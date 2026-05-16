require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Tous les gifts bigwin, triés par sortOrder puis date
  const all = await Gift.find({ appId: 'bigwin' })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  console.log(`Gifts bigwin : ${all.length}`);
  for (const g of all) {
    console.log(`  sortOrder=${g.sortOrder ?? '∅'} | isActive=${g.isActive} | ${g._id} | "${g.title?.fr || g.title?.en}"`);
  }

  // Repérer le nouveau "Journal du Parieur" + "5 erreurs fatales"
  console.log('\n--- "Journal du Parieur" ---');
  const j = await Gift.find({
    appId: 'bigwin',
    $or: [
      { 'title.fr': /journal.*parieur/i },
      { 'title.en': /bettor.*daily/i },
    ],
  }).lean();
  for (const g of j) console.log(`  ${g._id} | "${g.title?.fr}" | sortOrder=${g.sortOrder ?? '∅'} | upd=${g.updatedAt}`);

  console.log('\n--- "5 erreurs fatales" ---');
  const e = await Gift.find({
    appId: 'bigwin',
    $or: [
      { 'title.fr': /5 erreurs|erreurs fatales/i },
      { 'title.en': /5 fatal|fatal mistakes/i },
    ],
  }).lean();
  for (const g of e) console.log(`  ${g._id} | "${g.title?.fr}" | sortOrder=${g.sortOrder ?? '∅'} | upd=${g.updatedAt}`);

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
