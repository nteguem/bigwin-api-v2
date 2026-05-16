require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

const APPS = ['goatips', 'goodtips', 'strategytips', 'wisetips'];
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const appId of APPS) {
    console.log(`\n=== ${appId} ===`);
    const all = await Gift.find({ appId }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    for (const g of all) {
      const t = (g.title?.fr || g.title?.en || '').slice(0,55);
      console.log(`  so=${g.sortOrder ?? '∅'} | act=${g.isActive} | ${g._id} | "${t}"`);
    }
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
