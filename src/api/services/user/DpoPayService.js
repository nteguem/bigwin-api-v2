// services/user/DpoPayService.js
const axios = require('axios');
const xml2js = require('xml2js');
const DpoPayTransaction = require('../../models/user/DpoPayTransaction');
const Package = require('../../models/common/Package');
const User = require('../../models/user/User');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const API_URL = 'https://secure.3gdirectpay.com/API/v6/';
const PAYMENT_URL = 'https://secure.3gdirectpay.com/payv2.php';
const COMPANY_TOKEN = process.env.DPO_COMPANY_TOKEN;
const SERVICE_TYPE = process.env.DPO_SERVICE_TYPE;

if (!COMPANY_TOKEN || !SERVICE_TYPE) {
  throw new Error('Variables d\'environnement DPO manquantes: DPO_COMPANY_TOKEN, DPO_SERVICE_TYPE');
}

class DpoPayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'DpoPayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// Mapper devise → pays
function getCurrencyCountry(currency) {
  const mapping = {
    'XOF': "Ivory Coast",
    'GHS': 'Ghana',
    'NGN': 'Nigeria',
    'CDF': 'Democratic Republic of Congo',
    'KES': 'Kenya',
    'UGX': 'Uganda',
    'TZS': 'Tanzania',
    'RWF': 'Rwanda',
    'ETB': 'Ethiopia',
    'ZAR': 'South Africa',
    'ZMW': 'Zambia',
    'ZWL': 'Zimbabwe',
    'BWP': 'Botswana',
    'NAD': 'Namibia',
    'MWK': 'Malawi',
    'LSL': 'Lesotho',
    'SZL': 'Eswatini',
    'MUR': 'Mauritius'
  };
  return mapping[currency] || '';
}

// Mapper devise → code pays ISO
function getCurrencyCountryCode(currency) {
  const mapping = {
    'XOF': 'CI',
    'GHS': 'GH',
    'NGN': 'NG',
    'CDF': 'CD',
    'KES': 'KE',
    'UGX': 'UG',
    'TZS': 'TZ',
    'RWF': 'RW',
    'ETB': 'ET',
    'ZAR': 'ZA',
    'ZMW': 'ZM',
    'ZWL': 'ZW',
    'BWP': 'BW',
    'NAD': 'NA',
    'MWK': 'MW',
    'LSL': 'LS',
    'SZL': 'SZ',
    'MUR': 'MU'
  };
  return mapping[currency] || '';
}

// Mapper devise → ville
function getCurrencyCity(currency) {
  const mapping = {
    'XOF': 'Abidjan',
    'GHS': 'Accra',
    'NGN': 'Lagos',
    'CDF': 'Kinshasa',
    'KES': 'Nairobi',
    'UGX': 'Kampala',
    'TZS': 'Dar es Salaam',
    'RWF': 'Kigali',
    'ETB': 'Addis Ababa',
    'ZAR': 'Johannesburg',
    'ZMW': 'Lusaka',
    'ZWL': 'Harare',
    'BWP': 'Gaborone',
    'NAD': 'Windhoek',
    'MWK': 'Lilongwe',
    'LSL': 'Maseru',
    'SZL': 'Mbabane',
    'MUR': 'Port Louis'
  };
  return mapping[currency] || '';
}

function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
    redirect_url: `${baseUrl}/api/payments/dpopay/success`,
    back_url: `${baseUrl}/api/payments/dpopay/cancel`
  };
}

function buildCreateTokenXml(data) {
  return `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${COMPANY_TOKEN}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${data.amount}</PaymentAmount>
    <PaymentCurrency>${data.currency}</PaymentCurrency>
    <CompanyRef>${data.companyRef}</CompanyRef>
    <RedirectURL>${data.redirectUrl}</RedirectURL>
    <BackURL>${data.backUrl}</BackURL>
    <CompanyRefUnique>0</CompanyRefUnique>
    <PTL>5</PTL>
    <customerFirstName>${data.customerFirstName}</customerFirstName>
    <customerLastName>${data.customerLastName}</customerLastName>
    <customerAddress>${data.customerAddress}</customerAddress>
    <customerCity>${data.customerCity}</customerCity>
    <customerCountry>${data.customerCountryCode}</customerCountry>
    <customerZip>${data.customerZip}</customerZip>
    <customerPhone>${data.phoneNumber}</customerPhone>
    <customerEmail>${data.customerEmail}</customerEmail>
    <DefaultPayment>MO</DefaultPayment>
    <DefaultPaymentCountry>${data.defaultPaymentCountry}</DefaultPaymentCountry>
  </Transaction>
  <Services>
    <Service>
      <ServiceType>${SERVICE_TYPE}</ServiceType>
      <ServiceDescription>${data.serviceDescription}</ServiceDescription>
      <ServiceDate>${new Date().toISOString().split('T')[0]}</ServiceDate>
    </Service>
  </Services>
</API3G>`;
}

function buildVerifyTokenXml(transactionToken) {
  return `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${COMPANY_TOKEN}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${transactionToken}</TransactionToken>
</API3G>`;
}

async function parseXmlResponse(xmlString) {
  const parser = new xml2js.Parser({ explicitArray: false });
  return await parser.parseStringPromise(xmlString);
}

async function createToken(userId, packageId, phoneNumber, currency) {
  try {
    console.log(`[DPO-START] Démarrage createToken userId=${userId}, package=${packageId}`);

    const packageDoc = await Package.findById(packageId);
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    const amount = packageDoc.pricing.get(currency);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    const orderId = `dpo-${Date.now()}`;
    const { redirect_url, back_url } = generateUrls();
    
    const countryName = getCurrencyCountry(currency);
    const countryCode = getCurrencyCountryCode(currency);
    const city = getCurrencyCity(currency);

    console.log(`[DPO-DEBUG] Country: ${countryName}, Code: ${countryCode}, City: ${city}`);

    const xmlPayload = buildCreateTokenXml({
      amount,
      currency,
      companyRef: orderId,
      redirectUrl: redirect_url,
      backUrl: back_url,
      phoneNumber,
      customerFirstName: user.firstName || 'Client',
      customerLastName: user.lastName || 'BigWin',
      customerEmail: user.email || `${user._id}@bigwin.app`,
      customerAddress: city || 'N/A',
      customerCity: city,
      customerCountryCode: countryCode,
      customerZip: '00000',
      serviceDescription: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      defaultPaymentCountry: countryName
    });

    console.log(`[DPO-XML]`, xmlPayload);

    const response = await axios.post(API_URL, xmlPayload, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 30000
    });

    console.log(`[DPO-RESPONSE]`, response.data);

    const parsedResponse = await parseXmlResponse(response.data);
    const result = parsedResponse.API3G;

    if (result.Result !== '000') {
      throw new DpoPayError(
        result.ResultExplanation || 'Erreur lors de la création du token',
        400,
        result
      );
    }

    const checkoutUrl = `${PAYMENT_URL}?ID=${result.TransToken}`;

    const dpoTransaction = new DpoPayTransaction({
      transactionToken: result.TransToken,
      orderId,
      companyRef: orderId,
      user: userId,
      package: packageId,
      amount,
      currency,
      phoneNumber,
      companyToken: COMPANY_TOKEN,
      serviceType: SERVICE_TYPE,
      redirectUrl: redirect_url,
      backUrl: back_url,
      checkoutUrl,
      status: 'PENDING'
    });

    await dpoTransaction.save();
    await dpoTransaction.populate(['package', 'user']);

    console.log(`[DPO-END] Transaction créée:`, dpoTransaction._id);

    return {
      transaction: dpoTransaction,
      checkoutUrl
    };

  } catch (error) {
    console.error(`[DPO-ERROR]`, error);

    if (error instanceof (DpoPayError || AppError)) {
      throw error;
    }

    throw new DpoPayError(
      error.message || 'Erreur lors de la création du token',
      500,
      error.response?.data
    );
  }
}

async function verifyToken(transactionToken) {
  try {
    console.log(`[DPO-VERIFY] Token:`, transactionToken);

    const xmlPayload = buildVerifyTokenXml(transactionToken);

    const response = await axios.post(API_URL, xmlPayload, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 30000
    });

    const parsedResponse = await parseXmlResponse(response.data);
    const result = parsedResponse.API3G;

    console.log(`[DPO-VERIFY] Response:`, result);

    const transaction = await DpoPayTransaction.findOne({ transactionToken })
      .populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    let status = 'PENDING';
    if (result.Result === '000') {
      status = 'PAID';
    } else if (result.Result === '901' || result.Result === '904') {
      status = 'CANCELLED';
    } else if (result.Result) {
      status = 'FAILED';
    }

    transaction.status = status;
    transaction.transactionApproval = result.TransactionApproval;
    transaction.transactionCurrency = result.TransactionCurrency;
    transaction.transactionAmount = result.TransactionAmount;
    transaction.transactionNetAmount = result.TransactionNetAmount;
    transaction.transactionSettlementDate = result.TransactionSettlementDate;
    transaction.customerName = result.CustomerName;
    transaction.customerPhone = result.CustomerPhone;
    transaction.customerEmail = result.CustomerEmail;
    transaction.customerCountry = result.CustomerCountry;
    transaction.customerCity = result.CustomerCity;
    transaction.fraudAlert = result.FraudAlert;
    transaction.fraudExplanation = result.FraudExplnation;
    transaction.verifiedAt = new Date();

    await transaction.save();

    return transaction;

  } catch (error) {
    console.error(`[DPO-VERIFY-ERROR]`, error);

    if (error instanceof (DpoPayError || AppError)) {
      throw error;
    }

    throw new DpoPayError(
      error.message || 'Erreur lors de la vérification',
      500,
      error.response?.data
    );
  }
}

async function checkTransactionStatus(orderId) {
  const transaction = await DpoPayTransaction.findOne({ 
    $or: [{ orderId }, { transactionToken: orderId }] 
  }).populate(['package', 'user']);

  if (!transaction) {
    throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  return await verifyToken(transaction.transactionToken);
}

module.exports = {
  createToken,
  verifyToken,
  checkTransactionStatus,
  DpoPayError
};