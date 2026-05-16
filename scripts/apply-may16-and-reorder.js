// Réplication "Le Journal du Parieur — 16 mai 2026 / May 16, 2026"
// depuis bigwin vers les 4 autres apps + réordonnancement sur les 5 apps :
//   0 → May 16 Journal     1 → May 15 Journal     2 → May 14 Journal
//   3 → May 13 Journal     4 → Les 3 Secrets      5 → 5 erreurs fatales
//   6 → 30 Prompts         7 → 7 BUSINESS
// (PSG-Arsenal reste à so=99, isActive=false — non touché)
//
// Idempotent : skip si déjà au bon sortOrder, skip création si May 16 déjà présent.

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

const OTHER_APPS = ['goatips', 'goodtips', 'strategytips', 'wisetips'];
const ALL_APPS = ['bigwin', ...OTHER_APPS];

const ORDER = [
  { regex: { fr: /16 mai/i, en: /may 16/i },               so: 0, label: '🔥 May 16 Journal' },
  { regex: { fr: /15 mai/i, en: /may 15/i },               so: 1, label: '🔥 May 15 Journal' },
  { regex: { fr: /14 mai/i, en: /may 14/i },               so: 2, label: '🔥 May 14 Journal' },
  { regex: { fr: /13 mai/i, en: /may 13/i },               so: 3, label: '🔥 May 13 Journal' },
  { regex: { fr: /3 Secrets/i, en: /3 Secrets/i },         so: 4, label: 'Les 3 Secrets' },
  { regex: { fr: /5 erreurs|erreurs fatales/i, en: /5 fatal|fatal mistakes/i }, so: 5, label: '5 erreurs fatales' },
  { regex: { fr: /30 Prompts/i, en: /30 Prompts/i },       so: 6, label: '30 Prompts' },
  { regex: { fr: /7 BUSINESS/i, en: /7 BUSINESS/i },       so: 7, label: '7 BUSINESS' },
];

async function applyOrder(appId) {
  for (const item of ORDER) {
    const g = await Gift.findOne({
      appId,
      $or: [
        { 'title.fr': item.regex.fr },
        { 'title.en': item.regex.en },
      ],
    });
    if (!g) { console.log(`    ⚠️  ${item.label} introuvable`); continue; }
    if (g.sortOrder === item.so) {
      console.log(`    ⏭️  ${item.label} (${g._id}) déjà so=${item.so}`);
    } else {
      const before = g.sortOrder;
      g.sortOrder = item.so;
      await g.save();
      console.log(`    ✅ ${item.label} (${g._id}) so ${before} → ${item.so}`);
    }
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Trouve le gift du 16 mai sur bigwin (créé manuellement par l'user)
  const src = await Gift.findOne({
    appId: 'bigwin',
    $or: [
      { 'title.fr': /16 mai/i },
      { 'title.en': /may 16/i },
    ],
  }).lean();
  if (!src) {
    console.error('❌ May 16 Journal source introuvable sur bigwin');
    process.exit(1);
  }
  console.log(`📦 Source : "${src.title.fr || src.title.en}" (${src._id})`);

  // bigwin : déjà créé → juste réordonner
  console.log('\n=== bigwin ===');
  await applyOrder('bigwin');

  // 4 autres apps : clone si absent puis réordonner
  for (const appId of OTHER_APPS) {
    console.log(`\n=== ${appId} ===`);
    const existing = await Gift.findOne({
      appId,
      $or: [
        { 'title.fr': /16 mai/i },
        { 'title.en': /may 16/i },
      ],
    });
    if (existing) {
      console.log(`  ⏭️  May 16 Journal déjà présent (${existing._id})`);
    } else {
      const clone = { ...src };
      delete clone._id; delete clone.__v;
      delete clone.createdAt; delete clone.updatedAt;
      clone.appId = appId;
      clone.sortOrder = 0;
      const created = await Gift.create(clone);
      console.log(`  ✅ Cloné May 16 Journal → ${created._id} (so=0)`);
    }
    await applyOrder(appId);
  }

  // Vérif finale
  console.log('\n=== Vérif finale (top 9 par sortOrder) ===');
  for (const appId of ALL_APPS) {
    const top = await Gift.find({ appId }).sort({ sortOrder: 1, createdAt: -1 }).limit(9).lean();
    console.log(`\n  ${appId} :`);
    for (const g of top) {
      const t = (g.title?.fr || g.title?.en || '').slice(0, 55);
      console.log(`    so=${g.sortOrder} | act=${g.isActive} | "${t}"`);
    }
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
