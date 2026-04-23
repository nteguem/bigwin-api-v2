/**
 * Template HTML pour les alertes P0.
 *
 * Design volontairement SOBRE — pas le layout brandé Proxidream (qui est
 * pour la com' utilisateur). Une alerte tech doit être :
 *   - Immédiatement lisible sur mobile
 *   - Sans fioriture (on veut juste savoir : quoi / quand / où agir)
 *   - Pas de logo, pas de signature juridique
 *
 * Échappe tout input dynamique (HTML entities) pour éviter qu'un message
 * contenant `<script>` ou des chevrons casse l'email.
 */

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s, max = 2000) {
  if (!s) return '';
  const str = String(s);
  return str.length > max ? str.slice(0, max) + '\n…[truncated]' : str;
}

/**
 * @param {Object} opts
 * @param {Object} opts.log — document Log
 * @param {number} opts.suppressedCount — alertes supprimées depuis le dernier envoi
 * @param {string|null} opts.deepLinkUrl — lien backoffice /logs?id=<id>
 */
function buildAlertHtml({ log, suppressedCount = 0, deepLinkUrl = null }) {
  const levelColor = log.level === 'fatal' ? '#DC2626' : '#EF4444';
  const time = new Date(log.timestamp).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  });

  const contextJson = log.context && Object.keys(log.context).length > 0
    ? truncate(JSON.stringify(log.context, null, 2), 3000)
    : null;

  const stackTrace = log.stack ? truncate(log.stack, 3000) : null;

  const suppressedBanner = suppressedCount > 0 ? `
    <div style="margin:0 0 16px;padding:10px 14px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:4px;color:#78350F;font-size:13px;">
      <strong>⚠️ ${suppressedCount} alerte${suppressedCount > 1 ? 's' : ''} similaire${suppressedCount > 1 ? 's' : ''} supprimée${suppressedCount > 1 ? 's' : ''}</strong>
      depuis le dernier envoi (throttling actif).
    </div>
  ` : '';

  const ctaButton = deepLinkUrl ? `
    <div style="text-align:center;margin:20px 0 8px;">
      <a href="${esc(deepLinkUrl)}" style="display:inline-block;background:#1E2ACC;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">
        Voir dans le backoffice →
      </a>
    </div>
  ` : '';

  const contextSection = contextJson ? `
    <div style="margin:16px 0 0;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;margin-bottom:6px;font-weight:600;">Context</div>
      <pre style="margin:0;padding:10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all;overflow-x:auto;">${esc(contextJson)}</pre>
    </div>
  ` : '';

  const stackSection = stackTrace ? `
    <div style="margin:16px 0 0;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;margin-bottom:6px;font-weight:600;">Stack trace</div>
      <pre style="margin:0;padding:10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;font-size:11px;color:#374151;white-space:pre-wrap;word-break:break-all;overflow-x:auto;">${esc(stackTrace)}</pre>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Alerte</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background:${levelColor};color:#fff;padding:16px 20px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.9;">Alerte ${esc(log.level.toUpperCase())}</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(log.service || 'system')}${log.category ? ' / ' + esc(log.category) : ''}</div>
      </div>
      <!-- Body -->
      <div style="padding:20px;">
        ${suppressedBanner}

        <div style="font-size:15px;color:#111827;font-weight:600;margin:0 0 4px;word-break:break-word;">${esc(log.message)}</div>
        <div style="font-size:12px;color:#6B7280;margin:0 0 20px;">${esc(time)}</div>

        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${log.appId ? `<tr><td style="padding:4px 0;color:#6B7280;width:100px;">App</td><td style="padding:4px 0;color:#111827;font-family:monospace;">${esc(log.appId)}</td></tr>` : ''}
          ${log.userId ? `<tr><td style="padding:4px 0;color:#6B7280;">User</td><td style="padding:4px 0;color:#111827;font-family:monospace;">${esc(log.userId)}</td></tr>` : ''}
          ${log.requestId ? `<tr><td style="padding:4px 0;color:#6B7280;">Request</td><td style="padding:4px 0;color:#111827;font-family:monospace;">${esc(log.requestId)}</td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#6B7280;">Log ID</td><td style="padding:4px 0;color:#111827;font-family:monospace;">${esc(String(log._id))}</td></tr>
        </table>

        ${stackSection}
        ${contextSection}
        ${ctaButton}
      </div>
      <!-- Footer -->
      <div style="background:#F9FAFB;padding:12px 20px;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;text-align:center;">
        Alerte automatique bigwin-api-v2 · Throttling 5 min par clé service.category
      </div>
    </div>
  </div>
</body></html>`;
}

function buildAlertSubject({ log, suppressedCount }) {
  const levelTag = `[${log.level.toUpperCase()}]`;
  const service = log.service ? ` ${log.service}${log.category ? '.' + log.category : ''}` : '';
  const suppressedSuffix = suppressedCount > 0 ? ` (+${suppressedCount} supprimées)` : '';
  const truncatedMessage = String(log.message).slice(0, 80);
  return `🚨 ${levelTag}${service} — ${truncatedMessage}${suppressedSuffix}`;
}

module.exports = { buildAlertHtml, buildAlertSubject };
