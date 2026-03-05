// controllers/user/cinetpayController.js
const cinetpayService = require('../../services/user/CinetpayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');
const CinetpayTransaction = require('../../models/user/CinetpayTransaction');

// ---------------------------------------------
//  INITIER UN PAIEMENT
// ---------------------------------------------
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId, phoneNumber } = req.body;
  const { appId, currentApp } = req;

  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!packageId || !phoneNumber) {
    return next(new AppError('packageId et phoneNumber sont requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!currentApp?.payments?.cinetpay?.enabled) {
    return next(new AppError('CinetPay non active pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Verifier abonnement actif
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubs = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActive  = activeSubs.some(sub => sub.package?._id.toString() === packageId);
  if (hasActive) {
    return next(new AppError('Vous avez deja un abonnement actif pour ce package', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const result = await cinetpayService.initiatePayment(
    appId,
    currentApp,
    req.user,
    packageId,
    phoneNumber
  );

  res.status(201).json({
    success: true,
    message: 'Paiement initie avec succes',
    data: {
      transaction: {
        transactionId: result.transaction.transactionId,
        amount:        result.transaction.amount,
        currency:      result.transaction.currency,
        status:        result.transaction.status,
        phoneNumber:   result.transaction.phoneNumber,
        package:       result.transaction.package
      },
      paymentUrl: result.paymentUrl
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
  if (!currentApp?.payments?.cinetpay?.enabled) {
    return next(new AppError('CinetPay non active pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const transaction = await cinetpayService.checkTransactionStatus(appId, currentApp, transactionId);

  // Verifier que la transaction appartient a l'utilisateur
  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisee', 403, ErrorCodes.UNAUTHORIZED));
  }

  // Activer l'abonnement si SUCCESS
  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(appId, transaction);
  } catch (err) {
    console.error('[CinetPay] Erreur processTransactionUpdate:', err.message);
  }

  res.status(200).json({
    success: true,
    data: {
      transaction: {
        transactionId: transaction.transactionId,
        status:        transaction.status,
        amount:        transaction.amount,
        currency:      transaction.currency,
        paymentMethod: transaction.paymentMethod,
        processed:     transaction.processed,
        createdAt:     transaction.createdAt,
        package:       transaction.package
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
//  WEBHOOK (notify_url)
// ---------------------------------------------
exports.webhook = catchAsync(async (req, res, next) => {
  console.log('=== WEBHOOK CINETPAY RECU ===');
  console.log('Body:', JSON.stringify(req.body));

  const { notify_token, merchant_transaction_id } = req.body;

  if (!notify_token || !merchant_transaction_id) {
    console.error('[Webhook] Champs manquants:', req.body);
    return res.status(200).json({ success: false, message: 'Champs manquants' });
  }

  try {
    // 1. Trouver la transaction
    const transaction = await CinetpayTransaction.findOne({ transactionId: merchant_transaction_id })
      .populate(['package', 'user']);

    if (!transaction) {
      console.error(`[Webhook] Transaction ${merchant_transaction_id} non trouvee`);
      return res.status(200).json({ success: false, message: 'Transaction non trouvee' });
    }

    // 2. Valider le notify_token (securite anti-fraude)
    if (transaction.notifyToken !== notify_token) {
      console.error(`[Webhook] notify_token invalide pour ${merchant_transaction_id}`);
      return res.status(200).json({ success: false, message: 'Token invalide' });
    }

    // 3. Eviter le double traitement
    if (transaction.processed) {
      console.log(`[Webhook] ${merchant_transaction_id} deja traite`);
      return res.status(200).json({ success: true, message: 'Deja traite' });
    }

    // 4. Recuperer l'app
    const currentApp = await App.findOne({ appId: transaction.appId, isActive: true }).lean();
    if (!currentApp) {
      console.error(`[Webhook] App ${transaction.appId} non trouvee`);
      return res.status(200).json({ success: false, message: 'App non trouvee' });
    }

    // 5. Verifier le statut final via l'API (ne jamais faire confiance au webhook seul)
    const updatedTransaction = await cinetpayService.checkTransactionStatus(
      transaction.appId,
      currentApp,
      transaction.transactionId
    );

    console.log(`[Webhook] Statut final: ${updatedTransaction.status}`);

    // 6. Activer l'abonnement si SUCCESS
    if (updatedTransaction.status === 'SUCCESS') {
      await paymentMiddleware.processTransactionUpdate(transaction.appId, updatedTransaction);
    }

    return res.status(200).json({ success: true, message: 'Webhook traite' });

  } catch (error) {
    console.error('[Webhook] Erreur:', error.message);
    // Toujours repondre 200 a CinetPay pour eviter les relances infinies
    return res.status(200).json({ success: false, message: error.message });
  }
});

// ---------------------------------------------
//  PAGE RETOUR SUCCESS (success_url)
// ---------------------------------------------
exports.paymentSuccess = catchAsync(async (req, res, next) => {
  const { transaction_id } = req.method === 'GET' ? req.query : req.body;

  if (!transaction_id) {
    return res.status(400).send(renderPage('Erreur', `
      <div class="icon">❌</div>
      <h1 class="error">Parametres manquants</h1>
      <p>Veuillez reessayer ou contacter le support.</p>
    `));
  }

  const transactionDoc = await CinetpayTransaction.findOne({ transactionId: transaction_id });
  if (!transactionDoc) {
    return res.status(404).send(renderPage('Erreur', `
      <div class="icon">❌</div><h1 class="error">Transaction introuvable</h1>
    `));
  }

  const currentApp = await App.findOne({ appId: transactionDoc.appId, isActive: true }).lean();
  if (!currentApp) {
    return res.status(404).send(renderPage('Erreur', `
      <div class="icon">❌</div><h1 class="error">Application introuvable</h1>
    `));
  }

  let tx;
  try {
    tx = await cinetpayService.checkTransactionStatus(transactionDoc.appId, currentApp, transaction_id);
    await paymentMiddleware.processTransactionUpdate(transactionDoc.appId, tx);
  } catch (err) {
    console.error('[Success] Erreur verification:', err.message);
  }

  const status = tx?.status || transactionDoc.status;
  let content;

  if (status === 'SUCCESS') {
    content = `
      <div class="icon">🎉</div>
      <h1 class="success">Paiement Reussi !</h1>
      <div class="badge badge-success">✅ Confirme</div>
      <p>Votre abonnement <strong>${tx?.package?.name?.fr || ''}</strong> est maintenant actif.</p>
      <div class="details">
        <p><strong>Transaction:</strong> <span class="txid">${transaction_id}</span></p>
        <p><strong>Montant:</strong> <span class="amount">${tx?.amount} ${tx?.currency}</span></p>
      </div>
      <p>Vous pouvez retourner sur l'application.</p>
    `;
  } else if (status === 'FAILED') {
    content = `
      <div class="icon">❌</div>
      <h1 class="error">Paiement Echoue</h1>
      <div class="badge badge-error">❌ Refuse</div>
      <p>Votre paiement n'a pas pu etre traite.</p>
      <div class="txid">${transaction_id}</div>
      <p>Veuillez reessayer ou contacter le support.</p>
    `;
  } else {
    content = `
      <div class="icon">⏳</div>
      <h1 class="pending">Paiement En Attente</h1>
      <div class="badge badge-pending">⏳ En cours</div>
      <p>Votre paiement est en cours de traitement.</p>
      <div class="txid">${transaction_id}</div>
      <p>Vous recevrez une notification des confirmation.</p>
    `;
  }

  return res.send(renderPage(`CinetPay - ${status}`, content));
});

// ---------------------------------------------
//  PAGE RETOUR FAILED (failed_url)
// ---------------------------------------------
exports.paymentFailed = catchAsync(async (req, res, next) => {
  const { transaction_id } = req.method === 'GET' ? req.query : req.body;

  return res.send(renderPage('CinetPay - Echec', `
    <div class="icon">❌</div>
    <h1 class="error">Paiement Echoue</h1>
    <div class="badge badge-error">❌ Refuse</div>
    <p>Votre paiement n'a pas abouti.</p>
    ${transaction_id ? `<div class="txid">${transaction_id}</div>` : ''}
    <p>Veuillez reessayer ou contacter le support.</p>
  `));
});

// ---------------------------------------------
//  HTML helper
// ---------------------------------------------
function renderPage(title, content) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:linear-gradient(135deg,#667eea,#764ba2);
      min-height:100vh;display:flex;align-items:center;
      justify-content:center;padding:16px}
    .container{background:#fff;border-radius:16px;
      box-shadow:0 8px 32px rgba(0,0,0,.15);
      width:100%;max-width:400px;padding:24px;text-align:center}
    h1{font-size:1.5rem;margin-bottom:16px;font-weight:600}
    p{font-size:.95rem;color:#666;margin-bottom:12px}
    .success{color:#10b981}.error{color:#ef4444}
    .pending{color:#6366f1}
    .details{background:#f8fafc;border:1px solid #e2e8f0;
      border-radius:12px;padding:16px;margin:20px 0;text-align:left}
    .details p{margin-bottom:8px;font-size:.9rem;color:#374151}
    .icon{font-size:2rem;margin-bottom:12px}
    .txid{font-family:monospace;background:#f1f5f9;
      padding:6px 12px;border-radius:6px;font-size:.85rem;
      color:#475569;display:inline-block;margin:8px 0}
    .amount{font-size:1.1rem;font-weight:600;color:#1f2937}
    .badge{display:inline-block;padding:4px 12px;
      border-radius:20px;font-size:.8rem;font-weight:500;margin:8px 0}
    .badge-success{background:#d1fae5;color:#065f46}
    .badge-error{background:#fee2e2;color:#991b1b}
    .badge-pending{background:#e0e7ff;color:#3730a3}
  </style>
</head>
<body>
  <div class="container">${content}</div>
</body>
</html>`;
}

module.exports = {
  initiatePayment: exports.initiatePayment,
  checkStatus:     exports.checkStatus,
  webhook:         exports.webhook,
  paymentSuccess:  exports.paymentSuccess,
  paymentFailed:   exports.paymentFailed
};