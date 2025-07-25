/**
 * @fileoverview Fournisseur de données pour le football
 */
const SportProvider = require('./SportProvider');

/**
 * Fournisseur de données pour le football
 * @extends SportProvider
 */
class FootballProvider extends SportProvider {
  /**
   * @param {Object} config - Configuration
   * @param {Object} dependencies - Dépendances injectées
   */
  constructor(config, dependencies) {
    super(config, dependencies);
    this.endpoints = {
      fixtures: '/fixtures'
    };
  }
  
  /**
   * Récupère les matchs pour une date spécifique
   * @param {string} date - Date au format YYYY-MM-DD
   * @returns {Promise<Object>} - Données des matchs
   */
  async fetchFixtures(date) {
    try {
      this.logger.info(`Fetching football fixtures for ${date}`);
      
      const response = await this.httpClient.get(`${this.baseUrl}${this.endpoints.fixtures}`, {
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
    const fixtures = rawData.response || [];
    const date = rawData.parameters?.date;
    
    // Créer l'index des pays et ligues
    const countries = new Set();
    const leagues = {};
    
    // Normaliser les matchs
    const matches = fixtures.map(fixture => {
      // Extraire le pays
      const country = fixture.league.country;
      countries.add(country);
      
      // Indexer les ligues par pays
      if (!leagues[country]) {
        leagues[country] = new Set();
      }
      leagues[country].add(fixture.league.name);
      
      // Normaliser le statut
      let normalizedStatus;
      switch(fixture.fixture.status.short) {
        case 'NS': normalizedStatus = 'NOT_STARTED'; break;
        case 'LIVE': normalizedStatus = 'LIVE'; break;
        case 'FT': normalizedStatus = 'FINISHED'; break;
        case 'CANC': normalizedStatus = 'CANCELLED'; break;
        default: normalizedStatus = fixture.fixture.status.short;
      }
      
      // Retourner le match normalisé
      return {
        id: fixture.fixture.id.toString(),
        date: fixture.fixture.date,
        league: {
          id: fixture.league.id.toString(),
          name: fixture.league.name,
          country: country,
          logo: fixture.league.logo
        },
        teams: {
          home: {
            id: fixture.teams.home.id.toString(),
            name: fixture.teams.home.name,
            logo: fixture.teams.home.logo
          },
          away: {
            id: fixture.teams.away.id.toString(),
            name: fixture.teams.away.name,
            logo: fixture.teams.away.logo
          }
        },
        venue: fixture.fixture.venue,
        status: normalizedStatus,
        score: {
          home: fixture.goals.home,
          away: fixture.goals.away,
          details: {
            halftime: fixture.score.halftime || { home: null, away: null },
            fulltime: fixture.score.fulltime || { home: null, away: null },
            extratime: fixture.score.extratime || { home: null, away: null },
            penalty: fixture.score.penalty || { home: null, away: null }
          }
        },
        sportSpecific: {
          elapsed: fixture.fixture.status.elapsed,
          referee: fixture.fixture.referee,
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
      sport: 'football',
      date,
      source: 'api-football',
      rawData,
      matches,
      indexes: {
        countries: countriesArray,
        leagues: leaguesObj
      }
    };
  }
}

module.exports = FootballProvider;