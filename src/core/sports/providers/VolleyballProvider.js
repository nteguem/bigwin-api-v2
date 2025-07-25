/**
 * @fileoverview Fournisseur de données pour le volleyball
 */
const SportProvider = require('./SportProvider');

/**
 * Fournisseur de données pour le volleyball
 * @extends SportProvider
 */
class VolleyballProvider extends SportProvider {
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
      this.logger.info(`Fetching volleyball games for ${date}`);
      
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
      
      // Retourner le match normalisé (structure adaptée au volleyball)
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
        venue: null, // Pas de détails de stade dans l'API volleyball
        status: normalizedStatus,
        score: {
          home: game.scores?.home || null,
          away: game.scores?.away || null,
          details: {
            sets: game.sets || null,
            home: {
              set1: game.periods?.set1?.home || null,
              set2: game.periods?.set2?.home || null,
              set3: game.periods?.set3?.home || null,
              set4: game.periods?.set4?.home || null,
              set5: game.periods?.set5?.home || null
            },
            away: {
              set1: game.periods?.set1?.away || null,
              set2: game.periods?.set2?.away || null,
              set3: game.periods?.set3?.away || null,
              set4: game.periods?.set4?.away || null,
              set5: game.periods?.set5?.away || null
            }
          }
        },
        sportSpecific: {
          time: game.time,
          timestamp: game.timestamp,
          timezone: game.timezone,
          week: game.week,
          sets: game.sets || null,
          periods: game.periods || null
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
      sport: 'volleyball',
      date,
      source: 'api-volleyball',
      rawData,
      matches,
      indexes: {
        countries: countriesArray,
        leagues: leaguesObj
      }
    };
  }
}

module.exports = VolleyballProvider;