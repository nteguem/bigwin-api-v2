/**
 * Admin logs controller — lecture des logs applicatifs pour le backoffice.
 *
 * Tous les endpoints sont super_admin only (données sensibles : stack traces,
 * contexte tenant cross-app, PII partielles).
 *
 * Utilise la connexion MongoDB dédiée aux logs (core/logger/connection).
 */
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const { getLogsConnection } = require('../../../core/logger/connection');
const getLogModel = require('../../models/common/Log');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const VALID_LEVELS = ['fatal', 'error', 'warn', 'info', 'http', 'debug'];

function getModel() {
  return getLogModel(getLogsConnection());
}

/**
 * Construit le filtre Mongo à partir des query params.
 * Toutes les valeurs sont validées / échappées pour éviter l'injection.
 */
function buildFilter(query) {
  const filter = {};

  if (query.level) {
    // Accepte soit un niveau seul, soit une liste "error,fatal"
    const levels = String(query.level).split(',').map(l => l.trim()).filter(l => VALID_LEVELS.includes(l));
    if (levels.length === 1) filter.level = levels[0];
    else if (levels.length > 1) filter.level = { $in: levels };
  }

  if (query.service) filter.service = String(query.service).slice(0, 64);
  if (query.category) filter.category = String(query.category).slice(0, 64);
  if (query.appId) filter.appId = String(query.appId).toLowerCase().slice(0, 64);
  if (query.userId) filter.userId = String(query.userId).slice(0, 64);
  if (query.requestId) filter.requestId = String(query.requestId).slice(0, 64);

  // Fenêtre temporelle
  const range = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!isNaN(d)) range.$gte = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!isNaN(d)) range.$lte = d;
  }
  if (Object.keys(range).length) filter.timestamp = range;

  // Recherche texte (sur message uniquement). On échappe les métacaractères
  // regex pour éviter qu'un `$` ou `(` crashe la query ou ralentisse Mongo
  // avec du backtracking.
  if (query.search) {
    const escaped = String(query.search).slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.message = { $regex: escaped, $options: 'i' };
  }

  return filter;
}

/**
 * GET /admin/logs
 * Liste paginée + filtres. Tri timestamp desc (plus récent en premier).
 *
 * Query params : level, service, category, appId, userId, requestId, search,
 *                from (ISO), to (ISO), page (default 1), limit (default 50, max 100)
 */
exports.list = catchAsync(async (req, res) => {
  const Log = getModel();

  const filter = buildFilter(req.query);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  // Exécute count + find en parallèle pour diviser par 2 le temps de réponse.
  const [total, data] = await Promise.all([
    Log.countDocuments(filter),
    Log.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
});

/**
 * GET /admin/logs/:id
 * Un log précis + tous les logs corrélés (même requestId). Permet au
 * backoffice d'afficher la chaîne complète d'une requête en un écran.
 */
exports.getById = catchAsync(async (req, res, next) => {
  const Log = getModel();

  // Validation ObjectId avant tout pour éviter un CastError qui fuite en 500.
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
    return next(new AppError('ID invalide', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const log = await Log.findById(req.params.id).lean();
  if (!log) {
    return next(new AppError('Log non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // Related : même requestId, ordre chronologique (asc) pour reconstituer la
  // timeline naturelle de la requête. Excluent le log courant.
  let related = [];
  if (log.requestId) {
    related = await Log.find({
      requestId: log.requestId,
      _id: { $ne: log._id },
    })
      .sort({ timestamp: 1 })
      .limit(50)
      .lean();
  }

  res.status(200).json({
    success: true,
    data: { log, related },
  });
});

/**
 * GET /admin/logs/stats
 * Agrégations pour le dashboard santé :
 *   - Compte par niveau (fatal/error/warn/info/http/debug)
 *   - Compte par service (top 10)
 *   - Timeseries par heure (pour graphe)
 *   - Top 5 erreurs les plus fréquentes (groupées par message)
 *
 * Query params : from, to, appId (optionnels)
 */
exports.stats = catchAsync(async (req, res) => {
  const Log = getModel();

  // Fenêtre par défaut : 24 dernières heures.
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 24 * 3600 * 1000);

  const match = { timestamp: { $gte: from, $lte: to } };
  if (req.query.appId) match.appId = String(req.query.appId).toLowerCase();

  // Les 4 agrégations en parallèle — Mongo peut les paralléliser côté serveur
  // via des curseurs indépendants, et on évite le round-trip séquentiel.
  const [byLevel, byService, byHour, topErrors] = await Promise.all([
    Log.aggregate([
      { $match: match },
      { $group: { _id: '$level', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    Log.aggregate([
      { $match: { ...match, service: { $ne: null } } },
      { $group: { _id: '$service', count: { $sum: 1 }, errors: {
        $sum: { $cond: [{ $in: ['$level', ['fatal', 'error']] }, 1, 0] }
      } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    Log.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            hour: { $dateTrunc: { date: '$timestamp', unit: 'hour' } },
            level: '$level',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.hour': 1 } },
    ]),

    Log.aggregate([
      { $match: { ...match, level: { $in: ['fatal', 'error'] } } },
      {
        $group: {
          _id: { service: '$service', message: '$message' },
          count: { $sum: 1 },
          lastSeen: { $max: '$timestamp' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);

  res.status(200).json({
    success: true,
    data: {
      window: { from, to },
      byLevel: byLevel.map(b => ({ level: b._id, count: b.count })),
      byService: byService.map(b => ({ service: b._id, count: b.count, errors: b.errors })),
      byHour: byHour.map(b => ({ hour: b._id.hour, level: b._id.level, count: b.count })),
      topErrors: topErrors.map(e => ({
        service: e._id.service,
        message: e._id.message,
        count: e.count,
        lastSeen: e.lastSeen,
      })),
    },
  });
});

/**
 * GET /admin/logs/services
 * Liste des services distincts (alimente le dropdown de filtre dans l'UI).
 * Limité aux 30 derniers jours pour pertinence + perf.
 */
exports.services = catchAsync(async (req, res) => {
  const Log = getModel();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const services = await Log.aggregate([
    { $match: { timestamp: { $gte: thirtyDaysAgo }, service: { $ne: null } } },
    { $group: { _id: '$service', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);

  res.status(200).json({
    success: true,
    data: services.map(s => ({ service: s._id, count: s.count })),
  });
});
