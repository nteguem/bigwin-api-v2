/**
 * @fileoverview Contrôleur pour les routes sportives
 */
const {
  sportsConfig,
  fetchAndStoreData,
  findMatch
} = require('../../../core/sports/providers/initService');

const { AppError } = require('../../../utils/errorHandler');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

/**
 * GET /api/sports
 */
exports.getAllSports = async (req, res, next) => {
  try {
    const sports = Object.entries(sportsConfig).map(([id, config]) => ({
      id,
      name: config.name
    }));

    formatSuccess(res, {
      data: sports,
      count: sports.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sports/:sport/dates/:date/countries
 */
exports.getCountries = async (req, res, next) => {
  try {
    const { sport, date } = req.params;
    const force = req.query.force === 'true';

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    const data = await fetchAndStoreData(sport, date, force);

    const countries = data.indexes.countries.map(country => {
      const countryId = country.toLowerCase().replace(/\s+/g, '-');
      return {
        id: countryId,
        name: country,
        flag: `https://media.api-sports.io/flags/${countryId.substring(0, 2)}.svg`
      };
    });

    formatSuccess(res, {
      data: countries,
      count: countries.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sports/:sport/dates/:date/countries/:country/leagues
 */
exports.getLeagues = async (req, res, next) => {
  try {
    const { sport, date, country } = req.params;
    const force = req.query.force === 'true';

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    const data = await fetchAndStoreData(sport, date, force);

    const countryName = data.indexes.countries.find(
      c => c.toLowerCase() === country.replace(/-/g, ' ').toLowerCase()
    );

    if (!countryName) {
      throw new AppError(`Country not found: ${country}`, 404);
    }

    const leagues = data.matches
      .filter(match => match.league.country === countryName)
      .reduce((acc, match) => {
        if (!acc.find(l => l.id === match.league.id)) {
          acc.push({
            id: match.league.id,
            name: match.league.name,
            logo: match.league.logo
          });
        }
        return acc;
      }, []);

    formatSuccess(res, {
      data: leagues,
      count: leagues.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sports/:sport/dates/:date/countries/:country/leagues/:league/fixtures
 */
exports.getFixtures = async (req, res, next) => {
  try {
    const { sport, date, country, league } = req.params;
    const force = req.query.force === 'true';

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    const data = await fetchAndStoreData(sport, date, force);

    const countryName = data.indexes.countries.find(
      c => c.toLowerCase() === country.replace(/-/g, ' ').toLowerCase()
    );

    if (!countryName) {
      throw new AppError(`Country not found: ${country}`, 404);
    }

    const fixtures = data.matches.filter(
      match => match.league.country === countryName && match.league.id === league
    );

    if (fixtures.length === 0) {
      throw new AppError(`No fixtures found for league: ${league}`, 404);
    }

    formatSuccess(res, {
      data: fixtures,
      count: fixtures.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sports/:sport/matches/:matchId?date=YYYY-MM-DD&force=true
 */
exports.getMatchDetails = async (req, res, next) => {
  try {
    const { sport, matchId } = req.params;
    const { date, force } = req.query;

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    const matchData = await findMatch(sport, matchId, date || null, force === 'true');

    if (!matchData) {
      throw new AppError(`Match not found: ${matchId}`, 404);
    }

    formatSuccess(res, { data: matchData });
  } catch (error) {
    next(error);
  }
};
