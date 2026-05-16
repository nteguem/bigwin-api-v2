// scripts/diagnose-afribapay-full.js
//
// Diagnostic AfribaPay EXHAUSTIF : pour CHAQUE combo (pays, opérateur, devise)
// présent dans la conf LIVE AfribaPay (GET /api/payments/afribapay/countries),
// tente une initiation via l'API prod et consigne la réponse complète dans un
// rapport Markdown.
//
// ⚠️ Crée une nouvelle transaction PENDING côté backend pour chaque initiation
// réussie. À usage diagnostique uniquement.
//
// Téléphone par combo : on essaie de récupérer le dernier `phoneNumber` connu
// pour ce combo (pour garantir un format valide), sinon fallback sur un
// placeholder `<prefix>50000000`.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const API_BASE = process.env.DIAG_API_BASE || 'https://api-new.proxidream.com';
const APP_ID = process.env.DIAG_APP_ID || 'bigwin';
const REPORT_PATH = path.join(__dirname, 'afribapay-full-diagnostic.md');

// Charger les modèles
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Package'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'user', 'User'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Subscription'));

const Package = mongoose.model('Package');
const User = mongoose.model('User');
const Subscription = mongoose.model('Subscription');
const AfribaPayTransaction = require(path.join(
  __dirname, '..', 'src', 'api', 'models', 'user', 'AfribaPayTransaction'
));

function signJwt(userId) {
  return jwt.sign({ id: String(userId), type: 'user' }, process.env.JWT_USER_SECRET, { expiresIn: '1h' });
}

(async () => {
  if (!process.env.MONGO_URI || !process.env.JWT_USER_SECRET) {
    console.error('❌ MONGO_URI ou JWT_USER_SECRET manquant');
    process.exit(1);
  }

  console.log('🔌 Connexion Mongo (prod)…');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connecté');

  // 1) Conf live AfribaPay
  console.log(`📡 GET ${API_BASE}/api/payments/afribapay/countries (x-app-id: ${APP_ID})`);
  const confRes = await axios.get(`${API_BASE}/api/payments/afribapay/countries`, {
    headers: { 'x-app-id': APP_ID }, timeout: 30000, validateStatus: () => true,
  });
  if (confRes.status !== 200 || !confRes.data?.success) {
    console.error('❌ /countries response not OK', confRes.status, JSON.stringify(confRes.data).slice(0, 200));
    process.exit(1);
  }
  const liveConf = confRes.data.data.countries;
  console.log(`✓ ${Object.keys(liveConf).length} pays en live`);

  // 2) Utilisateur de test : un user de l'app sans abonnement actif
  console.log(`🔍 Recherche d'un user ${APP_ID} sans abonnement actif…`);
  const candidates = await User.find({ appId: APP_ID, isActive: true }).limit(80);
  let testUser = null;
  for (const u of candidates) {
    const subs = await Subscription.find({
      user: u._id,
      status: { $in: ['active', 'ACTIVE'] },
      endDate: { $gt: new Date() }
    });
    if (subs.length === 0) { testUser = u; break; }
  }
  if (!testUser) {
    console.error('❌ Aucun user sans abonnement actif trouvé pour ' + APP_ID);
    process.exit(1);
  }
  console.log(`✓ User : ${testUser.email || '(no email)'} (${testUser._id})`);

  // 3) Package : le moins cher de l'app, isActive
  console.log(`🔍 Recherche d'un package ${APP_ID} actif…`);
  const pkg = await Package.findOne({ appId: APP_ID, isActive: true }).sort({ 'pricing.XOF': 1 });
  if (!pkg) {
    console.error('❌ Aucun package actif pour ' + APP_ID);
    process.exit(1);
  }
  const pkgLabel = (pkg.name && (pkg.name.fr || pkg.name.en)) || String(pkg.name) || '(no name)';
  console.log(`✓ Package : ${pkgLabel} (${pkg._id})`);

  const userJwt = signJwt(testUser._id);

  // 4) Pour CHAQUE (country × operator × currency) de la live, initiate
  const results = [];
  const countries = Object.keys(liveConf).sort();
  let i = 0;
  for (const country of countries) {
    const cData = liveConf[country];
    const prefix = cData.prefix || '';
    for (const [currency, currencyData] of Object.entries(cData.currencies || {})) {
      for (const op of currencyData.operators || []) {
        i++;
        // Téléphone : on récupère le dernier `phoneNumber` connu pour ce combo
        // (garantit un format valide), sinon fallback placeholder.
        const past = await AfribaPayTransaction.findOne({
          country, operator: op.operator_code, currency
        }).sort({ createdAt: -1 }).select('phoneNumber');
        const phone = past?.phoneNumber || `${prefix}50000000`;
        const phoneSource = past?.phoneNumber ? 'past tx' : 'placeholder';

        const combo = `${country}/${op.operator_code}/${currency}`;
        console.log(`  [${i}] ▶️ ${combo}  phone=${phone} (${phoneSource})`);

        const t0 = Date.now();
        let response;
        try {
          const r = await axios.post(
            `${API_BASE}/api/payments/afribapay/initiate`,
            {
              packageId: String(pkg._id),
              phoneNumber: phone,
              operator: op.operator_code,
              country,
              currency,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'x-app-id': APP_ID,
                'Authorization': `Bearer ${userJwt}`,
              },
              validateStatus: () => true,
              timeout: 30000,
            }
          );
          response = { ok: true, status: r.status, body: r.data, ms: Date.now() - t0 };
        } catch (e) {
          response = { ok: false, status: 0, error: e.message, code: e.code, ms: Date.now() - t0 };
        }

        results.push({
          country,
          countryName: cData.country_name,
          countryFlag: cData.country_flag,
          prefix,
          operator: op.operator_code,
          operatorName: op.operator_name,
          currency,
          otpRequired: Number(op.otp_required) ? 1 : 0,
          wallet: Number(op.wallet) ? 1 : 0,
          phone, phoneSource,
          response
        });
      }
    }
  }

  await mongoose.disconnect();
  console.log('🔌 Déconnecté Mongo');

  // 5) Rapport Markdown
  const lines = [];
  lines.push(`# Diagnostic AfribaPay — initiate COMPLET (tous les combos live)`);
  lines.push('');
  lines.push(`Date : ${new Date().toISOString().slice(0, 19)}Z`);
  lines.push(`Backend : \`${API_BASE}\`  |  App : \`${APP_ID}\``);
  lines.push(`User : \`${testUser.email || '(no email)'}\` (\`${testUser._id}\`)`);
  lines.push(`Package : \`${pkgLabel}\` (\`${pkg._id}\`)`);
  lines.push(`Combos testés : **${results.length}** sur **${countries.length}** pays live`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 5.a — Synthèse
  lines.push('## 1. Synthèse globale');
  lines.push('');
  lines.push('| Pays | Opérateur | Devise | OTP | Wallet | Phone | HTTP | Code erreur | Verdict |');
  lines.push('|---|---|---|---:|---:|---|---:|---|---|');
  for (const r of results) {
    const verdict = !r.response.ok ? `❌ réseau (${r.response.code || 'err'})`
      : r.response.status === 201 ? '✅ 201 initiée'
      : r.response.status === 200 ? '✅ 200'
      : (r.response.status === 400 && r.response.body?.error?.code === 'OTP_REQUIRED') ? '🔑 OTP requis'
      : (r.response.status === 400 && r.response.body?.error?.code === 'AFRIBAPAY_ERROR') ? '⛔ AfribaPay rejette'
      : (r.response.status === 400 && r.response.body?.error?.code === 'VALIDATION_ERROR') ? '⛔ validation'
      : `⚠️ ${r.response.status}`;
    const errCode = r.response.body?.error?.code
      || (r.response.status >= 200 && r.response.status < 300 ? '—' : '?');
    lines.push(`| ${r.countryFlag || ''} ${r.country} | \`${r.operator}\` | ${r.currency} | ${r.otpRequired} | ${r.wallet} | \`${r.phone}\` (${r.phoneSource}) | ${r.response.status || 'X'} | ${errCode} | ${verdict} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 5.b — Détail par combo
  lines.push('## 2. Détail par combo (réponse complète de l\'API)');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.countryFlag || ''} ${r.country} — \`${r.operator}\` (${r.currency})`);
    lines.push('');
    lines.push(`- ${r.countryName ? `Pays : **${r.countryName}**` : ''}`);
    lines.push(`- Opérateur : **${r.operatorName || r.operator}** (\`${r.operator}\`)`);
    lines.push(`- Conf live : \`otp_required=${r.otpRequired}\`, \`wallet=${r.wallet}\`, prefix \`${r.prefix}\``);
    lines.push(`- Téléphone testé : \`${r.phone}\` (source : ${r.phoneSource})`);
    if (!r.response.ok) {
      lines.push(`- ❌ **Erreur réseau** : \`${r.response.error}\` (code \`${r.response.code || ''}\`), ${r.response.ms} ms`);
    } else {
      lines.push(`- **HTTP** : ${r.response.status} (${r.response.ms} ms)`);
      lines.push(`- **Body** :`);
      lines.push('```json');
      lines.push(JSON.stringify(r.response.body, null, 2));
      lines.push('```');
    }
    lines.push('');
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  console.log(`✅ Rapport écrit : ${REPORT_PATH}`);
})().catch(err => {
  console.error('💥 Diagnostic échoué :', err);
  process.exit(1);
});
