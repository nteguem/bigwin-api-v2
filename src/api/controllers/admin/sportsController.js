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