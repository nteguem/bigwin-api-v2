// src/api/models/common/Ticket.js

const mongoose = require("mongoose");

/**
 * TICKETS PARTAGÉS (Shared Tickets)
 * ==================================
 * 
 * Les tickets peuvent être soit spécifiques à une application, soit partagés entre toutes les applications.
 * 
 * UTILISATION :
 * - appId = "app1", "app2", etc. → Ticket spécifique à une app
 * - appId = "shared" → Ticket partagé visible depuis toutes les apps
 * 
 * NOTIFICATIONS :
 * - Ticket spécifique : Notification envoyée uniquement à son app
 * - Ticket partagé : Notification envoyée à TOUTES les apps actives
 */

const TicketSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
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

// Indexes
TicketSchema.index({ appId: 1, date: -1, category: 1, isVisible: 1 });
TicketSchema.index({ appId: 1, date: -1 });
TicketSchema.index({ appId: 1, category: 1 });
TicketSchema.index({ appId: 1, status: 1 });
TicketSchema.index({ appId: 1, isVisible: 1, date: -1 });
TicketSchema.index({ date: -1 });
TicketSchema.index({ category: 1 });
TicketSchema.index({ status: 1 });
TicketSchema.index({ isVisible: 1, date: -1 });

// Hooks
TicketSchema.post('findOneAndUpdate', async function (doc) {
  if (doc) {
    const update = this.getUpdate();
    const wasVisibilityChanged = update.isVisible === true || update.$set?.isVisible === true;
    
    if (wasVisibilityChanged && doc.isVisible) {
      try {
        const Category = mongoose.model('Category');
        const category = await Category.findById(doc.category);
        const categoryName = category ? category.description : 'Catégorie inconnue';
        
        const isLive = categoryName.toUpperCase().includes('LIVE');
        const isDailyCoupon = categoryName.toUpperCase().includes('COUPON DU JOUR') || 
                             category?.name === 'CDJ';
                
        const notificationService = require("../../services/common/notificationService");
        
        let notification;
        
        if (isDailyCoupon) {
          notification = {
            headings: {
              en: "💎 Daily Sure Bet!",
              fr: "💎 Coup Sûr du Jour!"
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
              android_accent_color: "FFD700",
              small_icon: "ic_notification",
              large_icon: "ic_launcher",
              priority: 10
            }
          };
        } else if (isLive) {
          notification = {
            headings: {
              en: "🔴 LIVE NOW!",
              fr: "🔴 EN DIRECT!"
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
              android_accent_color: "FF0000",
              small_icon: "ic_notification",
              large_icon: "ic_launcher"
            }
          };
        } else {
          notification = {
            headings: {
              en: "💰 New Coupon!",
              fr: "💰 Nouveau Coupon!"
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

        // ⭐ NOUVEAU : Gestion des tickets partagés
        if (doc.appId === "shared") {
          // Ticket partagé → Broadcaster à toutes les apps actives
          console.log(`📢 [SHARED] Ticket partagé détecté - Broadcasting à toutes les apps`);
          
          const App = mongoose.model('App');
          const activeApps = await App.find({ isActive: true }).select('appId');
          
          console.log(`📊 [SHARED] ${activeApps.length} apps actives trouvées`);
          
          let successCount = 0;
          let errorCount = 0;
          
          for (const app of activeApps) {
            try {
              const result = await notificationService.sendToAll(app.appId, notification);
              successCount++;
              
              console.log(`✅ [${app.appId}] Notification envoyée`, {
                notificationId: result.id,
                recipients: result.recipients
              });
            } catch (error) {
              errorCount++;
              console.error(`❌ [${app.appId}] Erreur envoi notification:`, error.message);
            }
          }
          
          console.log(`📊 [SHARED] Résumé: ${successCount} succès, ${errorCount} erreurs`);
          
        } else {
          // Ticket spécifique → Envoi normal à l'app
          const result = await notificationService.sendToAll(doc.appId, notification);
          
          console.log(`✅ [${doc.appId}] Notification envoyée avec succès`);
          console.log("📊 Statistiques:", {
            appId: doc.appId,
            notificationId: result.id,
            recipients: result.recipients,
            type: isDailyCoupon ? 'DAILY_COUPON' : (isLive ? 'LIVE' : 'NORMAL'),
            category: categoryName
          });
        }
        
      } catch (error) {
        console.error(`❌ Erreur globale envoi notification:`, error.message);
        console.error('Détails erreur:', {
          ticketId: doc._id,
          appId: doc.appId,
          categoryId: doc.category,
          error: error.stack
        });
      }
    }
  }
});

module.exports = mongoose.model("Ticket", TicketSchema);