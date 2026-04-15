const axios = require('axios');

const API_HOST = 'api-football-v1.p.rapidapi.com';
const BASE_URL = `https://${API_HOST}/v3`;
const CACHE_TTL_MS = 60 * 60 * 1000;
const QUOTA_BLOCK_THRESHOLD = 5;

const cache = new Map();
const quotaState = {
  limit: null,
  remaining: null,
  updatedAt: null
};

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

async function rapidGet(endpoint, params) {
  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    params,
    headers: {
      'x-rapidapi-key': process.env.RAPID_API_KEY,
      'x-rapidapi-host': API_HOST
    },
    timeout: 15000
  });
  updateQuotaFromHeaders(response.headers);
  return response.data;
}

function updateQuotaFromHeaders(headers) {
  if (!headers) return;
  const limit = parseInt(headers['x-ratelimit-requests-limit'], 10);
  const remaining = parseInt(headers['x-ratelimit-requests-remaining'], 10);
  if (!isNaN(limit)) quotaState.limit = limit;
  if (!isNaN(remaining)) quotaState.remaining = remaining;
  quotaState.updatedAt = new Date().toISOString();
}

exports.getQuota = () => ({
  limit: quotaState.limit,
  remaining: quotaState.remaining,
  updatedAt: quotaState.updatedAt,
  blockThreshold: QUOTA_BLOCK_THRESHOLD,
  blocked: quotaState.remaining != null && quotaState.remaining <= QUOTA_BLOCK_THRESHOLD
});

exports.refreshQuota = async () => {
  if (!process.env.RAPID_API_KEY) return exports.getQuota();
  try {
    const response = await axios.get(`${BASE_URL}/status`, {
      headers: {
        'x-rapidapi-key': process.env.RAPID_API_KEY,
        'x-rapidapi-host': API_HOST
      },
      timeout: 10000
    });
    updateQuotaFromHeaders(response.headers);
    const reqs = response.data?.response?.requests;
    if (reqs) {
      if (typeof reqs.limit_day === 'number') quotaState.limit = reqs.limit_day;
      if (typeof reqs.current === 'number' && typeof reqs.limit_day === 'number') {
        quotaState.remaining = Math.max(0, reqs.limit_day - reqs.current);
      }
      quotaState.updatedAt = new Date().toISOString();
    }
  } catch (_) {
    // silencieux — on retourne ce qu'on a
  }
  return exports.getQuota();
};

function pickMainOdds(oddsResponse) {
  const item = oddsResponse?.response?.[0];
  if (!item) return {};
  const firstBookmaker = item.bookmakers?.[0];
  if (!firstBookmaker) return {};

  const findMarket = (labelRegex) =>
    firstBookmaker.bets?.find(b => labelRegex.test(b.name));

  const matchWinner = findMarket(/Match Winner|Full Time Result/i);
  const overUnder = firstBookmaker.bets?.find(b => /Goals Over\/?Under/i.test(b.name));
  const btts = findMarket(/Both Teams Score/i);
  const doubleChance = findMarket(/Double Chance/i);

  const byLabel = (market, label) =>
    market?.values?.find(v => v.value?.toString().toLowerCase() === label.toLowerCase())?.odd;

  return {
    bookmaker: firstBookmaker.name,
    home: byLabel(matchWinner, 'Home'),
    draw: byLabel(matchWinner, 'Draw'),
    away: byLabel(matchWinner, 'Away'),
    over25: matchOverUnder(overUnder, 'Over', 2.5),
    under25: matchOverUnder(overUnder, 'Under', 2.5),
    bttsYes: byLabel(btts, 'Yes'),
    bttsNo: byLabel(btts, 'No'),
    dc1X: byLabel(doubleChance, 'Home/Draw'),
    dc12: byLabel(doubleChance, 'Home/Away'),
    dcX2: byLabel(doubleChance, 'Draw/Away')
  };
}

function matchOverUnder(market, side, line) {
  if (!market) return undefined;
  const entry = market.values?.find(v => {
    const val = v.value?.toString().toLowerCase() || '';
    return val.startsWith(side.toLowerCase()) && val.includes(line.toString());
  });
  return entry?.odd;
}

function formatPercent(raw) {
  if (raw == null) return null;
  const n = typeof raw === 'string' ? parseFloat(raw.replace('%', '')) : Number(raw);
  return isNaN(n) ? null : Math.round(n);
}

function buildSuggestions(predictionData, odds) {
  const item = predictionData?.response?.[0];
  if (!item) return { available: false, items: [] };

  const p = item.predictions || {};
  const teams = item.teams || {};
  const comparison = item.comparison || {};

  const winnerId = p.winner?.id;
  const homeId = teams.home?.id;
  const awayId = teams.away?.id;
  const winnerSide = winnerId === homeId ? 'home' : winnerId === awayId ? 'away' : null;

  const items = [];

  // Over/Under principal recommandé par API-Football
  if (p.under_over) {
    const raw = p.under_over.toString();
    const direction = raw.startsWith('-') ? 'under' : 'over';
    const value = parseFloat(raw.replace(/[-+]/, '')) || 2.5;
    items.push({
      market: 'OVER_UNDER',
      label: `${direction === 'under' ? 'Moins' : 'Plus'} de ${value} buts`,
      comment: 'Recommandation principale IA',
      odds: direction === 'under' ? odds.under25 : odds.over25,
      confidence: null,
      eventId: 'total_goals',
      parametric: true,
      params: { value, direction }
    });
  }

  // Over/Under alternatif (ligne 1.5 ou 3.5 selon la tendance)
  const attackHome = formatPercent(comparison.att?.home);
  const attackAway = formatPercent(comparison.att?.away);
  const defHome = formatPercent(comparison.def?.home);
  const defAway = formatPercent(comparison.def?.away);
  const attackAvg = attackHome != null && attackAway != null ? (attackHome + attackAway) / 2 : null;
  const defAvg = defHome != null && defAway != null ? (defHome + defAway) / 2 : null;

  if (attackAvg != null && defAvg != null) {
    // Attaque forte + défense faible → tendance buts élevés → Over 1.5 safe
    // Attaque faible + défense forte → tendance buts bas → Under 2.5 safe
    if (attackAvg >= 55 && defAvg <= 50) {
      items.push({
        market: 'OVER_UNDER_SAFE',
        label: 'Plus de 1.5 buts',
        comment: `Attaques ${attackAvg.toFixed(0)}% / défenses ${defAvg.toFixed(0)}%`,
        odds: null,
        confidence: Math.round(attackAvg),
        eventId: 'total_goals',
        parametric: true,
        params: { value: 1.5, direction: 'over' }
      });
    } else if (attackAvg <= 45 && defAvg >= 55) {
      items.push({
        market: 'OVER_UNDER_SAFE',
        label: 'Moins de 2.5 buts',
        comment: `Attaques ${attackAvg.toFixed(0)}% / défenses ${defAvg.toFixed(0)}%`,
        odds: odds.under25,
        confidence: Math.round(defAvg),
        eventId: 'total_goals',
        parametric: true,
        params: { value: 2.5, direction: 'under' }
      });
    }
  }

  // BTTS
  const bttsHome = formatPercent(comparison.goals?.home);
  const bttsAway = formatPercent(comparison.goals?.away);
  if (bttsHome != null && bttsAway != null) {
    const bothScore = bttsHome >= 40 && bttsAway >= 40;
    items.push({
      market: 'BTTS',
      label: bothScore ? 'Les deux équipes marquent: Oui' : 'Les deux équipes marquent: Non',
      comment: `Attaque dom ${bttsHome}% / ext ${bttsAway}%`,
      odds: bothScore ? odds.bttsYes : odds.bttsNo,
      confidence: Math.round((bttsHome + bttsAway) / 2),
      eventId: bothScore ? 'both_teams_score' : 'both_teams_score_no',
      parametric: false
    });
  }

  // BTTS + Over 2.5 combiné (pari plus agressif)
  if (bttsHome != null && bttsAway != null && bttsHome >= 50 && bttsAway >= 50) {
    items.push({
      market: 'BTTS_AND_OVER',
      label: 'Les deux marquent + Plus de 2.5 buts',
      comment: 'Match offensif probable',
      odds: null,
      confidence: Math.round((bttsHome + bttsAway) / 2),
      eventId: 'both_teams_score_3plus',
      parametric: false
    });
  }

  if (p.advice) {
    items.push({
      market: 'ADVICE',
      label: p.advice,
      comment: 'Conseil API-Football (informatif)',
      odds: null,
      confidence: null,
      eventId: null,
      parametric: false
    });
  }

  return {
    available: true,
    fixture: {
      home: teams.home?.name,
      away: teams.away?.name,
      homeLogo: teams.home?.logo,
      awayLogo: teams.away?.logo
    },
    odds,
    items: items.slice(0, 5)
  };
}

exports.getSuggestionsForFixture = async (fixtureId) => {
  if (!fixtureId) {
    const err = new Error('fixtureId requis');
    err.statusCode = 400;
    throw err;
  }
  if (!process.env.RAPID_API_KEY) {
    const err = new Error('RAPID_API_KEY non configurée');
    err.statusCode = 500;
    throw err;
  }

  const cacheKey = `ai:${fixtureId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (
    quotaState.remaining != null &&
    quotaState.remaining <= QUOTA_BLOCK_THRESHOLD
  ) {
    const err = new Error(
      `Quota IA presque épuisé (${quotaState.remaining} restant). Suggestions bloquées.`
    );
    err.statusCode = 429;
    throw err;
  }

  try {
    const [predictionData, oddsData] = await Promise.all([
      rapidGet('/predictions', { fixture: fixtureId }),
      rapidGet('/odds', { fixture: fixtureId }).catch(() => ({ response: [] }))
    ]);

    const odds = pickMainOdds(oddsData);
    const suggestions = buildSuggestions(predictionData, odds);
    setCached(cacheKey, suggestions);
    return suggestions;
  } catch (error) {
    const status = error.response?.status;
    const err = new Error(
      status === 429 ? 'Quota API-Football dépassé, réessayez plus tard' :
      status === 401 || status === 403 ? 'Clé API-Football invalide' :
      `Erreur API-Football: ${error.message}`
    );
    err.statusCode = status || 502;
    throw err;
  }
};
