/**
 * @fileoverview Fournisseur de données pour le baseball
 */
const SportProvider = require('./SportProvider');

/**
 * Fournisseur de données pour le baseball
 * @extends SportProvider
 */
class BaseballProvider extends SportProvider {
  /**
   * @param {Object} config - Configuration
   * @param {Object} dependencies - Dépendances injectées
   */
  constructor(config, dependencies) {
    super(config, dependencies);
    this.endpoints = {
      games: '/games'
    };
  }
  
  /**
   * Récupère les matchs pour une date spécifique
   * @param {string} date - Date au format YYYY-MM-DD
   * @returns {Promise<Object>} - Données des matchs
   */
  async fetchFixtures(date) {
    try {
      this.logger.info(`Fetching baseball games for ${date}`);
      
      const response = await this.httpClient.get(`${this.baseUrl}${this.endpoints.games}`, {
        params: { date },
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': this.host
        }
      });
      
      return response;
    } catch (error) {
      throw this.handleApiError(error, `fetchFixtures(${date})`);
    }
  }
  
  /**
   * Transforme les données brutes en format standardisé
   * @param {Object} rawData - Données brutes de l'API
   * @returns {Object} - Données normalisées
   */
  normalizeData(rawData) {
    const games = rawData.response || [];
    const date = rawData.parameters?.date;
    
    // Créer l'index des pays et ligues
    const countries = new Set();
    const leagues = {};
    
    // Normaliser les matchs
    const matches = games.map(game => {
      // Extraire le pays
      const country = game.country.name;
      countries.add(country);
      
      // Indexer les ligues par pays
      if (!leagues[country]) {
        leagues[country] = new Set();
      }
      leagues[country].add(game.league.name);
      
      // Normaliser le statut
      let normalizedStatus;
      switch(game.status.short) {
        case 'NS': normalizedStatus = 'NOT_STARTED'; break;
        case 'LIVE': normalizedStatus = 'LIVE'; break;
        case 'FT': normalizedStatus = 'FINISHED'; break;
        case 'CANC': normalizedStatus = 'CANCELLED'; break;
        default: normalizedStatus = game.status.short;
      }
      
      // Retourner le match normalisé
      return {
        id: game.id.toString(),
        date: game.date,
        league: {
          id: game.league.id.toString(),
          name: game.league.name,
          country: country,
          logo: game.league.logo,
          season: game.league.season
        },
        teams: {
          home: {
            id: game.teams.home.id.toString(),
            name: game.teams.home.name,
            logo: game.teams.home.logo
          },
          away: {
            id: game.teams.away.id.toString(),
            name: game.teams.away.name,
            logo: game.teams.away.logo
          }
        },
        venue: null, // Pas de détails de stade dans l'API baseball
        status: normalizedStatus,
        score: {
          home: game.scores.home.total,
          away: game.scores.away.total,
          details: {
            home: {
              hits: game.scores.home.hits,
              errors: game.scores.home.errors,
              innings: game.scores.home.innings
            },
            away: {
              hits: game.scores.away.hits,
              errors: game.scores.away.errors,
              innings: game.scores.away.innings
            }
          }
        },
        sportSpecific: {
          time: game.time,
          timestamp: game.timestamp,
          timezone: game.timezone,
          week: game.week,
          innings: {
            home: game.scores.home.innings,
            away: game.scores.away.innings
          }
        }
      };
    });
    
    // Convertir les ensembles en tableaux pour l'indexation
    const countriesArray = Array.from(countries);
    const leaguesObj = {};
    
    for (const country in leagues) {
      leaguesObj[country] = Array.from(leagues[country]);
    }
    
    return {
      sport: 'baseball',
      date,
      source: 'api-baseball',
      rawData,
      matches,
      indexes: {
        countries: countriesArray,
        leagues: leaguesObj
      }
    };
  }
}

module.exports = BaseballProvider;