/**
 * @fileoverview Contrôleur pour les routes sportives - VERSION CORRIGÉE
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
      name: config.name,
      icon: config.icon,
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

    // Normaliser le nom du pays depuis l'URL
    const countryFromUrl = country.replace(/-/g, ' ');
    
    // Trouver le pays correspondant (case-insensitive)
    const countryName = data.indexes.countries.find(
      c => c.toLowerCase() === countryFromUrl.toLowerCase()
    );

    if (!countryName) {
      throw new AppError(`Country not found: ${country}`, 404);
    }

    // Pour les courses hippiques, enrichir les données hippodromes
    if (sport === 'horse') {
      const hippodromes = data.matches
        .filter(match => match.league.country.toLowerCase() === countryName.toLowerCase())
        .reduce((acc, match) => {
          let hippodrome = acc.find(h => h.id === match.league.id);
          
          if (!hippodrome) {
            // Extraire le numéro de réunion depuis l'ID du match (ex: R2-C1 -> R2)
            const reunionNumber = match.id.split('-')[0]; // R2
            
            hippodrome = {
              id: match.league.id,
              name: match.league.name,
              logo: exports.getHippodromeEmoji(match.league.id),
              reunionNumber: reunionNumber,
              racesCount: 0,
              disciplines: new Set(),
              specialRaces: [],
              weather: match.sportSpecific?.weather,
              nextRaceTime: null
            };
            acc.push(hippodrome);
          }
          
          // Compter les courses
          hippodrome.racesCount++;
          
          // Collecter les disciplines
          if (match.sportSpecific?.discipline) {
            hippodrome.disciplines.add(match.sportSpecific.discipline);
          }
          
          // Détecter les courses spéciales (Quinté Plus, etc.)
          if (match.sportSpecific?.bettingTypes) {
            const hasQuinte = match.sportSpecific.bettingTypes.some(bet => 
              bet.type.toLowerCase().includes('multi') || 
              bet.type.toLowerCase().includes('quinté')
            );
            if (hasQuinte && !hippodrome.specialRaces.includes('Q+')) {
              hippodrome.specialRaces.push('Q+');
            }
          }
          
          // Trouver la prochaine course
          const raceTime = new Date(match.date);
          const now = new Date();
          if (raceTime > now && (!hippodrome.nextRaceTime || raceTime < new Date(hippodrome.nextRaceTime))) {
            hippodrome.nextRaceTime = match.date;
          }
          
          return acc;
        }, []);
      
      // Transformer les disciplines en tableau et trier par numéro de réunion
      const leagues = hippodromes.map(h => ({
        ...h,
        disciplines: Array.from(h.disciplines),
        displayName: `${h.reunionNumber} ${h.name.toUpperCase()}`
      })).sort((a, b) => {
        // Trier par numéro de réunion (R1, R2, R3...)
        const numA = parseInt(a.reunionNumber.replace('R', ''));
        const numB = parseInt(b.reunionNumber.replace('R', ''));
        return numA - numB;
      });

      return formatSuccess(res, {
        data: leagues,
        count: leagues.length
      });
    }

    // Code standard pour les autres sports
    const leagues = data.matches
      .filter(match => match.league.country.toLowerCase() === countryName.toLowerCase())
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

    // Normaliser le nom du pays depuis l'URL
    const countryFromUrl = country.replace(/-/g, ' ');
    
    // Trouver le pays correspondant (case-insensitive)
    const countryName = data.indexes.countries.find(
      c => c.toLowerCase() === countryFromUrl.toLowerCase()
    );

    if (!countryName) {
      throw new AppError(`Country not found: ${country}`, 404);
    }

    // Filtrer les courses (fixtures) par pays et hippodrome (league)
    const fixtures = data.matches.filter(
      match => 
        match.league.country.toLowerCase() === countryName.toLowerCase() && 
        match.league.id === league
    );

    if (fixtures.length === 0) {
      throw new AppError(`No fixtures found for league: ${league}`, 404);
    }

    // Format spécialisé pour les courses hippiques
    if (sport === 'horse') {
      const horseData = exports.formatHorseRaces(fixtures, league);
      return formatSuccess(res, {
        data: horseData
      });
    }

    // Format standard pour les autres sports
    let fixturesWithFlag = fixtures;
    
    if (sport !== 'horse') {
      const countryId = country.toLowerCase().replace(/\s+/g, '-');
      const countryFlag = `https://media.api-sports.io/flags/${countryId.substring(0, 2)}.svg`;
      
      fixturesWithFlag = fixtures.map(fixture => ({
        ...fixture,
        league: {
          ...fixture.league,
          countryFlag
        }
      }));
    } else {
      fixturesWithFlag = fixtures.map(fixture => ({
        ...fixture,
        league: {
          ...fixture.league,
          countryFlag: 'https://media.api-sports.io/flags/fr.svg'
        }
      }));
    }

    formatSuccess(res, {
      data: fixturesWithFlag,
      count: fixturesWithFlag.length
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

    // Format spécialisé pour les détails des courses hippiques
    if (sport === 'horse') {
      const raceDetails = exports.formatHorseRaceDetails(matchData);
      return formatSuccess(res, { 
        data: raceDetails 
      });
    }

    formatSuccess(res, { 
      data: matchData 
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Formate les courses hippiques pour l'affichage
 */
exports.formatHorseRaces = (fixtures, leagueId) => {
  const hippodrome = fixtures[0];
  
  return {
    hippodrome: {
      id: leagueId,
      name: hippodrome.league.name,
      fullName: hippodrome.venue.name,
      city: hippodrome.venue.city,
      emoji: exports.getHippodromeEmoji(leagueId)
    },
    date: fixtures[0].date.split('T')[0],
    weather: fixtures[0].sportSpecific?.weather,
    meetingType: fixtures[0].sportSpecific?.meetingType,
    races: fixtures.map(fixture => ({
      id: fixture.id,
      raceNumber: fixture.sportSpecific?.courseNumber,
      name: fixture.sportSpecific?.courseName,
      shortName: fixture.sportSpecific?.courseNameShort,
      startTime: fixture.date,
      discipline: fixture.sportSpecific?.discipline,
      distance: fixture.sportSpecific?.distance,
      track: fixture.sportSpecific?.track,
      status: exports.formatRaceStatus(fixture.status),
      runners: fixture.sportSpecific?.runners,
      conditions: fixture.sportSpecific?.conditions,
      prize: {
        total: fixture.sportSpecific?.prize?.total,
        first: fixture.sportSpecific?.prize?.first,
        second: fixture.sportSpecific?.prize?.second,
        third: fixture.sportSpecific?.prize?.third
      },
      betting: fixture.sportSpecific?.bettingTypes?.map(bet => ({
        type: bet.type,
        stake: bet.baseStake,
        available: bet.available
      })) || [],
      result: fixture.score?.details?.arrivee ? {
        finishing: fixture.score.details.arrivee,
        inquiry: fixture.score.details.enquete
      } : null,
      duration: fixture.sportSpecific?.raceDuration
    })).sort((a, b) => a.raceNumber - b.raceNumber),
    totalRaces: fixtures.length
  };
};

/**
 * Formate les détails d'une course hippique
 */
exports.formatHorseRaceDetails = (matchData) => {
  return {
    race: {
      id: matchData.id,
      number: matchData.sportSpecific?.courseNumber,
      name: matchData.sportSpecific?.courseName,
      shortName: matchData.sportSpecific?.courseNameShort,
      startTime: matchData.date,
      discipline: matchData.sportSpecific?.discipline,
      distance: matchData.sportSpecific?.distance,
      track: matchData.sportSpecific?.track,
      status: exports.formatRaceStatus(matchData.status),
      runners: matchData.sportSpecific?.runners
    },
    hippodrome: {
      id: matchData.league.id,
      name: matchData.league.name,
      fullName: matchData.venue.name,
      city: matchData.venue.city,
      emoji: exports.getHippodromeEmoji(matchData.league.id)
    },
    conditions: matchData.sportSpecific?.conditions,
    prize: matchData.sportSpecific?.prize,
    betting: matchData.sportSpecific?.bettingTypes,
    weather: matchData.sportSpecific?.weather,
    meetingType: matchData.sportSpecific?.meetingType,
    result: matchData.score?.details?.arrivee ? {
      finishing: matchData.score.details.arrivee,
      inquiry: matchData.score.details.enquete,
      duration: matchData.sportSpecific?.raceDuration
    } : null
  };
};

/**
 * Retourne un emoji pour l'hippodrome
 */
exports.getHippodromeEmoji = (hippodromeCode) => {
  const emojiMap = {
    'LSO': '🌊', // Les Sables d'Olonne - côtier
    'SSB': '🏔️', // San Sebastian - montagnard
    'LON': '🏛️', // Longchamp - parisien prestige
    'CAE': '🌾', // Caen - campagne
    'BOR': '🍷', // Bordeaux - vignoble
    'DEA': '⭐', // Deauville - prestige
    'MAR': '🏰', // Marseille - méditerranéen
    'LYO': '🦁', // Lyon - lion de la ville
    'NAN': '🏰', // Nantes - château
    'TOU': '🌸', // Toulouse - ville rose
  };
  
  return emojiMap[hippodromeCode] || '🏇'; // Emoji par défaut
};

/**
 * Formate le statut de course en français
 */
exports.formatRaceStatus = (status) => {
  const statusMap = {
    'NOT_STARTED': 'Programmée',
    'LIVE': 'En cours',
    'FINISHED': 'Terminée',
    'CANCELLED': 'Annulée'
  };
  
  return statusMap[status] || status;
};

/**
 * GET /api/sports/:sport/races/:raceId/participants?date=YYYY-MM-DD
 */
exports.getRaceParticipants = async (req, res, next) => {
  try {
    const { sport, raceId } = req.params;
    const { date } = req.query;

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    if (sport !== 'horse') {
      throw new AppError(`Participants endpoint only available for horse racing`, 400);
    }

    if (!date) {
      throw new AppError(`Date parameter is required`, 400);
    }

    if (!raceId || !raceId.match(/^R\d+-C\d+$/)) {
      throw new AppError(`Invalid race ID format. Expected: R2-C1`, 400);
    }

    // Utiliser directement le HorseProvider
    const HorseProvider = require('../../../core/sports/providers/HorseProvider');
    const HttpClient = require('../../../utils/httpClient');
    const logger = require('../../../utils/logger');

    const horseProvider = new HorseProvider(sportsConfig.horse, {
      httpClient: new HttpClient(),
      logger
    });

    // Récupérer les participants
    const rawData = await horseProvider.fetchParticipants(date, raceId);
    const normalizedData = horseProvider.normalizeParticipants(rawData);
    
    // Ajouter l'ID de course aux données normalisées
    normalizedData.raceId = raceId;
    normalizedData.date = date;

    formatSuccess(res, {
      data: normalizedData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sports/:sport/races/:raceId/events?date=YYYY-MM-DD
 */
exports.getHorseEvents = async (req, res, next) => {
  try {
    const { sport, raceId } = req.params;
    const { date } = req.query;

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    if (sport !== 'horse') {
      throw new AppError(`Horse events endpoint only available for horse racing`, 400);
    }

    if (!date) {
      throw new AppError(`Date parameter is required`, 400);
    }

    // Récupérer d'abord les participants pour connaître le nombre de partants
    const HorseProvider = require('../../../core/sports/providers/HorseProvider');
    const HttpClient = require('../../../utils/httpClient');
    const logger = require('../../../utils/logger');

    const horseProvider = new HorseProvider(sportsConfig.horse, {
      httpClient: new HttpClient(),
      logger
    });

    const rawData = await horseProvider.fetchParticipants(date, raceId);
    const participantsData = horseProvider.normalizeParticipants(rawData);

    // Générer les événements disponibles selon le nombre de partants
    const events = exports.generateHorseEvents(participantsData.totalPartants, participantsData.participants);

    formatSuccess(res, {
      data: {
        raceId,
        date,
        totalPartants: participantsData.totalPartants,
        availableEvents: events
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sports/:sport/races/:raceId/events/build
 */
exports.buildHorseEvent = async (req, res, next) => {
  try {
    const { sport, raceId } = req.params;
    const { eventType, selectedHorses, date } = req.body;

    if (!sportsConfig[sport]) {
      throw new AppError(`Sport not found: ${sport}`, 404);
    }

    if (sport !== 'horse') {
      throw new AppError(`Horse event building only available for horse racing`, 400);
    }

    if (!eventType || !selectedHorses || !Array.isArray(selectedHorses) || !date) {
      throw new AppError(`Missing required fields: eventType, selectedHorses (array), date`, 400);
    }

    // Récupérer les participants pour validation
    const HorseProvider = require('../../../core/sports/providers/HorseProvider');
    const HttpClient = require('../../../utils/httpClient');
    const logger = require('../../../utils/logger');

    const horseProvider = new HorseProvider(sportsConfig.horse, {
      httpClient: new HttpClient(),
      logger
    });

    const rawData = await horseProvider.fetchParticipants(date, raceId);
    const participantsData = horseProvider.normalizeParticipants(rawData);

    // Valider les chevaux sélectionnés
    const validNumbers = participantsData.participants.map(p => p.numero);
    const invalidHorses = selectedHorses.filter(num => !validNumbers.includes(num));
    
    if (invalidHorses.length > 0) {
      throw new AppError(`Invalid horse numbers: ${invalidHorses.join(', ')}. Valid numbers: ${validNumbers.join(', ')}`, 400);
    }

    // Construire l'événement
    const builtEvent = exports.buildHorseEventFromSelection(eventType, selectedHorses, participantsData.participants, raceId);

    formatSuccess(res, {
      data: {
        event: builtEvent
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Génère les événements disponibles selon le nombre de partants - VERSION FINALE PMU
 */
exports.generateHorseEvents = (totalPartants, participants) => {
  const events = [];

  // Déterminer le nombre de places payées pour le Simple Placé
  const placesPayees = totalPartants >= 8 ? 3 : 2;
  const placesText = totalPartants >= 8 ? "3 premiers" : "2 premiers";

  // Simple Placé - pour chaque cheval avec règle dynamique
  participants.forEach(participant => {
    events.push({
      id: `simple_place_${participant.numero}`,
      type: 'simple_place',
      label: {
        fr: `Simple Placé - ${participant.nom} (${participant.numero})`,
        en: `Show Bet - ${participant.nom} (${participant.numero})`
      },
      category: 'placement',
      description: {
        fr: `Le cheval n°${participant.numero} (${participant.nom}) finit dans les ${placesText}`,
        en: `Horse #${participant.numero} (${participant.nom}) finishes in top ${placesPayees}`
      },
      selectionType: 'single',
      requiredSelections: 1,
      maxSelections: 1,
      preSelected: [participant.numero],
      pmuRules: {
        placesPayees: placesPayees,
        miseBase: 1.50
      }
    });
  });

  // Couplé - si >= 8 partants
  if (totalPartants >= 8) {
    events.push({
      id: 'couple',
      type: 'couple',
      label: {
        fr: 'Couplé',
        en: 'Exacta'
      },
      category: 'combination',
      description: {
        fr: 'Sélectionnez 2 chevaux (gagnant: 2 premiers, placé: 3 premiers)',
        en: 'Select 2 horses (win: first 2, place: first 3)'
      },
      selectionType: 'multiple',
      requiredSelections: 2,
      maxSelections: 2,
      preSelected: [],
      pmuRules: {
        miseBase: 1.50,
        variantes: [
          {
            type: 'gagnant',
            description: 'Les 2 chevaux aux 2 premières places (quel que soit l\'ordre)',
            gain: 'élevé'
          },
          {
            type: 'place',
            description: 'Les 2 chevaux parmi les 3 premiers (quel que soit l\'ordre)',
            gain: 'modéré'
          }
        ]
      }
    });
  }

  // Tiercé - si >= 8 partants
  if (totalPartants >= 8) {
    events.push({
      id: 'tierce',
      type: 'tierce',
      label: {
        fr: 'Tiercé',
        en: 'Tiercé'
      },
      category: 'combination',
      description: {
        fr: 'Trouvez les 3 premiers chevaux (ordre ou désordre)',
        en: 'Find the first 3 horses (order or disorder)'
      },
      selectionType: 'multiple',
      requiredSelections: 3,
      maxSelections: 3,
      preSelected: [],
      pmuRules: {
        miseBase: 1.00,
        variantes: [
          {
            type: 'ordre',
            description: 'Les 3 chevaux dans l\'ordre exact',
            gain: 'maximum'
          },
          {
            type: 'desordre',
            description: 'Les 3 chevaux dans le désordre',
            gain: 'standard'
          }
        ]
      }
    });
  }

  // 2 sur 4 - UNIQUEMENT si >= 10 partants (règle PMU stricte)
  if (totalPartants >= 10) {
    events.push({
      id: 'deux_sur_quatre',
      type: 'deux_sur_quatre',
      label: {
        fr: '2 sur 4',
        en: '2 out of 4'
      },
      category: 'combination',
      description: {
        fr: 'Sélectionnez 2 chevaux qui finiront dans les 4 premiers (quel que soit l\'ordre)',
        en: 'Select 2 horses that will finish in top 4 (any order)'
      },
      selectionType: 'multiple',
      requiredSelections: 2,
      maxSelections: 2,
      preSelected: [],
      pmuRules: {
        miseBase: 3.00,
        chancesGain: "1 sur 7 environ"
      }
    });
  }

  // Quinté+ - si >= 8 partants (plus logique que 5 pour un vrai Quinté)
  if (totalPartants >= 8) {
    events.push({
      id: 'quinte_plus',
      type: 'quinte_plus',
      label: {
        fr: 'Quinté+',
        en: 'Quinté+'
      },
      category: 'combination',
      description: {
        fr: 'Trouvez les 5 premiers chevaux (ordre, désordre ou bonus 4/5 et 3)',
        en: 'Find the first 5 horses (order, disorder or bonus 4/5 and 3)'
      },
      selectionType: 'multiple',
      requiredSelections: 5,
      maxSelections: 5,
      preSelected: [],
      pmuRules: {
        miseBase: 2.00,
        variantes: [
          {
            type: 'ordre',
            description: 'Les 5 chevaux dans l\'ordre exact (gros gain)',
            gain: 'maximum'
          },
          {
            type: 'desordre',
            description: 'Les 5 chevaux dans le désordre (gain moyen)',
            gain: 'moyen'
          },
          {
            type: 'bonus_4_sur_5',
            description: '4 chevaux parmi les 5 premiers (bonus 4/5)',
            gain: 'bonus'
          },
          {
            type: 'bonus_3',
            description: '3 chevaux parmi les 5 premiers (bonus 3)',
            gain: 'consolation'
          }
        ]
      }
    });
  }

  return events;
};

/**
 * Construit un événement final à partir des sélections - VERSION FINALE PMU
 */
exports.buildHorseEventFromSelection = (eventType, selectedHorses, participants, raceId) => {
  const selectedParticipants = participants.filter(p => selectedHorses.includes(p.numero));
  const totalPartants = participants.length;
  
  // Validation des sélections
  if (!selectedHorses || selectedHorses.length === 0) {
    throw new AppError('Aucun cheval sélectionné', 400);
  }

  // Déterminer les règles selon le nombre de partants
  const placesPayees = totalPartants >= 8 ? 3 : 2;
  const placesText = totalPartants >= 8 ? "3 premiers" : "2 premiers";
  
  // Normaliser l'eventType pour gérer les IDs uniques
  let normalizedEventType = eventType;
  if (eventType.startsWith('simple_place_')) {
    normalizedEventType = 'simple_place';
  }
  
  // Validation du nombre de chevaux selon le type d'événement
  const requiredSelections = {
    'simple_place': 1,
    'couple': 2,
    'tierce': 3,
    'deux_sur_quatre': 2,
    'quinte_plus': 5
  };
  
  const required = requiredSelections[normalizedEventType];
  if (required && selectedHorses.length !== required) {
    throw new AppError(`${normalizedEventType} nécessite exactement ${required} cheval(x), ${selectedHorses.length} fourni(s)`, 400);
  }
  
  // Validation des conditions de partants - MÊMES RÈGLES que generateHorseEvents
  if ((normalizedEventType === 'couple' || normalizedEventType === 'tierce' || normalizedEventType === 'quinte_plus') && totalPartants < 8) {
    throw new AppError(`${normalizedEventType} nécessite au moins 8 partants`, 400);
  }
  if (normalizedEventType === 'deux_sur_quatre' && totalPartants < 10) {
    throw new AppError('2 sur 4 nécessite au moins 10 partants', 400);
  }

  const eventTemplates = {
    simple_place: {
      label: `Simple Placé - ${selectedParticipants[0]?.nom} (${selectedHorses[0]})`,
      description: `Le cheval n°${selectedHorses[0]} finit dans les ${placesText}`,
      expression: `placement_${selectedHorses[0]}_top${placesPayees}`,
      miseBase: 1.50
    },
    couple: {
      label: `Couplé - Chevaux ${selectedHorses.join(', ')}`,
      description: `Les chevaux n°${selectedHorses.join(' et n°')} (gagnant ou placé)`,
      expression: `couple_${selectedHorses.sort().join('_')}`,
      miseBase: 1.50,
      variantes: ['gagnant', 'placé']
    },
    tierce: {
      label: `Tiercé - Chevaux ${selectedHorses.join(', ')}`,
      description: `Les chevaux n°${selectedHorses.join(', n°')} dans les 3 premiers (ordre ou désordre)`,
      expression: `tierce_${selectedHorses.sort().join('_')}`,
      miseBase: 1.00,
      variantes: ['ordre', 'désordre']
    },
    deux_sur_quatre: {
      label: `2 sur 4 - Chevaux ${selectedHorses.join(', ')}`,
      description: `Les chevaux n°${selectedHorses.join(' et n°')} finissent dans les 4 premiers (quel que soit l'ordre)`,
      expression: `deux_sur_quatre_${selectedHorses.sort().join('_')}`,
      miseBase: 3.00
    },
    quinte_plus: {
      label: `Quinté+ - Chevaux ${selectedHorses.join(', ')}`,
      description: `Les chevaux n°${selectedHorses.join(', n°')} dans les 5 premiers (ordre, désordre ou bonus)`,
      expression: `quinte_plus_${selectedHorses.sort().join('_')}`,
      miseBase: 2.00,
      variantes: ['ordre', 'désordre', 'bonus_4_sur_5', 'bonus_3']
    }
  };

  const template = eventTemplates[normalizedEventType];
  
  if (!template) {
    throw new AppError(`Type d'événement inconnu: ${normalizedEventType}`, 400);
  }

  // Générer un ID unique pour l'événement construit
  const eventId = normalizedEventType === 'simple_place' 
    ? `simple_place_${selectedHorses[0]}_${raceId}`
    : `${normalizedEventType}_${raceId}_${selectedHorses.sort().join('_')}`;

  return {
    id: eventId,
    position: 1,
    priority: 'high',
    label: {
      fr: template.label,
      en: template.label,
      current: template.label
    },
    expression: template.expression,
    category: 'horse_racing',
    description: {
      fr: template.description,
      en: template.description,
      current: template.description
    },
    pmuCompliant: {
      miseBase: template.miseBase,
      variantes: template.variantes || null,
      reglesPMU: true
    },
    horseSpecific: {
      raceId: raceId,
      eventType: normalizedEventType,
      originalEventType: eventType,
      selectedHorses: selectedHorses.sort(),
      selectedParticipants: selectedParticipants.map(p => ({
        numero: p.numero,
        nom: p.nom
      })),
      totalPartants: totalPartants,
      placesPayees: placesPayees
    }
  };
};