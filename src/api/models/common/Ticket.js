// src/api/models/common/Ticket.js

const mongoose = require("mongoose");

/**
 * TICKETS AVEC CATÉGORIES PARTAGÉES
 * ==================================
 *
 * Les tickets sont filtrés par catégories accessibles (pas par appId du ticket).
 *
 * LOGIQUE :
 * - Ticket avec appId = "bigwin" dans catégorie shared → Visible dans toutes les apps
 * - Ticket avec appId = "bigwin" dans catégorie bigwin → Visible uniquement dans bigwin
 *
 * NOTIFICATIONS :
 * - Si la CATÉGORIE est shared → Notification envoyée à TOUTES les apps actives
 * - Si la CATÉGORIE est spécifique → Notification envoyée uniquement à l'app du ticket
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
  },

  // Résultat dérivé des prédictions liées au ticket. Mis à jour par le cron
  // de correction des tickets, qui s'exécute juste après la correction des
  // pronos. Règle :
  //   - won  : tous les pronos décidés sont 'won' (au moins 1 pred décidée)
  //   - lost : au moins 1 pred 'lost'
  //   - pending : il reste des preds 'pending' et aucune 'lost'
  //   - void : seulement des 'void' (cas marginal)
  // Champ séparé de `status` pour ne pas casser la logique métier existante.
  result: {
    type: String,
    enum: ['pending', 'won', 'lost', 'void'],
    default: 'pending'
  },

  // Dernière fois que le résultat a été calculé (utile pour debug + skip
  // les tickets récemment traités).
  resultUpdatedAt: {
    type: Date,
    default: null
  },

  // Marqueur d'idempotence pour la sync sortante vers des systemes externes.
  // Si on republie un ticket deja clone, on n'en cree pas un doublon : on
  // met juste a jour le ticket cible identifie par cet id.
  //
  // Cle absente / null  => pas encore clone (1ere sync = create)
  // Cle definie         => deja clone (sync = update si necessaire)
  externalRefs: {
    wintips: {
      type: String, // ObjectId du ticket cible cote wintips
      default: null,
    },
  },
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
TicketSchema.index({ appId: 1, result: 1, date: -1 });
TicketSchema.index({ result: 1 });
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
        // ⭐ Support bilingue : description et name sont désormais { fr, en }
        const categoryDescFr = category?.description?.fr || category?.description || '';
        const categoryDescEn = category?.description?.en || category?.description || '';
        const categoryNameFr = category?.name?.fr || category?.name || '';
        const categoryNameEn = category?.name?.en || category?.name || '';

        // ⭐ NOUVEAU : Vérifier si la CATÉGORIE est shared (pas le ticket)
        const isCategoryShared = category && category.appId === "shared";

        const isLive = categoryDescFr.toUpperCase().includes('LIVE') || categoryDescEn.toUpperCase().includes('LIVE');
        const isDailyCoupon = categoryDescFr.toUpperCase().includes('COUPON DU JOUR') ||
                             categoryDescEn.toUpperCase().includes('DAILY') ||
                             categoryNameFr === 'CDJ';
                
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
              category_name: categoryDescFr,
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
              en: `⚡ Live coupon available! Don't miss out - ${categoryDescEn}`,
              fr: `⚡ Coupon live disponible ! Ne ratez pas - ${categoryDescFr}`
            },
            data: {
              type: "live",
              ticket_id: doc._id.toString(),
              category_name: categoryDescFr,
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
              en: `🎯 Fresh coupon just dropped in ${categoryDescEn} - Check it now!`,
              fr: `🎯 Nouveau coupon disponible dans ${categoryDescFr} - Découvrez-le !`
            },
            data: {
              type: "ticket",
              ticket_id: doc._id.toString(),
              category_name: categoryDescFr,
              action: "view_ticket"
            },
            options: {
              android_accent_color: "FF6B35",
              small_icon: "ic_notification",
              large_icon: "ic_launcher"
            }
          };
        }

        // Strategie de broadcast (priorite ordre suivant) :
        //   1. Categorie shared (retro-compat Live)        -> toutes apps actives
        //   2. Categorie multi-app via category.appIds      -> liste de diffusion
        //   3. Categorie mono-app (legacy)                  -> doc.appId only
        const catAppIds = Array.isArray(category?.appIds) ? category.appIds : [];

        if (isCategoryShared) {
          console.log(`📢 [SHARED] "${categoryNameFr}" - broadcast toutes apps actives`);
          const App = mongoose.model('App');
          const activeApps = await App.find({ isActive: true }).select('appId');
          let ok = 0, fail = 0;
          for (const app of activeApps) {
            try {
              const r = await notificationService.sendToAll(app.appId, notification);
              ok++;
              console.log(`✅ [${app.appId}] notif envoyee`, { id: r.id, recipients: r.recipients });
            } catch (err) {
              fail++;
              console.error(`❌ [${app.appId}] erreur:`, err.message);
            }
          }
          console.log(`📊 [SHARED] ${ok}/${activeApps.length} OK (${fail} erreurs)`);

        } else if (catAppIds.length > 1) {
          // Multi-app via Category.appIds : broadcast a la liste de diffusion
          console.log(`📢 [MULTI-APP CAT] "${categoryNameFr}" diffusee sur ${catAppIds.length} apps : ${catAppIds.join(', ')}`);
          let ok = 0, fail = 0;
          for (const targetAppId of catAppIds) {
            try {
              const r = await notificationService.sendToAll(targetAppId, notification);
              ok++;
              console.log(`✅ [${targetAppId}] notif envoyee`, { id: r.id, recipients: r.recipients });
            } catch (err) {
              fail++;
              console.error(`❌ [${targetAppId}] erreur:`, err.message);
            }
          }
          console.log(`📊 [MULTI-APP CAT] ${ok}/${catAppIds.length} OK (${fail} erreurs)`);

        } else {
          // Mono-app : 1 seule app dans catAppIds (= la categorie est dediee a cette app)
          // Fallback sur doc.appId si catAppIds vide (cat non migree, defense).
          const targetAppId = catAppIds[0] || doc.appId;
          const r = await notificationService.sendToAll(targetAppId, notification);
          console.log(`✅ [${targetAppId}] notif envoyee (mono-app)`, {
            id: r.id,
            recipients: r.recipients,
            type: isDailyCoupon ? 'DAILY_COUPON' : (isLive ? 'LIVE' : 'NORMAL'),
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

      // Sync sortante vers systemes externes (wintips, etc.) — fire-and-forget.
      // Totalement isole : si la sync echoue, la notif push bigwin a deja
      // ete envoyee et le ticket reste bien publie en bigwin. Le service
      // gere lui-meme ses try-catch internes.
      try {
        const syncService = require('../../services/admin/syncToWintipsService');
        setImmediate(() => {
          syncService.maybeSyncTicket(doc).catch((err) => {
            console.error(`[syncWintips] uncaught: ${err.message}`);
          });
        });
      } catch (err) {
        // Erreur de chargement du service : log mais on continue
        console.error(`[syncWintips] init failed: ${err.message}`);
      }
    }
  }
});

module.exports = mongoose.model("Ticket", TicketSchema);