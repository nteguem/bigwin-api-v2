// src/api/services/admin/transactionsAnalyticsService.js
//
// Analytics transactions : agrège les tentatives de paiement de TOUS les
// PSPs (CinetPay, AfribaPay, Smobilpay, Korapay, Fedapay, Flutterwave,
// GooglePlay) en une vue unifiée.
//
// Le challenge : chaque PSP a ses propres statuses. On normalise tout
// vers `success | pending | failed` pour pouvoir comparer.

const CinetpayTransaction = require('../../models/user/CinetpayTransaction');
const AfribaPayTransaction = require('../../models/user/AfribaPayTransaction');
const SmobilpayTransaction = require('../../models/user/SmobilpayTransaction');
const KorapayTransaction = require('../../models/user/KorapayTransaction');
const FedapayTransaction = require('../../models/user/FedapayTransaction');
const FlutterwaveTransaction = require('../../models/user/FlutterwaveTransaction');
const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
const { convertToXAF } = require('./subscriptionManagementService');

/**
 * Normalise un status PSP brut vers {success, pending, failed}.
 * Couvre les 7 PSPs avec leurs vocabulaires différents.
 */
function normalizeStatus(rawStatus) {
  if (!rawStatus) return 'pending';
  const s = String(rawStatus).trim().toUpperCase();

  // SUCCESS-like
  if (['ACCEPTED', 'APPROVED', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'ACTIVE'].includes(s)) {
    return 'success';
  }
  // FAILED-like (refus, annulé, expiré, erreur)
  if (
    ['REFUSED', 'DECLINED', 'FAILED', 'ERROR', 'ERRORED', 'CANCELED', 'CANCELLED',
      'EXPIRED', 'REJECTED', 'ON_HOLD'].includes(s)
  ) {
    return 'failed';
  }
  // tout le reste = pending (PROCESSING, WAITING_FOR_CUSTOMER, INITIATED, etc.)
  return 'pending';
}

function buildPeriodRange({ period, startDate, endDate }) {
  if (startDate || endDate) {
    return {
      start: startDate ? new Date(startDate) : null,
      end: endDate ? new Date(endDate) : null,
    };
  }
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  switch (period) {
    case 'day':
      start.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'month':
    default:
      start.setDate(start.getDate() - 30);
      break;
  }
  return { start, end };
}

function buildMatch(appId, range) {
  const match = {};
  if (appId && appId !== 'all') match.appId = appId;
  if (range.start || range.end) {
    match.createdAt = {};
    if (range.start) match.createdAt.$gte = range.start;
    if (range.end) match.createdAt.$lt = range.end;
  }
  return match;
}

/**
 * Charge toutes les transactions de tous les PSPs sur la période, en
 * gardant uniquement les champs pertinents pour les agrégats. On le fait
 * en une seule passe par PSP (une query allégée par collection).
 */
async function loadAllTransactions(appId, range) {
  const match = buildMatch(appId, range);
  const projection = {
    appId: 1, status: 1, currency: 1, amount: 1, country: 1,
    operator: 1, operatorName: 1, createdAt: 1,
  };

  const [cinet, afri, smob, kora, feda, fw, gp] = await Promise.all([
    CinetpayTransaction.find(match, projection).lean(),
    AfribaPayTransaction.find(match, projection).lean(),
    SmobilpayTransaction.find(match, projection).lean(),
    KorapayTransaction.find(match, projection).lean(),
    FedapayTransaction.find(match, projection).lean(),
    FlutterwaveTransaction.find(match, projection).lean(),
    GooglePlayTransaction.find(match, projection).lean(),
  ]);

  // Annoter chaque transaction avec son PSP source pour les agrégats
  const tag = (arr, psp) => arr.map((t) => ({ ...t, psp }));
  return [
    ...tag(cinet, 'cinetpay'),
    ...tag(afri, 'afribapay'),
    ...tag(smob, 'smobilpay'),
    ...tag(kora, 'korapay'),
    ...tag(feda, 'fedapay'),
    ...tag(fw, 'flutterwave'),
    ...tag(gp, 'googleplay'),
  ];
}

/**
 * KPIs globaux : total, success, failed, pending, success rate, revenue.
 */
function computeKpis(transactions) {
  const k = {
    total: 0,
    success: 0,
    pending: 0,
    failed: 0,
    successRate: 0,
    revenueXAF: 0,
  };
  for (const t of transactions) {
    k.total++;
    const norm = normalizeStatus(t.status);
    k[norm]++;
    if (norm === 'success' && t.amount) {
      k.revenueXAF += convertToXAF(t.amount, t.currency);
    }
  }
  k.successRate = k.total > 0 ? (k.success / k.total) * 100 : 0;
  return k;
}

/**
 * Agrégat par dimension (psp, country, operator).
 * Renvoie [{ key, total, success, pending, failed, successRate, revenueXAF }].
 */
function aggregateByDimension(transactions, getKey) {
  const map = {};
  for (const t of transactions) {
    const key = getKey(t);
    if (!key) continue;
    if (!map[key]) {
      map[key] = { key, total: 0, success: 0, pending: 0, failed: 0, revenueXAF: 0 };
    }
    map[key].total++;
    const norm = normalizeStatus(t.status);
    map[key][norm]++;
    if (norm === 'success' && t.amount) {
      map[key].revenueXAF += convertToXAF(t.amount, t.currency);
    }
  }
  return Object.values(map).map((row) => ({
    ...row,
    successRate: row.total > 0 ? (row.success / row.total) * 100 : 0,
  }));
}

/**
 * Endpoint principal — retourne toutes les vues d'analyse en une seule
 * passe sur les données.
 */
async function getTransactionsAnalytics({ appId, period, startDate, endDate, limit = 10 }) {
  const range = buildPeriodRange({ period, startDate, endDate });
  const transactions = await loadAllTransactions(appId, range);

  const kpis = computeKpis(transactions);

  const byPsp = aggregateByDimension(transactions, (t) => t.psp)
    .sort((a, b) => b.total - a.total);

  const byCountry = aggregateByDimension(transactions, (t) =>
    t.country ? t.country.toUpperCase() : null
  )
    .filter((r) => r.total >= 3)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  // Opérateur : on combine PSP+operator pour différencier "MTN CM" de "MTN CI"
  const byOperator = aggregateByDimension(transactions, (t) => {
    const op = t.operator || t.operatorName;
    if (!op) return null;
    const country = t.country ? t.country.toUpperCase() : '?';
    return `${op}|${country}`;
  })
    .filter((r) => r.total >= 3)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, limit)
    .map((r) => {
      const [operator, country] = r.key.split('|');
      return { ...r, operator, country };
    });

  // Liste des "pires" PSPs/opérateurs (success rate le plus bas) pour identifier
  // les problèmes — affiché en bonus côté UI.
  const worstByPsp = byPsp
    .filter((r) => r.total >= 5)
    .sort((a, b) => a.successRate - b.successRate)
    .slice(0, limit);

  return {
    period: { start: range.start, end: range.end },
    kpis,
    byPsp,
    byCountry,
    byOperator,
    worstByPsp,
  };
}

module.exports = {
  getTransactionsAnalytics,
};
