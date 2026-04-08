// src/api/services/admin/subscriptionManagementService.js

const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');

/**
 * Taux de conversion vers XAF (devise de référence)
 * XAF/XOF : parité fixe (1:1)
 * Autres : taux approximatifs, ajustables manuellement
 */
const CURRENCY_TO_XAF = {
  XAF: 1,
  XOF: 1,          // Parité fixe CFA BEAC / CFA BCEAO
  EUR: 655.957,    // Taux fixe (zone franc)
  USD: 615,
  CDF: 0.22,
  GNF: 0.072,
  GMD: 8.5,
  NGN: 0.38,
  KES: 4.8,
  GHS: 46,
  EGP: 12.8,
  TZS: 0.24,
  ZAR: 33,
};

/**
 * Convertit un montant d'une devise vers XAF
 */
function convertToXAF(amount, currency) {
  const rate = CURRENCY_TO_XAF[currency];
  if (!rate) return amount; // devise inconnue → retourner tel quel
  return Math.round(amount * rate);
}

/**
 * Récupérer les souscriptions avec filtres (utilise aggregate pour bypasser le hook pre-find)
 */
async function getAllSubscriptions(appId, filters = {}, options = {}) {
  const { startDate, endDate, paymentProvider, status, search } = filters;
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 20;
  const sortBy = options.sortBy || 'createdAt';
  const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
  const skip = (page - 1) * limit;

  // Construction du match (aggregate bypasse les hooks pre-find)
  const match = {};

  // Filtre multi-app : si appId === 'all', pas de filtre
  if (appId && appId !== 'all') {
    match.appId = appId;
  }

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lt = new Date(endDate);
  }

  if (paymentProvider) {
    match.paymentProvider = paymentProvider;
  }

  if (status) {
    match.status = status;
  }

  // Pipeline d'agrégation
  const pipeline = [
    { $match: match },
    { $sort: { [sortBy]: sortOrder } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'user',
              pipeline: [
                { $project: { pseudo: 1, email: 1, firstName: 1, lastName: 1, countryCode: 1, profilePicture: 1 } }
              ]
            }
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'packages',
              localField: 'package',
              foreignField: '_id',
              as: 'package',
              pipeline: [
                { $project: { name: 1, 'pricing': 1 } }
              ]
            }
          },
          { $unwind: { path: '$package', preserveNullAndEmptyArrays: true } },
        ]
      }
    }
  ];

  // Si recherche texte, on filtre après le lookup user
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    pipeline.splice(1, 0, {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: '_searchUser',
        pipeline: [
          { $project: { pseudo: 1, email: 1, firstName: 1, lastName: 1 } }
        ]
      }
    }, {
      $unwind: { path: '$_searchUser', preserveNullAndEmptyArrays: true }
    }, {
      $match: {
        $or: [
          { '_searchUser.pseudo': searchRegex },
          { '_searchUser.email': searchRegex },
          { '_searchUser.firstName': searchRegex },
          { '_searchUser.lastName': searchRegex },
          { 'paymentReference': searchRegex },
        ]
      }
    }, {
      $project: { _searchUser: 0 }
    });
  }

  const result = await Subscription.aggregate(pipeline);

  const total = result[0]?.metadata[0]?.total || 0;
  const subscriptions = result[0]?.data || [];

  // Ajouter l'équivalent XAF à chaque souscription
  const enriched = subscriptions.map(sub => ({
    ...sub,
    pricing: {
      ...sub.pricing,
      amountXAF: convertToXAF(sub.pricing.amount, sub.pricing.currency),
    }
  }));

  return {
    subscriptions: enriched,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    }
  };
}

/**
 * Statistiques des ventes avec conversion XAF
 */
async function getSubscriptionStats(appId, filters = {}) {
  const { startDate, endDate, paymentProvider, status } = filters;

  const match = {};

  if (appId && appId !== 'all') {
    match.appId = appId;
  }

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lt = new Date(endDate);
  }

  if (paymentProvider) {
    match.paymentProvider = paymentProvider;
  }

  if (status) {
    match.status = status;
  }

  const pipeline = [
    { $match: match },
    {
      $facet: {
        // Total général
        totals: [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
            }
          }
        ],
        // Par devise
        byCurrency: [
          {
            $group: {
              _id: '$pricing.currency',
              count: { $sum: 1 },
              totalAmount: { $sum: '$pricing.amount' },
            }
          },
          { $sort: { totalAmount: -1 } }
        ],
        // Par provider
        byProvider: [
          {
            $group: {
              _id: '$paymentProvider',
              count: { $sum: 1 },
            }
          }
        ],
        // Par statut
        byStatus: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            }
          }
        ],
        // Par jour (7 derniers jours ou période filtrée)
        byDay: [
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
              },
              count: { $sum: 1 },
              totalAmount: { $sum: '$pricing.amount' },
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 31 }
        ],
        // Par app (utile en mode multi-app)
        byApp: [
          {
            $group: {
              _id: '$appId',
              count: { $sum: 1 },
            }
          },
          { $sort: { count: -1 } }
        ]
      }
    }
  ];

  const result = await Subscription.aggregate(pipeline);
  const data = result[0];

  // Calculer le total en XAF
  const totalXAF = (data.byCurrency || []).reduce((sum, curr) => {
    return sum + convertToXAF(curr.totalAmount, curr._id);
  }, 0);

  // Enrichir byCurrency avec l'équivalent XAF
  const byCurrencyEnriched = (data.byCurrency || []).map(curr => ({
    currency: curr._id,
    count: curr.count,
    totalAmount: curr.totalAmount,
    totalAmountXAF: convertToXAF(curr.totalAmount, curr._id),
  }));

  return {
    totalSubscriptions: data.totals[0]?.count || 0,
    totalRevenueXAF: totalXAF,
    byCurrency: byCurrencyEnriched,
    byProvider: (data.byProvider || []).map(p => ({
      provider: p._id,
      count: p.count,
    })),
    byStatus: (data.byStatus || []).map(s => ({
      status: s._id,
      count: s.count,
    })),
    byDay: (data.byDay || []).map(d => ({
      date: d._id,
      count: d.count,
      totalAmount: d.totalAmount,
    })),
    byApp: (data.byApp || []).map(a => ({
      app: a._id,
      count: a.count,
    })),
    currencyRates: CURRENCY_TO_XAF,
  };
}

module.exports = {
  getAllSubscriptions,
  getSubscriptionStats,
  CURRENCY_TO_XAF,
  convertToXAF,
};
