// src/api/services/common/aiGiftService.js
//
// Génération IA des cadeaux personnalisés via Gemini.
// Différence avec aiNotificationService : ici on attend du HTML/text
// (pas du JSON), et le prompt est un template avec variables {xxx} fournies
// par l'utilisateur via le formulaire.
//
// On réutilise la logique transport/retry/error-handling de Gemini existante
// (axios + GEMINI_API_KEY) — voir aiNotificationService pour la base.

const axios = require('axios');
const logger = require('../../../utils/logger');
const { AppError } = require('../../../utils/AppError');

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/**
 * Substitue les variables {xxx} du template par les valeurs du formulaire.
 * Si une variable est absente du form data → remplacée par "non précisé".
 */
function fillPromptTemplate(template, formData) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = formData?.[key];
    if (v === undefined || v === null || v === '') return 'non précisé';
    return String(v);
  });
}

/**
 * Sanitize basique du HTML produit par l'IA.
 * On retire les blocs ```html ... ``` et balises script.
 * Pas de DOMPurify côté serveur — le mobile rend dans une WebView isolée
 * sans bridge JS, donc le risque XSS est faible. Sufisant pour V1.
 */
function sanitizeHtml(raw) {
  if (!raw) return '';
  let clean = raw.trim();
  // Retirer les fences markdown
  if (clean.startsWith('```html')) clean = clean.slice(7);
  else if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();
  // Retirer balises script/iframe/object + handlers événements
  clean = clean
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    // Couvre les 3 styles d'attributs handlers : guillemets doubles, simples,
    // ET sans guillemets (ex: `<img onerror=alert(1)>` qui passait avant).
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  return clean;
}

/**
 * Échappe les caractères spéciaux HTML (pour insertion safe dans `<title>`,
 * attributs, etc.). Pas une vraie sanitization — juste un escape contextuel.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrappe le HTML produit par l'IA dans une enveloppe stylée
 * pour un rendu propre en WebView mobile.
 */
function wrapHtmlOutput(htmlBody, { title = 'Mon cadeau', primaryColor = '#1E2ACC' } = {}) {
  // Enveloppe minimaliste, mobile-friendly, light theme.
  // `title` est échappé : il vient de gift.title.fr (saisi par admin) →
  // si l'admin écrit `<script>alert(1)</script>` on l'affiche en texte, pas exécuté.
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>${safeTitle}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; padding: 16px;
    color: #1f2937; background: #ffffff;
    line-height: 1.55; font-size: 15px;
  }
  h1 { font-size: 22px; color: ${primaryColor}; margin: 0 0 12px 0; }
  h2 { font-size: 18px; color: #111827; margin: 18px 0 8px 0; }
  h3 { font-size: 16px; color: #111827; margin: 14px 0 6px 0; }
  p { margin: 0 0 10px 0; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin-bottom: 4px; }
  strong { color: #111827; }
  blockquote {
    border-left: 4px solid ${primaryColor};
    background: #f9fafb;
    padding: 10px 14px;
    margin: 12px 0;
    border-radius: 4px;
  }
  table {
    width: 100%; border-collapse: collapse; margin: 10px 0;
    font-size: 14px;
  }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
  th { background: #f3f4f6; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  .footer { color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center; }
</style>
</head>
<body>
${htmlBody}
<p class="footer">Généré pour toi — ${new Date().toLocaleDateString('fr-FR')}</p>
</body>
</html>`;
}

/**
 * Lance la génération via Gemini.
 * Retry x3 sur 503/réseau (mêmes règles que aiNotificationService).
 * Si on échoue après tous les retries → throw : le caller doit NE PAS débiter
 * (en pratique, le débit a eu lieu au unlock, donc la génération coûte 0
 * crédit, mais elle peut être bloquée par le rate limit).
 */
async function generateContentRaw({
  systemPrompt,
  userPrompt,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 4096,
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      'Service IA non configuré. GEMINI_API_KEY manquante.',
      500
    );
  }

  const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  const MAX_RETRIES = 3;
  const RETRY_DELAYS_MS = [1000, 3000, 7000];
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const t0 = Date.now();
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        timeout: 60000,
      });
      const durationMs = Date.now() - t0;

      const candidate = response.data?.candidates?.[0];
      const content = candidate?.content?.parts?.[0]?.text;

      if (!content) {
        const finishReason = candidate?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
          throw new Error(`Génération interrompue : ${finishReason}`);
        }
        throw new Error('Réponse Gemini vide');
      }

      // Tokens : Gemini renvoie usageMetadata
      const tokensUsed =
        response.data?.usageMetadata?.totalTokenCount || null;

      return { content, tokensUsed, durationMs };
    } catch (error) {
      lastError = error;

      if (error.response) {
        const status = error.response.status;
        const errObj = error.response.data?.error || {};
        const detail =
          errObj.message ||
          error.response.data?.message ||
          JSON.stringify(error.response.data);
        const geminiStatus = errObj.status || '';

        const isTransient =
          status === 503 || status === 502 || geminiStatus === 'UNAVAILABLE';
        if (isTransient && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt];
          logger.warn(
            `[aiGift] Gemini ${status} (${geminiStatus}) — retry ${attempt + 1}/${MAX_RETRIES} dans ${delay}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        logger.error(
          `[aiGift] Gemini HTTP ${status} (${geminiStatus}): ${detail}`,
          { fullError: error.response.data, attempts: attempt + 1 }
        );
        if (status === 400)
          throw new AppError(`Requête IA invalide : ${detail}`, 400);
        if (status === 401 || status === 403)
          throw new AppError(`Clé API IA invalide : ${detail}`, 500);
        if (status === 429)
          throw new AppError(
            `Quota IA dépassé pour aujourd'hui. Réessaye demain.`,
            429
          );
        if (status === 503)
          throw new AppError(
            `IA temporairement indisponible. Réessaye dans 1-2 minutes.`,
            503
          );
        throw new AppError(`Erreur IA (${status}) : ${detail}`, 500);
      }

      // Réseau / timeout
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt];
        logger.warn(
          `[aiGift] Réseau Gemini KO — retry ${attempt + 1}/${MAX_RETRIES} dans ${delay}ms : ${error.message}`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      logger.error(
        `[aiGift] Erreur réseau Gemini après ${MAX_RETRIES + 1} tentatives: ${error.message}`
      );
      throw new AppError(`Erreur réseau IA : ${error.message}`, 500);
    }
  }

  throw lastError;
}

/**
 * Point d'entrée haut-niveau : génère un cadeau IA à partir d'un Gift et
 * du formulaire utilisateur. Renvoie un HTML stylé prêt à afficher
 * (ou texte brut si outputFormat='text').
 *
 * @param {Object} params
 * @param {Object} params.gift     - document Gift Mongoose
 * @param {Object} params.formData - données du formulaire (clés ↔ formSchema)
 * @param {Object} [params.appBranding] - { primaryColor }
 * @returns {Promise<{output, outputFormat, tokensUsed, durationMs, aiModel}>}
 */
async function generateGiftContent({ gift, formData, appBranding = {} }) {
  if (!gift || gift.type !== 'ai') {
    throw new AppError('Ce cadeau ne supporte pas la génération IA', 400);
  }

  const filledPrompt = fillPromptTemplate(gift.promptTemplate, formData);

  const systemPrompt = `Tu es un assistant expert qui produit du contenu personnalisé pour des utilisateurs francophones, principalement en Afrique.

RÈGLES STRICTES :
1. Réponds en français clair, sans jargon technique anglais.
2. Si l'output demandé est du HTML, retourne UNIQUEMENT le contenu HTML structuré (h1, h2, p, ul, table, blockquote…). Pas de balises <html>, <head> ou <body>, pas de CSS inline. Pas de markdown avec \`\`\`html.
3. Si l'output demandé est du texte, pas de balises HTML.
4. Sois concret, actionnable, sans phrases creuses ni clichés motivationnels.
5. Si une donnée du formulaire est marquée "non précisé", continue avec une réponse générale pertinente.
6. Limite-toi au sujet demandé. N'ajoute pas de disclaimer juridique ou de recommandation de "consulter un professionnel" sauf si vraiment nécessaire.`;

  const userPrompt = `Format de sortie demandé : ${gift.outputFormat || 'html'}

Voici la mission :

${filledPrompt}`;

  const { content, tokensUsed, durationMs } = await generateContentRaw({
    systemPrompt,
    userPrompt,
    model: gift.aiModel || DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 4096,
  });

  const outputFormat = gift.outputFormat || 'html';
  let output;

  if (outputFormat === 'html') {
    const sanitized = sanitizeHtml(content);
    const giftTitleFr = gift.title?.fr || 'Mon cadeau';
    output = wrapHtmlOutput(sanitized, {
      title: giftTitleFr,
      primaryColor: appBranding.primaryColor || '#1E2ACC',
    });
  } else {
    // text — on retire d'éventuelles balises HTML résiduelles
    output = content.replace(/<[^>]+>/g, '').trim();
  }

  return {
    output,
    outputFormat,
    tokensUsed,
    durationMs,
    aiModel: gift.aiModel || DEFAULT_MODEL,
  };
}

module.exports = {
  generateGiftContent,
  fillPromptTemplate, // exposé pour tests
  sanitizeHtml,
};
