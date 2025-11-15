// controllers/user/dpoPayController.js
const dpoPayService = require('../../services/user/DpoPayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Initier un paiement DPO Pay
 */
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId, phoneNumber, currency } = req.body;

  // Validation
  if (!packageId || !phoneNumber || !currency) {
    return next(new AppError(
      'packageId, phoneNumber et currency sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier abonnement actif
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubscriptions = await subscriptionService.getActiveSubscriptions(req.user._id);
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

  try {
    const result = await dpoPayService.createToken(
      req.user._id,
      packageId,
      phoneNumber,
      currency
    );

    res.status(201).json({
      success: true,
      message: 'Paiement initié avec succès',
      data: {
        transaction: {
          transactionToken: result.transaction.transactionToken,
          orderId: result.transaction.orderId,
          amount: result.transaction.amount,
          currency: result.transaction.currency,
          status: result.transaction.status,
          phoneNumber: result.transaction.phoneNumber,
          package: result.transaction.package
        },
        checkoutUrl: result.checkoutUrl
      }
    });

  } catch (error) {
    if (error instanceof dpoPayService.DpoPayError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: {
          code: 'DPOPAY_ERROR',
          message: error.message,
          details: error.responseData
        }
      });
    }

    throw error;
  }
});

/**
 * Vérifier le statut d'un paiement
 */
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  const transaction = await dpoPayService.checkTransactionStatus(orderId);

  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisée', 403, ErrorCodes.UNAUTHORIZED));
  }

  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(transaction);
  } catch (error) {
    console.error('Error processing transaction update:', error.message);
  }

  res.status(200).json({
    success: true,
    data: {
      transaction: {
        transactionToken: transaction.transactionToken,
        orderId: transaction.orderId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        transactionApproval: transaction.transactionApproval,
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
 * Webhook DPO Pay (appelé après redirection)
 */
exports.handleRedirect = catchAsync(async (req, res, next) => {
  const { TransactionToken, CompanyRef } = req.query;

  if (!TransactionToken) {
    return next(new AppError('TransactionToken requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  try {
    // Vérifier le statut auprès de DPO
    const transaction = await dpoPayService.verifyToken(TransactionToken);

    // Marquer webhook reçu
    transaction.webhookReceived = true;
    transaction.webhookData = req.query;
    await transaction.save();

    // Traiter la transaction
    await paymentMiddleware.processTransactionUpdate(transaction);

    // Rediriger vers le frontend avec le statut
    const frontendUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/payment/${transaction.status.toLowerCase()}?orderId=${transaction.orderId}`;
    
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Redirect handling error:', error.message);
    
    const frontendUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/payment/error`);
  }
});

/**
 * Cancel callback
 */
exports.handleCancel = catchAsync(async (req, res, next) => {
  const { TransactionToken } = req.query;

  if (TransactionToken) {
    try {
      const DpoPayTransaction = require('../../models/user/DpoPayTransaction');
      const transaction = await DpoPayTransaction.findOne({ transactionToken: TransactionToken });
      
      if (transaction && transaction.status === 'PENDING') {
        transaction.status = 'CANCELLED';
        transaction.webhookReceived = true;
        transaction.webhookData = req.query;
        await transaction.save();
      }
    } catch (error) {
      console.error('Cancel handling error:', error.message);
    }
  }

  const frontendUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  res.redirect(`${frontendUrl}/payment/cancelled`);
});

module.exports = {
  initiatePayment: exports.initiatePayment,
  checkStatus: exports.checkStatus,
  handleRedirect: exports.handleRedirect,
  handleCancel: exports.handleCancel
};