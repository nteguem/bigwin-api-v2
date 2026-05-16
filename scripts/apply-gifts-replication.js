// Réplique sur goatips / goodtips / strategytips / wisetips :
//  1) Le gift bigwin "Les 3 Secrets des Parieurs..." (clone du doc avec change appId)
//  2) La désactivation (isActive: false) du gift "PSG-Arsenal..." dans chaque app
//
// Idempotent : si "Les 3 Secrets" existe déjà pour l'app, on skip la création ;
// si le PSG-Arsenal est déjà à isActive=false, on log mais on n'écrit rien.

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

const SOURCE_GIFT_ID = '6a0471051733adad6f583bdd'; // "Les 3 Secrets..." bigwin
const APPS = ['goatips', 'goodtips', 'strategytips', 'wisetips'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Source gift (lean → POJO modifiable)
  const src = await Gift.findById(SOURCE_GIFT_ID).lean();
  if (!src) { console.error('❌ Gift source introuvable'); process.exit(1); }
  console.log(`📦 Source : "${src.title.fr}" (${src._id}, tier=${src.tier})`);

  for (const appId of APPS) {
    console.log(`\n=== ${appId} ===`);

    // ── 1) Clone "Les 3 Secrets..." si absent
    const existing = await Gift.findOne({
      appId,
      $or: [
        { 'title.fr': /3 Secrets/i },
        { 'title.en': /3 Secrets/i },
      ],
    }).lean();
    if (existing) {
      console.log(`  ⏭️  "Les 3 Secrets..." déjà présent (${existing._id}) → skip création`);
    } else {
      const clone = { ...src };
      delete clone._id;
      delete clone.__v;
      delete clone.createdAt;
      delete clone.updatedAt;
      clone.appId = appId;
      const created = await Gift.create(clone);
      console.log(`  ✅ Cloné "Les 3 Secrets..." → ${created._id}`);
    }

    // ── 2) Désactivation du PSG-Arsenal
    const psg = await Gift.findOne({
      appId,
      $or: [
        { 'title.fr': /psg.*arsenal|arsenal.*psg/i },
        { 'title.en': /psg.*arsenal|arsenal.*psg/i },
      ],
    });
    if (!psg) {
      console.log(`  ⚠️  PSG-Arsenal introuvable → skip`);
    } else if (psg.isActive === false) {
      console.log(`  ⏭️  PSG-Arsenal (${psg._id}) déjà isActive=false → skip`);
    } else {
      psg.isActive = false;
      await psg.save();
      console.log(`  ✅ PSG-Arsenal (${psg._id}) → isActive=false`);
    }
  }

  // Vérif finale
  console.log('\n=== Vérif finale ===');
  for (const appId of APPS) {
    const secrets = await Gift.findOne({ appId, 'title.fr': /3 Secrets/i }).lean();
    const psg = await Gift.findOne({ appId, 'title.fr': /psg.*arsenal/i }).lean();
    console.log(`  ${appId}: 3Secrets=${secrets ? secrets._id : '—'} | PSG-Arsenal=${psg ? `${psg._id} isActive=${psg.isActive}` : '—'}`);
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
