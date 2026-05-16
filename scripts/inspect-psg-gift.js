require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Tous les gifts bigwin qui parlent de PSG / Arsenal (titre OU description),
  // triés par dernière maj
  const gifts = await Gift.find({
    appId: 'bigwin',
    $or: [
      { 'title.fr': /psg|arsenal|paris/i },
      { 'title.en': /psg|arsenal|paris/i },
      { 'description.fr': /psg|arsenal|paris/i },
      { 'description.en': /psg|arsenal|paris/i },
    ]
  }).sort({ updatedAt: -1 }).limit(5).lean();

  console.log(`Gifts bigwin mentionnant PSG/Arsenal/Paris : ${gifts.length}`);
  for (const g of gifts) {
    console.log(`\n--- ${g._id} ---`);
    console.log('  title.fr   :', g.title?.fr);
    console.log('  title.en   :', g.title?.en);
    console.log('  type       :', g.type, '| staticFormat:', g.staticFormat, '| category:', g.category);
    console.log('  tier       :', g.tier);
    console.log('  isActive   :', g.isActive);
    console.log('  isFreeTeaser:', g.isFreeTeaser);
    console.log('  status     :', g.status || '(no status field)');
    console.log('  createdAt  :', g.createdAt);
    console.log('  updatedAt  :', g.updatedAt);
    console.log('  keys       :', Object.keys(g).join(', '));
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
