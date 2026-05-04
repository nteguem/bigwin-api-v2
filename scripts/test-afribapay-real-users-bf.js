/**
 * Test Orange BF SANS OTP avec les VRAIS numéros utilisateurs vus dans le
 * dashboard AfribaPay (les paiements en PENDING qui ont échoué à cause de
 * notre check `otp_required: 1`).
 *
 * Si AfribaPay les accepte tous → confirmation que la politique a changé,
 * et on peut désactiver le check OTP en toute confiance.
 *
 * ⚠️ ATTENTION : ces tests envoient un PUSH USSD réel sur les téléphones
 * concernés. Chaque user qui valide par erreur sera débité de 100 XOF.
 *
 * USAGE :
 *   node scripts/test-afribapay-real-users-bf.js
 */

require('dotenv').config();
const axios = require('axios');

// Numéros vus en PENDING dans le dashboard AfribaPay (orange BF)
const REAL_NUMBERS = [
  '22605576960',
  '22676722555',
  '22677016756',
  '22604166219',
  '22674696178',
  '22666500739',
  '22664340221',
  '22664502961',
  '22667133162',
  '22665151684',
];

const AMOUNT = 100;
const COUNTRY = 'BF';
const OPERATOR = 'orange';
const CURRENCY = 'XOF';

(async () => {
  const config = {
    apiUrl: process.env.AFRIBAPAY_API_URL,
    apiUser: process.env.AFRIBAPAY_API_USER,
    apiKey: process.env.AFRIBAPAY_API_KEY,
    merchantKey: process.env.AFRIBAPAY_MERCHANT_KEY,
  };

  if (!config.apiUrl || !config.apiUser || !config.apiKey || !config.merchantKey) {
    console.error('❌ Config AfribaPay incomplète dans .env');
    process.exit(1);
  }

  console.log(`🧪 Test ${REAL_NUMBERS.length} vrais numéros Orange BF SANS OTP`);
  console.log(`   Montant : ${AMOUNT} XOF chacun\n`);

  // Token
  console.log('🔑 Token...');
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
  const token =
    tokenRes.data?.access_token ||
    tokenRes.data?.token ||
    tokenRes.data?.data?.access_token;
  console.log('✅ Token OK\n');

  const results = [];

  for (let i = 0; i < REAL_NUMBERS.length; i++) {
    const phone = REAL_NUMBERS[i];
    const orderId = `test-real-${phone}-${Date.now()}`;
    const payload = {
      operator: OPERATOR,
      country: COUNTRY,
      phone_number: phone,
      amount: AMOUNT,
      currency: CURRENCY,
      order_id: orderId,
      merchant_key: config.merchantKey,
      reference_id: `TEST OTP SKIP REAL`,
      lang: 'fr',
      notify_url: 'https://api-new.proxidream.com/api/payments/afribapay/webhook',
      return_url: 'https://api-new.proxidream.com/api/payments/afribapay/success',
      cancel_url: 'https://api-new.proxidream.com/api/payments/afribapay/cancel',
    };

    process.stdout.write(`[${i + 1}/${REAL_NUMBERS.length}] ${phone} ... `);

    try {
      const res = await axios.post(`${config.apiUrl}/v1/pay/payin`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      const data = res.data?.data || res.data;
      console.log(`✅ ${data.status} | txn=${data.transaction_id}`);
      results.push({ phone, ok: true, status: data.status, txn: data.transaction_id });
    } catch (err) {
      const body = err.response?.data;
      const msg = body?.error?.message || body?.message || err.message;
      console.log(`❌ ${err.response?.status || '?'} : ${msg}`);
      results.push({ phone, ok: false, status: err.response?.status, message: msg });
    }

    // Petite pause entre 2 requêtes pour éviter rate limit AfribaPay
    await new Promise((r) => setTimeout(r, 500));
  }

  // Résumé
  const ok = results.filter((r) => r.ok).length;
  const ko = results.length - ok;

  console.log('\n━━━ RÉSUMÉ ━━━');
  console.log(`✅ Acceptés : ${ok} / ${results.length}`);
  console.log(`❌ Rejetés  : ${ko} / ${results.length}`);

  if (ko > 0) {
    console.log('\nRejets :');
    results.filter((r) => !r.ok).forEach((r) => {
      console.log(`   ${r.phone} → ${r.message}`);
    });
  }

  console.log('\n💡 Vérifie dans ton dashboard AfribaPay (filtre "TEST OTP SKIP REAL")');
  console.log('   pour voir les ' + ok + ' transactions test apparaître.');
  if (ok === results.length) {
    console.log('\n🎉 Tous acceptés sans OTP → la fix `otp_required: 0` est confirmée.');
  }
})().catch((err) => {
  console.error('❌ Erreur fatale :', err.message);
  process.exit(1);
});
