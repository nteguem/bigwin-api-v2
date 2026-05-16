// scripts/diagnose-afribapay.js
//
// Diagnostic AfribaPay : pour chaque pays supporté (data/payments/afribapayData.json),
//  1) statistiques DB des 7 derniers jours (par pays / opérateur / status),
//  2) rejoue UNE initiation par pays via l'API prod (`api-new.proxidream.com`)
//     en réutilisant les paramètres d'une transaction récente (préf. PENDING/FAILED),
//  3) écrit un rapport Markdown dans scripts/afribapay-diagnostic.md.
//
// Usage : `node scripts/diagnose-afribapay.js`
//
// ⚠️ Le rejeu d'initiation crée une NOUVELLE transaction côté backend +
// déclenche potentiellement un prompt USSD côté user (on réutilise son numéro).
// L'objectif est purement diagnostique : on logue la réponse, on ne suit pas le
// flow jusqu'à la confirmation.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const AFRIBAPAY_CONF = require(path.join(__dirname, '..', 'data', 'payments', 'afribapayData.json'));

const API_BASE = process.env.DIAG_API_BASE || 'https://api-new.proxidream.com';
const LOOKBACK_DAYS = 7;
const REPORT_PATH = path.join(__dirname, 'afribapay-diagnostic.md');

require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Package'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'user', 'User'));
const AfribaPayTransaction = require(path.join(
  __dirname, '..', 'src', 'api', 'models', 'user', 'AfribaPayTransaction'
));

function signUserJwt(userId) {
  return jwt.sign(
    { id: String(userId), type: 'user' },
    process.env.JWT_USER_SECRET,
    { expiresIn: '1h' }
  );
}

async function initiate({ appId, jwtToken, packageId, phoneNumber, operator, country, currency }) {
  const url = `${API_BASE}/api/payments/afribapay/initiate`;
  const t0 = Date.now();
  try {
    const res = await axios.post(url, {
      packageId, phoneNumber, operator, country, currency
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': appId,
        'Authorization': `Bearer ${jwtToken}`
      },
      validateStatus: () => true, // on capture tout, on ne throw pas
      timeout: 30000
    });
    return { ok: true, status: res.status, body: res.data, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, body: null, ms: Date.now() - t0, error: e.message, code: e.code };
  }
}

(async () => {
  if (!process.env.MONGO_URI || !process.env.JWT_USER_SECRET) {
    console.error('❌ MONGO_URI ou JWT_USER_SECRET manquant dans .env');
    process.exit(1);
  }

  console.log(`🔌 Connexion Mongo (prod)…`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✓ Connecté`);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
  const countries = Object.keys(AFRIBAPAY_CONF);

  // ─── 1) Stats DB globales (par app / pays / status) sur la fenêtre ────────
  console.log(`📊 Agrégation des transactions des ${LOOKBACK_DAYS} derniers jours…`);
  const globalStats = await AfribaPayTransaction.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: {
        _id: { appId: '$appId', country: '$country', operator: '$operator', status: '$status' },
        count: { $sum: 1 },
        lastAt: { $max: '$createdAt' }
      } },
    { $sort: { '_id.appId': 1, '_id.country': 1, '_id.operator': 1, '_id.status': 1 } }
  ]);
  console.log(`✓ ${globalStats.length} lignes d'agrégation`);

  // ─── 2) Pour chaque pays : choisir UNE transaction récente à rejouer ──────
  // Ordre de préférence : PENDING > FAILED > tout statut (le plus récent).
  // Pour la diversité, on cherche d'abord en `bigwin` puis n'importe quelle app.
  const STATUS_PRIORITY = ['PENDING', 'pending', 'FAILED', 'failed'];
  const replays = [];

  for (const country of countries) {
    let chosen = null;

    // priorité aux statuts PENDING/FAILED
    for (const status of STATUS_PRIORITY) {
      chosen = await AfribaPayTransaction.findOne({ country, status, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .populate('package')
        .populate('user');
      if (chosen) break;
    }
    // fallback : n'importe quel statut récent
    if (!chosen) {
      chosen = await AfribaPayTransaction.findOne({ country, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .populate('package')
        .populate('user');
    }

    if (!chosen) {
      replays.push({ country, skipped: 'no transaction in the lookback window' });
      console.log(`  ${country} → aucune transaction sur ${LOOKBACK_DAYS}j, skip`);
      continue;
    }

    if (!chosen.user || !chosen.package) {
      replays.push({
        country, skipped: 'user or package missing on the chosen transaction',
        transactionId: chosen.transactionId, status: chosen.status
      });
      console.log(`  ${country} → tx ${chosen.transactionId} mais user/package null, skip`);
      continue;
    }

    const jwtToken = signUserJwt(chosen.user._id);
    console.log(`  ${country} → rejeu (${chosen.operator}/${chosen.currency}, status=${chosen.status}, app=${chosen.appId})…`);
    const reply = await initiate({
      appId: chosen.appId,
      jwtToken,
      packageId: String(chosen.package._id),
      phoneNumber: chosen.phoneNumber,
      operator: chosen.operator,
      country,
      currency: chosen.currency
    });

    replays.push({
      country,
      source: {
        transactionId: chosen.transactionId,
        orderId: chosen.orderId,
        appId: chosen.appId,
        userId: String(chosen.user._id),
        userEmail: chosen.user.email || null,
        packageId: String(chosen.package._id),
        packageName: chosen.package.name || null,
        operator: chosen.operator,
        currency: chosen.currency,
        phoneNumber: chosen.phoneNumber,
        amount: chosen.amount,
        status: chosen.status,
        createdAt: chosen.createdAt,
        originalProviderId: chosen.providerId || null,
        originalProviderLink: chosen.providerLink || null,
        webhookReceived: chosen.webhookReceived,
      },
      replay: reply
    });
  }

  await mongoose.disconnect();
  console.log(`🔌 Déconnecté Mongo`);

  // ─── 3) Génération du rapport Markdown ───────────────────────────────────
  const lines = [];
  lines.push(`# Diagnostic AfribaPay — ${new Date().toISOString().slice(0, 19)}Z`);
  lines.push('');
  lines.push(`Fenêtre d'analyse : **${LOOKBACK_DAYS} derniers jours** (depuis ${since.toISOString()}).`);
  lines.push(`Backend testé : \`${API_BASE}\``);
  lines.push(`Conf source : \`data/payments/afribapayData.json\` — ${countries.length} pays.`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3.a — Stats globales
  lines.push('## 1. Statistiques DB (toutes apps confondues)');
  lines.push('');
  lines.push('### Vue par pays × opérateur × status');
  lines.push('');
  lines.push('| App | Pays | Opérateur | Status | Count | Dernière tx |');
  lines.push('|---|---|---|---|---:|---|');
  for (const row of globalStats) {
    const { appId, country, operator, status } = row._id;
    const last = row.lastAt ? new Date(row.lastAt).toISOString().slice(0, 19).replace('T', ' ') : '—';
    lines.push(`| ${appId} | ${country} | ${operator} | ${status} | ${row.count} | ${last} |`);
  }
  lines.push('');

  // 3.b — Vue résumée par pays (succès / pending / failed)
  const perCountry = new Map(); // country → { ok, pending, failed, other }
  for (const row of globalStats) {
    const c = row._id.country;
    if (!perCountry.has(c)) perCountry.set(c, { ok: 0, pending: 0, failed: 0, other: 0, total: 0 });
    const s = (row._id.status || '').toUpperCase();
    const e = perCountry.get(c);
    e.total += row.count;
    if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(s)) e.ok += row.count;
    else if (s === 'PENDING') e.pending += row.count;
    else if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(s)) e.failed += row.count;
    else e.other += row.count;
  }
  lines.push('### Synthèse par pays');
  lines.push('');
  lines.push('| Pays | Total | ✅ Success | ⏳ Pending | ❌ Failed | ❓ Autre | Taux succès |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const country of countries) {
    const e = perCountry.get(country) || { ok: 0, pending: 0, failed: 0, other: 0, total: 0 };
    const rate = e.total > 0 ? `${((e.ok / e.total) * 100).toFixed(1)}%` : '—';
    lines.push(`| ${country} ${AFRIBAPAY_CONF[country].country_flag} | ${e.total} | ${e.ok} | ${e.pending} | ${e.failed} | ${e.other} | ${rate} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3.c — Rejeu par pays
  lines.push('## 2. Rejeu d\'une initiation par pays via l\'API prod');
  lines.push('');
  lines.push('Pour chaque pays, on a sélectionné UNE transaction récente (priorité ' +
    '`PENDING` → `FAILED` → autre), récupéré son user/package, généré un JWT user ' +
    'et rejoué `POST /api/payments/afribapay/initiate` avec les mêmes paramètres.');
  lines.push('');

  for (const r of replays) {
    const flag = AFRIBAPAY_CONF[r.country].country_flag;
    const name = AFRIBAPAY_CONF[r.country].country_name;
    lines.push(`### ${flag} ${r.country} — ${name}`);
    lines.push('');

    if (r.skipped) {
      lines.push(`> ⚠️ **Skip** : ${r.skipped}`);
      lines.push('');
      continue;
    }

    const s = r.source;
    lines.push('**Transaction source :**');
    lines.push('');
    lines.push('| Champ | Valeur |');
    lines.push('|---|---|');
    lines.push(`| App | \`${s.appId}\` |`);
    lines.push(`| Opérateur | \`${s.operator}\` |`);
    lines.push(`| Devise | \`${s.currency}\` |`);
    lines.push(`| Téléphone | \`${s.phoneNumber}\` |`);
    lines.push(`| Montant | ${s.amount} ${s.currency} |`);
    lines.push(`| Package | ${s.packageName ? `\`${s.packageName}\` (${s.packageId})` : `\`${s.packageId}\``} |`);
    lines.push(`| User | ${s.userEmail || '—'} (\`${s.userId}\`) |`);
    lines.push(`| transactionId | \`${s.transactionId}\` |`);
    lines.push(`| orderId | \`${s.orderId}\` |`);
    lines.push(`| Status d'origine | **${s.status}** |`);
    lines.push(`| providerId | \`${s.originalProviderId || '—'}\` |`);
    lines.push(`| providerLink | ${s.originalProviderLink ? `\`${s.originalProviderLink}\`` : '—'} |`);
    lines.push(`| webhookReceived | ${s.webhookReceived} |`);
    lines.push(`| createdAt | ${new Date(s.createdAt).toISOString()} |`);
    lines.push('');

    const rep = r.replay;
    lines.push('**Réponse du rejeu :**');
    lines.push('');
    if (!rep.ok) {
      lines.push(`> ❌ Erreur réseau : \`${rep.error}\` (code \`${rep.code}\`), ${rep.ms} ms`);
    } else {
      const verdict = rep.status === 201 ? '✅ 201 (initiation acceptée)'
        : rep.status === 200 ? '✅ 200'
        : `⚠️ ${rep.status}`;
      lines.push(`- **HTTP** : ${verdict} (${rep.ms} ms)`);
      lines.push('- **Body** :');
      lines.push('```json');
      lines.push(JSON.stringify(rep.body, null, 2));
      lines.push('```');
    }
    lines.push('');
  }

  // 3.d — Notes
  lines.push('---');
  lines.push('');
  lines.push('## 3. Notes');
  lines.push('');
  lines.push('- Les rejeux **créent une nouvelle transaction** côté backend et peuvent ' +
    'déclencher un prompt USSD chez l\'utilisateur source. À titre purement diagnostique.');
  lines.push('- Les statuts `PENDING` peuvent être normaux (transaction en attente du webhook) ' +
    'mais aussi traduire des webhooks AfribaPay qui ne sont jamais arrivés.');
  lines.push('- Le `providerId` vide + `providerLink` vide à l\'initiation peut indiquer que ' +
    'AfribaPay a refusé la requête côté API avant même de créer une référence opérateur.');
  lines.push('- Comparer le **taux de succès** de la synthèse par pays avec les 30 jours précédents ' +
    'pour confirmer une dégradation soudaine.');
  lines.push('');

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  console.log(`✅ Rapport écrit : ${REPORT_PATH}`);
})().catch(err => {
  console.error('💥 Diagnostic échoué :', err);
  process.exit(1);
});
