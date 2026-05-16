// scripts/audit-afribapay-conf.js
//
// Compare la conf AfribaPay LIVE (tirée en temps réel via notre route
// GET /api/payments/afribapay/countries qui interroge AfribaPay côté serveur)
// avec le fichier local data/payments/afribapayData.json. Repère :
//   - les pays présents dans le JSON local mais plus dans AfribaPay
//   - les pays présents dans AfribaPay mais absents du JSON local
//   - pour chaque opérateur commun : `otp_required` / `wallet` différent
//   - les opérateurs ajoutés ou retirés par AfribaPay
//
// Utile pour répondre « est-ce qu'AfribaPay a changé qqch côté serveur sans
// qu'on ait mis à jour notre conf locale ? »
//
// Usage : `node scripts/audit-afribapay-conf.js`

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const API_BASE = process.env.DIAG_API_BASE || 'https://api-new.proxidream.com';
const APP_ID = process.env.DIAG_APP_ID || 'bigwin';
const REPORT_PATH = path.join(__dirname, 'afribapay-conf-audit.md');

const LOCAL = require(path.join(__dirname, '..', 'data', 'payments', 'afribapayData.json'));

(async () => {
  console.log(`📡 GET ${API_BASE}/api/payments/afribapay/countries  (x-app-id: ${APP_ID})`);
  let live = null;
  try {
    const res = await axios.get(`${API_BASE}/api/payments/afribapay/countries`, {
      headers: { 'x-app-id': APP_ID },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data?.success) {
      console.error('❌ Réponse inattendue :', res.status, JSON.stringify(res.data).slice(0, 400));
      process.exit(1);
    }
    live = res.data.data.countries;
    console.log(`✓ ${Object.keys(live).length} pays récupérés (live)`);
  } catch (e) {
    console.error('❌ Échec appel /countries :', e.message);
    process.exit(1);
  }

  // ─── Diff ──────────────────────────────────────────────────────────────
  const localCodes = new Set(Object.keys(LOCAL));
  const liveCodes = new Set(Object.keys(live));

  const onlyLocal = [...localCodes].filter(c => !liveCodes.has(c)).sort();
  const onlyLive = [...liveCodes].filter(c => !localCodes.has(c)).sort();
  const common = [...localCodes].filter(c => liveCodes.has(c)).sort();

  // Pour chaque pays commun, comparer la liste d'opérateurs.
  function flatOperators(countryData) {
    const ops = [];
    for (const [currency, currencyData] of Object.entries(countryData.currencies || {})) {
      for (const op of currencyData.operators || []) {
        ops.push({
          currency,
          code: op.operator_code,
          name: op.operator_name,
          otp: Number(op.otp_required) ? 1 : 0,
          wallet: Number(op.wallet) ? 1 : 0,
          ussd: op.ussd_code || '',
        });
      }
    }
    return ops;
  }

  const perCountryDiff = []; // { country, removed, added, mismatches }
  for (const c of common) {
    const lLocal = flatOperators(LOCAL[c]);
    const lLive = flatOperators(live[c]);
    const localMap = new Map(lLocal.map(o => [`${o.currency}/${o.code}`, o]));
    const liveMap = new Map(lLive.map(o => [`${o.currency}/${o.code}`, o]));
    const removed = [...localMap.keys()].filter(k => !liveMap.has(k)).map(k => localMap.get(k));
    const added = [...liveMap.keys()].filter(k => !localMap.has(k)).map(k => liveMap.get(k));
    const mismatches = [];
    for (const [k, lo] of localMap) {
      const liv = liveMap.get(k);
      if (!liv) continue;
      const diffs = [];
      if (lo.otp !== liv.otp) diffs.push(`otp_required: ${lo.otp} → ${liv.otp}`);
      if (lo.wallet !== liv.wallet) diffs.push(`wallet: ${lo.wallet} → ${liv.wallet}`);
      if (diffs.length) mismatches.push({ key: k, local: lo, live: liv, diffs });
    }
    if (removed.length || added.length || mismatches.length) {
      perCountryDiff.push({ country: c, removed, added, mismatches });
    }
  }

  // ─── Rapport ───────────────────────────────────────────────────────────
  const out = [];
  out.push(`# Audit conf AfribaPay — local JSON vs API live`);
  out.push('');
  out.push(`Date : ${new Date().toISOString().slice(0, 19)}Z`);
  out.push(`Source live : \`GET ${API_BASE}/api/payments/afribapay/countries\` avec \`x-app-id: ${APP_ID}\``);
  out.push(`Source local : \`data/payments/afribapayData.json\``);
  out.push('');
  out.push(`Pays — local : **${localCodes.size}** ; live : **${liveCodes.size}** ; communs : **${common.length}**.`);
  out.push('');
  out.push(`> ⚠️ Le cache du serveur est mutualisé entre apps (pas par tenant). Cet audit reflète la conf vue par le serveur (premier app à avoir tapé /countries) — pour bigwin si \`cachedCountries\` était vide au moment de l'appel.`);
  out.push('');
  out.push('---');
  out.push('');

  out.push('## 1. Pays présents dans le JSON local mais ABSENTS de la conf live');
  out.push('');
  if (onlyLocal.length === 0) {
    out.push('_(aucun)_');
  } else {
    out.push('| Code | Nom | Devises locales |');
    out.push('|---|---|---|');
    for (const c of onlyLocal) {
      out.push(`| **${c}** ${LOCAL[c].country_flag || ''} | ${LOCAL[c].country_name} | ${Object.keys(LOCAL[c].currencies || {}).join(', ')} |`);
    }
    out.push('');
    out.push('→ AfribaPay ne propose plus ces pays côté merchant. À retirer du JSON local (et de l\'app) si confirmé.');
  }
  out.push('');

  out.push('## 2. Pays présents dans AfribaPay LIVE mais ABSENTS du JSON local');
  out.push('');
  if (onlyLive.length === 0) {
    out.push('_(aucun)_');
  } else {
    out.push('| Code | Nom | Devises live |');
    out.push('|---|---|---|');
    for (const c of onlyLive) {
      out.push(`| **${c}** ${live[c].country_flag || ''} | ${live[c].country_name} | ${Object.keys(live[c].currencies || {}).join(', ')} |`);
    }
    out.push('');
    out.push('→ AfribaPay a ouvert ces pays mais ils ne sont pas dans notre JSON local. L\'app ne les propose pas → revenus potentiels perdus.');
  }
  out.push('');

  out.push('## 3. Différences par pays (opérateurs ajoutés/retirés, `otp_required` / `wallet` qui ont changé)');
  out.push('');
  if (perCountryDiff.length === 0) {
    out.push('_(aucune divergence sur les pays communs)_');
  } else {
    for (const d of perCountryDiff) {
      const flag = LOCAL[d.country].country_flag || '';
      out.push(`### ${flag} ${d.country} — ${LOCAL[d.country].country_name}`);
      out.push('');
      if (d.mismatches.length) {
        out.push('**Champs qui ont changé :**');
        out.push('');
        out.push('| Opérateur (devise) | Local | Live | Diff |');
        out.push('|---|---|---|---|');
        for (const m of d.mismatches) {
          out.push(`| \`${m.local.code}\` (${m.local.currency}) | otp=${m.local.otp} wallet=${m.local.wallet} | otp=${m.live.otp} wallet=${m.live.wallet} | ${m.diffs.join(' ; ')} |`);
        }
        out.push('');
      }
      if (d.removed.length) {
        out.push('**Opérateurs présents en LOCAL, retirés en LIVE :**');
        out.push('');
        for (const o of d.removed) out.push(`- \`${o.code}\` (${o.name}, ${o.currency})`);
        out.push('');
      }
      if (d.added.length) {
        out.push('**Opérateurs nouveaux côté LIVE, absents du JSON local :**');
        out.push('');
        for (const o of d.added) out.push(`- \`${o.code}\` (${o.name}, ${o.currency}) — otp=${o.otp} wallet=${o.wallet}`);
        out.push('');
      }
    }
  }
  out.push('');

  out.push('## 4. Récap LIVE complet (référence)');
  out.push('');
  out.push('| Pays | Devise | Opérateur | otp_required | wallet |');
  out.push('|---|---|---|---:|---:|');
  for (const c of Object.keys(live).sort()) {
    for (const [cur, curData] of Object.entries(live[c].currencies || {})) {
      for (const op of curData.operators || []) {
        out.push(`| ${c} | ${cur} | ${op.operator_code} | ${Number(op.otp_required) ? '**1**' : 0} | ${Number(op.wallet) ? 1 : 0} |`);
      }
    }
  }
  out.push('');

  fs.writeFileSync(REPORT_PATH, out.join('\n'), 'utf8');
  console.log(`✅ Rapport écrit : ${REPORT_PATH}`);
})().catch(err => {
  console.error('💥 Audit échoué :', err);
  process.exit(1);
});
