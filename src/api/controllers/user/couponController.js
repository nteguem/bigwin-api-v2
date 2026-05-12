// controllers/user/couponController.js

const TicketService = require('../../services/common/ticketService');
const subscriptionService = require('../../services/user/subscriptionService');
const DayOff = require('../../models/common/DayOff');
const accessGateService = require('../../services/common/accessGateService');
const UserAccessUnlock = require('../../models/common/UserAccessUnlock');

/**
 * Formate une prédiction d'un ticket pour l'API coupons. Si `maskEvent`, on
 * masque le PRONOSTIC (event/pari) — le match (équipes, ligue, date), la cote
 * et le statut restent visibles : aperçu d'un coupon gaté pas (encore)
 * débloqué. Le frontend détecte un `event` vide ⇒ floute cette partie.
 */
function formatCouponPrediction(pred, lang, maskEvent) {
  const isHorseRacing =
    pred?.sport?.id === 'horse' ||
    pred?.sport?.name?.toLowerCase() === 'courses hippiques';

  return {
    id: pred._id,
    odds: pred.odds,
    status: pred.status,
    sport: pred?.sport,
    locked: !!maskEvent,
    event: maskEvent
      ? { id: null, label: null, description: null, category: null }
      : {
          id: pred.event?.id,
          label: pred.event?.label?.[lang] || pred.event?.label?.fr || pred.event?.label?.current || '',
          description: pred.event?.description?.current || '',
          category: pred.event?.category
        },
    match: {
      id: pred.matchData.id,
      date: pred.matchData.date,
      status: pred.matchData.status,
      league: {
        name: pred.matchData.league.name,
        country: pred.matchData.league.country,
        logo: pred.matchData.league.logo,
        countryFlag: pred.matchData.league.countryFlag,
      },
      ...(isHorseRacing ? {
        raceInfo: {
          raceNumber: pred.matchData.raceInfo?.raceNumber,
          raceName: pred.matchData.raceInfo?.raceName,
          discipline: pred.matchData.raceInfo?.discipline,
          totalRunners: pred.matchData.raceInfo?.totalRunners
        }
      } : {
        teams: {
          home: {
            id: pred.matchData?.teams?.home?.id,
            name: pred.matchData?.teams?.home?.name,
            logo: pred.matchData?.teams?.home?.logo
          },
          away: {
            id: pred.matchData?.teams?.away?.id,
            name: pred.matchData?.teams?.away?.name,
            logo: pred.matchData?.teams?.away?.logo
          }
        },
        score: pred.matchData.score ? {
          home: pred.matchData.score.home,
          away: pred.matchData.score.away,
          status: pred.matchData.status
        } : null
      }),
      venue: pred.matchData.venue ? {
        name: pred.matchData.venue.name,
        city: pred.matchData.venue.city
      } : null
    }
  };
}

class CouponController {
  
  // Récupérer la liste des coupons (tickets visibles)
  async getCoupons(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { 
        page = 1, 
        limit = 150, 
        category = null, 
        date = null,
        isVip = null, // true, false ou null (tous)
        lang = 'fr' // Langue par défaut : français
      } = req.query;

      const offset = (page - 1) * parseInt(limit);

      // ⭐ Récupérer les tickets visibles avec pagination POUR CETTE APP
      const result = await TicketService.getTickets(appId, {
        offset,
        limit: parseInt(limit),
        category,
        date,
        isVisible: true
      });

      // Filtrer selon l'accès de l'utilisateur
      let filteredData = result.data;

      if (isVip === 'true') {
        // ⭐ OPTIMISATION : Une seule requête pour récupérer toutes les catégories VIP accessibles POUR CETTE APP
        const userVipCategories = await subscriptionService.getUserVipCategories(appId, req.user._id);
        const accessibleVipCategoryIds = new Set(userVipCategories.map(cat => cat._id.toString()));

        // Filtrer les tickets selon les catégories VIP accessibles
        filteredData = result.data.filter(ticket => {
          const categoryId = ticket.category._id.toString();
          return ticket.category.isVip && accessibleVipCategoryIds.has(categoryId);
        });

      } else if (isVip === 'false') {
        // Pour les coupons gratuits : seulement les catégories non-VIP
        filteredData = result.data.filter(ticket => !ticket.category.isVip);
      }
      // Si isVip === null, on garde tous les tickets (comportement par défaut)

      // Pré-charger l'état de déblocage des CATÉGORIES free gatées (1 requête
      // au lieu d'une par catégorie). Anonyme ⇒ aucun déblocage possible.
      const gatedCategoryIds = [];
      const seenGatedCat = new Set();
      for (const t of filteredData) {
        const cat = t.category;
        if (!cat || cat.isVip || !accessGateService.categoryIsGated(cat)) continue;
        const id = cat._id.toString();
        if (!seenGatedCat.has(id)) { seenGatedCat.add(id); gatedCategoryIds.push(cat._id); }
      }
      const unlockMap = new Map(); // categoryId(string) -> UserAccessUnlock doc
      if (gatedCategoryIds.length > 0 && req.user) {
        const unlocks = await UserAccessUnlock.find({
          appId,
          user: req.user._id,
          resourceType: accessGateService.RESOURCE_TYPE_CATEGORY,
          resource: { $in: gatedCategoryIds }
        });
        unlocks.forEach(u => unlockMap.set(u.resource.toString(), u));
      }
      // Compteur "X personnes ont débloqué cette catégorie" (1 agrégation).
      const unlockCountMap = gatedCategoryIds.length > 0
        ? await accessGateService.countCategoryUnlocks(appId, gatedCategoryIds)
        : new Map();

      // Un abonné (forfait actif) n'a PAS à regarder de pub : le gate ne concerne
      // que les utilisateurs free sans forfait. On contourne donc la porte pour
      // lui (il voit les coupons free comme s'ils n'étaient pas gatés).
      let userIsSubscriber = false;
      if (req.user && gatedCategoryIds.length > 0) {
        try {
          const subs = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
          userIsSubscriber = Array.isArray(subs) && subs.length > 0;
        } catch (_) { /* fail-open : traiter comme non-abonné */ }
      }

      // Grouper les tickets par catégorie
      const categoriesMap = new Map();
      
      filteredData.forEach(ticket => {
        const categoryId = ticket.category._id.toString();
        
        if (!categoriesMap.has(categoryId)) {
          categoriesMap.set(categoryId, {
            id: ticket.category._id,
            name: ticket.category.name?.[lang] || ticket.category.name?.fr || ticket.category.name,
            icon: ticket.category.icon,
            successRate: ticket.category.successRate,
            description: ticket.category.description?.[lang] || ticket.category.description?.fr || ticket.category.description || null,
            isVip: ticket.category.isVip,
            isActive: ticket.category.isActive,
            totalCoupons: 0,
            coupons: []
          });
        }

        const category = categoriesMap.get(categoryId);
        category.totalCoupons++;
        
        // Porte de déblocage par pub — portée par la CATÉGORIE (free uniquement).
        // Un abonné contourne la porte (cf. userIsSubscriber).
        const gated = !(ticket.category && ticket.category.isVip) && accessGateService.categoryIsGated(ticket.category);
        const unlockDoc = gated ? (unlockMap.get(categoryId) || null) : null;
        const isUnlocked = !!(unlockDoc && unlockDoc.isAccessActive());

        if (gated && !isUnlocked && !userIsSubscriber) {
          // Aperçu d'un coupon gaté NON débloqué : on renvoie les prédictions
          // AVEC le match (équipes, ligue, date, cote) mais le PRONOSTIC est
          // masqué (event vide) — le frontend floute juste cette partie.
          category.coupons.push({
            id: ticket._id,
            title: ticket.title,
            date: ticket.date,
            closingAt: ticket.closingAt,
            status: ticket.status,
            totalPredictions: ticket.predictions.length,
            totalOdds: ticket.predictions.reduce((total, pred) => total * pred.odds, 1).toFixed(2),
            locked: true,
            gate: {
              type: 'ad_reward',
              categoryId: ticket.category._id,
              offers: ticket.category.accessGate.options.map(o => ({
                durationMinutes: o.durationMinutes != null ? o.durationMinutes : null,
                adsRequired: o.adsRequired
              })),
              requiresAuth: !req.user,
              unlockCount: unlockCountMap.get(categoryId) || 0,
              state: accessGateService.buildState(unlockDoc)
            },
            predictions: ticket.predictions.map(pred => formatCouponPrediction(pred, lang, true)),
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt
          });
          return; // coupon suivant
        }

        // Formater le coupon (accès libre, ou ticket gaté déjà débloqué)
        const coupon = {
          id: ticket._id,
          title: ticket.title,
          date: ticket.date,
          closingAt: ticket.closingAt,
          status: ticket.status,
          totalPredictions: ticket.predictions.length,
          totalOdds: ticket.predictions.reduce((total, pred) => total * pred.odds, 1).toFixed(2),
          predictions: ticket.predictions.map(pred => formatCouponPrediction(pred, lang, false)),
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt
        };

        if (isUnlocked) {
          // Ticket gaté déjà débloqué : indiquer jusqu'à quand l'accès est valide.
          coupon.unlocked = true;
          coupon.unlockedUntil = unlockDoc.expiresAt || null; // null = à vie
        }

        category.coupons.push(coupon);
      });

      // Convertir la Map en array
      const categories = Array.from(categoriesMap.values());

      const typeMessage = isVip === 'true' ? 'VIP' : isVip === 'false' ? 'gratuits' : '';

      // Vérifier si c'est un jour off quand il n'y a pas de coupons
      let dayOff = null;
      if (categories.length === 0) {
        const checkDate = date || new Date().toISOString().split('T')[0];
        const dayOffRecord = await DayOff.findOne({ appId, date: checkDate }).populate('message').lean();
        if (dayOffRecord?.message) {
          dayOff = {
            active: true,
            message: dayOffRecord.message.message?.[lang] || dayOffRecord.message.message?.fr
          };
        }
      }

      return res.status(200).json({
        success: true,
        message: `Liste des coupons ${typeMessage} récupérée avec succès`.trim(),
        data: {
          categories,
          ...(dayOff && { dayOff })
        }
      });

    } catch (error) {
      console.error('Erreur lors de la récupération des coupons:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Preview VIP : données masquées pour upsell (accès public)
  async getVipPreview(req, res) {
    try {
      const appId = req.appId;
      const { lang = 'fr' } = req.query;

      // Récupérer les tickets VIP visibles du jour
      const today = new Date().toISOString().split('T')[0];
      const result = await TicketService.getTickets(appId, {
        offset: 0,
        limit: 150,
        date: today,
        isVisible: true
      });

      // Ne garder que les catégories VIP (skip les tickets dont la catégorie a été supprimée)
      const vipTickets = result.data.filter(ticket => ticket.category && ticket.category.isVip);

      // Grouper par catégorie avec données masquées
      const categoriesMap = new Map();

      vipTickets.forEach(ticket => {
        const categoryId = ticket.category._id.toString();

        if (!categoriesMap.has(categoryId)) {
          categoriesMap.set(categoryId, {
            id: ticket.category._id,
            name: ticket.category.name?.[lang] || ticket.category.name?.fr || ticket.category.name,
            icon: ticket.category.icon,
            successRate: ticket.category.successRate,
            description: ticket.category.description?.[lang] || ticket.category.description?.fr || ticket.category.description || null,
            isVip: true,
            totalCoupons: 0,
            coupons: []
          });
        }

        const category = categoriesMap.get(categoryId);
        category.totalCoupons++;

        // Données masquées : stats sans détails des prédictions
        category.coupons.push({
          id: ticket._id,
          title: ticket.title,
          date: ticket.date,
          status: ticket.status,
          totalPredictions: ticket.predictions.length,
          totalOdds: ticket.predictions.reduce((total, pred) => total * pred.odds, 1).toFixed(2),
          // Pas de predictions[] — c'est le masquage
        });
      });

      const categories = Array.from(categoriesMap.values());

      return res.status(200).json({
        success: true,
        message: 'Aperçu VIP récupéré avec succès',
        data: { categories }
      });

    } catch (error) {
      console.error('Erreur lors de la récupération du preview VIP:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Récupérer un coupon spécifique par ID
  async getCouponById(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      const { lang = 'fr' } = req.query;

      // ⭐ Passer appId au service
      const ticket = await TicketService.getTicketById(appId, id);

      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Coupon non trouvé'
        });
      }

      // Vérifier si le ticket est visible
      if (!ticket.isVisible) {
        return res.status(404).json({
          success: false,
          message: 'Coupon non disponible'
        });
      }

      // Vérifier l'accès si c'est une catégorie VIP
      if (ticket.category.isVip) {
        // ⭐ Passer appId au service
        const hasAccess = await subscriptionService.hasAccessToCategory(appId, req.user._id, ticket.category._id);
        
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'Abonnement VIP requis pour accéder à ce coupon'
          });
        }
      }

      // Formater les données du coupon avec sa catégorie
      const couponWithCategory = {
        category: {
          id: ticket.category._id,
          name: ticket.category.name?.[lang] || ticket.category.name?.fr || ticket.category.name,
          icon: ticket.category.icon,
          successRate: ticket.category.successRate,
          description: ticket.category.description?.[lang] || ticket.category.description?.fr || ticket.category.description || null,
          isVip: ticket.category.isVip,
          isActive: ticket.category.isActive
        },
        coupon: {
          id: ticket._id,
          title: ticket.title,
          date: ticket.date,
          closingAt: ticket.closingAt,
          status: ticket.status,
          totalPredictions: ticket.predictions.length,
          totalOdds: ticket.predictions.reduce((total, pred) => total * pred.odds, 1).toFixed(2),
          predictions: ticket.predictions.map(pred => {
            const isHorseRacing = pred?.sport?.id === 'horse' || pred?.sport?.name?.toLowerCase() === 'courses hippiques';
            
            return {
              id: pred._id,
              odds: pred.odds,
              status: pred.status,
              sport: pred?.sport,
              event: {
                id: pred.event?.id,
                label: pred.event?.label?.[lang] || pred.event?.label?.fr || pred.event?.label?.current || '',
                description: pred.event?.description?.current || '',
                category: pred.event?.category
              },
              match: {
                id: pred.matchData.id,
                date: pred.matchData.date,
                status: pred.matchData.status,
                league: {
                  name: pred.matchData.league.name,
                  country: pred.matchData.league.country,
                  logo: pred.matchData.league.logo,
                  countryFlag: pred.matchData.league.countryFlag,
                },
                // CONDITION AJOUTÉE pour éviter l'erreur sur les courses hippiques
                ...(isHorseRacing ? {
                  // Structure pour course hippique
                  raceInfo: {
                    raceNumber: pred.matchData.raceInfo?.raceNumber,
                    raceName: pred.matchData.raceInfo?.raceName,
                    discipline: pred.matchData.raceInfo?.discipline,
                    totalRunners: pred.matchData.raceInfo?.totalRunners
                  }
                } : {
                  // Structure existante pour sports d'équipe
                  teams: {
                    home: {
                      id: pred.matchData?.teams?.home?.id,
                      name: pred.matchData?.teams?.home?.name,
                      logo: pred.matchData?.teams?.home?.logo
                    },
                    away: {
                      id: pred.matchData?.teams?.away?.id,
                      name: pred.matchData?.teams?.away?.name,
                      logo: pred.matchData?.teams?.away?.logo
                    }
                  },
                  score: pred.matchData.score ? {
                    home: pred.matchData.score.home,
                    away: pred.matchData.score.away,
                    status: pred.matchData.status
                  } : null
                }),
                venue: pred.matchData.venue ? {
                  name: pred.matchData.venue.name,
                  city: pred.matchData.venue.city
                } : null
              }
            };
          }),
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt
        }
      };

      return res.status(200).json({
        success: true,
        message: `Coupon récupéré avec succès`,
        data: couponWithCategory
      });

    } catch (error) {
      console.error('Erreur lors de la récupération du coupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Récupérer l'historique des tickets par dates
  async getTicketsHistory(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { 
        daysBack = 10,
        isVip = null,
        category = null,
        lang = 'fr' // Langue par défaut : français
      } = req.query;

      // Générer les dates précédentes (à partir d'hier)
      const dates = [];
      const today = new Date();
      
      for (let i = 1; i <= parseInt(daysBack); i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        dates.push(date.toISOString().split('T')[0]); // Format YYYY-MM-DD
      }

      const historyByDate = [];

      // Pour chaque date, récupérer les tickets
      for (const date of dates) {
        // ⭐ Passer appId au service
        const result = await TicketService.getTickets(appId, {
          offset: 0,
          limit: 1000, // Grande limite pour récupérer tous les tickets de la date
          category,
          date,
          isVisible: null // Tous les tickets, pas seulement les visibles
        });

        // Filtrer selon l'accès de l'utilisateur
        let filteredData = result.data;

        if (isVip === 'true') {
          // ⭐ Récupérer les catégories VIP accessibles POUR CETTE APP
          const userVipCategories = await subscriptionService.getUserVipCategories(appId, req.user._id);
          const accessibleVipCategoryIds = new Set(userVipCategories.map(cat => cat._id.toString()));

          // Filtrer les tickets selon les catégories VIP accessibles
          filteredData = result.data.filter(ticket => {
            const categoryId = ticket.category._id.toString();
            return ticket.category.isVip && accessibleVipCategoryIds.has(categoryId);
          });

        } else if (isVip === 'false') {
          // Pour les tickets gratuits : seulement les catégories non-VIP
          filteredData = result.data.filter(ticket => !ticket.category.isVip);
        }
        // Si isVip === null, on garde tous les tickets

        // Grouper les tickets par catégorie pour cette date
        const categoriesMap = new Map();
        
        filteredData.forEach(ticket => {
          const categoryId = ticket.category._id.toString();
          
          if (!categoriesMap.has(categoryId)) {
            categoriesMap.set(categoryId, {
              id: ticket.category._id,
              name: ticket.category.name?.[lang] || ticket.category.name?.fr || ticket.category.name,
              description: ticket.category.description?.[lang] || ticket.category.description?.fr || ticket.category.description || null,
              icon: ticket.category.icon,
              successRate: ticket.category.successRate,
              isVip: ticket.category.isVip,
              isActive: ticket.category.isActive,
              tickets: []
            });
          }
          
          const category = categoriesMap.get(categoryId);
          
          // Formater le ticket
          const ticket_formatted = {
            id: ticket._id,
            title: ticket.title,
            date: ticket.date,
            closingAt: ticket.closingAt,
            status: ticket.status,
            isVisible: ticket.isVisible,
            totalPredictions: ticket.predictions.length,
            totalOdds: ticket.predictions.reduce((total, pred) => total * pred.odds, 1).toFixed(2),
            predictions: ticket.predictions.map(pred => {
              const isHorseRacing = pred?.sport?.id === 'horse' || pred?.sport?.name?.toLowerCase() === 'courses hippiques';
              
              return {
                id: pred._id,
                odds: pred.odds,
                status: pred.status,
                sport: pred?.sport,
                event: {
                  id: pred.event?.id,
                  label: pred.event?.label?.[lang] || pred.event?.label?.fr || pred.event?.label?.current || '',
                  description: pred.event?.description?.current || '',
                  category: pred.event?.category
                },
                match: {
                  id: pred.matchData.id,
                  date: pred.matchData.date,
                  status: pred.matchData.status,
                  league: {
                    name: pred.matchData.league.name,
                    country: pred.matchData.league.country,
                    logo: pred.matchData.league.logo,
                    countryFlag: pred.matchData.league.countryFlag,
                  },
                  // CONDITION AJOUTÉE pour éviter l'erreur sur les courses hippiques
                  ...(isHorseRacing ? {
                    // Structure pour course hippique
                    raceInfo: {
                      raceNumber: pred.matchData.raceInfo?.raceNumber,
                      raceName: pred.matchData.raceInfo?.raceName,
                      discipline: pred.matchData.raceInfo?.discipline,
                      totalRunners: pred.matchData.raceInfo?.totalRunners
                    }
                  } : {
                    // Structure existante pour sports d'équipe
                    teams: {
                      home: {
                        id: pred.matchData?.teams?.home?.id,
                        name: pred.matchData?.teams?.home?.name,
                        logo: pred.matchData?.teams?.home?.logo
                      },
                      away: {
                        id: pred.matchData?.teams?.away?.id,
                        name: pred.matchData?.teams?.away?.name,
                        logo: pred.matchData?.teams?.away?.logo
                      }
                    },
                    score: pred.matchData.score ? {
                      home: pred.matchData.score.home,
                      away: pred.matchData.score.away,
                      status: pred.matchData.status
                    } : null
                  }),
                  venue: pred.matchData.venue ? {
                    name: pred.matchData.venue.name,
                    city: pred.matchData.venue.city
                  } : null
                }
              };
            }),
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt
          };
          
          category.tickets.push(ticket_formatted);
        });

        // Convertir la Map en array et ajouter à l'historique seulement si il y a des catégories
        const categories = Array.from(categoriesMap.values());
        
        if (categories.length > 0) {
          historyByDate.push({
            date,
            categories
          });
        }
      }

      const typeMessage = isVip === 'true' ? 'VIP' : isVip === 'false' ? 'gratuits' : '';

      return res.status(200).json({
        success: true,
        message: `Historique des tickets ${typeMessage} des ${daysBack} dernières dates récupéré avec succès`.trim(),
        data: {
          historyByDate
        }
      });

    } catch (error) {
      console.error('Erreur lors de la récupération de l\'historique des tickets:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

module.exports = new CouponController();