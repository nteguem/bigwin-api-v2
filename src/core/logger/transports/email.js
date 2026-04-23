/**
 * Transport Winston → Email (alerting P0).
 *
 * Déclenche un email à `ALERT_EMAIL` quand un log de niveau `ALERT_LEVEL`
 * (défaut: fatal) est émis, avec throttling par clé `service.category`.
 *
 * Principes de résilience :
 *   - JAMAIS throw ni appeler logger.* (boucle infinie garantie)
 *   - Fire-and-forget via setImmediate
 *   - Tout échec SMTP écrit sur stderr en brut, puis disparaît silencieusement
 *   - Si `ALERT_EMAIL` absent → transport no-op (retourne immédiatement)
 *   - Si sendAlert réussit, on UPDATE le doc Log avec `alertSent: true` pour
 *     que le backoffice affiche le bandeau "📬 Alerte email envoyée"
 *
 * Le timing : le transport Mongo enregistre d'abord le log en DB, PUIS le
 * transport email s'active. Comme Winston appelle tous les transports en
 * parallèle, on doit attendre un peu (`await Log.findOne`) pour récupérer
 * l'_id du doc persisté. On le fait via un petit retry.
 */
const Transport = require('winston-transport');
const { shouldAlert } = require('../throttle');
const { buildAlertHtml, buildAlertSubject } = require('../alerts/emailTemplate');

class EmailAlertTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.connection = opts.connection;
    this.level = opts.level || process.env.ALERT_LEVEL || 'fatal';
    this.to = opts.to || process.env.ALERT_EMAIL || null;
    this.adminUrl = opts.adminUrl || process.env.ALERT_ADMIN_URL || null;
    this._model = null;
    this._mailService = null;

    if (!this.to) {
      // Pas d'email configuré → ce transport ne fera rien. On le garde
      // attaché pour que l'ajout d'ALERT_EMAIL à chaud puisse réactiver
      // l'alerting sans redémarrer (après prochain init complet).
      process.stderr.write('[EmailAlert] ALERT_EMAIL absent, transport silencieux\n');
    }
  }

  _getModel() {
    if (this._model) return this._model;
    const getLogModel = require('../../../api/models/common/Log');
    this._model = getLogModel(this.connection);
    return this._model;
  }

  _getMailService() {
    if (this._mailService) return this._mailService;
    // Import différé pour éviter d'initialiser nodemailer au boot si on ne
    // s'en sert pas (pas d'ALERT_EMAIL).
    this._mailService = require('../../../api/services/common/mailService');
    return this._mailService;
  }

  /**
   * Trouve le document Log qui correspond à l'info Winston qu'on vient de
   * recevoir. Comme le transport Mongo écrit en parallèle et en fire-and-
   * forget, on doit retry un peu pour lui laisser le temps de persister.
   *
   * On matche sur `{ requestId, service, message, level }` qui est assez
   * discriminant en pratique (même s'il peut théoriquement coïncider avec
   * un autre log quasi-simultané — peu probable pour une FATAL).
   */
  async _findLogDoc(info) {
    const Model = this._getModel();
    const filter = {
      level: info.level,
      message: typeof info.message === 'string' ? info.message : JSON.stringify(info.message),
      service: info.service || null,
    };
    if (info.requestId) filter.requestId = info.requestId;

    // 3 tentatives espacées de 150ms (total max 450ms)
    for (let i = 0; i < 3; i++) {
      const doc = await Model.findOne(filter).sort({ timestamp: -1 }).lean();
      if (doc) return doc;
      await new Promise(r => setTimeout(r, 150));
    }
    return null;
  }

  async _sendAndMark(info) {
    try {
      if (!this.to) return;

      const service = info.service || 'system';
      const category = info.category || 'default';
      const throttleKey = `${service}.${category}`;

      const { allow, suppressedCount } = shouldAlert(throttleKey);
      if (!allow) return;

      const log = await this._findLogDoc(info);
      if (!log) {
        // Pire cas : pas de doc trouvé. On envoie quand même avec les infos
        // de `info`, sans deeplink (pas d'_id à linker).
        const pseudoLog = {
          _id: 'unknown',
          timestamp: info.timestamp || new Date(),
          level: info.level,
          message: info.message,
          service: info.service,
          category: info.category,
          requestId: info.requestId,
          appId: info.appId,
          userId: info.userId,
          stack: info.stack,
          context: info,
        };
        const html = buildAlertHtml({ log: pseudoLog, suppressedCount, deepLinkUrl: null });
        const subject = buildAlertSubject({ log: pseudoLog, suppressedCount });
        await this._getMailService().sendAlert({ to: this.to, subject, html });
        return;
      }

      const deepLinkUrl = this.adminUrl
        ? `${this.adminUrl.replace(/\/$/, '')}/logs?id=${log._id}`
        : null;

      const html = buildAlertHtml({ log, suppressedCount, deepLinkUrl });
      const subject = buildAlertSubject({ log, suppressedCount });

      await this._getMailService().sendAlert({ to: this.to, subject, html });

      // Marque le doc comme alerté — le drawer du backoffice affichera le
      // bandeau "📬 Alerte email envoyée".
      const Model = this._getModel();
      await Model.updateOne(
        { _id: log._id },
        { $set: { alertSent: true, alertSentAt: new Date() } }
      );
    } catch (err) {
      // Jamais propager — SMTP down ne doit pas crasher une requête.
      process.stderr.write(`[EmailAlert] send failed: ${err.message}\n`);
    }
  }

  log(info, callback) {
    // Winston attend le callback tout de suite.
    setImmediate(() => this.emit('logged', info));

    // Fire-and-forget avec catch ultime. `_sendAndMark` est déjà try/catch
    // interne, mais belt-and-suspenders au cas où.
    this._sendAndMark(info).catch((err) => {
      process.stderr.write(`[EmailAlert] unexpected: ${err.message}\n`);
    });

    callback();
  }
}

module.exports = function createEmailTransport(connection, opts = {}) {
  return new EmailAlertTransport({ connection, ...opts });
};
