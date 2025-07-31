const TicketService = require('../../services/common/ticketService');
const subscriptionService = require('../../services/user/subscriptionService');

class CouponController {
  
  // Récupérer la liste des coupons (tickets visibles)
  async getCoupons(req, res) {
    try {
      const { 
        page = 1, 
        limit = 10, 
        category = null, 
        date = null,
        isVip = null // true, false ou null (tous)
      } = req.query;

      const offset = (page - 1) * parseInt(limit);

      // Récupérer les tickets visibles avec pagination
      const result = await TicketService.getTickets({
        offset,
        limit: parseInt(limit),
        category,
        date,
        isVisible: true
      });

      // Filtrer selon l'accès de l'utilisateur
      let filteredData = result.data;

      if (isVip === 'true') {
        // OPTIMISATION : Une seule requête pour récupérer toutes les catégories VIP accessibles
        const userVipCategories = await subscriptionService.getUserVipCategories(req.user._id);
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

      // Grouper les tickets par catégorie
      const categoriesMap = new Map();
      
      filteredData.forEach(ticket => {
        const categoryId = ticket.category._id.toString();
        
        if (!categoriesMap.has(categoryId)) {
          categoriesMap.set(categoryId, {
            id: ticket.category._id,
            name: ticket.category.name,
            description: ticket.category.description || null,
            isVip: ticket.category.isVip,
            isActive: ticket.category.isActive,
            totalCoupons: 0,
            coupons: []
          });
        }
        
        const category = categoriesMap.get(categoryId);
        category.totalCoupons++;
        
        // Formater le coupon
        const coupon = {
          id: ticket._id,
          title: ticket.title,
          date: ticket.date,
          closingAt: ticket.closingAt,
          status: ticket.status,
          totalPredictions: ticket.predictions.length,
          totalOdds: ticket.predictions.reduce((total, pred) => total * pred.odds, 1).toFixed(2),
          predictions: ticket.predictions.map(pred => ({
            id: pred._id,
            odds: pred.odds,
            status: pred.status,
            event: {
              id: pred.event.id,
              label: pred.event.label.current,
              description: pred.event.description.current,
              category: pred.event.category
            },
            match: {
              id: pred.matchData.id,
              date: pred.matchData.date,
              status: pred.matchData.status,
              league: {
                name: pred.matchData.league.name,
                country: pred.matchData.league.country,
                logo: pred.matchData.league.logo
              },
              teams: {
                home: {
                  id: pred.matchData.teams.home.id,
                  name: pred.matchData.teams.home.name,
                  logo: pred.matchData.teams.home.logo
                },
                away: {
                  id: pred.matchData.teams.away.id,
                  name: pred.matchData.teams.away.name,
                  logo: pred.matchData.teams.away.logo
                }
              },
              venue: pred.matchData.venue ? {
                name: pred.matchData.venue.name,
                city: pred.matchData.venue.city
              } : null,
              score: pred.matchData.score ? {
                home: pred.matchData.score.home,
                away: pred.matchData.score.away,
                status: pred.matchData.status
              } : null
            }
          })),
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt
        };
        
        category.coupons.push(coupon);
      });

      // Convertir la Map en array
      const categories = Array.from(categoriesMap.values());

      const typeMessage = isVip === 'true' ? 'VIP' : isVip === 'false' ? 'gratuits' : '';

      return res.status(200).json({
        success: true,
        message: `Liste des coupons ${typeMessage} récupérée avec succès`.trim(),
        data: {
          categories
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

  // Récupérer un coupon spécifique par ID
  async getCouponById(req, res) {
    try {
      const { id } = req.params;

      const ticket = await TicketService.getTicketById(id);

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
        const hasAccess = await subscriptionService.hasAccessToCategory(req.user._id, ticket.category._id);
        
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
          name: ticket.category.name,
          description: ticket.category.description || null,
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
          predictions: ticket.predictions.map(pred => ({
            id: pred._id,
            odds: pred.odds,
            status: pred.status,
            event: {
              id: pred.event.id,
              label: pred.event.label.current,
              description: pred.event.description.current,
              category: pred.event.category
            },
            match: {
              id: pred.matchData.id,
              date: pred.matchData.date,
              status: pred.matchData.status,
              league: {
                name: pred.matchData.league.name,
                country: pred.matchData.league.country,
                logo: pred.matchData.league.logo
              },
              teams: {
                home: {
                  id: pred.matchData.teams.home.id,
                  name: pred.matchData.teams.home.name,
                  logo: pred.matchData.teams.home.logo
                },
                away: {
                  id: pred.matchData.teams.away.id,
                  name: pred.matchData.teams.away.name,
                  logo: pred.matchData.teams.away.logo
                }
              },
              venue: pred.matchData.venue ? {
                name: pred.matchData.venue.name,
                city: pred.matchData.venue.city
              } : null,
              score: pred.matchData.score ? {
                home: pred.matchData.score.home,
                away: pred.matchData.score.away,
                status: pred.matchData.status
              } : null
            }
          })),
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

}

module.exports = new CouponController();