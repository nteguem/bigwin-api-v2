// scripts/backup-affiliation-legacy.js
//
// Dump JSON local des collections legacy d'affiliation, AVANT le wipe.
// Read-only sur MongoDB, écriture seulement dans /backup-affiliation-legacy/.
//
// Couvre :
//   - Collection `affiliates`       (54 docs attendus)
//   - Collection `affiliatetypes`   (3 docs)
//   - Collection `commissions`      (1002 docs — historique compta)
//   - Subset `users` ayant un `referredBy != null` (8758 docs — pour pouvoir
//     restaurer le lien affilié↔user en cas de problème)
//
// Aucune modification BD. Idempotent (re-run = re-écrit les fichiers).
//
// Usage :
//   node scripts/backup-affiliation-legacy.js

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'backup-affiliation-legacy');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB');
  console.log('📦 Backup vers : ' + OUT_DIR);
  console.log('');

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const manifest = {
    backupDate: new Date().toISOString(),
    mongoUri: 'redacted',
    dbName: mongoose.connection.name,
    collections: {},
  };

  const dump = async (collectionName, query = {}, file) => {
    const col = mongoose.connection.collection(collectionName);
    const docs = await col.find(query).toArray();
    const filePath = path.join(OUT_DIR, file);
    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
    console.log(`   ✅ ${collectionName} → ${file} (${docs.length} docs, ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
    manifest.collections[collectionName] = {
      count: docs.length,
      file,
      sizeKB: +(fs.statSync(filePath).size / 1024).toFixed(1),
    };
  };

  console.log('Dumping...');
  await dump('affiliates', {}, `affiliates-${timestamp}.json`);
  await dump('affiliatetypes', {}, `affiliatetypes-${timestamp}.json`);
  await dump('commissions', {}, `commissions-${timestamp}.json`);
  await dump(
    'users',
    { referredBy: { $exists: true, $ne: null } },
    `users-with-referredBy-${timestamp}.json`
  );

  // Manifest de référence
  const manifestPath = path.join(OUT_DIR, `manifest-${timestamp}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`   ✅ manifest → manifest-${timestamp}.json`);

  console.log('');
  console.log('📊 Résumé :');
  Object.entries(manifest.collections).forEach(([k, v]) => {
    console.log(`   ${k}: ${v.count} docs (${v.sizeKB} KB)`);
  });
  console.log('');
  console.log('📂 Tous les fichiers dans : ' + OUT_DIR);
  console.log('');
  console.log('⚠️  IMPORTANT : ces fichiers contiennent des données SENSIBLES');
  console.log('   (tokens, hash mots de passe affiliés, infos paiement).');
  console.log('   À déplacer hors du repo avant tout commit / push.');
  console.log('   Le dossier /backup-affiliation-legacy est ajouté au .gitignore.');

  await mongoose.disconnect();
  console.log('\n✅ Backup terminé');
})().catch((e) => {
  console.error('❌ Erreur :', e);
  process.exit(1);
});
