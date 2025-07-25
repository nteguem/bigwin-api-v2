/**
 * @fileoverview Fournisseur de données pour le basketball
 */
const SportProvider = require('./SportProvider');

/**
 * Fournisseur de données pour le basketball
 * @extends SportProvider
 */
class BasketballProvider extends SportProvider {
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
      this.logger.info(`Fetching basketball games for ${date}`);
      
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
          logo: game.league.logo
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
        venue: null, // Pas de détails de stade dans l'API basketball
        status: normalizedStatus,
        score: {
          home: game.scores.home.total,
          away: game.scores.away.total,
          details: {
            home: {
              quarter_1: game.scores.home.quarter_1,
              quarter_2: game.scores.home.quarter_2,
              quarter_3: game.scores.home.quarter_3,
              quarter_4: game.scores.home.quarter_4,
              overtime: game.scores.home.over_time
            },
            away: {
              quarter_1: game.scores.away.quarter_1,
              quarter_2: game.scores.away.quarter_2,
              quarter_3: game.scores.away.quarter_3,
              quarter_4: game.scores.away.quarter_4,
              overtime: game.scores.away.over_time
            }
          }
        },
        sportSpecific: {
            overtime: {
              home: game.scores.home.over_time,
              away: game.scores.away.over_time
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
      sport: 'basketball',
      date,
      source: 'api-basketball',
      rawData,
      matches,
      indexes: {
        countries: countriesArray,
        leagues: leaguesObj
      }
    };
  }
}

module.exports = BasketballProvider;