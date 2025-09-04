
/**
 * @fileoverview Service d'initialisation des données sportives à la demande
 */
require('dotenv').config();
const FootballProvider = require('./FootballProvider');
const BasketballProvider = require('./BasketballProvider');
const RugbyProvider = require('./RugbyProvider');
const HandballProvider = require('./HandballProvider');
const VolleyballProvider = require('./VolleyballProvider');
const BaseballProvider = require('./BaseballProvider');
const HockeyProvider = require('./HockeyProvider');
const TennisProvider = require('./TennisProvider');
const HorseProvider = require('./HorseProvider'); // NOUVEAU
const FileStorageManager = require('../storage/FileStorageManager');
const logger = require('../../../utils/logger');
const path = require('path');
const HttpClient = require('../../../utils/httpClient');

// Dépendances
const httpClient = new HttpClient();

const sportsConfig = {
  football: {
    name: 'Football',
    icon: '⚽',
    sportId: 'football',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-football-v1.p.rapidapi.com/v3',
    host: 'api-football-v1.p.rapidapi.com'
  },
  basketball: {
    name: 'Basketball',
    icon: '🏀',
    sportId: 'basketball',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-basketball.p.rapidapi.com',
    host: 'api-basketball.p.rapidapi.com'
  },
  rugby: {
    name: 'Rugby',
    icon: '🏉',
    sportId: 'rugby',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-rugby.p.rapidapi.com',
    host: 'api-rugby.p.rapidapi.com'
  },
  handball: {
    name: 'Handball',
    icon: '🤾',
    sportId: 'handball',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-handball.p.rapidapi.com',
    host: 'api-handball.p.rapidapi.com'
  },
  volleyball: {
    name: 'Volleyball',
    icon: '🏐',
    sportId: 'volleyball',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-volleyball.p.rapidapi.com',
    host: 'api-volleyball.p.rapidapi.com'
  },
  baseball: {
    name: 'Baseball',
    icon: '⚾',
    sportId: 'baseball',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-baseball.p.rapidapi.com',
    host: 'api-baseball.p.rapidapi.com'
  },
  hockey: {
    name: 'Hockey',
    icon: '🏒',
    sportId: 'hockey',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://api-hockey.p.rapidapi.com',
    host: 'api-hockey.p.rapidapi.com'
  },
  tennis: {
    name: 'Tennis',
    icon: '🎾',
    sportId: 'tennis',
    apiKey: process.env.RAPID_API_KEY,
    baseUrl: 'https://tennis-api-atp-wta-itf.p.rapidapi.com',
    host: 'tennis-api-atp-wta-itf.p.rapidapi.com'
  },
  horse: {
    name: 'Courses Hippiques',
    icon: '🏇',
    sportId: 'horse',
    apiKey: null, 
    baseUrl: 'https://online.turfinfo.api.pmu.fr/rest/client/61',
    host: 'online.turfinfo.api.pmu.fr'
  }
};

// Fournisseurs
const providers = {
  football: new FootballProvider(sportsConfig.football, { httpClient, logger }),
  basketball: new BasketballProvider(sportsConfig.basketball, { httpClient, logger }),
  rugby: new RugbyProvider(sportsConfig.rugby, { httpClient, logger }),
  handball: new HandballProvider(sportsConfig.handball, { httpClient, logger }),
  volleyball: new VolleyballProvider(sportsConfig.volleyball, { httpClient, logger }),
  baseball: new BaseballProvider(sportsConfig.baseball, { httpClient, logger }),
  hockey: new HockeyProvider(sportsConfig.hockey, { httpClient, logger }),
  tennis: new TennisProvider(sportsConfig.tennis, { httpClient, logger }),
  horse: new HorseProvider(sportsConfig.horse, { httpClient, logger }) // NOUVEAU
};

// Stockage local (reste identique)
const storageManager = new FileStorageManager({
  basePath: path.join(process.cwd(), 'data', 'sports')
}, { logger });

/**
 * Récupère les données (stock local ou API)
 */
const fetchAndStoreData = async (sport, date, forceRefresh = false) => {
  try {
    
    const exists = await storageManager.dataExists(sport, date);
    
    if (exists && !forceRefresh) {
      logger.info(`Data for ${sport} on ${date} already exists. Loading from storage...`);
      return await storageManager.getData(sport, date);
    }
    
    const provider = providers[sport];
    if (!provider) throw new Error(`No provider configured for sport: ${sport}`);
    
    const rawData = await provider.fetchFixtures(date);
    // Gérer les providers avec normalizeData async ou sync
    const normalizedData = await Promise.resolve(provider.normalizeData(rawData));
    await storageManager.saveData(sport, date, normalizedData);
    
    return normalizedData;
  } catch (error) {
    logger.error(`Error fetching/storing data for ${sport} on ${date}: ${error.message}`);
    throw error;
  }
};

/**
 * Liste les dates disponibles en local
 */
const getAvailableDates = async (sport) => {
  return await storageManager.getAvailableDates(sport);
};

/**
 * Recherche un match/course précis dans les données
 */
const findMatch = async (sport, matchId, date = null, forceUpdate = false) => {
  try {
    if (!sportsConfig[sport]) throw new Error(`Sport not found: ${sport}`);
    
    let matchData = null;
    
    if (date) {
      try {
        const dateData = await fetchAndStoreData(sport, date, forceUpdate);
        matchData = dateData.matches.find(match => match.id === matchId);
        if (matchData) return matchData;
      } catch (err) {
        logger.warn(`Failed in ${date}: ${err.message}`);
      }
    }
    
    const availableDates = await getAvailableDates(sport);
    for (const availableDate of availableDates) {
      if (availableDate === date) continue;
      
      try {
        const dateData = await fetchAndStoreData(sport, availableDate, forceUpdate);
        matchData = dateData.matches.find(match => match.id === matchId);
        if (matchData) return matchData;
      } catch (err) {
        logger.warn(`Skipping date ${availableDate}: ${err.message}`);
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`Error finding match ${matchId} for ${sport}: ${error.message}`);
    throw error;
  }
};

module.exports = {
  fetchAndStoreData,
  getAvailableDates,
  findMatch,
  sportsConfig
};