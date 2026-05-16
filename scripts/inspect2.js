require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('=== bigwin (par sortOrder) ===');
  const all = await Gift.find({ appId: 'bigwin' }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  for (const g of all) {
    const t = (g.title?.fr || g.title?.en || '').slice(0, 60);
    console.log(`  so=${g.sortOrder ?? '∅'} | act=${g.isActive} | ${g._id} | "${t}"`);
  }
  console.log('\n=== bigwin — gift May 14 ===');
  const j14 = await Gift.findOne({ appId: 'bigwin', $or: [{ 'title.fr': /14 mai/i }, { 'title.en': /may 14/i }] }).lean();
  if (j14) console.log(`  ${j14._id} | so=${j14.sortOrder} | act=${j14.isActive} | "${j14.title?.fr}"`);
  else console.log('  ❌ pas trouvé');
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
