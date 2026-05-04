/**
 * Test : AfribaPay accepte-t-il Orange Money Burkina Faso sans OTP ?
 *
 * Bypass complètement notre check `otp_required: 1`. Appelle directement
 * l'endpoint `/v1/pay/payin` d'AfribaPay sans `otp_code` et observe la
 * réponse.
 *
 * Lit la config depuis :
 *   - .env (AFRIBAPAY_API_URL, AFRIBAPAY_API_USER, AFRIBAPAY_API_KEY, AFRIBAPAY_MERCHANT_KEY)
 *   - sinon depuis la BD (App.payments.afribapay) pour appId=bigwin
 *
 * USAGE :
 *   node scripts/test-afribapay-orange-bf-no-otp.js <phoneE164> [montant]
 *
 *   Ex : node scripts/test-afribapay-orange-bf-no-otp.js 22670000000 100
 *
 * SCENARIO :
 *   - Si AfribaPay répond `success: true` → bingo, on peut passer otp_required à 0
 *     (⚠️ une transaction réelle sera initiée — annule via leur dashboard si besoin)
 *   - Si AfribaPay rejette avec un message contenant "OTP" → on garde le check
 *   - Si AfribaPay rejette pour autre raison → on saura quoi (numéro invalide, etc.)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const phone = process.argv[2];
const amount = parseInt(process.argv[3] || '100', 10);

if (!phone) {
  console.error('❌ Usage : node scripts/test-afribapay-orange-bf-no-otp.js <phoneE164> [montant]');
  console.error('   Ex   : node scripts/test-afribapay-orange-bf-no-otp.js 22670000000 100');
  process.exit(1);
}

async function getConfig() {
  // Essaye .env d'abord
  if (
    process.env.AFRIBAPAY_API_URL &&
    process.env.AFRIBAPAY_API_USER &&
    process.env.AFRIBAPAY_API_KEY &&
    process.env.AFRIBAPAY_MERCHANT_KEY
  ) {
    console.log('✅ Config lue depuis .env');
    return {
      apiUrl: process.env.AFRIBAPAY_API_URL,
      apiUser: process.env.AFRIBAPAY_API_USER,
      apiKey: process.env.AFRIBAPAY_API_KEY,
      merchantKey: process.env.AFRIBAPAY_MERCHANT_KEY,
    };
  }

  // Sinon depuis la BD
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) throw new Error('MONGO_URI manquant et .env incomplet');
  await mongoose.connect(MONGO_URI);
  const App = require('../src/api/models/common/App');
  const app = await App.findOne({ appId: 'bigwin' }).lean();
  if (!app?.payments?.afribapay?.enabled) {
    throw new Error('AfribaPay non configuré pour bigwin');
  }
  console.log('✅ Config lue depuis BD (app=bigwin)');
  const c = app.payments.afribapay;
  return {
    apiUrl: c.apiUrl,
    apiUser: c.apiUser,
    apiKey: c.apiKey,
    merchantKey: c.merchantKey,
  };
}

(async () => {
  console.log(`\n🧪 Test Orange Money BF SANS OTP`);
  console.log(`   Phone : ${phone}`);
  console.log(`   Amount: ${amount} XOF\n`);

  const config = await getConfig();

  // 1) Token
  console.log('🔑 Récupération access token...');
  const credentials = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString('base64');
  const tokenRes = await axios.post(
    `${config.apiUrl}/v1/token`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const token = tokenRes.data?.access_token || tokenRes.data?.token || tokenRes.data?.data?.access_token;
  if (!token) {
    console.error('❌ Pas de token dans la réponse :', tokenRes.data);
    process.exit(1);
  }
  console.log('✅ Token OK\n');

  // 2) Payin SANS otp_code
  const orderId = `test-no-otp-${Date.now()}`;
  const payload = {
    operator: 'orange',
    country: 'BF',
    phone_number: phone,
    amount,
    currency: 'XOF',
    order_id: orderId,
    merchant_key: config.merchantKey,
    reference_id: 'TEST OTP SKIP',
    lang: 'fr',
    notify_url: 'https://api-new.proxidream.com/api/payments/afribapay/webhook',
    return_url: 'https://api-new.proxidream.com/api/payments/afribapay/success',
    cancel_url: 'https://api-new.proxidream.com/api/payments/afribapay/cancel',
    // PAS d'otp_code volontairement
  };

  console.log('🚀 POST /v1/pay/payin (sans otp_code)');
  console.log('   Payload :', JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(`${config.apiUrl}/v1/pay/payin`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log('\n✅ RÉPONSE 200 :');
    console.log(JSON.stringify(res.data, null, 2));
    console.log('\n🎉 AfribaPay accepte SANS OTP !');
    console.log('   → Tu peux passer `otp_required: 1 → 0` dans afribapayData.json');
    console.log('   → ⚠️  Vérifie sur ton dashboard AfribaPay si une vraie transaction a été initiée');
  } catch (err) {
    if (err.response) {
      console.log(`\n❌ RÉPONSE ${err.response.status} :`);
      console.log(JSON.stringify(err.response.data, null, 2));

      const body = JSON.stringify(err.response.data || {}).toLowerCase();
      if (body.includes('otp')) {
        console.log('\n🔒 Verdict : AfribaPay EXIGE TOUJOURS un OTP pour Orange BF');
        console.log('   → Garde `otp_required: 1`');
        console.log('   → Implémente le flow OTP côté mobile (instruction USSD + champ OTP)');
      } else {
        console.log('\n⚠️  Verdict : rejet pour une AUTRE raison (numéro invalide, etc.)');
        console.log('   → Re-test avec un vrai numéro Orange BF avant de conclure');
      }
    } else {
      console.error('\n❌ Erreur réseau :', err.message);
    }
  }

  if (mongoose.connection.readyState) await mongoose.disconnect();
})().catch((err) => {
  console.error('❌ Erreur fatale :', err.message);
  process.exit(1);
});
