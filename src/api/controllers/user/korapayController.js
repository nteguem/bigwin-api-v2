// src/api/controllers/user/korapayController.js

const korapayService = require('../../services/user/KorapayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');
const KorapayTransaction = require('../../models/user/KorapayTransaction');

/**
 * Initier un paiement KoraPay (Checkout)
 */
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId, currency, phone } = req.body;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError(
      'Header X-App-Id requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Validation
  if (!packageId || !currency) {
    return next(new AppError(
      'packageId et currency sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que KoraPay est activé pour cette app
  if (!currentApp?.payments?.korapay?.enabled) {
    return next(new AppError(
      'KoraPay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier si l'utilisateur a déjà un abonnement actif pour ce package
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubscriptions = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActivePackage = activeSubscriptions.some(sub => 
    sub.package._id.toString() === packageId
  );

  if (hasActivePackage) {
    return next(new AppError(
      'Vous avez déjà un abonnement actif pour ce package',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Récupérer automatiquement les données utilisateur
  const customerName = req.user.pseudo || req.user.name || req.user.username || 'Utilisateur';
  const customerEmail = req.user.email || `user_${req.user._id}@temp.app`;
  const customerPhone = phone || req.user.phone || null;

  // Option: merchant bears cost (peut être passé en paramètre)
  const merchantBearsCost = req.body.merchantBearsCost || false;

  const result = await korapayService.initiatePayment(
    appId,
    currentApp,
    req.user._id,
    packageId,
    currency,
    customerName,
    customerEmail,
    customerPhone,
    merchantBearsCost
  );

  res.status(201).json({
    success: true,
    message: 'Paiement initié avec succès',
    data: {
      transaction: {
        transactionId: result.transaction.transactionId,
        reference: result.transaction.reference,
        korapayReference: result.transaction.korapayReference,
        amount: result.transaction.amount,
        currency: result.transaction.currency,
        status: result.transaction.status,
        customerName: result.transaction.customerName,
        customerEmail: result.transaction.customerEmail,
        package: result.transaction.package
      },
      checkoutUrl: result.checkoutUrl
    }
  });
});

/**
 * Initier un paiement Mobile Money direct
 */
exports.initiateMobileMoneyPayment = catchAsync(async (req, res, next) => {
  const { packageId, currency, mobileNumber } = req.body;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError(
      'Header X-App-Id requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Validation
  if (!packageId || !currency || !mobileNumber) {
    return next(new AppError(
      'packageId, currency et mobileNumber sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que KoraPay est activé
  if (!currentApp?.payments?.korapay?.enabled) {
    return next(new AppError(
      'KoraPay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier si l'utilisateur a déjà un abonnement actif
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubscriptions = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActivePackage = activeSubscriptions.some(sub => 
    sub.package._id.toString() === packageId
  );

  if (hasActivePackage) {
    return next(new AppError(
      'Vous avez déjà un abonnement actif pour ce package',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Récupérer les données utilisateur
  const customerName = req.user.pseudo || req.user.name || req.user.username || 'Utilisateur';
  const customerEmail = req.user.email || `user_${req.user._id}@temp.app`;
  const merchantBearsCost = req.body.merchantBearsCost || false;

  const result = await korapayService.initiateMobileMoneyPayment(
    appId,
    currentApp,
    req.user._id,
    packageId,
    currency,
    mobileNumber,
    customerName,
    customerEmail,
    merchantBearsCost
  );

  res.status(201).json({
    success: true,
    message: 'Paiement Mobile Money initié avec succès',
    data: {
      transaction: {
        transactionId: result.transaction.transactionId,
        reference: result.transaction.reference,
        korapayReference: result.transaction.korapayReference,
        amount: result.transaction.amount,
        currency: result.transaction.currency,
        status: result.transaction.status,
        authModel: result.authModel,
        package: result.transaction.package
      },
      authModel: result.authModel,
      message: result.message
    }
  });
});

/**
 * Vérifier le statut d'un paiement
 */
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { reference } = req.params;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError(
      'Header X-App-Id requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que KoraPay est activé
  if (!currentApp?.payments?.korapay?.enabled) {
    return next(new AppError(
      'KoraPay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  const transaction = await korapayService.checkTransactionStatus(appId, currentApp, reference);

  // Vérifier que la transaction appartient à l'utilisateur
  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisée', 403, ErrorCodes.UNAUTHORIZED));
  }

  // Traiter la transaction si le statut a changé
  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(appId, transaction);
  } catch (error) {
    console.error('[KoraPay] Error processing transaction update:', error.message);
  }

  res.status(200).json({
    success: true,
    data: {
      transaction: {
        transactionId: transaction.transactionId,
        reference: transaction.reference,
        korapayReference: transaction.korapayReference,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        paymentMethod: transaction.paymentMethod,
        processed: transaction.processed,
        createdAt: transaction.createdAt,
        package: transaction.package
      },
      subscription: subscription ? {
        id: subscription._id,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status
      } : null
    }
  });
});

/**
 * Webhook KoraPay
 */
exports.webhook = catchAsync(async (req, res, next) => {
  const receivedSignature = req.headers['x-korapay-signature'];
  const webhookBody = req.body;

  console.log('=== WEBHOOK KORAPAY REÇU ===');
  console.log('Signature:', receivedSignature);
  console.log('Event:', webhookBody.event);

  if (!receivedSignature) {
    console.error('[Webhook KoraPay] Signature manquante');
    return res.status(200).json({ received: true }); // Retourner 200 pour éviter les retry
  }

  if (!webhookBody.data || !webhookBody.data.payment_reference) {
    console.error('[Webhook KoraPay] Données webhook invalides');
    return res.status(200).json({ received: true });
  }

  try {
    const paymentReference = webhookBody.data.payment_reference;
    
    // Chercher la transaction par référence (sans appId d'abord)
    const transaction = await KorapayTransaction.findOne({
      $or: [
        { reference: paymentReference },
        { transactionId: paymentReference },
        { korapayReference: paymentReference }
      ]
    }).populate(['package', 'user']);

    if (!transaction) {
      console.error(`[Webhook KoraPay] Transaction non trouvée pour reference: ${paymentReference}`);
      return res.status(200).json({ received: true });
    }

    // Récupérer l'appId depuis la transaction
    const appId = transaction.appId;
    console.log(`[Webhook KoraPay] AppId récupéré: ${appId}`);

    // Récupérer l'app depuis la base
    const currentApp = await App.findOne({ appId, isActive: true }).lean();

    if (!currentApp) {
      console.error(`[Webhook KoraPay] App ${appId} non trouvée`);
      return res.status(200).json({ received: true });
    }

    // Vérifier que KoraPay est activé
    if (!currentApp?.payments?.korapay?.enabled) {
      console.error(`[Webhook KoraPay] KoraPay non activé pour app ${appId}`);
      return res.status(200).json({ received: true });
    }

    // Vérifier la signature
    const config = korapayService.getConfig(currentApp);
    const isValid = korapayService.verifyWebhookSignature(
      receivedSignature,
      webhookBody.data,
      config.secretKey
    );

    if (!isValid) {
      console.error('[Webhook KoraPay] Signature invalide');
      return res.status(200).json({ received: true });
    }

    console.log(`[Webhook KoraPay] Signature valide pour transaction ${transaction.transactionId}`);

    // Enregistrer le webhook dans la transaction
    await transaction.recordWebhook(webhookBody);
    
    console.log(`[Webhook KoraPay] Webhook enregistré, statut: ${transaction.status}`);

    // Traiter la transaction via le middleware
    await paymentMiddleware.processTransactionUpdate(appId, transaction);

    res.status(200).json({
      success: true,
      message: 'Webhook traité avec succès'
    });

  } catch (error) {
    console.error('[Webhook KoraPay] Erreur:', error.message);
    console.error('Error stack:', error.stack);
    
    // Toujours retourner 200 pour éviter les retry de KoraPay
    res.status(200).json({
      success: false,
      message: 'Erreur lors du traitement du webhook',
      error: error.message
    });
  }
});

/**
 * Callback après paiement (redirect_url)
 */
exports.paymentCallback = catchAsync(async (req, res, next) => {
  const { reference } = req.query;

  console.log('=== CALLBACK KORAPAY ===');
  console.log('Reference:', reference);

  if (!reference) {
    const errorContent = `
      <div class="icon">❌</div>
      <h1 class="error">Erreur</h1>
      <p>Référence de transaction manquante.</p>
      <p>Veuillez réessayer ou contacter le support.</p>
    `;
    return res.status(400).send(getHtmlTemplate('KoraPay - Erreur', errorContent));
  }

  // Récupérer la transaction pour obtenir l'appId
  const transactionForApp = await KorapayTransaction.findOne({
    $or: [
      { reference },
      { transactionId: reference },
      { korapayReference: reference }
    ]
  });

  if (!transactionForApp) {
    const errorContent = `
      <div class="icon">❌</div>
      <h1 class="error">Erreur</h1>
      <p>Transaction non trouvée.</p>
      <p>Référence: <span class="transaction-id">${reference}</span></p>
    `;
    return res.status(404).send(getHtmlTemplate('KoraPay - Erreur', errorContent));
  }

  const appId = transactionForApp.appId;

  // Récupérer l'app
  const currentApp = await App.findOne({ appId, isActive: true }).lean();

  if (!currentApp) {
    const errorContent = `
      <div class="icon">❌</div>
      <h1 class="error">Erreur</h1>
      <p>Application non trouvée.</p>
    `;
    return res.status(404).send(getHtmlTemplate('KoraPay - Erreur', errorContent));
  }

  // Vérifier que KoraPay est activé
  if (!currentApp?.payments?.korapay?.enabled) {
    const errorContent = `
      <div class="icon">❌</div>
      <h1 class="error">Erreur</h1>
      <p>KoraPay n'est pas activé pour cette application.</p>
    `;
    return res.status(400).send(getHtmlTemplate('KoraPay - Erreur', errorContent));
  }

  let transactionStatus;
  let errorOccurred = false;

  try {
    // Vérifier le statut de la transaction
    transactionStatus = await korapayService.checkTransactionStatus(appId, currentApp, reference);
    
    // Traiter la transaction
    await paymentMiddleware.processTransactionUpdate(appId, transactionStatus);
  } catch (error) {
    console.error('[KoraPay Callback] Erreur lors de la vérification:', error.message);
    errorOccurred = true;
  }

  // Générer le contenu HTML selon le statut
  let content;

  if (errorOccurred) {
    content = `
      <div class="icon">⏳</div>
      <h1 class="warning">Vérification en cours</h1>
      <p>Nous vérifions le statut de votre paiement...</p>
      <p>Vous recevrez une notification dès que le traitement sera terminé.</p>
      <div class="transaction-id">${reference}</div>
    `;
  } else if (transactionStatus.status === 'SUCCESS') {
    content = `
      <div class="icon">🎉</div>
      <h1 class="success">Paiement Réussi !</h1>
      <div class="status-badge status-success">✅ Confirmé</div>
      <p>Votre abonnement <strong>${transactionStatus.package.name.fr || transactionStatus.package.name.en}</strong> a été activé avec succès.</p>
      
      <div class="details">
        <p><strong>Référence:</strong> <span class="transaction-id">${reference}</span></p>
        <p><strong>Montant:</strong> <span class="amount">${transactionStatus.amount} ${transactionStatus.currency}</span></p>
        <p><strong>Méthode:</strong> ${transactionStatus.paymentMethod || 'KoraPay'}</p>
        <p><strong>Durée:</strong> ${transactionStatus.package.duration} jours</p>
      </div>
      
      <p>✅ Notification de confirmation envoyée</p>
      <p>✅ Accès premium maintenant actif</p>
    `;
  } else if (transactionStatus.status === 'FAILED') {
    content = `
      <div class="icon">❌</div>
      <h1 class="error">Paiement Échoué</h1>
      <div class="status-badge status-error">❌ Refusé</div>
      <p><strong>${transactionStatus.errorMessage || 'Le paiement a échoué'}</strong></p>
      <div class="transaction-id">${reference}</div>
      <p>Veuillez réessayer ou contacter le support.</p>
    `;
  } else if (transactionStatus.status === 'CANCELLED') {
    content = `
      <div class="icon">⚠️</div>
      <h1 class="warning">Paiement Annulé</h1>
      <div class="status-badge status-warning">⚠️ Annulé</div>
      <p>Vous avez annulé le paiement.</p>
      <div class="transaction-id">${reference}</div>
      <p>Vous pouvez réessayer quand vous le souhaitez.</p>
    `;
  } else if (transactionStatus.status === 'PROCESSING') {
    content = `
      <div class="icon">📱</div>
      <h1 class="warning">Confirmation Requise</h1>
      <div class="status-badge status-warning">⏳ En attente</div>
      <p>Votre demande de paiement a été envoyée.</p>
      
      <div class="highlight">
        <p><strong>📲 Vérifiez votre téléphone</strong></p>
        <p>Une notification de paiement vous a été envoyée.</p>
        <p>Veuillez confirmer pour finaliser le paiement.</p>
      </div>
      
      <div class="transaction-id">${reference}</div>
      <p>Vous recevrez une notification de confirmation.</p>
    `;
  } else {
    content = `
      <div class="icon">⏳</div>
      <h1 class="pending">Paiement En Attente</h1>
      <div class="status-badge status-pending">⏳ En cours</div>
      <p>Votre paiement est en cours de traitement.</p>
      <div class="transaction-id">${reference}</div>
      <p>Veuillez patienter quelques instants.</p>
    `;
  }

  return res.send(getHtmlTemplate(`KoraPay - ${transactionStatus?.status || 'Statut'}`, content));
});

// ==================== HTML TEMPLATES ====================

const getMobileOptimizedCSS = () => `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      line-height: 1.6;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      width: 100%;
      max-width: 400px;
      padding: 24px;
      text-align: center;
      animation: slideUp 0.3s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    h1 { font-size: 1.5rem; margin-bottom: 16px; font-weight: 600; }
    p { font-size: 0.95rem; color: #666; margin-bottom: 12px; }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .warning { color: #f59e0b; }
    .pending { color: #6366f1; }
    .details {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      margin: 20px 0;
      text-align: left;
    }
    .details p { margin-bottom: 8px; font-size: 0.9rem; color: #374151; }
    .details p:last-child { margin-bottom: 0; }
    .highlight {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      border-radius: 12px;
      padding: 16px;
      margin: 20px 0;
      border-left: 4px solid #f59e0b;
    }
    .highlight p { color: #92400e; font-size: 0.9rem; }
    .icon { font-size: 2rem; margin-bottom: 12px; }
    .transaction-id {
      font-family: 'Courier New', monospace;
      background: #f1f5f9;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #475569;
      display: inline-block;
      margin: 8px 0;
      word-break: break-all;
    }
    .amount { font-size: 1.1rem; font-weight: 600; color: #1f2937; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 500;
      margin: 8px 0;
    }
    .status-success { background: #d1fae5; color: #065f46; }
    .status-error { background: #fee2e2; color: #991b1b; }
    .status-warning { background: #fef3c7; color: #92400e; }
    .status-pending { background: #e0e7ff; color: #3730a3; }
    @media (max-width: 480px) {
      .container { padding: 20px; margin: 12px; border-radius: 12px; }
      h1 { font-size: 1.3rem; }
      p { font-size: 0.9rem; }
      .details, .highlight { padding: 14px; }
    }
  </style>
`;

const getHtmlTemplate = (title, content) => `
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#667eea">
    <title>${title}</title>
    ${getMobileOptimizedCSS()}
  </head>
  <body>
    <div class="container">
      ${content}
    </div>
  </body>
  </html>
`;

module.exports = {
  initiatePayment: exports.initiatePayment,
  initiateMobileMoneyPayment: exports.initiateMobileMoneyPayment,
  checkStatus: exports.checkStatus,
  webhook: exports.webhook,
  paymentCallback: exports.paymentCallback
};