// src/api/services/admin/geoAnalyticsService.js
//
// Analytics géographiques : classement des pays par 5 indicateurs
// (revenu, ventes, nouveaux users, conversion, croissance) sur une période
// glissante (jour / semaine / mois / custom).
//
// Toutes les sommes de revenu sont converties en XAF pour comparabilité.
// La conversion vient du service subscriptionManagementService.

const User = require('../../models/user/User');
const Subscription = require('../../models/common/Subscription');
const { convertToXAF } = require('./subscriptionManagementService');

/**
 * Construit la borne de période. Si startDate/endDate fournis → custom.
 * Sinon utilise `period` (day | week | month).
 */
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

/**
 * Construit la période précédente de même longueur (pour calcul croissance).
 * Ex: si periode = 1-7 oct, previousPeriod = 24-30 sept.
 */
function buildPreviousPeriod({ start, end }) {
  if (!start || !end) return { start: null, end: null };
  const span = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - span),
    end: new Date(start.getTime()),
  };
}

function buildSubMatch(appId, range) {
  const match = { isGift: { $ne: true } };
  if (appId && appId !== 'all') match.appId = appId;
  if (range.start || range.end) {
    match.createdAt = {};
    if (range.start) match.createdAt.$gte = range.start;
    if (range.end) match.createdAt.$lt = range.end;
  }
  return match;
}

function buildUserMatch(appId, range) {
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
 * Top pays par REVENU (en XAF).
 * Joine Subscription → User pour récupérer countryCode.
 */
async function topByRevenue(appId, range) {
  const result = await Subscription.aggregate([
    { $match: buildSubMatch(appId, range) },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          country: '$userDoc.countryCode',
          currency: '$pricing.currency',
        },
        amount: { $sum: '$pricing.amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  // Pivoter par pays + convertir en XAF
  const byCountry = {};
  for (const row of result) {
    const country = (row._id.country || 'UNKNOWN').toUpperCase();
    const currency = row._id.currency;
    if (!byCountry[country]) byCountry[country] = { revenueXAF: 0, count: 0 };
    byCountry[country].revenueXAF += convertToXAF(row.amount, currency);
    byCountry[country].count += row.count;
  }

  return Object.entries(byCountry)
    .map(([countryCode, v]) => ({ countryCode, revenueXAF: v.revenueXAF, count: v.count }))
    .sort((a, b) => b.revenueXAF - a.revenueXAF);
}

/**
 * Top pays par NOUVEAUX USERS.
 */
async function topByNewUsers(appId, range) {
  const result = await User.aggregate([
    { $match: buildUserMatch(appId, range) },
    {
      $group: {
        _id: '$countryCode',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);
  return result.map((r) => ({
    countryCode: (r._id || 'UNKNOWN').toUpperCase(),
    count: r.count,
  }));
}

/**
 * Top pays par TAUX DE CONVERSION (users payants / users total) sur la période.
 * On compte un user comme "payant" s'il a au moins 1 subscription validée
 * (status SUCCESS-like) sur la période.
 */
async function topByConversion(appId, range) {
  // Total users par pays (créés sur la période)
  const usersByCountry = await User.aggregate([
    { $match: buildUserMatch(appId, range) },
    {
      $group: {
        _id: '$countryCode',
        total: { $sum: 1 },
      },
    },
  ]);

  // Users payants par pays (au moins 1 sub sur la période)
  const buyersByCountry = await Subscription.aggregate([
    { $match: buildSubMatch(appId, range) },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { country: '$userDoc.countryCode', user: '$user' },
      },
    },
    {
      $group: {
        _id: '$_id.country',
        buyers: { $sum: 1 },
      },
    },
  ]);

  const totalMap = Object.fromEntries(
    usersByCountry.map((r) => [(r._id || 'UNKNOWN').toUpperCase(), r.total])
  );
  const buyersMap = Object.fromEntries(
    buyersByCountry.map((r) => [(r._id || 'UNKNOWN').toUpperCase(), r.buyers])
  );

  const allCountries = new Set([...Object.keys(totalMap), ...Object.keys(buyersMap)]);
  return Array.from(allCountries)
    .map((c) => {
      const total = totalMap[c] || 0;
      const buyers = buyersMap[c] || 0;
      const rate = total > 0 ? (buyers / total) * 100 : 0;
      return { countryCode: c, total, buyers, conversionRate: rate };
    })
    .filter((r) => r.total >= 5) // ignorer pays avec <5 users (statistiquement non-fiable)
    .sort((a, b) => b.conversionRate - a.conversionRate);
}

/**
 * Top pays par CROISSANCE (revenu période vs période précédente).
 * Renvoie pour chaque pays : revCurrent, revPrevious, growthPct.
 */
async function topByGrowth(appId, range) {
  const previous = buildPreviousPeriod(range);

  const [current, prev] = await Promise.all([
    topByRevenue(appId, range),
    topByRevenue(appId, previous),
  ]);

  const prevMap = Object.fromEntries(prev.map((p) => [p.countryCode, p.revenueXAF]));
  const currMap = Object.fromEntries(current.map((c) => [c.countryCode, c.revenueXAF]));

  const allCountries = new Set([...Object.keys(prevMap), ...Object.keys(currMap)]);
  return Array.from(allCountries)
    .map((c) => {
      const cur = currMap[c] || 0;
      const pre = prevMap[c] || 0;
      let growthPct = 0;
      if (pre > 0) growthPct = ((cur - pre) / pre) * 100;
      else if (cur > 0) growthPct = 100; // pays nouveau (0 → X) = +100% conventionnel
      return { countryCode: c, revenueXAF: cur, previousRevenueXAF: pre, growthPct };
    })
    .filter((r) => r.revenueXAF > 0 || r.previousRevenueXAF > 0)
    .sort((a, b) => b.growthPct - a.growthPct);
}

/**
 * Endpoint principal : retourne les 5 classements en parallèle.
 */
async function getGeoAnalytics({ appId, period, startDate, endDate, limit = 10 }) {
  const range = buildPeriodRange({ period, startDate, endDate });

  const [revenue, newUsers, conversion, growth] = await Promise.all([
    topByRevenue(appId, range),
    topByNewUsers(appId, range),
    topByConversion(appId, range),
    topByGrowth(appId, range),
  ]);

  // "Top par ventes" = même tri que revenu mais sur le `count` cumulé
  const sales = revenue
    .map((r) => ({ countryCode: r.countryCode, count: r.count }))
    .sort((a, b) => b.count - a.count);

  return {
    period: { start: range.start, end: range.end },
    topByRevenue: revenue.slice(0, limit),
    topBySales: sales.slice(0, limit),
    topByNewUsers: newUsers.slice(0, limit),
    topByConversion: conversion.slice(0, limit),
    topByGrowth: growth.slice(0, limit),
  };
}

module.exports = {
  getGeoAnalytics,
};
