require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
const Ticket = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Ticket'));
const Prediction = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Prediction'));

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Tickets bigwin modifiés AUJOURD'HUI
  const since = new Date('2026-05-13T00:00:00Z');
  console.log('TICKETS bigwin modifiés depuis 2026-05-13 00:00Z :');
  const tks = await Ticket.find({ appId: 'bigwin', updatedAt: { $gte: since } })
    .sort({ updatedAt: -1 }).limit(10).lean();
  for (const t of tks) {
    console.log(`  - _id=${t._id} isVisible=${t.isVisible} status=${t.status} date=${t.date} title="${t.title}" upd=${t.updatedAt}`);
    console.log(`    keys: ${Object.keys(t).join(', ')}`);
  }

  // Le doc complet d'une des prédictions PSG modifiée aujourd'hui
  const pids = ['6a0436b1b52d5ebe19cd513d', '6a043656b52d5ebe19cd42fa'];
  for (const id of pids) {
    const p = await Prediction.findById(id).lean();
    if (!p) continue;
    console.log(`\nPREDICTION ${id} (full doc) :`);
    // remove matchData for brevity
    const { matchData, ...rest } = p;
    console.log(JSON.stringify(rest, null, 2));
    console.log('  matchData.id:', matchData?.id);
    console.log('  matchData keys:', Object.keys(matchData || {}).join(', '));
    console.log('  matchData.status:', matchData?.status);
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
