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

    // "Les 3 Secrets..."
    const secrets = await Gift.find({
      appId,
      $or: [
        { 'title.fr': /3 Secrets/i },
        { 'title.en': /3 Secrets/i },
      ],
    }).lean();
    console.log(`  "Les 3 Secrets" : ${secrets.length} match(es)`);
    for (const g of secrets) console.log(`    - ${g._id} | title.fr="${g.title?.fr}" | isActive=${g.isActive}`);

    // "PSG-Arsenal"
    const psg = await Gift.find({
      appId,
      $or: [
        { 'title.fr': /psg|arsenal|paris/i },
        { 'title.en': /psg|arsenal|paris/i },
      ],
    }).lean();
    console.log(`  "PSG / Arsenal" : ${psg.length} match(es)`);
    for (const g of psg) console.log(`    - ${g._id} | title.fr="${g.title?.fr}" | isActive=${g.isActive} | upd=${g.updatedAt}`);
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
