// controllers/user/intouchController.js
//
// Controller InTouch / TouchPay — Paiement Marchand (C2B).
// Routes :
//   POST /payments/intouch/initiate           (auth user)
//   GET  /payments/intouch/status/:id         (auth user)
//   POST /payments/intouch/webhook            (public — InTouch callback)
//
// Note : pas de page success/failed HTML. InTouch est full-API (push USSD
// au telephone du client), il n'y a aucune redirection navigateur.

const intouchService = require('../../services/user/IntouchService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');
const IntouchTransaction = require('../../models/user/IntouchTransaction');

// ---------------------------------------------
//  INITIER UN PAIEMENT
// ---------------------------------------------
exports.initiatePayment = catchAsync(async (req, res, next) => {
  // `country` est OPTIONNEL : si absent, le service le deduit du `phoneNumber`
  // (prefixe ITU). Le fournir explicitement (ISO-2) est utile quand le numero
  // est ambigu ou quand le mobile veut forcer un pays specifique.
  const { packageId, phoneNumber, operator, country } = req.body;
  const { appId, currentApp } = req;

  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!packageId || !phoneNumber || !operator) {
    return next(new AppError('packageId, phoneNumber et operator sont requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!currentApp?.payments?.intouch?.enabled) {
    return next(new AppError('InTouch non actif pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Verifier abonnement actif
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubs = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActive = activeSubs.some(sub => sub.package?._id.toString() === packageId);
  if (hasActive) {
    return next(new AppError('Vous avez deja un abonnement actif pour ce package', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const result = await intouchService.initiatePayment(
    appId, currentApp, req.user, packageId, phoneNumber, operator, country
  );

  res.status(201).json({
    success: true,
    message: 'Paiement initie — un push USSD a ete envoye sur le telephone du client',
    data: {
      transaction: {
        transactionId:        result.transaction.transactionId,
        gutouchTransactionId: result.transaction.gutouchTransactionId,
        amount:               result.transaction.amount,
        currency:             result.transaction.currency,
        status:               result.transaction.status,
        operator:             result.transaction.operator,
        countryCode:          result.transaction.countryCode,
        recipientNumber:      result.transaction.recipientNumber,
        package:              result.transaction.package
      }
    }
  });
});

// ---------------------------------------------
//  VERIFIER LE STATUT
// ---------------------------------------------
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { transactionId } = req.params;
  const { appId, currentApp } = req;

  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!currentApp?.payments?.intouch?.enabled) {
    return next(new AppError('InTouch non actif pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const transaction = await intouchService.checkTransactionStatus(appId, currentApp, transactionId);

  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisee', 403, ErrorCodes.UNAUTHORIZED));
  }

  // Activer abonnement si SUCCESS (idempotent — processed flag dans paymentMiddleware)
  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(appId, transaction);
  } catch (err) {
    console.error('[InTouch] Erreur processTransactionUpdate:', err.message);
  }

  res.status(200).json({
    success: true,
    data: {
      transaction: {
        transactionId:    transaction.transactionId,
        status:           transaction.status,
        amount:           transaction.amount,
        currency:         transaction.currency,
        operator:         transaction.operator,
        countryCode:      transaction.countryCode,
        recipientNumber:  transaction.recipientNumber,
        processed:        transaction.processed,
        createdAt:        transaction.createdAt,
        package:          transaction.package
      },
      subscription: subscription ? {
        id:        subscription._id,
        startDate: subscription.startDate,
        endDate:   subscription.endDate,
        status:    subscription.status
      } : null
    }
  });
});

// ---------------------------------------------
//  WEBHOOK (callback InTouch)
//
//  InTouch ne signe PAS les webhooks → on ne fait JAMAIS confiance au body.
//  On utilise uniquement `partner_transaction_id` pour identifier la transaction,
//  puis on rappelle check_status (authentifie HTTP Basic) pour determiner
//  le vrai statut final. Sans cette etape, n'importe qui pourrait forger
//  un POST vers /webhook et faire passer un paiement en SUCCESS.
// ---------------------------------------------
exports.webhook = catchAsync(async (req, res, next) => {
  console.log('=== WEBHOOK INTOUCH RECU ===');
  console.log('Body:', JSON.stringify(req.body));

  const { partner_transaction_id, gu_transaction_id, status: webhookStatus, message } = req.body || {};

  if (!partner_transaction_id) {
    console.error('[Webhook InTouch] partner_transaction_id manquant');
    return res.status(200).json({ success: false, message: 'partner_transaction_id manquant' });
  }

  try {
    // 1. Trouver la transaction
    const transaction = await IntouchTransaction.findOne({ transactionId: partner_transaction_id });
    if (!transaction) {
      console.error(`[Webhook InTouch] Transaction ${partner_transaction_id} non trouvee`);
      return res.status(200).json({ success: false, message: 'Transaction non trouvee' });
    }

    // 2. Eviter le double traitement (idempotency)
    if (transaction.processed) {
      console.log(`[Webhook InTouch] ${partner_transaction_id} deja traite`);
      return res.status(200).json({ success: true, message: 'Deja traite' });
    }

    // 3. Recuperer l'app
    const currentApp = await App.findOne({ appId: transaction.appId, isActive: true }).lean();
    if (!currentApp) {
      console.error(`[Webhook InTouch] App ${transaction.appId} non trouvee`);
      return res.status(200).json({ success: false, message: 'App non trouvee' });
    }

    // 4. Verifier le statut FINAL via check_status — ne JAMAIS faire confiance
    //    au body du webhook (pas de signature → spoofing trivial).
    const updatedTransaction = await intouchService.checkTransactionStatus(
      transaction.appId, currentApp, transaction.transactionId
    );

    console.log(`[Webhook InTouch] Statut webhook=${webhookStatus} → check_status=${updatedTransaction.status}`);

    // 5. Dispatch (SUCCESS → cree subscription, FAILED → notification echec)
    if (updatedTransaction.status === 'SUCCESS' || updatedTransaction.status === 'FAILED') {
      await paymentMiddleware.processTransactionUpdate(transaction.appId, updatedTransaction);
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook traite',
      status:  updatedTransaction.status
    });
  } catch (error) {
    console.error('[Webhook InTouch] Erreur:', error.message);
    // Toujours repondre 200 pour eviter les relances infinies de InTouch
    return res.status(200).json({ success: false, message: error.message });
  }
});

module.exports = {
  initiatePayment: exports.initiatePayment,
  checkStatus:     exports.checkStatus,
  webhook:         exports.webhook
};
