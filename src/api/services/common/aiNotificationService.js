// src/api/services/common/aiNotificationService.js

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../../../utils/logger');
const { AppError } = require('../../../utils/AppError');

class AINotificationService {
  constructor() {
    this.client = null;
    this.model = 'claude-sonnet-4-20250514';
    this.initializeClient();
  }

  /**
   * Initialiser le client Anthropic
   */
  initializeClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      logger.warn('[AINotification] ANTHROPIC_API_KEY non configurée');
      return;
    }

    this.client = new Anthropic({
      apiKey: apiKey
    });

    logger.info('[AINotification] Client Anthropic initialisé');
  }

  /**
   * Générer des propositions de notifications
   * @param {String} appId - Nom de l'application (⭐ C'est déjà le nom, pas un ID)
   * @param {String} prompt - Description de la notification souhaitée
   * @param {Object} context - Contexte additionnel (événement, réduction, etc.)
   * @param {Number} count - Nombre de propositions (1-3)
   * @returns {Array} Propositions de notifications
   */
  async generateNotifications(appId, prompt, context = {}, count = 3) {
    if (!this.client) {
      throw new AppError('Service IA non configuré. Vérifiez ANTHROPIC_API_KEY.', 500);
    }

    if (!prompt || prompt.trim().length < 10) {
      throw new AppError('La description doit contenir au moins 10 caractères', 400);
    }

    // Limiter le nombre de propositions
    const proposalCount = Math.min(Math.max(count, 1), 3);

    // ⭐ appId est déjà le nom de l'app, on l'utilise directement
    const systemPrompt = this._buildSystemPrompt(appId);
    const userPrompt = this._buildUserPrompt(prompt, context, proposalCount);

    try {
      logger.info('[AINotification] Génération de notifications...', { 
        appName: appId, // ⭐ appId = nom de l'app
        prompt, 
        context 
      });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ],
        system: systemPrompt
      });

      // Extraire le contenu de la réponse
      const content = response.content[0].text;
      
      // Parser le JSON
      const proposals = this._parseResponse(content, proposalCount);

      logger.info('[AINotification] Notifications générées avec succès', {
        appName: appId,
        count: proposals.length
      });

      return proposals;

    } catch (error) {
      logger.error('[AINotification] Erreur génération:', {
        appName: appId,
        message: error.message,
        status: error.status
      });

      if (error.status === 401) {
        throw new AppError('Clé API Anthropic invalide', 500);
      }

      if (error.status === 429) {
        throw new AppError('Limite de requêtes API atteinte. Réessayez plus tard.', 429);
      }

      throw new AppError(`Erreur génération IA: ${error.message}`, 500);
    }
  }

  /**
   * Construire le prompt système
   * @param {String} appName - Nom de l'application (⭐ C'est appId qui est déjà le nom)
   */
  _buildSystemPrompt(appName) {
    return `Tu es un expert en marketing mobile et notifications push pour une application de pronostics sportifs appelée ${appName}.

Ton rôle est de générer des notifications push engageantes, persuasives et professionnelles.

RÈGLES IMPORTANTES:
1. Toujours fournir les textes en ANGLAIS (en) et FRANÇAIS (fr)
2. Utiliser des emojis appropriés pour attirer l'attention (⚽🏆💰🎯🔥💎🦁 etc.)
3. Les messages doivent être courts et percutants (max 150 caractères pour contents)
4. Les headings doivent être accrocheurs (max 50 caractères)
5. Adapter le ton selon l'urgence : casual, excitant, ou urgent
6. Toujours inclure un call-to-action implicite

FORMAT DE SORTIE OBLIGATOIRE (JSON strict):
{
  "proposals": [
    {
      "id": 1,
      "notification": {
        "headings": {
          "en": "Titre anglais avec emoji",
          "fr": "Titre français avec emoji"
        },
        "contents": {
          "en": "Message anglais engageant avec call-to-action",
          "fr": "Message français engageant avec call-to-action"
        },
        "data": {
          "type": "type_de_notification",
          "campaign": "nom_campagne_snake_case",
          "action": "action_a_effectuer",
          "urgency": "low|medium|high"
        },
        "options": {
          "android_accent_color": "CODE_HEX_SANS_#",
          "small_icon": "ic_notification",
          "large_icon": "ic_launcher",
          "priority": 1-10
        }
      }
    }
  ]
}

TYPES DE NOTIFICATIONS DISPONIBLES:
- promo: Promotions et réductions
- event: Événements sportifs
- reminder: Rappels
- celebration: Célébrations (fêtes, anniversaires)
- tip: Conseils et astuces
- vip: Offres VIP exclusives
- live: Matchs en direct
- result: Résultats de matchs
- monthly_celebration: Célébrations mensuelles

ACTIONS DISPONIBLES:
- view_predictions: Voir les pronostics
- view_subscription: Voir les abonnements
- view_live: Voir les matchs live
- view_results: Voir les résultats
- upgrade_vip: Passer en VIP
- claim_offer: Réclamer une offre

COULEURS SUGGÉRÉES (hex sans #):
- Rouge urgent: D32F2F
- Vert succès: 00C853
- Or premium: FFD700
- Orange action: FF6B35
- Bleu info: 2196F3
- Violet VIP: 9C27B0

PRIORITÉS:
- 1-3: Basse (info générale)
- 4-6: Moyenne (promos, rappels)
- 7-8: Haute (événements importants)
- 9-10: Urgente (live, offres limitées)

Tu dois UNIQUEMENT répondre avec le JSON, sans texte avant ou après.`;
  }

  /**
   * Construire le prompt utilisateur
   */
  _buildUserPrompt(prompt, context, count) {
    let userPrompt = `Génère exactement ${count} proposition(s) de notification push pour le contexte suivant:

DESCRIPTION:
${prompt}`;

    if (Object.keys(context).length > 0) {
      userPrompt += `

CONTEXTE ADDITIONNEL:
${JSON.stringify(context, null, 2)}`;
    }

    userPrompt += `

Rappel: Réponds UNIQUEMENT avec le JSON valide contenant ${count} proposition(s), sans aucun texte supplémentaire.`;

    return userPrompt;
  }

  /**
   * Parser la réponse de l'IA
   */
  _parseResponse(content, expectedCount) {
    try {
      // Nettoyer le contenu (enlever les backticks markdown si présents)
      let cleanContent = content.trim();
      
      // Enlever les blocs de code markdown
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      
      cleanContent = cleanContent.trim();

      // Parser le JSON
      const parsed = JSON.parse(cleanContent);

      // Valider la structure
      if (!parsed.proposals || !Array.isArray(parsed.proposals)) {
        throw new Error('Structure invalide: proposals manquant');
      }

      // Valider chaque proposition
      const validatedProposals = parsed.proposals.map((proposal, index) => {
        return this._validateProposal(proposal, index + 1);
      });

      return validatedProposals;

    } catch (error) {
      logger.error('[AINotification] Erreur parsing réponse:', {
        error: error.message,
        content: content.substring(0, 500)
      });
      
      throw new AppError(`Erreur parsing réponse IA: ${error.message}`, 500);
    }
  }

  /**
   * Valider et normaliser une proposition
   */
  _validateProposal(proposal, id) {
    const notification = proposal.notification || proposal;

    // Vérifier les champs obligatoires
    if (!notification.headings || !notification.contents) {
      throw new Error(`Proposition ${id}: headings et contents requis`);
    }

    if (!notification.headings.en || !notification.headings.fr) {
      throw new Error(`Proposition ${id}: headings.en et headings.fr requis`);
    }

    if (!notification.contents.en || !notification.contents.fr) {
      throw new Error(`Proposition ${id}: contents.en et contents.fr requis`);
    }

    // Normaliser la structure
    return {
      id: id,
      notification: {
        headings: {
          en: notification.headings.en,
          fr: notification.headings.fr
        },
        contents: {
          en: notification.contents.en,
          fr: notification.contents.fr
        },
        data: {
          type: notification.data?.type || 'general',
          campaign: notification.data?.campaign || `campaign_${Date.now()}`,
          action: notification.data?.action || 'view_predictions',
          urgency: notification.data?.urgency || 'medium',
          ...notification.data
        },
        options: {
          android_accent_color: notification.options?.android_accent_color || 'FF6B35',
          small_icon: notification.options?.small_icon || 'ic_notification',
          large_icon: notification.options?.large_icon || 'ic_launcher',
          priority: notification.options?.priority || 5,
          ...notification.options
        }
      }
    };
  }

  /**
   * Vérifier si le service est disponible
   */
  isAvailable() {
    return !!this.client;
  }
}

module.exports = new AINotificationService();