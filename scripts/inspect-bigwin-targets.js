// Inspection : trouver le gift bigwin "Les 3 Secrets..." + identifier ce qui a
// été désactivé côté PSG (ticket ou prediction).
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));
const Ticket = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Ticket'));
const Prediction = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Prediction'));

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // 1) Le gift bigwin par titre (fr OU en)
  console.log('=== Gift bigwin par titre ===');
  const giftQ = {
    appId: 'bigwin',
    $or: [
      { 'title.fr': /3 Secrets/i },
      { 'title.en': /3 Secrets/i },
    ],
  };
  const g = await Gift.findOne(giftQ).lean();
  if (!g) {
    console.log("  ❌ pas trouvé. Liste des derniers gifts bigwin :");
    const recents = await Gift.find({ appId: 'bigwin' }).sort({ createdAt: -1 }).limit(5).lean();
    for (const x of recents) console.log('  -', x._id, '|', x?.title?.fr || x?.title?.en, '| tier=', x.tier);
  } else {
    console.log(JSON.stringify(g, null, 2));
  }

  // 2) Ticket(s) bigwin contenant "psg" (case-insensitive) dans la home/away,
  //    triés par updatedAt desc — pour identifier ce qui a bougé récemment.
  console.log('\n=== Ticket(s) bigwin avec PSG, par dernière maj ===');
  const tickets = await Ticket.find({
    appId: 'bigwin',
    $or: [
      { 'predictions': { $exists: true } },
    ],
  }).sort({ updatedAt: -1 }).limit(50).populate('predictions').lean();
  let found = 0;
  for (const t of tickets) {
    const psgPreds = (t.predictions || []).filter(p => {
      const teams = JSON.stringify(p?.matchData?.teams || '');
      return /psg|paris[ -]?saint/i.test(teams);
    });
    if (psgPreds.length > 0) {
      found++;
      console.log(`  ▶ ticket ${t._id} | date=${t.date} | isVisible=${t.isVisible} | status=${t.status} | updatedAt=${t.updatedAt}`);
      for (const p of psgPreds) {
        const home = p?.matchData?.teams?.home?.name;
        const away = p?.matchData?.teams?.away?.name;
        console.log(`    - prediction ${p._id} | ${home} vs ${away} | status=${p.status} | odds=${p.odds} | updatedAt=${p.updatedAt}`);
      }
      if (found >= 5) break;
    }
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
