// src/api/services/common/admobSsvService.js
//
// Vérification des callbacks "Server-Side Verification" (SSV) des pubs
// récompensées AdMob.
//
// AdMob appelle notre endpoint en GET avec, en dernier, `signature` et
// `key_id`. Le contenu signé = TOUS les paramètres AVANT `&signature=`, sans
// réordonner ni ré-encoder. La signature est ECDSA / SHA-256 ; les clés
// publiques sont fournies par le serveur de clés AdMob et tournent à intervalle
// variable (à ne pas mettre en cache plus de 24h).
//
// Réf : https://developers.google.com/admob/android/ssv

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../../../utils/logger');

const VERIFIER_KEYS_URL =
  process.env.ADMOB_SSV_KEYS_URL ||
  'https://www.gstatic.com/admob/reward/verifier-keys.json';

// 1h : largement sous le maximum de 24h autorisé par Google.
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache = { keysById: new Map(), fetchedAt: 0, fetching: null };

async function fetchKeys() {
  const res = await axios.get(VERIFIER_KEYS_URL, { timeout: 10000 });
  const keys = res && res.data && Array.isArray(res.data.keys) ? res.data.keys : [];
  const keysById = new Map();
  for (const k of keys) {
    if (k && k.keyId != null && k.pem) keysById.set(String(k.keyId), k.pem);
  }
  if (keysById.size === 0) {
    throw new Error('AdMob verifier keys: réponse vide ou inattendue');
  }
  cache = { keysById, fetchedAt: Date.now(), fetching: null };
  return keysById;
}

async function getKeysMap({ force = false } = {}) {
  const stale = Date.now() - cache.fetchedAt > CACHE_TTL_MS;
  if (!force && !stale && cache.keysById.size > 0) return cache.keysById;
  // Pas d'`await` entre le test et l'affectation ⇒ dédup des fetchs concurrents.
  if (cache.fetching) return cache.fetching;
  cache.fetching = fetchKeys().catch((err) => {
    cache.fetching = null;
    logger.error('[ADMOB SSV] Échec récupération des clés de vérification', { error: err.message });
    throw err;
  });
  return cache.fetching;
}

async function getPublicKey(keyId) {
  let map;
  try {
    map = await getKeysMap();
  } catch (_) {
    return null;
  }
  if (map.has(String(keyId))) return map.get(String(keyId));
  // Rotation des clés : on force un refresh et on réessaie une fois.
  try {
    map = await getKeysMap({ force: true });
  } catch (_) {
    return null;
  }
  return map.get(String(keyId)) || null;
}

/**
 * Vérifie un callback SSV AdMob à partir de la query string BRUTE.
 *
 * @param {string} rawQuery  la query string telle que reçue, sans le `?`
 *   (ex. `req.originalUrl.split('?')[1]`). Ne PAS la réordonner ni ré-encoder.
 * @returns {Promise<{ valid:boolean, reason?:string, params?:{
 *   adNetwork:string, adUnit:string, customData:string|null, rewardAmount:string,
 *   rewardItem:string, timestamp:string, transactionId:string, userId:string|null
 * } }>}
 */
async function verifyCallback(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { valid: false, reason: 'empty_query' };
  }

  const sigMarker = '&signature=';
  const idx = rawQuery.indexOf(sigMarker);
  if (idx === -1) return { valid: false, reason: 'no_signature' };

  const signedContent = rawQuery.substring(0, idx);   // tout AVANT &signature=
  const tail = rawQuery.substring(idx + 1);           // signature=...&key_id=...

  const tailParams = new URLSearchParams(tail);
  const signatureRaw = tailParams.get('signature');
  const keyId = tailParams.get('key_id');
  if (!signatureRaw || !keyId) return { valid: false, reason: 'malformed_tail' };

  let signature;
  try {
    // Accepte base64 standard ou URL-safe, avec ou sans padding.
    const normalized = decodeURIComponent(signatureRaw).replace(/-/g, '+').replace(/_/g, '/');
    signature = Buffer.from(normalized, 'base64');
    if (!signature || signature.length === 0) throw new Error('empty');
  } catch (_) {
    return { valid: false, reason: 'bad_signature_encoding' };
  }

  const pem = await getPublicKey(keyId);
  if (!pem) return { valid: false, reason: 'unknown_key_id' };

  let ok = false;
  try {
    // Signature ECDSA. AdMob l'envoie normalement en DER (format par défaut pour
    // les clés EC) ; par robustesse on retente en IEEE-P1363 (r||s brut, 64
    // octets pour P-256) si le DER échoue.
    ok = crypto.verify('sha256', Buffer.from(signedContent, 'utf8'), pem, signature);
    if (!ok) {
      try {
        ok = crypto.verify(
          'sha256',
          Buffer.from(signedContent, 'utf8'),
          { key: pem, dsaEncoding: 'ieee-p1363' },
          signature
        );
      } catch (_) { /* signature pas au format brut → on garde ok=false */ }
    }
  } catch (err) {
    logger.warn('[ADMOB SSV] Erreur lors de la vérification de signature', { error: err.message, keyId });
    return { valid: false, reason: 'verify_error' };
  }
  if (!ok) {
    // Diagnostic : si un proxy (Nginx/CDN) a décodé la query string, le
    // `custom_data` n'est plus percent-escaped → le contenu signé reconstruit
    // ici ne correspond plus à ce qu'AdMob a signé → échec garanti.
    // `signatureBytes` : 64 = format brut (P1363), ~70-72 = DER.
    const queryLooksDecodedByProxy =
      /custom_data=\{/.test(signedContent) || /"resourceType":/.test(signedContent);
    logger.warn('[ADMOB SSV] Signature invalide', {
      keyId,
      signatureBytes: signature.length,
      queryLooksDecodedByProxy
    });
    return { valid: false, reason: 'bad_signature' };
  }

  // Signature valide → on parse les paramètres métier depuis le contenu signé.
  const p = new URLSearchParams(signedContent);
  return {
    valid: true,
    params: {
      adNetwork: p.get('ad_network'),
      adUnit: p.get('ad_unit'),
      customData: p.get('custom_data'),     // peut être percent-escaped : à décoder à l'usage
      rewardAmount: p.get('reward_amount'),
      rewardItem: p.get('reward_item'),
      timestamp: p.get('timestamp'),        // epoch ms (string)
      transactionId: p.get('transaction_id'),
      userId: p.get('user_id')
    }
  };
}

module.exports = { verifyCallback };
