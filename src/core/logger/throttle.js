/**
 * Throttle en mémoire pour les alertes email.
 *
 * Règle : on autorise UN email par clé `{service}.{category}` par fenêtre
 * (défaut 5 min). Les alertes supprimées incrémentent un compteur qui sera
 * remonté dans le prochain email autorisé ("N similar alerts suppressed").
 *
 * Pourquoi en mémoire et pas Redis/Mongo :
 *   - Simple, zéro dépendance supplémentaire
 *   - Perte acceptable : si le process crash, au pire on envoie 1 email en
 *     double avant que le throttle se réamorce
 *   - Scale horizontal : si plusieurs workers PM2, chacun a son throttle →
 *     risque de X emails en parallèle. Acceptable pour le POC. Migrer vers
 *     Redis quand on passe à cluster mode.
 */

const WINDOW_MS = parseInt(process.env.ALERT_THROTTLE_MS || String(5 * 60 * 1000), 10);

// Map<key, { lastSentAt: number, suppressedCount: number }>
const state = new Map();

// Garde-fou : éviter que state explose si beaucoup de clés uniques. On purge
// les entrées expirées lazy (au prochain check) — suffisant pour notre volume.
function purgeExpired(now) {
  // Seulement si la map grossit trop (pragmatique, O(n) mais rare)
  if (state.size < 100) return;
  for (const [key, entry] of state.entries()) {
    if (now - entry.lastSentAt > WINDOW_MS * 2) {
      state.delete(key);
    }
  }
}

/**
 * Décide si une alerte doit être envoyée. Incrémente le compteur de
 * suppression si bloquée.
 *
 * @param {string} key — typiquement `service.category` (ou `service` seul si
 *                       category absente)
 * @returns {{ allow: boolean, suppressedCount: number }}
 *   - allow: true si on envoie, false si on supprime
 *   - suppressedCount: le nombre d'alertes supprimées DEPUIS le dernier envoi
 *                      (0 si c'est la toute première, ou après rearmage)
 */
function shouldAlert(key) {
  const now = Date.now();
  purgeExpired(now);

  const entry = state.get(key);

  // Première occurrence OU fenêtre expirée → on envoie
  if (!entry || now - entry.lastSentAt > WINDOW_MS) {
    const suppressedCount = entry ? entry.suppressedCount : 0;
    state.set(key, { lastSentAt: now, suppressedCount: 0 });
    return { allow: true, suppressedCount };
  }

  // Dans la fenêtre → on bloque et on incrémente
  entry.suppressedCount += 1;
  return { allow: false, suppressedCount: entry.suppressedCount };
}

/**
 * Permet d'inspecter l'état du throttle depuis l'extérieur (debug).
 */
function getState() {
  return Array.from(state.entries()).map(([key, entry]) => ({
    key,
    lastSentAt: new Date(entry.lastSentAt).toISOString(),
    suppressedCount: entry.suppressedCount,
  }));
}

module.exports = { shouldAlert, getState, WINDOW_MS };
