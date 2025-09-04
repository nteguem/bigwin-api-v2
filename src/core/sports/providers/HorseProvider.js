/**
 * @fileoverview Fournisseur de données pour les courses hippiques
 */
const SportProvider = require('./SportProvider');

/**
 * Fournisseur de données pour les courses hippiques
 * @extends SportProvider
 */
class HorseProvider extends SportProvider {
  /**
   * @param {Object} config - Configuration
   * @param {Object} dependencies - Dépendances injectées
   */
  constructor(config, dependencies) {
    super(config, dependencies);
    this.endpoints = {
      fixtures: '/programme' // endpoint pour récupérer le programme
    };
  }
  
  /**
   * Récupère les courses pour une date spécifique
   * @param {string} date - Date au format YYYY-MM-DD
   * @returns {Promise<Object>} - Données des courses
   */
  async fetchFixtures(date) {
    try {
      // Convertir YYYY-MM-DD en DDMMYYYY pour l'API PMU
      const formattedDate = this.formatDateForPMU(date);
      
      this.logger.info(`Fetching horse races for ${date} (${formattedDate})`);
      
      // URL complète pour l'API PMU
      const url = `${this.baseUrl}${this.endpoints.fixtures}/${formattedDate}`;
      
      const response = await this.httpClient.get(url, {
        params: { 
          meteo: 'true', 
          specialisation: 'INTERNET' 
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
          'Referer': 'https://www.pmu.fr/',
          'Origin': 'https://www.pmu.fr'
        },
        timeout: 30000 // Timeout de 30 secondes
      });
      
      return response;
    } catch (error) {
      throw this.handleApiError(error, `fetchFixtures(${date})`);
    }
  }
  
  /**
   * Convertit une date YYYY-MM-DD en DDMMYYYY
   * @param {string} date - Date au format YYYY-MM-DD
   * @returns {string} - Date au format DDMMYYYY
   */
  formatDateForPMU(date) {
    const [year, month, day] = date.split('-');
    return `${day}${month}${year}`;
  }
  
  /**
   * Transforme les données brutes en format standardisé
   * @param {Object} rawData - Données brutes de l'API PMU
   * @returns {Object} - Données normalisées
   */
  normalizeData(rawData) {
    if (!rawData || typeof rawData !== 'object') {
      return {
        sport: 'horse',
        date: null,
        source: 'pmu-turfinfo',
        rawData: rawData || {},
        matches: [],
        indexes: {
          countries: ['france'],
          leagues: { 'france': [] }
        }
      };
    }

    // L'API PMU retourne les données dans rawData.programme.reunions
    let reunions = [];
    let dateReunion = null;
    
    // Cas 1: Structure complète avec programme
    if (rawData.programme && Array.isArray(rawData.programme.reunions)) {
      reunions = rawData.programme.reunions;
      dateReunion = rawData.programme.date;
    }
    // Cas 2: Les données contiennent directement les réunions
    else if (Array.isArray(rawData.reunions)) {
      reunions = rawData.reunions;
      dateReunion = rawData.dateReunion;
    }
    // Cas 3: rawData est directement une réunion avec des courses
    else if (rawData.courses && Array.isArray(rawData.courses)) {
      reunions = [rawData];
      dateReunion = rawData.dateReunion;
    }
    
    // Extraire la date depuis les données ou utiliser une date par défaut
    let date = null;
    if (dateReunion) {
      date = new Date(dateReunion).toISOString().split('T')[0];
    }
    
    // Si pas de réunions, retourner une structure vide
    if (reunions.length === 0) {
      return {
        sport: 'horse',
        date,
        source: 'pmu-turfinfo',
        rawData,
        matches: [],
        indexes: {
          countries: ['france'],
          leagues: { 'france': [] }
        }
      };
    }
    
    // Créer l'index des pays et ligues (hippodromes)
    const countries = new Set(['france']);
    const leagues = { 'france': new Set() };
    
    // Normaliser les courses
    const matches = [];
    
    reunions.forEach((reunion) => {
      const hippodrome = reunion.hippodrome?.libelleCourt || 'Hippodrome inconnu';
      leagues['france'].add(hippodrome);
      
      // Vérifier que reunion.courses existe et est un tableau
      const courses = reunion.courses || [];
      
      courses.forEach((course) => {
        // Normaliser le statut
        let normalizedStatus;
        switch(course.statut) {
          case 'PROGRAMMEE': normalizedStatus = 'NOT_STARTED'; break;
          case 'ROUGE_AUX_PARTANTS': normalizedStatus = 'LIVE'; break;
          case 'FIN_COURSE': normalizedStatus = 'FINISHED'; break;
          case 'ANNULEE': normalizedStatus = 'CANCELLED'; break;
          default: normalizedStatus = course.statut || 'UNKNOWN';
        }
        
        // Transformer la course en format match standardisé
        const match = {
          id: `R${reunion.numOfficiel || 0}-C${course.numOrdre || 0}`,
          date: course.heureDepart ? new Date(course.heureDepart).toISOString() : new Date().toISOString(),
          league: {
            id: reunion.hippodrome?.code || 'UNK',
            name: reunion.hippodrome?.libelleCourt || 'Hippodrome inconnu',
            country: 'france',
            logo: null
          },
          teams: {
            home: {
              id: 'field',
              name: 'Partants',
              logo: null
            },
            away: {
              id: 'odds',
              name: `${course.nombreDeclaresPartants || 0} chevaux`,
              logo: null
            }
          },
          venue: {
            id: reunion.hippodrome?.code || 'UNK',
            name: reunion.hippodrome?.libelleLong || 'Hippodrome inconnu',
            city: reunion.hippodrome?.libelleCourt || 'Ville inconnue'
          },
          status: normalizedStatus,
          score: {
            home: course.ordreArrivee ? course.ordreArrivee[0]?.[0] : null,
            away: course.ordreArrivee ? course.ordreArrivee[1]?.[0] : null,
            details: {
              arrivee: course.ordreArrivee || null,
              enquete: course.indicateurEvenementArriveeProvisoire || null
            }
          },
          sportSpecific: {
            courseNumber: course.numOrdre || null,
            courseName: course.libelle || 'Course sans nom',
            courseNameShort: course.libelleCourt || course.libelle || 'Course',
            discipline: this.formatDiscipline(course.discipline, course.specialite),
            distance: course.distance ? `${course.distance}m` : null,
            track: course.corde === "CORDE_GAUCHE" ? "Gauche" : "Droite",
            runners: course.nombreDeclaresPartants || 0,
            conditions: {
              age: this.extractAgeFromConditions(course.conditions),
              sex: this.formatConditionSexe(course.conditionSexe),
              earnings: this.extractGainsFromConditions(course.conditions)
            },
            prize: {
              total: course.montantPrix || 0,
              first: course.montantOffert1er || 0,
              second: course.montantOffert2eme || 0,
              third: course.montantOffert3eme || 0
            },
            bettingTypes: course.paris ? course.paris.map(pari => ({
              type: this.formatTypePari(pari.typePari),
              baseStake: pari.miseBase || 0,
              available: pari.enVente || false
            })) : [],
            weather: rawData.programme?.meteo ? {
              temperature: rawData.programme.meteo.temperature,
              conditions: rawData.programme.meteo.nebulositeLibelleCourt,
              wind: {
                strength: rawData.programme.meteo.forceVent,
                direction: rawData.programme.meteo.directionVent
              }
            } : null,
            meetingType: this.formatTypeReunion(reunion.nature),
            raceDuration: course.dureeCourse || null
          }
        };
        
        matches.push(match);
      });
    });
    
    // Convertir les ensembles en tableaux
    const leaguesObj = {};
    for (const country in leagues) {
      leaguesObj[country] = Array.from(leagues[country]);
    }
    
    return {
      sport: 'horse',
      date,
      source: 'pmu-turfinfo',
      rawData,
      matches: matches.sort((a, b) => new Date(a.date) - new Date(b.date)),
      indexes: {
        countries: Array.from(countries),
        leagues: leaguesObj
      }
    };
  }
  
  // Fonctions utilitaires spécifiques aux courses hippiques
  formatDiscipline(discipline, specialite) {
    if (!discipline) return 'Trot';
    
    const disciplines = {
      'MONTE': 'Trot monté',
      'ATTELE': 'Trot attelé',
      'GALOP': 'Galop'
    };
    return disciplines[discipline] || specialite || discipline;
  }
  
  formatConditionSexe(condition) {
    if (!condition) return 'Tous';
    
    const conditions = {
      'TOUS_CHEVAUX': 'Tous',
      'MALES_ET_HONGRES': 'Mâles et hongres',
      'FEMELLES': 'Juments'
    };
    return conditions[condition] || condition;
  }
  
  formatTypeReunion(nature) {
    if (!nature) return 'Diurne';
    
    const types = {
      'SEMINOCTURNE': 'Nocturne',
      'DIURNE': 'Diurne',
      'MATINALE': 'Matinale'
    };
    return types[nature] || nature;
  }
  
  formatTypePari(type) {
    if (!type) return '';
    return type.replace('E_', '').replace(/_/g, ' ').toLowerCase();
  }
  
  extractAgeFromConditions(conditions) {
    if (!conditions) return null;
    const ageMatch = conditions.match(/Pour (\d+) ans?/i) || 
                     conditions.match(/(\d+) (?:et|à) (\d+) ans/i);
    return ageMatch ? ageMatch[1] : null;
  }
  
  extractGainsFromConditions(conditions) {
    if (!conditions) return null;
    const gainsMatch = conditions.match(/gagné ([\d.]+)/i);
    return gainsMatch ? parseInt(gainsMatch[1].replace('.', '')) : null;
  }
}

module.exports = HorseProvider;