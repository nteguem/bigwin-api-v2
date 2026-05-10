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

const mongoose = require('mongoose');

const User = require('../../models/user/User');
const Device = require('../../models/common/Device');
const Referral = require('../../models/affiliate/Referral');
const Commission = require('../../models/affiliate/Commission');
const PayoutRequest = require('../../models/affiliate/PayoutRequest');
const AffiliateConfig = require('../../models/affiliate/AffiliateConfig');
const App = require('../../models/common/App');
const mailService = require('../common/mailService');
const notificationService = require('../common/notificationService');
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
      });
    }
    return config;
  }

  /**
   * Active le rôle affilié pour un User existant.
   *
   * V1 : on demande pays + firstName + lastName (identité pour AfribaPay).
   * PAS d'opérateur ni de numéro mobile money à l'activation — ces infos
   * sont saisies UNE SEULE FOIS au moment du premier retrait, figées à vie.
   *
   * @param {Object} user - User document Mongoose
   * @param {Object} [opts] - { country?, firstName, lastName }
   */
  async activate(user, opts = {}) {
    if (!user || !user._id) {
      throw new AppError('User invalide', 400, ErrorCodes.VALIDATION_ERROR);
    }

    if (user.affiliate?.isActive) {
      // Idempotent : déjà activé, on retourne l'état courant
      return user;
    }

    const config = await this.getOrCreateConfig(user.appId);
    if (!config.isEnabled) {
      throw new AppError(
        "Le programme d'affiliation n'est pas activé pour cette application.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Pays choisi par l'user > pays détecté du User. Doit être dans
    // payoutCountries enabled (sinon les retraits seraient impossibles).
    const requestedCountry = (
      opts.country ||
      user.countryCode ||
      ''
    ).toUpperCase();

    if (!requestedCountry) {
      throw new AppError(
        'Pays requis pour activer le compte affilié.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const countryCfg = (config.payoutCountries || []).find(
      (c) => c.code === requestedCountry && c.enabled !== false
    );
    if (!countryCfg) {
      throw new AppError(
        `Le programme d'affiliation n'est pas disponible dans le pays ${requestedCountry}.`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Identité affilié — requise pour les payouts AfribaPay
    const firstName = (opts.firstName || '').trim();
    const lastName = (opts.lastName || '').trim();
    if (!firstName || !lastName) {
      throw new AppError(
        'Prénom et nom requis pour activer le compte affilié.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const code = await User.generateAffiliateCode(user.appId);

    user.affiliate = {
      isActive: true,
      code,
      tier: config.defaultTier,
      country: requestedCountry,
      firstName,
      lastName,
      // payoutMethod omis : sera défini au premier retrait
      activatedAt: new Date(),
      suspended: false,
    };

    await user.save();
    return user;
  }

  /**
   * Définit la méthode de retrait (operator + phoneNumber) UNE SEULE FOIS.
   * Une fois définie, plus modifiable côté user (immuable, anti-fraude).
   * Pour modifier, l'admin doit reset via le backoffice.
   */
  async setPayoutMethod(user, { operator, phoneNumber }) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    if (user.affiliate.payoutMethod?.operator) {
      throw new AppError(
        'Vos coordonnées mobile money sont déjà définies. Contactez le support pour les modifier.',
        409,
        ErrorCodes.DUPLICATE_OPERATION
      );
    }
    if (!operator || !phoneNumber) {
      throw new AppError(
        'Opérateur et numéro mobile money requis.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    user.affiliate.payoutMethod = {
      operator: operator.toLowerCase().trim(),
      phoneNumber: phoneNumber.trim(),
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
      // canActivate est true uniquement si le pays détecté de l'user est
      // dans la liste des pays activés. Logique restrictive cohérente avec
      // l'intention business : on ne propose le programme qu'aux users
      // dont le pays est supporté.
      let canActivate = false;
      let defaultCountry = null;
      if (user.countryCode) {
        const config = await this.getOrCreateConfig(appId);
        if (config.isEnabled) {
          const userCountry = user.countryCode.toUpperCase();
          const userCfg = (config.payoutCountries || []).find(
            (c) => c.code === userCountry && c.enabled !== false
          );
          if (userCfg) {
            canActivate = true;
            defaultCountry = {
              code: userCfg.code,
              currency: userCfg.currency,
            };
          }
        }
      }
      // commissionRate exposé même en pré-activation pour que l'écran
      // "Devenir affilié" puisse afficher clairement ce que l'user va gagner.
      const cfg = await this.getOrCreateConfig(appId);
      return {
        isAffiliate: false,
        canActivate,
        defaultCountry, // pré-sélection du select pays côté UI
        commissionRate: cfg.defaultCommissionRate ?? 15,
        // Pré-remplissage du form d'activation côté mobile (modifiable
        // pour les users dont firstName/lastName sont des pseudos).
        prefill: {
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          email: user.email || null,
        },
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

    // Lookup de la devise du pays affilié depuis la config (single source
    // of truth) + nom du pays depuis AppConfig. Évite que le mobile
    // hardcode un mapping country→currency/name.
    const config = await this.getOrCreateConfig(appId);
    const countryCfg = (config.payoutCountries || []).find(
      (c) => c.code === (user.affiliate.country || '').toUpperCase()
    );
    const AppConfigModel = require('../../models/common/AppConfig');
    const countryDoc = user.affiliate.country
      ? await AppConfigModel.findOne({
          countryCode: user.affiliate.country.toUpperCase(),
        })
          .select('countryName')
          .lean()
      : null;

    return {
      isAffiliate: true,
      code: user.affiliate.code,
      tier: user.affiliate.tier,
      country: user.affiliate.country,
      countryName: countryDoc?.countryName || null,
      currency: countryCfg?.currency || null,
      commissionRate: config.defaultCommissionRate ?? 15,
      firstName: user.affiliate.firstName || null,
      lastName: user.affiliate.lastName || null,
      email: user.email || null,
      payoutMethod: user.affiliate.payoutMethod || null,
      hasPayoutMethod: !!user.affiliate.payoutMethod?.operator,
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
   * Liste des pays disponibles pour activer un compte affilié, enrichie
   * avec le nom du pays (depuis AppConfig) et un flag isUserCountry pour
   * que l'UI mobile puisse pré-sélectionner le pays détecté.
   */
  async listEligibleCountries(user) {
    const config = await this.getOrCreateConfig(user.appId);
    const enabled = (config.payoutCountries || [])
      .filter((c) => c.enabled !== false)
      .map((c) => c.toObject ? c.toObject() : c);

    if (enabled.length === 0) return [];

    const codes = enabled.map((c) => c.code);
    const AppConfigModel = require('../../models/common/AppConfig');
    const countryDocs = await AppConfigModel.find({
      countryCode: { $in: codes },
    })
      .select('countryCode countryName')
      .lean();

    const nameByCode = countryDocs.reduce((acc, d) => {
      acc[d.countryCode] = d.countryName;
      return acc;
    }, {});

    const userCountry = (user.countryCode || '').toUpperCase();

    return enabled.map((c) => ({
      code: c.code,
      name: nameByCode[c.code] || c.code,
      currency: c.currency,
      isUserCountry: c.code === userCountry,
    }));
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

      // Notif push : nouveau filleul (uniquement pour les referrals
      // éligibles à commission, pas self_ref/country_mismatch).
      if (status === 'signed_up') {
        this._notifyAffiliate(
          referrer._id,
          referee.appId,
          { fr: 'Nouveau filleul 🎉', en: 'New referral 🎉' },
          {
            fr: `${referee.pseudo || 'Un nouvel utilisateur'} vient de s'inscrire avec ton code.`,
            en: `${referee.pseudo || 'A new user'} just signed up with your code.`,
          },
          { type: 'affiliate.new_referral', referralId: String(referral._id) }
        ).catch(() => {});
      }

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
   * Liste paginée des filleuls d'un affilié.
   * Recherche optionnelle par pseudo / email / phoneNumber via `q`.
   *
   * @param {Object} user - parrain
   * @param {Object} opts - { page, limit, q }
   */
  async listMyReferrals(user, { page = 1, limit = 20, q } = {}) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const baseFilter = { appId: user.appId, referrer: user._id };

    // Recherche : on cherche d'abord les Users qui matchent dans tous les
    // champs identifiants (pseudo, firstName, lastName, email, phoneNumber),
    // puis on filtre les Referrals par ces userIds. Regex insensible à la
    // casse pour rester tolérant aux casse-tête de saisie utilisateur.
    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rgx = new RegExp(escaped, 'i');
      const matchingUsers = await User.find({
        appId: user.appId,
        $or: [
          { pseudo: rgx },
          { firstName: rgx },
          { lastName: rgx },
          { email: rgx },
          { phoneNumber: rgx },
        ],
      })
        .select('_id')
        .lean();
      const ids = matchingUsers.map((u) => u._id);
      if (ids.length === 0) {
        return {
          items: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }
      baseFilter.referee = { $in: ids };
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      Referral.find(baseFilter)
        .populate('referee', 'pseudo countryCode createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Referral.countDocuments(baseFilter),
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
   * Détail d'un filleul. Inclut les commissions générées (si converti)
   * + les subscriptions du filleul (achats, même hors commission).
   *
   * Sécurité : vérifie que le `referrer` du Referral est bien le user
   * courant (pas de fuite de données entre affiliés).
   */
  async getReferralDetail(user, referralId) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const referral = await Referral.findOne({
      _id: referralId,
      appId: user.appId,
      referrer: user._id,
    })
      .populate(
        'referee',
        'pseudo email phoneNumber dialCode countryCode createdAt'
      )
      .lean();

    if (!referral) {
      throw new AppError('Filleul introuvable.', 404, ErrorCodes.NOT_FOUND);
    }

    // Subscriptions du filleul (tous les achats, même non-commissionnés)
    const Subscription = require('../../models/common/Subscription');
    const subs = await Subscription.find({
      appId: user.appId,
      user: referral.referee?._id,
    })
      .populate('package', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Commissions liées à ce referral (toutes statuts)
    const commissions = await Commission.find({
      appId: user.appId,
      referral: referral._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Email partiellement masqué (RGPD light) : `j***@gmail.com`
    const maskedEmail = (e) => {
      if (!e || typeof e !== 'string' || !e.includes('@')) return null;
      const [local, domain] = e.split('@');
      const head = local.slice(0, 1);
      return `${head}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
    };

    // Téléphone partiellement masqué : `+237 6XX XX 78 90` → `+237 6XX XX ** 90`
    const maskedPhone = (dial, phone) => {
      if (!phone) return null;
      const tail = phone.slice(-2);
      const masked = '*'.repeat(Math.max(0, phone.length - 2)) + tail;
      return dial ? `${dial} ${masked}` : masked;
    };

    return {
      _id: referral._id,
      status: referral.status,
      createdAt: referral.createdAt,
      convertedAt: referral.convertedAt,
      referee: referral.referee
        ? {
            pseudo: referral.referee.pseudo,
            country: referral.referee.countryCode,
            email: maskedEmail(referral.referee.email),
            phoneNumber: maskedPhone(
              referral.referee.dialCode,
              referral.referee.phoneNumber
            ),
            joinedAt: referral.referee.createdAt,
          }
        : null,
      subscriptions: subs.map((s) => {
        // Package.name est un objet bilingue { fr, en } — on extrait
        // une string pour ne pas envoyer un Map au client.
        const pkgName = s.package?.name;
        const packageNameStr =
          (pkgName && typeof pkgName === 'object'
            ? pkgName.fr || pkgName.en
            : pkgName) || null;
        return {
          _id: s._id,
          packageName: packageNameStr,
          amount: s.pricing?.amount || 0,
          currency: s.pricing?.currency || null,
          startedAt: s.startDate || s.createdAt,
          expiresAt: s.endDate || null,
          status: s.status || null,
        };
      }),
      commissions: commissions.map((c) => ({
        _id: c._id,
        amount: c.amount,
        currency: c.currency,
        rate: c.commissionRate,
        status: c.status,
        createdAt: c.createdAt,
      })),
    };
  }

  /**
   * Crée la Commission au paiement réussi d'un filleul.
   * Appelé depuis paymentMiddleware.handleSuccessfulTransaction()
   * APRÈS la création de la Subscription.
   *
   * Garde-fous (silencieux — jamais de throw qui casserait le paiement) :
   *   - Pas de Referral pour ce User → return null
   *   - Referral.status ∉ {'signed_up', 'converted'} (self_ref / country_mismatch) → skip
   *   - Affilié suspendu → skip
   *   - Commission déjà créée pour cette Subscription → skip (idempotent)
   *
   * Note : 'converted' = ≥1 commission déjà créée. On l'accepte pour que les
   * achats SUIVANTS d'un filleul (renouvellements, autres forfaits) génèrent
   * aussi des commissions au parrain — sinon seul le premier achat compterait.
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

    // Trouve le Referral éligible. 'signed_up' = pas encore converti.
    // 'converted' = au moins une commission déjà créée — on accepte aussi
    // pour que les achats SUIVANTS du même filleul génèrent une nouvelle
    // commission (renouvellement, autre forfait). On exclut explicitement
    // 'self_ref' et 'country_mismatch' qui sont des cas non éligibles.
    const referral = await Referral.findOne({
      appId: sub.appId,
      referee: sub.user,
      status: { $in: ['signed_up', 'converted'] },
    });
    if (!referral) return null;

    // Vérifie l'affilié (existe + actif + non suspendu)
    const referrer = await User.findById(referral.referrer);
    if (!referrer || !referrer.affiliate?.isActive) return null;
    if (referrer.affiliate.suspended) return null;

    // Récupère la config (sert pour le taux de commission)
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

    // Notif push à l'affilié : commission gagnée
    this._notifyAffiliate(
      referrer._id,
      sub.appId,
      {
        fr: `Commission +${amount} ${commission.currency} 💰`,
        en: `Commission +${amount} ${commission.currency} 💰`,
      },
      {
        fr: `Tu as gagné ${amount} ${commission.currency} grâce à un achat de ton filleul.`,
        en: `You earned ${amount} ${commission.currency} from one of your referrals.`,
      },
      {
        type: 'affiliate.new_commission',
        commissionId: String(commission._id),
        amount: String(amount),
        currency: commission.currency,
      }
    ).catch(() => {});

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
      // Retire de la liste du payout en cours ET décrémente le montant
      // total du payout (sinon l'affilié toucherait trop).
      await PayoutRequest.updateOne(
        { _id: commission.payoutRequest },
        {
          $pull: { commissionsIncluded: commission._id },
          $inc: { amount: -Math.abs(commission.amount) },
        }
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
   * Crée une PayoutRequest "queued" qui retire la totalité du solde
   * `available` de l'affilié dans la devise de son pays.
   *
   * Garde-fous :
   *   - User affilié actif, non suspendu
   *   - payoutMethod défini (operator + phoneNumber)
   *   - Pays activé dans la config
   *   - Pas de payout en cours (max concurrent)
   *   - Plafond mensuel (max payouts / mois)
   *   - Solde available > 0 et >= seuils config
   *
   * Lock atomique : toutes les commissions `available` du user en
   * `currency` passent en `locked` + reçoivent `payoutRequest = pr._id`.
   * Le worker (Phase 5) prend la PayoutRequest, appelle AfribaPay, et
   * passe en `paid` ou `awaiting_funds` selon le retour.
   */
  async requestPayout(user, opts = {}) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    if (user.affiliate.suspended) {
      throw new AppError(
        'Compte affilié suspendu.',
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    // Si pas encore de payoutMethod, on accepte les params {operator,
    // phoneNumber} dans le body et on les fixe à vie. Sinon on utilise
    // ceux déjà enregistrés (immuables).
    if (!user.affiliate.payoutMethod?.operator) {
      if (!opts.operator || !opts.phoneNumber) {
        throw new AppError(
          'Premier retrait : opérateur et numéro mobile money requis.',
          400,
          ErrorCodes.VALIDATION_ERROR
        );
      }
      user.affiliate.payoutMethod = {
        operator: opts.operator.toLowerCase().trim(),
        phoneNumber: opts.phoneNumber.trim(),
      };
      await user.save();
    }

    const { operator, phoneNumber } = user.affiliate.payoutMethod;

    const country = (user.affiliate.country || '').toUpperCase();
    if (!country) {
      throw new AppError(
        'Pays affilié non défini.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const config = await this.getOrCreateConfig(user.appId);
    const countryCfg = (config.payoutCountries || []).find(
      (c) => c.code === country && c.enabled !== false
    );
    if (!countryCfg) {
      throw new AppError(
        `Retraits non disponibles pour le pays ${country}.`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // === LOCK ATOMIQUE ANTI-DOUBLE RETRAIT ===
    // Empêche les race conditions multi-device : si 2 requêtes arrivent
    // simultanément, seule la première peut set activePayoutId. La 2e
    // se voit refuser. C'est plus robuste que countDocuments qui n'est
    // pas atomique.
    const newPayoutId = new mongoose.Types.ObjectId();
    const locked = await User.findOneAndUpdate(
      {
        _id: user._id,
        $or: [
          { 'affiliate.activePayoutId': null },
          { 'affiliate.activePayoutId': { $exists: false } },
        ],
      },
      { $set: { 'affiliate.activePayoutId': newPayoutId } },
      { new: false }
    );
    if (!locked) {
      throw new AppError(
        'Vous avez déjà une demande de retrait en cours.',
        409,
        ErrorCodes.DUPLICATE_OPERATION
      );
    }

    // À partir d'ici, en cas d'erreur on doit unset le lock pour ne pas
    // bloquer l'user à vie.
    try {
      // Plafonnement mensuel
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const monthCount = await PayoutRequest.countDocuments({
        appId: user.appId,
        user: user._id,
        requestedAt: { $gte: startOfMonth },
        status: { $ne: 'cancelled' },
      });
      if (monthCount >= (config.maxPayoutsPerMonthPerUser || 2)) {
        throw new AppError(
          'Plafond mensuel de retraits atteint.',
          429,
          ErrorCodes.RATE_LIMIT_EXCEEDED
        );
      }

      // Récupère toutes les commissions available dans la devise du pays
      const currency = countryCfg.currency;
      const commissions = await Commission.find({
        appId: user.appId,
        referrer: user._id,
        currency,
        status: 'available',
      })
        .sort({ createdAt: 1 })
        .lean();

      if (commissions.length === 0) {
        throw new AppError(
          'Aucune commission disponible au retrait.',
          400,
          ErrorCodes.VALIDATION_ERROR
        );
      }

      const totalAmount = commissions.reduce((s, c) => s + c.amount, 0);

      if (totalAmount < (countryCfg.minAmountForPayout || 0)) {
        throw new AppError(
          `Montant minimum de retrait : ${countryCfg.minAmountForPayout} ${currency}.`,
          400,
          ErrorCodes.VALIDATION_ERROR
        );
      }
      if (totalAmount > (countryCfg.maxAmountForPayout || Infinity)) {
        throw new AppError(
          `Montant maximum de retrait : ${countryCfg.maxAmountForPayout} ${currency}.`,
          400,
          ErrorCodes.VALIDATION_ERROR
        );
      }

      // Crée la PayoutRequest puis lock les commissions atomiquement.
      // afribaPayOrderId est set DANS le create() (et pas via un save()
      // séparé) pour que le webhook puisse le matcher dès l'instant t0
      // — pas de race window entre create et update.
      const commissionIds = commissions.map((c) => c._id);

      const pr = await PayoutRequest.create({
        _id: newPayoutId,
        appId: user.appId,
        user: user._id,
        amount: totalAmount,
        currency,
        country,
        operator,
        phoneNumber,
        status: 'queued',
        commissionsIncluded: commissionIds,
        requestedAt: new Date(),
        afribaPayOrderId: `payout-${newPayoutId}`,
        attempts: [
          {
            type: 'request',
            status: 'queued',
            actor: String(user._id),
            payload: { amount: totalAmount, currency, operator, phoneNumber },
          },
        ],
      });

      // Lock les commissions
      await Commission.updateMany(
        { _id: { $in: commissionIds }, status: 'available' },
        { $set: { status: 'locked', payoutRequest: pr._id } }
      );

      // Email admin (fire-and-forget — ne casse pas la requête en cas d'échec)
      this._notifyAdminNewPayout(pr, user).catch((err) => {
        console.error(
          '[affiliateService] notify admin failed:',
          err?.message || err
        );
      });

      return pr;
    } catch (err) {
      // Si quoi que ce soit échoue après le lock, on libère le User pour
      // qu'il puisse re-essayer. Sinon il serait coincé à vie.
      await User.findOneAndUpdate(
        { _id: user._id, 'affiliate.activePayoutId': newPayoutId },
        { $unset: { 'affiliate.activePayoutId': '' } }
      ).catch(() => {});
      throw err;
    }
  }

  /**
   * Envoie une push notification OneSignal à l'affilié. Récupère ses
   * Devices actifs avec playerId puis appelle notificationService. Fail
   * silently — on ne casse pas le flow si la notif échoue.
   */
  async _notifyAffiliate(affiliateUserId, appId, headings, contents, data = {}) {
    try {
      const devices = await Device.find({
        appId,
        user: affiliateUserId,
        isActive: true,
        playerId: { $exists: true, $ne: null },
      })
        .select('playerId')
        .lean();
      const playerIds = devices.map((d) => d.playerId).filter(Boolean);
      if (playerIds.length === 0) return; // pas de device → silent
      await notificationService.sendToUsers(appId, playerIds, {
        headings,
        contents,
        data,
      });
    } catch (err) {
      console.warn(
        '[affiliateService] _notifyAffiliate failed:',
        err?.message || err
      );
    }
  }

  /**
   * Envoie un email à l'admin pour notifier d'une nouvelle demande de
   * retrait. L'email destinataire est `process.env.AFFILIATE_NOTIFY_EMAIL`
   * (avec fallback sur SMTP_FROM ou un email codé à part). En cas
   * d'échec, on log silencieusement — le retrait n'est pas annulé.
   */
  async _notifyAdminNewPayout(pr, user) {
    const to =
      process.env.AFFILIATE_NOTIFY_EMAIL ||
      process.env.ADMIN_EMAIL ||
      process.env.SUPPORT_EMAIL ||
      process.env.SMTP_FROM;
    if (!to) {
      console.warn(
        '[affiliateService] AFFILIATE_NOTIFY_EMAIL non configuré — email admin skip'
      );
      return;
    }

    const fmtAmount = `${pr.amount} ${pr.currency}`;
    const subject = `[${pr.appId.toUpperCase()}] Nouvelle demande de retrait — ${fmtAmount}`;

    const html = `
      <h2 style="margin:0 0 16px">Nouvelle demande de retrait affilié</h2>
      <table cellpadding="6" cellspacing="0" border="0" style="font-family:system-ui,sans-serif;border-collapse:collapse">
        <tr><td><strong>App</strong></td><td>${pr.appId}</td></tr>
        <tr><td><strong>Affilié</strong></td><td>${user.pseudo || '—'} (${user.email || user.phoneNumber || '—'})</td></tr>
        <tr><td><strong>Identité affilié</strong></td><td>${user.affiliate?.firstName || ''} ${user.affiliate?.lastName || ''}</td></tr>
        <tr><td><strong>Code</strong></td><td><code>${user.affiliate?.code || '—'}</code></td></tr>
        <tr><td><strong>Pays</strong></td><td>${pr.country}</td></tr>
        <tr><td><strong>Montant</strong></td><td><strong style="font-size:1.2em">${fmtAmount}</strong></td></tr>
        <tr><td><strong>Mobile money</strong></td><td>${pr.operator} · ${pr.phoneNumber}</td></tr>
        <tr><td><strong>PayoutRequest ID</strong></td><td><code>${pr._id}</code></td></tr>
        <tr><td><strong>Demandé le</strong></td><td>${new Date(pr.requestedAt).toISOString()}</td></tr>
      </table>
      <p style="margin-top:24px">
        <strong>Action requise :</strong> Effectue le virement manuel via AfribaPay
        sur le numéro indiqué, puis valide ou rejette la demande dans le backoffice
        admin → Affiliations → Retraits.
      </p>
    `;

    await mailService.sendAlert({ to, subject, html });
  }

  /**
   * Détail d'une PayoutRequest de l'affilié. Inclut les commissions
   * incluses dans le payout (avec le filleul source pour chacune)
   * et les attempts récents (audit trail simplifié).
   *
   * Sécurité : vérifie que la PayoutRequest appartient bien au user
   * courant.
   */
  async getMyPayoutDetail(user, payoutId) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const pr = await PayoutRequest.findOne({
      _id: payoutId,
      appId: user.appId,
      user: user._id,
    }).lean();

    if (!pr) {
      throw new AppError('Demande introuvable.', 404, ErrorCodes.NOT_FOUND);
    }

    // Charger les commissions liées (avec referee pseudo pour l'UI)
    const commissions = await Commission.find({
      _id: { $in: pr.commissionsIncluded || [] },
    })
      .populate('referee', 'pseudo countryCode')
      .sort({ createdAt: 1 })
      .lean();

    // Audit trail simplifié — on cache les payloads internes (parfois
    // sensibles) et on garde juste les types et statuts.
    const auditTrail = (pr.attempts || []).map((a) => ({
      at: a.at,
      type: a.type,
      status: a.status,
      actor: a.actor,
      error: a.error || null,
    }));

    return {
      _id: pr._id,
      amount: pr.amount,
      currency: pr.currency,
      country: pr.country,
      operator: pr.operator,
      phoneNumber: pr.phoneNumber,
      status: pr.status,
      requestedAt: pr.requestedAt,
      paidAt: pr.paidAt || null,
      cancelledAt: pr.cancelledAt || null,
      cancelReason: pr.cancelReason || null,
      failureReason: pr.failureReason || null,
      afribaPayTransactionId: pr.afribaPayTransactionId || null,
      commissions: commissions.map((c) => ({
        _id: c._id,
        amount: c.amount,
        currency: c.currency,
        rate: c.commissionRate,
        status: c.status,
        createdAt: c.createdAt,
        referee: c.referee
          ? {
              pseudo: c.referee.pseudo,
              country: c.referee.countryCode,
            }
          : null,
      })),
      attempts: auditTrail,
    };
  }

  /**
   * Liste paginée des PayoutRequest de l'affilié.
   */
  async listMyPayouts(user, { page = 1, limit = 20, status } = {}) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const filter = { appId: user.appId, user: user._id };
    if (status) filter.status = status;

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      PayoutRequest.find(filter)
        .select(
          'amount currency country operator phoneNumber status requestedAt paidAt failureReason afribaPayTransactionId'
        )
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayoutRequest.countDocuments(filter),
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

  /**
   * Détail d'une commission de l'affilié. Inclut le filleul source, la
   * subscription qui l'a générée, et le payout associé si elle est en
   * cours d'encaissement (status=locked|paid).
   *
   * Sécurité : vérifie que la commission appartient bien au user courant
   * pour ne pas leak des montants entre affiliés.
   */
  async getCommissionDetail(user, commissionId) {
    if (!user.affiliate?.isActive) {
      throw new AppError(
        "Vous n'êtes pas affilié.",
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const com = await Commission.findOne({
      _id: commissionId,
      appId: user.appId,
      referrer: user._id,
    })
      .populate(
        'referee',
        'pseudo email phoneNumber dialCode countryCode createdAt'
      )
      .lean();

    if (!com) {
      throw new AppError('Commission introuvable.', 404, ErrorCodes.NOT_FOUND);
    }

    const Subscription = require('../../models/common/Subscription');
    const sub = com.subscription
      ? await Subscription.findById(com.subscription)
          .populate('package', 'name')
          .lean()
      : null;

    let payout = null;
    if (com.payoutRequest) {
      const PayoutRequest = require('../../models/affiliate/PayoutRequest');
      payout = await PayoutRequest.findById(com.payoutRequest)
        .select(
          'amount currency status requestedAt paidAt operator phoneNumber'
        )
        .lean();
    }

    // Helpers de masquage (mêmes règles que getReferralDetail)
    const maskedEmail = (e) => {
      if (!e || typeof e !== 'string' || !e.includes('@')) return null;
      const [local, domain] = e.split('@');
      return `${local.slice(0, 1)}${'*'.repeat(
        Math.max(2, local.length - 1)
      )}@${domain}`;
    };
    const maskedPhone = (dial, phone) => {
      if (!phone) return null;
      const tail = phone.slice(-2);
      const masked = '*'.repeat(Math.max(0, phone.length - 2)) + tail;
      return dial ? `${dial} ${masked}` : masked;
    };

    // Extraction de packageName depuis l'objet bilingue
    const pkgName = sub?.package?.name;
    const packageNameStr =
      (pkgName && typeof pkgName === 'object'
        ? pkgName.fr || pkgName.en
        : pkgName) || null;

    return {
      _id: com._id,
      amount: com.amount,
      currency: com.currency,
      rate: com.commissionRate,
      status: com.status,
      createdAt: com.createdAt,
      paidAt: com.paidAt || null,
      cancelledAt: com.cancelledAt || null,
      cancelReason: com.cancelReason || null,
      referee: com.referee
        ? {
            pseudo: com.referee.pseudo,
            country: com.referee.countryCode,
            email: maskedEmail(com.referee.email),
            phoneNumber: maskedPhone(
              com.referee.dialCode,
              com.referee.phoneNumber
            ),
            joinedAt: com.referee.createdAt,
          }
        : null,
      subscription: sub
        ? {
            _id: sub._id,
            packageName: packageNameStr,
            amount: sub.pricing?.amount || 0,
            currency: sub.pricing?.currency || null,
            startedAt: sub.startDate || sub.createdAt,
            expiresAt: sub.endDate || null,
            status: sub.status || null,
          }
        : null,
      payout: payout
        ? {
            _id: payout._id,
            amount: payout.amount,
            currency: payout.currency,
            status: payout.status,
            requestedAt: payout.requestedAt,
            paidAt: payout.paidAt || null,
            operator: payout.operator,
            phoneNumber: maskedPhone(null, payout.phoneNumber),
          }
        : null,
    };
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
