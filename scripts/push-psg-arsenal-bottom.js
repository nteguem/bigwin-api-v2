require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

const APPS = ['bigwin', 'goatips', 'goodtips', 'strategytips', 'wisetips'];
const TARGET = 99;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const appId of APPS) {
    const g = await Gift.findOne({
      appId,
      $or: [
        { 'title.fr': /psg.*arsenal|arsenal.*psg/i },
        { 'title.en': /psg.*arsenal|arsenal.*psg/i },
      ],
    });
    if (!g) { console.log(`  ⚠️  ${appId}: PSG-Arsenal introuvable`); continue; }
    if (g.sortOrder === TARGET) {
      console.log(`  ⏭️  ${appId}: PSG-Arsenal (${g._id}) déjà sortOrder=${TARGET}`);
    } else {
      const before = g.sortOrder;
      g.sortOrder = TARGET;
      await g.save();
      console.log(`  ✅ ${appId}: PSG-Arsenal (${g._id}) sortOrder ${before} → ${TARGET} (isActive=${g.isActive})`);
    }
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
