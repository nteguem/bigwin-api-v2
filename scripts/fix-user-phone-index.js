// scripts/fix-user-phone-index.js
//
// One-off : drop l'ancien index unique `appId_1_dialCode_1_phoneNumber_1` qui
// était créé en `sparse` — `sparse` n'exclut que les champs ABSENTS, pas les
// `null` explicites, donc le 2e user Google d'une app (créé avec dialCode:null,
// phoneNumber:null) entrait en collision unique sur {appId,null,null} → 500 à
// l'auth Google. Le schéma a été corrigé (partialFilterExpression) ; après ce
// script, redémarre le backend → Mongoose recrée le bon index via autoIndex.
//
//   Usage (depuis le dossier du backend) :  node scripts/fix-user-phone-index.js

const mongoose = require('mongoose');
try { require('dotenv').config(); } catch (_) { /* dotenv facultatif */ }

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI manquant (dans .env ou en variable d\'environnement).');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const coll = mongoose.connection.db.collection('users');
  const before = await coll.indexes();
  console.log('Index "users" avant :', before.map((i) => i.name).join(', '));

  try {
    await coll.dropIndex('appId_1_dialCode_1_phoneNumber_1');
    console.log('✅ Index "appId_1_dialCode_1_phoneNumber_1" droppé.');
  } catch (e) {
    console.log('ℹ️  dropIndex :', e.codeName || e.message, '(déjà absent ?)');
  }

  console.log('→ Redémarre le backend (ex. `pm2 restart bigwin-old-api`) : Mongoose recréera l\'index en partial.');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Erreur :', e.message);
  process.exit(1);
});
