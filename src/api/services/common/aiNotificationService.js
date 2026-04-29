// src/api/services/common/aiNotificationService.js
//
// Service IA pour la génération et correction de notifications push.
// Backend: Google Gemini (modèle gemini-2.0-flash sur le free tier).
//
// Pourquoi Gemini :
//  • Free tier généreux : 250 requêtes/jour, 10 RPM, 1M tokens/min
//  • Pas de carte bancaire requise
//  • Mode JSON natif (responseMimeType: application/json)
//  • Qualité équivalente à Claude/GPT-4 sur les tâches courtes
//
// Pas de SDK : appel REST direct via axios (déjà dans les deps).

const axios = require('axios');
const logger = require('../../../utils/logger');
const { AppError } = require('../../../utils/AppError');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

class AINotificationService {
  constructor() {
    this.apiKey = null;
    // gemini-2.5-flash-lite : 1000 RPD / 15 RPM (4× plus que flash), moins
    // en demande donc moins de 503, qualité tout à fait suffisante pour
    // correction + traduction. Si on veut + de qualité on peut passer à
    // 'gemini-2.5-flash' (250 RPD).
    this.model = 'gemini-2.5-flash-lite';
    this.initializeClient();
  }

  initializeClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('[AINotification] GEMINI_API_KEY non configurée');
      return;
    }
    this.apiKey = apiKey;
    logger.info('[AINotification] Client Gemini configuré (modèle: ' + this.model + ')');
  }

  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * Appel bas-niveau de l'API Gemini.
   * Utilise generateContent avec system_instruction + contents.
   * responseMimeType=application/json force du JSON propre en sortie (plus
   * besoin de gérer les ```json``` markdown).
   *
   * Retry automatique sur 503 (UNAVAILABLE — pic de charge Google côté serveur)
   * avec backoff exponentiel : 1s, 3s, 7s. Au-delà, surface l'erreur.
   */
  async _generateContent({ system, user, temperature = 0.6, maxTokens = 2048, jsonOutput = true }) {
    if (!this.apiKey) {
      throw new AppError('Service IA non configuré. Vérifiez GEMINI_API_KEY.', 500);
    }

    const url = `${GEMINI_BASE_URL}/${this.model}:generateContent`;
    const payload = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };
    if (jsonOutput) {
      payload.generationConfig.responseMimeType = 'application/json';
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAYS_MS = [1000, 3000, 7000]; // backoff exponentiel
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          timeout: 30000,
        });

        const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) {
          const finishReason = response.data?.candidates?.[0]?.finishReason;
          if (finishReason && finishReason !== 'STOP') {
            throw new Error(`Génération interrompue : ${finishReason}`);
          }
          throw new Error('Réponse Gemini vide');
        }
        return content;
      } catch (error) {
        lastError = error;

        if (error.response) {
          const status = error.response.status;
          const errObj = error.response.data?.error || {};
          const detail = errObj.message || error.response.data?.message || JSON.stringify(error.response.data);
          const geminiStatus = errObj.status || '';

          // 503 / UNAVAILABLE = pic de charge temporaire → retry
          const isTransient = status === 503 || status === 502 || geminiStatus === 'UNAVAILABLE';
          if (isTransient && attempt < MAX_RETRIES) {
            const delay = RETRY_DELAYS_MS[attempt];
            logger.warn(`[AINotification] Gemini ${status} (${geminiStatus}) — retry ${attempt + 1}/${MAX_RETRIES} dans ${delay}ms`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          // Erreur définitive : on log et on lève
          logger.error(`[AINotification] Gemini HTTP ${status} (${geminiStatus}): ${detail}`, {
            fullError: error.response.data,
            attempts: attempt + 1,
          });
          if (status === 400) throw new AppError(`Requête Gemini invalide : ${detail}`, 400);
          if (status === 401 || status === 403) throw new AppError(`Clé API Gemini invalide ou non autorisée : ${detail}`, 500);
          if (status === 404) throw new AppError(`Modèle ${this.model} introuvable : ${detail}`, 500);
          if (status === 429) throw new AppError(`Quota Gemini dépassé : ${detail}`, 429);
          if (status === 503) throw new AppError(`Gemini surchargé après ${MAX_RETRIES + 1} tentatives. Réessaye dans 1-2 minutes : ${detail}`, 503);
          throw new AppError(`Erreur Gemini (${status}) : ${detail}`, 500);
        }

        // Erreur réseau/timeout : retry aussi
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt];
          logger.warn(`[AINotification] Réseau Gemini KO — retry ${attempt + 1}/${MAX_RETRIES} dans ${delay}ms : ${error.message}`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        logger.error(`[AINotification] Erreur réseau Gemini après ${MAX_RETRIES + 1} tentatives: ${error.message}`);
        throw new AppError(`Erreur réseau IA: ${error.message}`, 500);
      }
    }
    // Sécurité (ne devrait jamais arriver)
    throw lastError;
  }

  /* ────────────────────────────────────────────────────────────
   * MÉTHODE 1 : polishMessage — flux principal du formulaire admin
   * Texte FR brut → 1 notification bilingue prête à l'envoi.
   * Réappel avec attempt > 0 → variation différente (bouton "Autre proposition").
   * ──────────────────────────────────────────────────────────── */
  async polishMessage(_appNameDeprecated, rawText, type = 'general', attempt = 0) {
    if (!rawText || rawText.trim().length < 5) {
      throw new AppError('Le texte doit contenir au moins 5 caractères', 400);
    }

    const system = this._buildPolishSystemPrompt();
    const user = this._buildPolishUserPrompt(rawText, type, attempt);

    logger.info('[AINotification] Polish message...', { type, attempt });

    const content = await this._generateContent({
      system,
      user,
      temperature: attempt > 0 ? 0.95 : 0.6,
      maxTokens: 2048,
      jsonOutput: true,
    });

    const parsed = this._parsePolishResponse(content);
    logger.info('[AINotification] Polish OK', { type, attempt });
    return parsed;
  }

  _buildPolishSystemPrompt() {
    return `Tu es un expert en notifications push marketing pour des apps de pronostics sportifs.

Ta mission : prendre un texte brut écrit en français (potentiellement avec fautes ou maladroit) et produire UNE notification push professionnelle et engageante. La notification doit être universelle (jamais mentionner le nom d'une app spécifique).

RÈGLES :
1. Corrige TOUTES les fautes d'orthographe/grammaire et reformule pour un ton percutant et chaleureux
2. Génère un titre court (max 50 caractères) en FR + EN avec emoji approprié
3. Génère un corps de notif (max 150 caractères) en FR + EN avec call-to-action implicite
4. Les versions FR et EN doivent transmettre le MÊME message — pas de traduction littérale, mais l'esprit
5. Ton adapté au contenu (promo = excitant, rappel = doux, live = urgent, etc.)
6. Choisis une couleur d'accent et une priorité cohérentes avec le ton

FORMAT DE SORTIE (JSON STRICT, rien d'autre) :
{
  "notification": {
    "headings": { "en": "...", "fr": "..." },
    "contents": { "en": "...", "fr": "..." },
    "data": {
      "type": "<promo|event|reminder|live|result|tip|celebration|rating|general>",
      "campaign": "<snake_case_court>",
      "urgency": "low|medium|high"
    },
    "options": {
      "android_accent_color": "<HEX_SANS_#>",
      "small_icon": "ic_notification",
      "large_icon": "ic_launcher",
      "priority": <1-10>
    }
  }
}

COULEURS PAR TYPE :
- promo: FF6B35       - vip: D4AF37
- event: 2196F3       - live: D32F2F
- reminder: 9C27B0    - result: 00C853
- tip: 4CAF50         - celebration: FFD700
- rating: F59E0B      - general: 1E2ACC

Réponds UNIQUEMENT avec le JSON.`;
  }

  _buildPolishUserPrompt(rawText, type, attempt) {
    let prompt = `Type de notification (indicatif) : ${type}\n\nTexte brut de l'admin :\n"""\n${rawText}\n"""\n\nProduis la notification.`;
    if (attempt > 0) {
      prompt += `\n\nIMPORTANT : c'est la tentative #${attempt + 1}. Génère une variation DIFFÉRENTE de la précédente — change l'angle, les emojis, la formulation. Reste fidèle au sens.`;
    }
    return prompt;
  }

  _parsePolishResponse(content) {
    try {
      let clean = content.trim();
      // Gemini avec responseMimeType=application/json renvoie déjà du JSON
      // brut, mais on garde le fallback ```json``` au cas où.
      if (clean.startsWith('```json')) clean = clean.slice(7);
      else if (clean.startsWith('```')) clean = clean.slice(3);
      if (clean.endsWith('```')) clean = clean.slice(0, -3);
      clean = clean.trim();

      const parsed = JSON.parse(clean);
      const notif = parsed.notification || parsed;

      if (!notif.headings?.fr || !notif.headings?.en) throw new Error('headings.fr et headings.en requis');
      if (!notif.contents?.fr || !notif.contents?.en) throw new Error('contents.fr et contents.en requis');

      return {
        headings: { fr: notif.headings.fr, en: notif.headings.en },
        contents: { fr: notif.contents.fr, en: notif.contents.en },
        data: {
          type: notif.data?.type || 'general',
          campaign: notif.data?.campaign || `campaign_${Date.now()}`,
          urgency: notif.data?.urgency || 'medium',
          ...notif.data,
        },
        options: {
          android_accent_color: notif.options?.android_accent_color || 'FF6B35',
          small_icon: notif.options?.small_icon || 'ic_notification',
          large_icon: notif.options?.large_icon || 'ic_launcher',
          priority: notif.options?.priority || 5,
          ...notif.options,
        },
      };
    } catch (error) {
      logger.error('[AINotification] Parse polish error:', { error: error.message, content: content.substring(0, 500) });
      throw new AppError(`Erreur parsing IA: ${error.message}`, 500);
    }
  }

  /* ────────────────────────────────────────────────────────────
   * MÉTHODE 2 : generateNotifications — ancien flux (3 propositions)
   * Conservée pour la rétro-compat de l'endpoint /notifications/generate.
   * Le nouveau formulaire utilise polishMessage à la place.
   * ──────────────────────────────────────────────────────────── */
  async generateNotifications(appId, prompt, context = {}, count = 3) {
    if (!prompt || prompt.trim().length < 10) {
      throw new AppError('La description doit contenir au moins 10 caractères', 400);
    }
    const proposalCount = Math.min(Math.max(count, 1), 3);
    const system = this._buildGenerateSystemPrompt(appId);
    const user = this._buildGenerateUserPrompt(prompt, context, proposalCount);

    logger.info('[AINotification] Génération...', { appName: appId, prompt, context });

    const content = await this._generateContent({
      system,
      user,
      temperature: 0.7,
      maxTokens: 4096,
      jsonOutput: true,
    });

    const proposals = this._parseGenerateResponse(content, proposalCount);
    logger.info('[AINotification] Génération OK', { appName: appId, count: proposals.length });
    return proposals;
  }

  _buildGenerateSystemPrompt(appName) {
    return `Tu es un expert en marketing mobile et notifications push pour une application de pronostics sportifs appelée ${appName}.

Ton rôle est de générer des notifications push engageantes, persuasives et professionnelles.

RÈGLES IMPORTANTES:
1. Toujours fournir les textes en ANGLAIS (en) et FRANÇAIS (fr)
2. Utiliser des emojis appropriés pour attirer l'attention
3. Les messages doivent être courts et percutants (max 150 caractères pour contents)
4. Les headings doivent être accrocheurs (max 50 caractères)
5. Adapter le ton selon l'urgence : casual, excitant, ou urgent
6. Toujours inclure un call-to-action implicite

FORMAT DE SORTIE OBLIGATOIRE (JSON strict) :
{
  "proposals": [
    {
      "id": 1,
      "notification": {
        "headings": { "en": "...", "fr": "..." },
        "contents": { "en": "...", "fr": "..." },
        "data": { "type": "...", "campaign": "...", "action": "...", "urgency": "low|medium|high" },
        "options": { "android_accent_color": "...", "small_icon": "ic_notification", "large_icon": "ic_launcher", "priority": 1-10 }
      }
    }
  ]
}

Tu dois UNIQUEMENT répondre avec le JSON, sans texte avant ou après.`;
  }

  _buildGenerateUserPrompt(prompt, context, count) {
    let p = `Génère exactement ${count} proposition(s) de notification push pour le contexte suivant:\n\nDESCRIPTION:\n${prompt}`;
    if (Object.keys(context).length > 0) {
      p += `\n\nCONTEXTE ADDITIONNEL:\n${JSON.stringify(context, null, 2)}`;
    }
    p += `\n\nRappel: Réponds UNIQUEMENT avec le JSON valide contenant ${count} proposition(s).`;
    return p;
  }

  _parseGenerateResponse(content, expectedCount) {
    try {
      let clean = content.trim();
      if (clean.startsWith('```json')) clean = clean.slice(7);
      else if (clean.startsWith('```')) clean = clean.slice(3);
      if (clean.endsWith('```')) clean = clean.slice(0, -3);
      clean = clean.trim();

      const parsed = JSON.parse(clean);
      if (!parsed.proposals || !Array.isArray(parsed.proposals)) {
        throw new Error('Structure invalide: proposals manquant');
      }
      return parsed.proposals.map((proposal, index) => this._validateProposal(proposal, index + 1));
    } catch (error) {
      logger.error('[AINotification] Erreur parsing génération:', { error: error.message, content: content.substring(0, 500) });
      throw new AppError(`Erreur parsing réponse IA: ${error.message}`, 500);
    }
  }

  _validateProposal(proposal, id) {
    const notification = proposal.notification || proposal;
    if (!notification.headings?.en || !notification.headings?.fr) {
      throw new Error(`Proposition ${id}: headings.en et headings.fr requis`);
    }
    if (!notification.contents?.en || !notification.contents?.fr) {
      throw new Error(`Proposition ${id}: contents.en et contents.fr requis`);
    }
    return {
      id,
      notification: {
        headings: { en: notification.headings.en, fr: notification.headings.fr },
        contents: { en: notification.contents.en, fr: notification.contents.fr },
        data: {
          type: notification.data?.type || 'general',
          campaign: notification.data?.campaign || `campaign_${Date.now()}`,
          action: notification.data?.action || 'view_predictions',
          urgency: notification.data?.urgency || 'medium',
          ...notification.data,
        },
        options: {
          android_accent_color: notification.options?.android_accent_color || 'FF6B35',
          small_icon: notification.options?.small_icon || 'ic_notification',
          large_icon: notification.options?.large_icon || 'ic_launcher',
          priority: notification.options?.priority || 5,
          ...notification.options,
        },
      },
    };
  }
}

module.exports = new AINotificationService();
