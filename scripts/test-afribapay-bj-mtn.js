// scripts/test-afribapay-bj-mtn.js
//
// Test ciblé : initie UNE transaction AfribaPay sur le Bénin (BJ) avec
// l'opérateur MTN et le numéro qui apparaît dans les FAILED récents
// (2290151041689). But : voir si ça passe maintenant ou si on a la même
// erreur que dans les autres FAILED.

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const API_BASE = 'https://api-new.proxidream.com';
const APP_ID = 'bigwin';
const COUNTRY = 'BJ';
const OPERATOR = 'mtn';
const CURRENCY = 'XOF';
const PHONE = '2290151041689';

require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Package'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'user', 'User'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Subscription'));

const Package = mongoose.model('Package');
const User = mongoose.model('User');
const Subscription = mongoose.model('Subscription');

function signJwt(userId) {
  return jwt.sign(
    { id: String(userId), type: 'user' },
    process.env.JWT_USER_SECRET,
    { expiresIn: '1h' },
  );
}

(async () => {
  if (!process.env.MONGO_URI || !process.env.JWT_USER_SECRET) {
    console.error('❌ MONGO_URI ou JWT_USER_SECRET manquant'); process.exit(1);
  }

  console.log('🔌 Mongo…');
  await mongoose.connect(process.env.MONGO_URI);

  // User test : un bigwin sans abonnement actif
  console.log('🔍 User test bigwin sans sub active…');
  const candidates = await User.find({ appId: APP_ID, isActive: true }).limit(80);
  let testUser = null;
  for (const u of candidates) {
    const subs = await Subscription.find({
      user: u._id,
      status: { $in: ['active', 'ACTIVE'] },
      endDate: { $gt: new Date() }
    });
    if (subs.length === 0) { testUser = u; break; }
  }
  if (!testUser) { console.error('❌ Aucun user sans sub'); process.exit(1); }
  console.log(`✓ ${testUser.email || '(no email)'} (${testUser._id})`);

  // Package : le moins cher
  const pkg = await Package.findOne({ appId: APP_ID, isActive: true }).sort({ 'pricing.XOF': 1 });
  if (!pkg) { console.error('❌ Aucun package'); process.exit(1); }
  const pkgLabel = (pkg.name?.fr || pkg.name?.en || String(pkg.name));
  console.log(`✓ Package : ${pkgLabel} (${pkg._id}) — XOF ${pkg.pricing?.XOF || '?'}`);

  await mongoose.disconnect();

  const userJwt = signJwt(testUser._id);

  console.log('\n──── INITIATE ────');
  console.log(`Combo : ${COUNTRY} / ${OPERATOR} / ${CURRENCY}`);
  console.log(`Phone : ${PHONE}`);
  console.log(`Backend : ${API_BASE}`);

  const t0 = Date.now();
  const r = await axios.post(
    `${API_BASE}/api/payments/afribapay/initiate`,
    {
      packageId: String(pkg._id),
      phoneNumber: PHONE,
      operator: OPERATOR,
      country: COUNTRY,
      currency: CURRENCY,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': APP_ID,
        'Authorization': `Bearer ${userJwt}`,
      },
      validateStatus: () => true,
      timeout: 30000,
    },
  );
  const ms = Date.now() - t0;

  console.log(`\nHTTP ${r.status}  (${ms}ms)`);
  console.log('Body :');
  console.log(JSON.stringify(r.data, null, 2));

  if (r.status === 201) {
    console.log('\n✅ Initiation OK — vérifie ton tél, tu devrais recevoir le push MoMo MTN');
  } else if (r.status === 400) {
    const code = r.data?.error?.code;
    const msg = r.data?.error?.message;
    console.log(`\n⛔ Erreur 400 — code: ${code}  msg: ${msg}`);
    if (r.data?.error?.afribapay) {
      console.log(`AfribaPay raw : ${JSON.stringify(r.data.error.afribapay).slice(0, 500)}`);
    }
  } else {
    console.log(`\n⚠️ Status inattendu ${r.status}`);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
