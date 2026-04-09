// src/api/services/admin/admobService.js
// Service pour récupérer les stats AdMob via l'API Google

const { google } = require('googleapis');
const logger = require('../../../utils/logger');

const ADMOB_CONFIG = {
  clientId: process.env.ADMOB_CLIENT_ID,
  clientSecret: process.env.ADMOB_CLIENT_SECRET,
  refreshToken: process.env.ADMOB_REFRESH_TOKEN,
  publisherId: process.env.ADMOB_PUBLISHER_ID || 'pub-1782439846938659',
};

// OAuth2 client singleton
let oauth2Client = null;

function getOAuth2Client() {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      ADMOB_CONFIG.clientId,
      ADMOB_CONFIG.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({
      refresh_token: ADMOB_CONFIG.refreshToken,
    });
  }
  return oauth2Client;
}

/**
 * Formater une date en YYYY-MM-DD pour l'API AdMob
 */
function formatDateForApi(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/**
 * Appeler l'API AdMob Network Report
 */
async function fetchNetworkReport(startDate, endDate, dimensions = [], metrics = []) {
  const auth = getOAuth2Client();
  const admob = google.admob({ version: 'v1', auth });

  const accountName = `accounts/${ADMOB_CONFIG.publisherId}`;

  const requestBody = {
    reportSpec: {
      dateRange: {
        startDate: formatDateForApi(startDate),
        endDate: formatDateForApi(endDate),
      },
      dimensions,
      metrics,
    },
  };

  const response = await admob.accounts.networkReport.generate({
    parent: accountName,
    requestBody,
  });

  return response.data;
}

/**
 * Parser les résultats de l'API AdMob
 */
function parseReportRows(data) {
  // L'API retourne un array d'objets, le premier est le header, les suivants sont les rows
  if (!Array.isArray(data) || data.length === 0) return [];

  return data
    .filter(item => item.row)
    .map(item => {
      const row = item.row;
      const result = {};

      // Dimensions
      if (row.dimensionValues) {
        for (const [key, val] of Object.entries(row.dimensionValues)) {
          result[key] = val.value || val.displayLabel || null;
        }
      }

      // Metrics
      if (row.metricValues) {
        for (const [key, val] of Object.entries(row.metricValues)) {
          if (val.microsValue) {
            // Les montants sont en micro-unités (1/1 000 000)
            result[key] = parseFloat(val.microsValue) / 1_000_000;
          } else if (val.integerValue) {
            result[key] = parseInt(val.integerValue);
          } else {
            result[key] = val.doubleValue || 0;
          }
        }
      }

      return result;
    });
}

/**
 * Récupérer les stats AdMob pour le dashboard
 * Retourne : today, yesterday, thisMonth, lastMonth
 */
async function getAdmobDashboardStats() {
  const now = new Date();

  // Dates
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // dernier jour du mois précédent

  const metrics = [
    'ESTIMATED_EARNINGS',
    'IMPRESSIONS',
    'CLICKS',
    'AD_REQUESTS',
    'MATCHED_REQUESTS',
  ];

  // Fetch les 4 périodes en parallèle
  const [todayData, yesterdayData, thisMonthData, lastMonthData] = await Promise.all([
    // Aujourd'hui
    fetchNetworkReport(today, today, ['DATE'], metrics)
      .catch(err => { logger.error('[ADMOB] Erreur today:', err.message); return []; }),

    // Hier
    fetchNetworkReport(yesterday, yesterday, ['DATE'], metrics)
      .catch(err => { logger.error('[ADMOB] Erreur yesterday:', err.message); return []; }),

    // Ce mois
    fetchNetworkReport(thisMonthStart, today, [], metrics)
      .catch(err => { logger.error('[ADMOB] Erreur thisMonth:', err.message); return []; }),

    // Mois dernier
    fetchNetworkReport(lastMonthStart, lastMonthEnd, [], metrics)
      .catch(err => { logger.error('[ADMOB] Erreur lastMonth:', err.message); return []; }),
  ]);

  const parsePeriod = (data) => {
    const rows = parseReportRows(data);
    if (rows.length === 0) {
      return { earnings: 0, impressions: 0, clicks: 0, adRequests: 0, matchedRequests: 0 };
    }
    // Agréger toutes les rows (si dimensions = DATE, il y a 1 row par jour)
    return rows.reduce((acc, row) => ({
      earnings: acc.earnings + (row.ESTIMATED_EARNINGS || 0),
      impressions: acc.impressions + (row.IMPRESSIONS || 0),
      clicks: acc.clicks + (row.CLICKS || 0),
      adRequests: acc.adRequests + (row.AD_REQUESTS || 0),
      matchedRequests: acc.matchedRequests + (row.MATCHED_REQUESTS || 0),
    }), { earnings: 0, impressions: 0, clicks: 0, adRequests: 0, matchedRequests: 0 });
  };

  return {
    today: parsePeriod(todayData),
    yesterday: parsePeriod(yesterdayData),
    thisMonth: parsePeriod(thisMonthData),
    lastMonth: parsePeriod(lastMonthData),
    currency: 'EUR', // AdMob affiche en devise du compte
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Récupérer les stats par app AdMob (today + thisMonth)
 */
async function getAdmobStatsByApp() {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const metrics = ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'CLICKS'];

  const [todayData, monthData] = await Promise.all([
    fetchNetworkReport(today, today, ['APP'], metrics)
      .catch(err => { logger.error('[ADMOB] Erreur byApp today:', err.message); return []; }),
    fetchNetworkReport(thisMonthStart, today, ['APP'], metrics)
      .catch(err => { logger.error('[ADMOB] Erreur byApp month:', err.message); return []; }),
  ]);

  const todayRows = parseReportRows(todayData);
  const monthRows = parseReportRows(monthData);

  // Merge: use monthRows as base, attach today data
  const todayMap = {};
  todayRows.forEach(row => { todayMap[row.APP] = row; });

  return monthRows.map(row => ({
    app: row.APP,
    today: {
      earnings: todayMap[row.APP]?.ESTIMATED_EARNINGS || 0,
      impressions: todayMap[row.APP]?.IMPRESSIONS || 0,
      clicks: todayMap[row.APP]?.CLICKS || 0,
    },
    thisMonth: {
      earnings: row.ESTIMATED_EARNINGS || 0,
      impressions: row.IMPRESSIONS || 0,
      clicks: row.CLICKS || 0,
    },
  }));
}

module.exports = {
  getAdmobDashboardStats,
  getAdmobStatsByApp,
};
