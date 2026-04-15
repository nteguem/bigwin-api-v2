const axios = require('axios');

const API_HOST = 'api-football-v1.p.rapidapi.com';
const BASE_URL = `https://${API_HOST}/v3`;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map();

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
  const { data } = await axios.get(`${BASE_URL}${endpoint}`, {
    params,
    headers: {
      'x-rapidapi-key': process.env.RAPID_API_KEY,
      'x-rapidapi-host': API_HOST
    },
    timeout: 15000
  });
  return data;
}

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

  if (winnerSide) {
    items.push({
      market: '1X2',
      selection: winnerSide,
      label: `${p.winner?.name} gagne`,
      comment: p.winner?.comment || null,
      odds: winnerSide === 'home' ? odds.home : odds.away,
      confidence: formatPercent(comparison.total?.[winnerSide])
    });
  }

  if (p.advice) {
    items.push({
      market: 'ADVICE',
      selection: null,
      label: p.advice,
      comment: 'Conseil API-Football',
      odds: null,
      confidence: null
    });
  }

  const goalsOver = p.goals?.home;
  if (p.under_over) {
    items.push({
      market: 'OVER_UNDER',
      selection: p.under_over.startsWith('-') ? 'under' : 'over',
      label: `${p.under_over.startsWith('-') ? 'Moins' : 'Plus'} de ${p.under_over.replace(/[-+]/, '')} buts`,
      comment: null,
      odds: p.under_over.startsWith('-') ? odds.under25 : odds.over25,
      confidence: null
    });
  }

  const bttsHome = formatPercent(comparison.goals?.home);
  const bttsAway = formatPercent(comparison.goals?.away);
  if (bttsHome != null && bttsAway != null) {
    const bothScore = bttsHome >= 40 && bttsAway >= 40;
    items.push({
      market: 'BTTS',
      selection: bothScore ? 'yes' : 'no',
      label: bothScore ? 'Les deux équipes marquent: Oui' : 'Les deux équipes marquent: Non',
      comment: `Attaque dom ${bttsHome}% / ext ${bttsAway}%`,
      odds: bothScore ? odds.bttsYes : odds.bttsNo,
      confidence: Math.round((bttsHome + bttsAway) / 2)
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
