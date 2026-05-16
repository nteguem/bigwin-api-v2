// 1) Sur bigwin : Les 3 Secrets → sortOrder=1, 5 erreurs fatales → sortOrder=2
//    (Journal du Parieur déjà à sortOrder=0)
// 2) Sur goatips / goodtips / strategytips / wisetips :
//    a) Cloner "🔥 Le Journal du Parieur — Édition du 13 mai 2026" depuis bigwin
//       (si absent) → sortOrder=0
//    b) Les 3 Secrets → sortOrder=1
//    c) 5 erreurs fatales → sortOrder=2
//
// Idempotent : valeurs cibles explicites, skip création si déjà présent.

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

const JOURNAL_SRC_ID = '6a0498361733adad6f5aaaee'; // "Le Journal du Parieur" sur bigwin
const APPS = ['goatips', 'goodtips', 'strategytips', 'wisetips'];

async function setSortOrder(appId, regex, target, label) {
  const g = await Gift.findOne({ appId, $or: [{ 'title.fr': regex }, { 'title.en': regex }] });
  if (!g) { console.log(`  ⚠️  ${label} introuvable`); return; }
  if (g.sortOrder === target) {
    console.log(`  ⏭️  ${label} (${g._id}) déjà sortOrder=${target}`);
  } else {
    const before = g.sortOrder;
    g.sortOrder = target;
    await g.save();
    console.log(`  ✅ ${label} (${g._id}) sortOrder ${before} → ${target}`);
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // ── 1) bigwin : swap sortOrder
  console.log('=== bigwin ===');
  await setSortOrder('bigwin', /journal.*parieur/i, 0, '🔥 Journal du Parieur');
  await setSortOrder('bigwin', /3 Secrets/i, 1, 'Les 3 Secrets');
  await setSortOrder('bigwin', /5 erreurs|erreurs fatales/i, 2, '5 erreurs fatales');

  // ── 2) Source pour le clone
  const src = await Gift.findById(JOURNAL_SRC_ID).lean();
  if (!src) { console.error('❌ Journal source introuvable'); process.exit(1); }

  for (const appId of APPS) {
    console.log(`\n=== ${appId} ===`);

    // a) Cloner Journal si absent
    const existing = await Gift.findOne({
      appId,
      $or: [
        { 'title.fr': /journal.*parieur/i },
        { 'title.en': /bettor.*daily/i },
      ],
    });
    if (existing) {
      console.log(`  ⏭️  Journal du Parieur déjà présent (${existing._id})`);
      if (existing.sortOrder !== 0) {
        existing.sortOrder = 0;
        await existing.save();
        console.log(`  ✅ Journal du Parieur (${existing._id}) sortOrder → 0`);
      } else {
        console.log(`  ⏭️  Journal du Parieur déjà sortOrder=0`);
      }
    } else {
      const clone = { ...src };
      delete clone._id; delete clone.__v;
      delete clone.createdAt; delete clone.updatedAt;
      clone.appId = appId;
      clone.sortOrder = 0;
      const created = await Gift.create(clone);
      console.log(`  ✅ Cloné Journal du Parieur → ${created._id} (sortOrder=0)`);
    }

    // b) Les 3 Secrets → 1
    await setSortOrder(appId, /3 Secrets/i, 1, 'Les 3 Secrets');
    // c) 5 erreurs fatales → 2
    await setSortOrder(appId, /5 erreurs|erreurs fatales/i, 2, '5 erreurs fatales');
  }

  // Vérif finale
  console.log('\n=== Vérif finale ===');
  for (const appId of ['bigwin', ...APPS]) {
    const top = await Gift.find({ appId }).sort({ sortOrder: 1, createdAt: -1 }).limit(5).lean();
    console.log(`  ${appId} (top 5 par sortOrder):`);
    for (const g of top) {
      const t = (g.title?.fr || g.title?.en || '').slice(0,50);
      console.log(`    so=${g.sortOrder} | act=${g.isActive} | "${t}"`);
    }
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
