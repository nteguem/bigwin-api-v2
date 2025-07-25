/**
 * @fileoverview Fournisseur de données pour le tennis
 */
const SportProvider = require('./SportProvider');

/**
 * Fournisseur de données pour le tennis
 * @extends SportProvider
 */
class TennisProvider extends SportProvider {
  /**
   * @param {Object} config - Configuration
   * @param {Object} dependencies - Dépendances injectées
   */
  constructor(config, dependencies) {
    super(config, dependencies);
    this.endpoints = {
      fixtures: '/tennis/v2/atp/fixtures',
      tournamentInfo: '/tennis/v2/atp/tournament/info'
    };
    // Cache pour éviter les appels API redondants pour les tournois
    this.tournamentCache = new Map();
  }
  
  /**
   * Récupère les matchs pour une date spécifique
   * @param {string} date - Date au format YYYY-MM-DD
   * @returns {Promise<Object>} - Données des matchs
   */
  async fetchFixtures(date) {
    try {
      this.logger.info(`Fetching tennis fixtures for ${date}`);
      
      const response = await this.httpClient.get(`${this.baseUrl}${this.endpoints.fixtures}/${date}`, {
        params: {
          pageSize: 1000,
          pageNo: 1
        },
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
   * Récupère les informations d'un tournoi (avec cache)
   * @param {number} tournamentId - ID du tournoi
   * @returns {Promise<Object>} - Informations du tournoi
   */
  async getTournamentInfo(tournamentId) {
    // Vérifier le cache d'abord
    if (this.tournamentCache.has(tournamentId)) {
      this.logger.info(`Using cached tournament info for ${tournamentId}`);
      return this.tournamentCache.get(tournamentId);
    }

    try {
      this.logger.info(`Fetching tournament info for ${tournamentId}`);
      
      const response = await this.httpClient.get(`${this.baseUrl}${this.endpoints.tournamentInfo}/${tournamentId}`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': this.host
        }
      });

      // Mettre en cache pour éviter les futurs appels
      this.tournamentCache.set(tournamentId, response.data);
      return response.data;
    } catch (error) {
      this.logger.warn(`Failed to fetch tournament info for ${tournamentId}: ${error.message}`);
      // Retourner des données par défaut si l'appel échoue
      return {
        id: tournamentId,
        name: `Tournament ${tournamentId}`,
        coutry: { acronym: 'INT', name: 'International' },
        court: { name: 'Unknown' },
        round: { name: 'Unknown' }
      };
    }
  }
  
  /**
   * Transforme les données brutes en format standardisé
   * @param {Object} rawData - Données brutes de l'API
   * @returns {Object} - Données normalisées
   */
  async normalizeData(rawData) {
    const matches = rawData.data || [];
    
    // Identifier les tournois uniques pour minimiser les appels API
    const uniqueTournamentIds = [...new Set(matches.map(match => match.tournamentId))];
    this.logger.info(`Found ${uniqueTournamentIds.length} unique tournaments in ${matches.length} matches`);
    
    // Récupérer les infos des tournois (1 appel par tournoi unique)
    const tournamentInfos = {};
    for (const tournamentId of uniqueTournamentIds) {
      tournamentInfos[tournamentId] = await this.getTournamentInfo(tournamentId);
    }
    
    // Créer l'index des pays et ligues
    const countries = new Set();
    const leagues = {};
    
    // Normaliser les matchs
    const normalizedMatches = matches.map(match => {
      // Récupérer les infos du tournoi depuis le cache
      const tournamentInfo = tournamentInfos[match.tournamentId];
      
      // Pays des joueurs
      const player1Country = match.player1?.countryAcr || 'Unknown';
      const player2Country = match.player2?.countryAcr || 'Unknown';
      countries.add(player1Country);
      countries.add(player2Country);
      
      // Pays et nom du tournoi
      const tournamentCountry = tournamentInfo.coutry?.name || 'International';
      const tournamentName = tournamentInfo.name || `Tournament ${match.tournamentId}`;
      
      countries.add(tournamentCountry);
      
      // Indexer les tournois par pays
      if (!leagues[tournamentCountry]) {
        leagues[tournamentCountry] = new Set();
      }
      leagues[tournamentCountry].add(tournamentName);
      
      // Le tennis n'a pas de statut explicite dans cette API, on suppose "NOT_STARTED"
      const normalizedStatus = 'NOT_STARTED';
      
      // Retourner le match normalisé
      return {
        id: match.id.toString(),
        date: match.date,
        league: {
          id: match.tournamentId.toString(),
          name: tournamentName,
          country: tournamentCountry,
          logo: null, // Pas de logo dans cette API
          season: new Date(match.date).getFullYear(),
          courtType: tournamentInfo.court?.name,
          roundType: tournamentInfo.round?.name
        },
        teams: {
          home: {
            id: match.player1Id.toString(),
            name: match.player1?.name || 'Player 1',
            logo: null,
            country: player1Country
          },
          away: {
            id: match.player2Id.toString(),
            name: match.player2?.name || 'Player 2',
            logo: null,
            country: player2Country
          }
        },
        venue: {
          name: tournamentInfo.name,
          city: tournamentInfo.name?.split(' - ')[1] || null,
          country: tournamentCountry
        },
        status: normalizedStatus,
        score: {
          home: null, // Pas de score dans les fixtures
          away: null,
          details: {
            sets: null,
            home: {
              set1: null,
              set2: null,
              set3: null,
              set4: null,
              set5: null
            },
            away: {
              set1: null,
              set2: null,
              set3: null,
              set4: null,
              set5: null
            }
          }
        },
        sportSpecific: {
          roundId: match.roundId,
          tournamentId: match.tournamentId,
          tournamentInfo: {
            name: tournamentInfo.name,
            courtType: tournamentInfo.court?.name,
            roundType: tournamentInfo.round?.name,
            country: tournamentInfo.coutry
          },
          player1: {
            id: match.player1Id,
            name: match.player1?.name,
            countryAcr: match.player1?.countryAcr
          },
          player2: {
            id: match.player2Id,
            name: match.player2?.name,
            countryAcr: match.player2?.countryAcr
          },
          isIndividualSport: true // Tennis est un sport individuel
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
      sport: 'tennis',
      date: matches[0]?.date?.split('T')[0] || null,
      source: 'tennis-api-atp-wta-itf',
      rawData,
      matches: normalizedMatches,
      indexes: {
        countries: countriesArray,
        leagues: leaguesObj
      },
      pagination: {
        hasNextPage: rawData.hasNextPage || false,
        totalMatches: normalizedMatches.length,
        uniqueTournaments: uniqueTournamentIds.length
      },
      apiCallsUsed: uniqueTournamentIds.length + 1 // 1 pour fixtures + 1 par tournoi unique
    };
  }
}

module.exports = TennisProvider;