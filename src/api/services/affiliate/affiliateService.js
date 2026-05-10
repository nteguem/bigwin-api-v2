// src/api/services/affiliate/affiliateService.js
//
// Service métier pour les opérations affilié côté user (auth user).
// Couvre :
//   - Activation du rôle affilié (génération code + setup payoutMethod)
//   - Lecture état affilié (`getMyAffiliateState`)
//   - Génération du lien de partage Play Store
//   - Validation d'un code à l'inscription d'un filleul
//   - Création du Referral à l'inscription (avec check pays + self-ref)
//
// L'admin a son propre service (admin/affiliateAdminService.js).

const User = require('../../models/user/User');
const Referral = require('../../models/affiliate/Referral');
const Commission = require('../../models/affiliate/Commission');
const PayoutRequest = require('../../models/affiliate/PayoutRequest');
const AffiliateConfig = require('../../models/affiliate/AffiliateConfig');
const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class AffiliateService {
  /**
   * Récupère (ou crée par défaut) la config affiliation d'une app.
   * Création paresseuse : si pas encore de config, on crée avec valeurs
   * par défaut (15% commission, etc.) pour ne jamais bloquer le flow.
   */
  async getOrCreateConfig(appId) {
    let config = await AffiliateConfig.findOne({ appId });
    if (!config) {
      config = await AffiliateConfig.create({
        appId,
        isEnabled: true,
        defaultTier: 'rookie',
        defaultCommissionRate: 15,
        attributionWindowDays: 30,
      });
    }
    return config;
  }

  /**
   * Active le rôle affilié pour un User existant.
   * - Le pays est figé (copié de User.countryCode).
   * - Le code est généré aléatoirement (8 chars [A-Z0-9], unique par app).
   * - Pas de re-activation possible (idempotent : si déjà actif, retourne tel quel).
   *
   * @param {Object} user - User document Mongoose
   * @param {Object} payoutMethod - { operator, phoneNumber }
   */
  async activate(user, payoutMethod) {
    if (!user || !user._id) {
      throw new AppError('User invalide', 400, ErrorCodes.VALIDATION_ERROR);
    }

    if (user.affiliate?.isActive) {
      // Idempotent : déjà activé, on retourne l'état courant
      return user;
    }

    if (!user.countryCode) {
      throw new AppError(
        'Pays utilisateur introuvable. Le pays est nécessaire pour activer le rôle affilié.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    if (!payoutMethod?.operator || !payoutMethod?.phoneNumber) {
      throw new AppError(
        'Coordonnées mobile money requises (operator + phoneNumber)',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const config = await this.getOrCreateConfig(user.appId);
    if (!config.isEnabled) {
      throw new AppError(
        "Le programme d'affiliation n'est pas activé pour cette application.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Le pays de l'user doit être dans la liste des pays activés
    // (sinon il ne pourrait jamais retirer ses commissions, vu que
    // les payouts AfribaPay sont scopés par pays).
    const userCountry = user.countryCode.toUpperCase();
    const countryEnabled = (config.payoutCountries || []).some(
      (c) => c.code === userCountry && c.enabled !== false
    );
    if (!countryEnabled) {
      throw new AppError(
        `Le programme d'affiliation n'est pas encore disponible dans ton pays (${userCountry}).`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const code = await User.generateAffiliateCode(user.appId);

    user.affiliate = {
      isActive: true,
      code,
      tier: config.defaultTier,
      country: user.countryCode.toUpperCase(),
      payoutMethod: {
        operator: payoutMethod.operator.toLowerCase(),
        phoneNumber: payoutMethod.phoneNumber.trim(),
      },
      activatedAt: new Date(),
      suspended: false,
    };

    await user.save();
    return user;
  }

  /**
   * Met à jour les coordonnées mobile money de l'affilié.
   * Pas de modification du pays ou du code (figés à vie).
   */
  async updatePayoutMethod(user, payoutMethod) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié. Activez votre compte d'abord.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    if (!payoutMethod?.operator || !payoutMethod?.phoneNumber) {
      throw new AppError(
        'operator et phoneNumber requis',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    user.affiliate.payoutMethod = {
      operator: payoutMethod.operator.toLowerCase(),
      phoneNumber: payoutMethod.phoneNumber.trim(),
    };
    await user.save();
    return user;
  }

  /**
   * État affilié + stats agrégées (balance, filleuls, commissions).
   * Source unique pour le dashboard mobile et le portail web.
   *
   * `canActivate` est `true` uniquement si le pays de l'user est dans
   * la liste des pays activés dans AffiliateConfig.payoutCountries
   * (avec enabled=true). Permet au mobile de cacher le bouton "Devenir
   * affilié" pour les users hors zone.
   */
  async getMyState(user) {
    const appId = user.appId;
    const isAffiliate = !!user.affiliate?.isActive;

    if (!isAffiliate) {
      // Vérifie si le pays user est éligible à devenir affilié
      let canActivate = false;
      if (user.countryCode) {
        const config = await this.getOrCreateConfig(appId);
        if (config.isEnabled) {
          const userCountry = user.countryCode.toUpperCase();
          canActivate = (config.payoutCountries || []).some(
            (c) => c.code === userCountry && c.enabled !== false
          );
        }
      }
      return {
        isAffiliate: false,
        canActivate,
      };
    }

    // Aggrégations parallèles
    const [
      availableAgg,
      lockedAgg,
      paidAgg,
      referralsCount,
      convertedReferralsCount,
      pendingPayouts,
    ] = await Promise.all([
      Commission.aggregate([
        { $match: { appId, referrer: user._id, status: 'available' } },
        { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Commission.aggregate([
        { $match: { appId, referrer: user._id, status: 'locked' } },
        { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Commission.aggregate([
        { $match: { appId, referrer: user._id, status: 'paid' } },
        { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Referral.countDocuments({ appId, referrer: user._id }),
      Referral.countDocuments({ appId, referrer: user._id, status: 'converted' }),
      PayoutRequest.countDocuments({
        appId,
        user: user._id,
        status: { $in: ['queued', 'processing', 'awaiting_funds'] },
      }),
    ]);

    const sumByCurrency = (agg) => {
      const out = {};
      for (const row of agg) out[row._id] = { amount: row.total, count: row.count };
      return out;
    };

    return {
      isAffiliate: true,
      code: user.affiliate.code,
      tier: user.affiliate.tier,
      country: user.affiliate.country,
      payoutMethod: user.affiliate.payoutMethod,
      activatedAt: user.affiliate.activatedAt,
      suspended: !!user.affiliate.suspended,
      balance: {
        available: sumByCurrency(availableAgg),
        locked: sumByCurrency(lockedAgg),
        paid: sumByCurrency(paidAgg),
      },
      stats: {
        totalReferrals: referralsCount,
        convertedReferrals: convertedReferralsCount,
        pendingPayouts,
      },
    };
  }

  /**
   * Génère le lien de partage Play Store avec le code injecté.
   *
   * Format AfribaPay-free : pas de domain custom, pas de Branch.io.
   * Le mobile parse le `referrer=utm_source=CODE` au 1er lancement via
   * Play Install Referrer API.
   */
  async getMyShareLink(user) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const code = user.affiliate.code;

    // Récupère le packageName depuis App config (pour construire l'URL Play)
    const app = await App.findOne({ appId: user.appId });
    const packageName = app?.googlePlay?.packageName;

    if (!packageName) {
      throw new AppError(
        `packageName Google Play non configuré pour app=${user.appId}`,
        500,
        ErrorCodes.SERVER_ERROR
      );
    }

    const referrer = `utm_source%3D${code}`;
    const url = `https://play.google.com/store/apps/details?id=${packageName}&referrer=${referrer}`;

    return {
      code,
      url,
      packageName,
    };
  }

  /**
   * Valide un `affiliateCode` reçu lors de l'inscription d'un user.
   * Retourne le User parrain si trouvé + actif + non suspendu, sinon null.
   *
   * NE THROW PAS si le code est invalide — l'inscription doit pouvoir
   * continuer même avec un code bidon (juste sans Referral).
   */
  async findReferrerByCode(appId, code) {
    if (!code || typeof code !== 'string') return null;

    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalized)) return null;

    const referrer = await User.findOne({
      appId,
      'affiliate.code': normalized,
      'affiliate.isActive': true,
      'affiliate.suspended': { $ne: true },
      isActive: true,
    });

    return referrer || null;
  }

  /**
   * Crée le Referral à l'inscription d'un User filleul.
   * Appelé depuis authController.register et googleAuthService après création User.
   *
   * Garde-fous (silencieux — pas de throw, on log juste) :
   *   - Pas de code → pas de Referral
   *   - Code invalide / inactif → pas de Referral
   *   - Self-ref (même phone) → Referral status='self_ref' (pas de commission)
   *   - Country mismatch → Referral status='country_mismatch' (pas de commission)
   *   - Tout OK → Referral status='signed_up' (éligible à commission au 1er paiement)
   *
   * @returns {Object|null} le Referral créé, ou null si aucun
   */
  async createReferralAtSignup(referee, code) {
    if (!code) return null;

    const referrer = await this.findReferrerByCode(referee.appId, code);
    if (!referrer) return null;

    // Détermine le statut du référral selon les règles métier
    let status = 'signed_up';

    // Self-ref : même phone (ou même email pour les Google users sans phone)
    const samePhone =
      referee.phoneNumber &&
      referrer.phoneNumber &&
      referee.dialCode === referrer.dialCode &&
      referee.phoneNumber === referrer.phoneNumber;
    const sameEmail =
      referee.email && referrer.email && referee.email === referrer.email;

    if (samePhone || sameEmail) {
      status = 'self_ref';
    } else if (
      referee.countryCode &&
      referrer.affiliate?.country &&
      referee.countryCode.toUpperCase() !==
        referrer.affiliate.country.toUpperCase()
    ) {
      status = 'country_mismatch';
    }

    try {
      const referral = await Referral.create({
        appId: referee.appId,
        referrer: referrer._id,
        referee: referee._id,
        code: referrer.affiliate.code,
        refereeCountry: referee.countryCode?.toUpperCase(),
        referrerCountry: referrer.affiliate.country,
        status,
      });
      return referral;
    } catch (err) {
      // Duplicate key (referee déjà parrainé) ou autre erreur : on log silencieusement
      if (err.code === 11000) {
        return await Referral.findOne({
          appId: referee.appId,
          referee: referee._id,
        });
      }
      // Autres erreurs : on ne casse pas le signup
      console.error('[affiliateService] createReferralAtSignup failed:', err.message);
      return null;
    }
  }

  /**
   * Liste paginée des filleuls d'un affilié, anonymisés.
   * @param {Object} user - parrain
   * @param {Object} opts - { page, limit }
   */
  async listMyReferrals(user, { page = 1, limit = 20 } = {}) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      Referral.find({ appId: user.appId, referrer: user._id })
        .populate('referee', 'pseudo countryCode createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Referral.countDocuments({ appId: user.appId, referrer: user._id }),
    ]);

    return {
      items: items.map((r) => ({
        _id: r._id,
        // Pseudonymisé : on ne donne pas l'identité complète du filleul
        referee: r.referee
          ? {
              pseudo: r.referee.pseudo,
              country: r.referee.countryCode,
              joinedAt: r.referee.createdAt,
            }
          : null,
        status: r.status,
        createdAt: r.createdAt,
        convertedAt: r.convertedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Crée la Commission au paiement réussi d'un filleul.
   * Appelé depuis paymentMiddleware.handleSuccessfulTransaction()
   * APRÈS la création de la Subscription.
   *
   * Garde-fous (silencieux — jamais de throw qui casserait le paiement) :
   *   - Pas de Referral pour ce User → return null
   *   - Referral.status ≠ 'signed_up' (self_ref / country_mismatch) → skip
   *   - Affilié suspendu → skip
   *   - Commission déjà créée pour cette Subscription → skip (idempotent)
   *
   * @param {Object} subscription - doc Subscription Mongoose populé ou _id-only
   * @returns {Object|null} Commission créée, ou null
   */
  async tryCreateCommissionForSubscription(subscription) {
    if (!subscription) return null;

    const Subscription = require('../../models/common/Subscription');
    const sub =
      subscription.user && subscription.package
        ? subscription
        : await Subscription.findById(subscription._id || subscription).lean();

    if (!sub) return null;

    // Idempotence : si Commission déjà créée pour cette sub, return existante
    const existing = await Commission.findOne({
      appId: sub.appId,
      subscription: sub._id,
    });
    if (existing) return existing;

    // Trouve le Referral éligible (status='signed_up' uniquement)
    const referral = await Referral.findOne({
      appId: sub.appId,
      referee: sub.user,
      status: 'signed_up',
    });
    if (!referral) return null;

    // Vérifie l'affilié (existe + actif + non suspendu)
    const referrer = await User.findById(referral.referrer);
    if (!referrer || !referrer.affiliate?.isActive) return null;
    if (referrer.affiliate.suspended) return null;

    // Calcul commission selon config
    const config = await this.getOrCreateConfig(sub.appId);
    const subAmount = sub.pricing?.amount || 0;
    if (subAmount <= 0) return null;

    const rate = config.defaultCommissionRate || 15;
    const amount = Math.round((subAmount * rate) / 100);
    if (amount <= 0) return null;

    let commission;
    try {
      commission = await Commission.create({
        appId: sub.appId,
        referrer: referral.referrer,
        referee: sub.user,
        referral: referral._id,
        subscription: sub._id,
        subscriptionAmount: subAmount,
        commissionRate: rate,
        amount,
        currency: sub.pricing?.currency || 'XAF',
        tier: referrer.affiliate.tier || 'rookie',
        status: 'available',
      });
    } catch (err) {
      // Race possible avec autre webhook : duplicate key sur (appId, subscription)
      if (err.code === 11000) {
        return await Commission.findOne({
          appId: sub.appId,
          subscription: sub._id,
        });
      }
      throw err;
    }

    // Marque le Referral comme converti
    if (referral.status === 'signed_up') {
      referral.status = 'converted';
      referral.convertedAt = new Date();
      referral.firstCommissionId = commission._id;
      await referral.save();
    }

    return commission;
  }

  /**
   * Annule la Commission liée à une Subscription (clawback).
   * Appelé en cas de refund / chargeback / annulation admin.
   *
   * Comportement selon status courant :
   *   - 'available' → cancelled (réintégrée au wallet de l'affilié)
   *   - 'locked'    → cancelled + retire de PayoutRequest.commissionsIncluded
   *                   (l'affilié garde son PayoutRequest pour le reste,
   *                    le montant total du payout est ajusté)
   *   - 'paid'      → log alerte. Pas de revert auto (l'argent a déjà été
   *                   versé). Admin doit reconcilier manuellement.
   *   - 'cancelled' → no-op (idempotent)
   */
  async cancelCommissionForSubscription(subscription, reason = 'refund') {
    if (!subscription) return null;
    const subId = subscription._id || subscription;

    const commission = await Commission.findOne({ subscription: subId });
    if (!commission) return null;

    if (commission.status === 'cancelled') return commission;

    if (commission.status === 'paid') {
      console.warn(
        `[affiliateService] Cannot auto-clawback paid commission ${commission._id} ` +
          `(reason=${reason}). Manual reconciliation required.`
      );
      return commission;
    }

    if (commission.status === 'locked' && commission.payoutRequest) {
      // Retire de la liste du payout en cours
      await PayoutRequest.updateOne(
        { _id: commission.payoutRequest },
        { $pull: { commissionsIncluded: commission._id } }
      );
    }

    commission.status = 'cancelled';
    commission.cancelledAt = new Date();
    commission.cancelReason = reason;
    commission.payoutRequest = null;
    await commission.save();

    return commission;
  }

  /**
   * Liste paginée des commissions de l'affilié.
   */
  async listMyCommissions(user, { page = 1, limit = 20, status } = {}) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const filter = { appId: user.appId, referrer: user._id };
    if (status) filter.status = status;

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      Commission.find(filter)
        .populate('referee', 'pseudo')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Commission.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = new AffiliateService();
