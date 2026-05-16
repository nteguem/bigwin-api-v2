// Migration : Category.appIds — multi-app sur les catégories
// ============================================================
//
// Pour chaque categorie existante :
//   - Si appId === "shared"  -> appIds = [toutes les apps actives en BD]
//                               (preserve le comportement Live Events legacy)
//   - Sinon                  -> appIds = [appId]
//                               (mono-app, comportement legacy identique)
//
// Idempotent :
//   - Si appIds est deja peuple ET inclut l'appId proprietaire -> skip
//   - Si invariant casse (appId absent de appIds) -> on l'ajoute
//
// Modes :
//   node scripts/migrate-categories-to-appids.js              # dry-run
//   node scripts/migrate-categories-to-appids.js --apply      # applique
//
// Utilise updateOne direct pour bypass les hooks Mongoose (pas de side-effect).

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const App = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
const Category = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Category'));

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY' : 'DRY-RUN';

function showCategory(c, action) {
  const name = c.name?.fr || c.name?.en || c.name || '?';
  console.log(`  ${action} _id=${c._id} | appId="${c.appId}" | name="${name}" | appIds(avant)=${JSON.stringify(c.appIds || [])}`);
}

(async () => {
  console.log(`\n=== Migration Category.appIds [${MODE}] ===\n`);
  if (!APPLY) {
    console.log('  ℹ️  Mode dry-run par defaut — aucune ecriture en BD.');
    console.log('  ℹ️  Pour appliquer : ajoute le flag --apply\n');
  }

  await mongoose.connect(process.env.MONGO_URI);

  // Liste des apps actives (pour la conversion shared -> appIds=[...])
  const activeApps = await App.find({ isActive: true }).select('appId').lean();
  const activeAppIds = activeApps.map(a => a.appId);
  console.log(`📊 ${activeAppIds.length} apps actives : ${activeAppIds.join(', ')}\n`);

  const stats = {
    total: 0,
    sharedConverted: 0,
    monoInit: 0,
    alreadyOk: 0,
    fixInvariant: 0,
    applied: 0,
  };

  // .lean() pour bypass le default function du schema (qui mentirait
  // sur l'etat reel en BD).
  const cursor = Category.find({}).lean().cursor();

  for await (const c of cursor) {
    stats.total++;
    const isShared = c.appId === 'shared';
    const currentAppIds = Array.isArray(c.appIds) ? c.appIds : [];
    const hasAppIds = currentAppIds.length > 0;

    if (isShared) {
      // Categorie shared -> appIds = [toutes les apps actives]
      const desired = activeAppIds.slice();
      const sameContent = currentAppIds.length === desired.length &&
        desired.every(a => currentAppIds.includes(a));
      if (sameContent) {
        stats.alreadyOk++;
        continue;
      }
      showCategory(c, '🌍 shared -> all apps');
      stats.sharedConverted++;
      if (APPLY) {
        await Category.updateOne({ _id: c._id }, { $set: { appIds: desired } });
        stats.applied++;
      }
    } else {
      // Categorie mono-app
      const ownerInList = hasAppIds && currentAppIds.includes(c.appId);
      if (hasAppIds && ownerInList) {
        stats.alreadyOk++;
        continue;
      }
      if (hasAppIds && !ownerInList) {
        // Invariant casse : ajoute l'appId proprietaire
        showCategory(c, '🔧 fix invariant');
        stats.fixInvariant++;
        if (APPLY) {
          await Category.updateOne(
            { _id: c._id },
            { $addToSet: { appIds: c.appId } }
          );
          stats.applied++;
        }
        continue;
      }
      // Pas de appIds -> init avec [appId]
      showCategory(c, '➕ mono init');
      stats.monoInit++;
      if (APPLY) {
        await Category.updateOne(
          { _id: c._id },
          { $set: { appIds: [c.appId] } }
        );
        stats.applied++;
      }
    }
  }

  console.log(`\n=== Resume ===`);
  console.log(`  Total Categories            : ${stats.total}`);
  console.log(`  shared -> all apps          : ${stats.sharedConverted}`);
  console.log(`  mono-app initialise          : ${stats.monoInit}`);
  console.log(`  fix invariant (appId added) : ${stats.fixInvariant}`);
  console.log(`  deja OK                      : ${stats.alreadyOk}`);
  if (APPLY) {
    console.log(`  ✅ applied                   : ${stats.applied}`);

    console.log(`\n=== Verif post-migration ===`);
    const sharedNoAppIds = await Category.countDocuments({
      appId: 'shared',
      $or: [{ appIds: { $exists: false } }, { appIds: { $size: 0 } }],
    });
    const monoNoAppIds = await Category.countDocuments({
      appId: { $ne: 'shared' },
      $or: [{ appIds: { $exists: false } }, { appIds: { $size: 0 } }],
    });
    console.log(`  Categories shared sans appIds : ${sharedNoAppIds} (attendu 0)`);
    console.log(`  Categories mono sans appIds   : ${monoNoAppIds} (attendu 0)`);

    const sample = await Category.findOne({ appIds: { $exists: true, $not: { $size: 0 } } }).lean();
    if (sample) {
      console.log(`\n  Sample : _id=${sample._id}`);
      console.log(`    appId    : "${sample.appId}"`);
      console.log(`    appIds   : ${JSON.stringify(sample.appIds)}`);
    }
  }

  await mongoose.disconnect();
  console.log(`\n=== ${MODE} terminé ===\n`);
})().catch(e => { console.error(e); process.exit(1); });
