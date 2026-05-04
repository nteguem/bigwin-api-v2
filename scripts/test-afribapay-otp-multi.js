/**
 * Test : AfribaPay accepte-t-il TOUS les opérateurs configurés `otp_required: 1`
 * sans envoyer de code OTP ?
 *
 * On teste en lot : Orange CI, Orange GN, Orange SN.
 * Numéros factices avec le bon préfixe pays — si AfribaPay accepte avec un
 * numéro inexistant, c'est qu'il ne valide pas l'OTP mais juste le format.
 *
 * USAGE :
 *   node scripts/test-afribapay-otp-multi.js
 */

require('dotenv').config();
const axios = require('axios');

const TESTS = [
  { country: 'CI', operator: 'orange', currency: 'XOF', phone: '22500000000', name: 'Orange Côte d\'Ivoire' },
  { country: 'GN', operator: 'orange', currency: 'GNF', phone: '22400000000', name: 'Orange Guinée' },
  { country: 'SN', operator: 'orange', currency: 'XOF', phone: '22100000000', name: 'Orange Sénégal' },
];

const AMOUNT = 100;

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

  for (const t of TESTS) {
    const orderId = `test-multi-${t.country}-${Date.now()}`;
    const payload = {
      operator: t.operator,
      country: t.country,
      phone_number: t.phone,
      amount: AMOUNT,
      currency: t.currency,
      order_id: orderId,
      merchant_key: config.merchantKey,
      reference_id: `TEST OTP SKIP ${t.country}`,
      lang: 'fr',
      notify_url: 'https://api-new.proxidream.com/api/payments/afribapay/webhook',
      return_url: 'https://api-new.proxidream.com/api/payments/afribapay/success',
      cancel_url: 'https://api-new.proxidream.com/api/payments/afribapay/cancel',
    };

    console.log(`━━━ ${t.name} (${t.phone}) ━━━`);

    try {
      const res = await axios.post(`${config.apiUrl}/v1/pay/payin`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const data = res.data?.data || res.data;
      console.log(`✅ ACCEPTÉ — status=${data.status}, txn=${data.transaction_id}, ref=${data.reference_id}`);
      results.push({ ...t, ok: true, status: data.status, txn: data.transaction_id });
    } catch (err) {
      const body = err.response?.data;
      const msg =
        body?.error?.message ||
        body?.message ||
        err.message ||
        'Erreur inconnue';
      console.log(`❌ REJETÉ (${err.response?.status || '?'}) — ${msg}`);
      const isOtp = JSON.stringify(body || {}).toLowerCase().includes('otp');
      results.push({
        ...t,
        ok: false,
        status: err.response?.status,
        message: msg,
        isOtp,
      });
    }
    console.log('');
  }

  // Résumé
  console.log('\n━━━ RÉSUMÉ ━━━');
  for (const r of results) {
    const icon = r.ok ? '✅' : (r.isOtp ? '🔒' : '⚠️ ');
    const note = r.ok
      ? `OK (${r.status})`
      : r.isOtp
        ? `OTP toujours requis`
        : `Rejet : ${r.message}`;
    console.log(`${icon} ${r.name.padEnd(28)} → ${note}`);
  }

  const allOk = results.every((r) => r.ok);
  const someOtp = results.some((r) => r.isOtp);

  console.log('\n━━━ VERDICT ━━━');
  if (allOk) {
    console.log('🎉 Tous acceptent SANS OTP → tu peux passer otp_required: 0 partout');
  } else if (someOtp) {
    console.log('🔒 Certains exigent toujours l\'OTP → garde otp_required: 1 pour eux');
    console.log('   Identifie lesquels dans le résumé ci-dessus.');
  } else {
    console.log('⚠️  Rejet pour autre raison (numéro factice probable). Re-tester avec vrais numéros.');
  }

  console.log('\n💡 Vérifie dans ton dashboard AfribaPay (filtre par "TEST OTP SKIP") pour voir');
  console.log('   les transactions test apparaître — elles vont expirer naturellement.');
})().catch((err) => {
  console.error('❌ Erreur fatale :', err.message);
  process.exit(1);
});
