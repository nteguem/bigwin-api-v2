// src/api/services/affiliate/affiliateAdGateService.js
//
// Porte publicitaire en amont de l'activation affilié.
//
// Concept : l'utilisateur doit regarder `adsRequired` pubs récompensées
// SSV-vérifiées AVANT que /user/affiliate/activate n'accepte sa demande.
// Le compteur est cumulatif et persistant côté serveur — l'user peut
// quitter et reprendre plus tard sans perdre ses pubs.
//
// Réutilise l'infra `UserAccessUnlock` (générique : déjà utilisée pour le
// déblocage de catégories). Une seule différence : on utilise
// `resourceType: 'affiliate'`, `resource: null` et `durationMinutes: null`
// (= "à vie", éligibilité acquise pour toujours).
//
// Le SSV controller (admobSsvController) trouve le doc par `nonce` et
// incrémente automatiquement le compteur via accessGateService.recordVerifiedReward
// — donc PAS de modification de la chaîne SSV existante.

const crypto = require('crypto');
const UserAccessUnlock = require('../../models/common/UserAccessUnlock');
const AffiliateConfig = require('../../models/affiliate/AffiliateConfig');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const RESOURCE_TYPE_AFFILIATE = 'affiliate';

/**
 * Récupère la config ad-gate effective pour cette app.
 * Si AffiliateConfig n'existe pas encore, renvoie les valeurs par défaut
 * (pas de side-effect ; la création paresseuse est gérée ailleurs).
 *
 * @returns {Promise<{ enabled:boolean, adsRequired:number }>}
 */
async function getAdGateConfig(appId) {
  const config = await AffiliateConfig.findOne({ appId }).lean();
  const gate = (config && config.adGate) || {};
  return {
    enabled: gate.enabled !== false, // default true
    adsRequired: Number.isFinite(Number(gate.adsRequired)) && Number(gate.adsRequired) > 0
      ? Number(gate.adsRequired)
      : 25,
  };
}

/**
 * Construit la vue API d'un doc UserAccessUnlock pour la porte affilié.
 * Stable et autosuffisante (pas d'access aux methods Mongoose).
 */
function buildProgressView(doc, adsRequired) {
  const verifiedCount = (doc && doc.verifiedCount) || 0;
  const completed = !!(doc && doc.status === 'unlocked');
  const required = adsRequired;
  const watched = Math.min(verifiedCount, required);
  return {
    enabled: true,
    adsRequired: required,
    adsWatched: watched,
    completed,
    // eligible = la porte est passée (le check d'activation regarde ceci)
    eligible: completed,
    // % d'avancement (0..100), arrondi à 1 décimale max
    percentage: required > 0
      ? Math.round((watched / required) * 1000) / 10
      : 0,
    // Nonce à transmettre au client pour le `customData` des pubs.
    nonce: (doc && doc.nonce) || null,
  };
}

/**
 * État courant de la porte ad-gate pour cet utilisateur.
 *
 * - Si la porte est désactivée dans la config → renvoie eligible=true sans
 *   créer aucun document (mode "pass-through").
 * - Sinon : retourne le compteur courant (0 si pas encore commencé).
 *   Le nonce n'est pas créé ici (il l'est par start()).
 *
 * @param {string} appId
 * @param {string|ObjectId} userId
 * @returns {Promise<object>}
 */
async function getProgress(appId, userId) {
  const cfg = await getAdGateConfig(appId);

  if (!cfg.enabled) {
    return {
      enabled: false,
      adsRequired: 0,
      adsWatched: 0,
      completed: true,
      eligible: true,
      percentage: 100,
      nonce: null,
    };
  }

  const doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_AFFILIATE,
    resource: null,
  });

  return buildProgressView(doc, cfg.adsRequired);
}

/**
 * Démarre (ou rafraîchit le nonce de) la session ad-gate pour l'utilisateur.
 *
 * Sémantique :
 *  - Si la porte est désactivée : 400 (le client ne devrait pas demander).
 *  - Si l'utilisateur a déjà complété (`status='unlocked'`) : on RENVOIE
 *    l'état courant sans changer le nonce (déjà éligible, rien à faire).
 *  - Si en cours OU pas encore commencé : crée le doc le cas échéant,
 *    régénère un `nonce` neuf, fige `selectedOption.adsRequired` à la valeur
 *    config actuelle (snapshot — si l'admin baisse le seuil en cours de
 *    route, les pubs déjà comptées suffiront immédiatement).
 *
 * Le `selectedOption.durationMinutes` est laissé à `null` ⇒ unlock à vie.
 *
 * @returns {Promise<{nonce, adsWatched, adsRequired, completed, ...}>}
 */
async function start(appId, userId) {
  const cfg = await getAdGateConfig(appId);
  if (!cfg.enabled) {
    throw new AppError(
      "La porte publicitaire n'est pas activée pour cette application.",
      400,
      ErrorCodes.OPERATION_NOT_ALLOWED
    );
  }

  let doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_AFFILIATE,
    resource: null,
  });

  // Déjà complété — pas de régénération de nonce, on renvoie tel quel.
  if (doc && doc.status === 'unlocked') {
    return buildProgressView(doc, cfg.adsRequired);
  }

  if (!doc) {
    doc = new UserAccessUnlock({
      appId,
      user: userId,
      resourceType: RESOURCE_TYPE_AFFILIATE,
      resource: null,
      status: 'in_progress',
      verifiedCount: 0,
      rewards: [],
    });
  }

  doc.status = 'in_progress';
  doc.selectedOption = {
    durationMinutes: null, // à vie
    adsRequired: cfg.adsRequired,
  };
  doc.nonce = crypto.randomBytes(24).toString('hex');
  doc.unlockedAt = null;
  doc.expiresAt = null;

  // Déblocage immédiat si l'user avait déjà accumulé assez de pubs lors d'une
  // session précédente (rare : nécessite que adsRequired ait été abaissé par
  // l'admin). On respecte la sémantique de startOrSwitchUnlock côté catégorie.
  if (doc.verifiedCount >= cfg.adsRequired) {
    doc.status = 'unlocked';
    doc.unlockedAt = new Date();
  }

  await doc.save();

  return buildProgressView(doc, cfg.adsRequired);
}

/**
 * Vérifie qu'un utilisateur est éligible à activer son compte affilié.
 * - Si la porte est désactivée dans la config → toujours éligible.
 * - Sinon : il faut un UserAccessUnlock affiliate avec status='unlocked'.
 *
 * @returns {Promise<boolean>}
 */
async function checkEligibility(appId, userId) {
  const cfg = await getAdGateConfig(appId);
  if (!cfg.enabled) return true;

  const doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_AFFILIATE,
    resource: null,
    status: 'unlocked',
  }).lean();

  return !!doc;
}

module.exports = {
  RESOURCE_TYPE_AFFILIATE,
  getAdGateConfig,
  getProgress,
  start,
  checkEligibility,
};
