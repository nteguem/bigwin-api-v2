const mongoose = require("mongoose");

const TicketSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true
  },
  isVisible: {
    type: Boolean,
    default: false
  },
  closingAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'closed', 'draft'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Index composé pour les requêtes principales
TicketSchema.index({
  date: -1,
  category: 1,
  isVisible: 1
});

// Index simple sur la date pour les requêtes par plage de dates
TicketSchema.index({
  date: -1
});

// Index sur la catégorie pour les filtres par catégorie
TicketSchema.index({
  category: 1
});

// Index sur le status pour les requêtes filtrées par status
TicketSchema.index({
  status: 1
});

// Index composé pour les requêtes fréquentes de tickets visibles par date
TicketSchema.index({
  isVisible: 1,
  date: -1
});

// Hook pour findByIdAndUpdate / findOneAndUpdate
TicketSchema.post('findOneAndUpdate', async function (doc) {
  if (doc) {
    const update = this.getUpdate();
    const wasVisibilityChanged = update.isVisible === true || update.$set?.isVisible === true;
    
    if (wasVisibilityChanged && doc.isVisible) {
      try {
        // Récupérer le nom de la catégorie
        const Category = mongoose.model('Category');
        const category = await Category.findById(doc.category);
        const categoryName = category ? category.description : 'Catégorie inconnue';
        
        // Vérifier le type de catégorie
        const isLive = categoryName.toUpperCase().includes('LIVE');
        const isDailyCoupon = categoryName.toUpperCase().includes('COUPON DU JOUR') || 
                             category?.name === 'CDJ';
                
        // Import du service de notification
        const notificationService = require("../../services/common/notificationService");
        
        let notification;
        
        if (isDailyCoupon) {
          // Notification pour Coupon du Jour (CDJ)
          notification = {
            headings: {
              en: "💎 Daily Sure Bet - BigWin!",
              fr: "💎 Coup Sûr du Jour - BigWin!"
            },
            contents: {
              en: `🎯 Today's guaranteed @2.00 odds is here! Grab it now!`,
              fr: `🎯 Le coup sûr du jour cote @2.00 est là ! À ne pas manquer !`
            },
            data: {
              type: "daily_coupon",
              ticket_id: doc._id.toString(),
              category_name: categoryName,
              action: "view_daily_coupon",
              guaranteed_odds: "2.00",
              success_rate: "99%"
            },
            options: {
              android_accent_color: "FFD700", // Or/Gold pour le coup sûr
              small_icon: "ic_notification",
              large_icon: "ic_launcher",
              priority: 10 // Haute priorité
            }
          };
        } else if (isLive) {
          // Notification pour les LIVE - Messages optimisés
          notification = {
            headings: {
              en: "🔴 LIVE NOW - BigWin!",
              fr: "🔴 EN DIRECT - BigWin!"
            },
            contents: {
              en: `⚡ Live coupon available! Don't miss out - ${categoryName}`,
              fr: `⚡ Coupon live disponible ! Ne ratez pas - ${categoryName}`
            },
            data: {
              type: "live",
              ticket_id: doc._id.toString(),
              category_name: categoryName,
              action: "view_live"
            },
            options: {
              android_accent_color: "FF0000", // Rouge pour LIVE
              small_icon: "ic_notification",
              large_icon: "ic_launcher"
            }
          };
        } else {
          // Notification normale - Messages optimisés
          notification = {
            headings: {
              en: "💰 New BigWin Coupon!",
              fr: "💰 Nouveau Coupon BigWin!"
            },
            contents: {
              en: `🎯 Fresh coupon just dropped in ${categoryName} - Check it now!`,
              fr: `🎯 Nouveau coupon disponible dans ${categoryName} - Découvrez-le !`
            },
            data: {
              type: "ticket",
              ticket_id: doc._id.toString(),
              category_name: categoryName,
              action: "view_ticket"
            },
            options: {
              android_accent_color: "FF6B35",
              small_icon: "ic_notification",
              large_icon: "ic_launcher"
            }
          };
        }

        // Envoyer la notification à tous les utilisateurs
        const result = await notificationService.sendToAll(notification);
        
        console.log("✅ Notification envoyée avec succès");
        console.log("📊 Statistiques:", {
          notificationId: result.id,
          recipients: result.recipients,
          type: isDailyCoupon ? 'DAILY_COUPON' : (isLive ? 'LIVE' : 'NORMAL'),
          category: categoryName
        });
        
      } catch (error) {
        console.error('❌ Erreur envoi notification:', error.message);
        
        // Log détaillé pour le debug en cas d'erreur
        console.error('Détails erreur:', {
          ticketId: doc._id,
          categoryId: doc.category,
          error: error.stack
        });
      }
    }
  }
});

module.exports = mongoose.model("Ticket", TicketSchema);