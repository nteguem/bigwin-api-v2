// ============================================================
// Migration MongoDB Shell - Categories bilingue (fr/en)
// Usage: mongosh "mongodb+srv://..." --file migrate-categories-bilingual.mongo.js
// Ou copier/coller dans MongoDB Compass > mongosh
// ============================================================

db = db.getSiblingDB('bigwin-dev');

// D'abord, supprimer l'ancien index
try {
  db.categories.dropIndex('appId_1_name_1');
  print('✅ Ancien index appId_1_name_1 supprimé');
} catch (e) {
  print('ℹ️  Ancien index non trouvé ou déjà supprimé');
}

// === SHARED ===

// Live (shared)
db.categories.updateOne(
  { _id: ObjectId("688f46a9909020ce94740a52") },
  { $set: {
    name: { fr: "Live", en: "Live" },
    description: { fr: "Pronostics en direct", en: "Live predictions" }
  }}
);

// === BIGWIN ===

// EDP
db.categories.updateOne(
  { _id: ObjectId("688f48b6909020ce94740a5d") },
  { $set: {
    name: { fr: "EDP", en: "EDP" },
    description: { fr: "Pronostic quotidien élite", en: "Elite Daily Prediction" }
  }}
);

// BDP
db.categories.updateOne(
  { _id: ObjectId("688f4923909020ce94740a63") },
  { $set: {
    name: { fr: "BDP", en: "BDP" },
    description: { fr: "Pronostic quotidien basique", en: "Basic Daily Prediction" }
  }}
);

// DFP
db.categories.updateOne(
  { _id: ObjectId("688f4b53909020ce94740a78") },
  { $set: {
    name: { fr: "DFP", en: "DFP" },
    description: { fr: "Pronostic gratuit du jour", en: "Daily Free Prediction" }
  }}
);

// MIX SPORT
db.categories.updateOne(
  { _id: ObjectId("688f5509909020ce94740af2") },
  { $set: {
    name: { fr: "MIX SPORT", en: "MIX SPORT" },
    description: { fr: "Pronostics combinés multi-sports - Football, Basketball, Tennis et plus avec cotes de 4+", en: "Multi-sport combined predictions - Football, Basketball, Tennis & more with 4+ odds" }
  }}
);

// PDP
db.categories.updateOne(
  { _id: ObjectId("689751f44a70f2d4cfdd8227") },
  { $set: {
    name: { fr: "PDP", en: "PDP" },
    description: { fr: "Pronostic quotidien premium", en: "Premium Daily Prediction" }
  }}
);

// TENNIS
db.categories.updateOne(
  { _id: ObjectId("68b706b4d746b887b19f8a94") },
  { $set: {
    name: { fr: "TENNIS", en: "TENNIS" },
    description: { fr: "Pronostic tennis", en: "Tennis Prediction" }
  }}
);

// HIPPIQUE
db.categories.updateOne(
  { _id: ObjectId("68ba652375f0233a6594349f") },
  { $set: {
    name: { fr: "HIPPIQUE", en: "HORSE RACING" },
    description: { fr: "Pronostic courses hippiques", en: "Horse Racing Prediction" }
  }}
);

// CDP
db.categories.updateOne(
  { _id: ObjectId("68c6cc9fc8382d8c744244fb") },
  { $set: {
    name: { fr: "CDP", en: "CDP" },
    description: { fr: "Pronostic quotidien classique", en: "Classic Daily Prediction" }
  }}
);

// CSJ
db.categories.updateOne(
  { _id: ObjectId("68e101305d973384fd8350ac") },
  { $set: {
    name: { fr: "CSJ", en: "SOTD" },
    description: { fr: "Coup sûr du jour - Cote de 3 garantie", en: "Sure bet of the day - Guaranteed odds of 3" }
  }}
);

// === GOATIPS ===

// Offre gratuite
db.categories.updateOne(
  { _id: ObjectId("6949b671a9e70426ccc3b025") },
  { $set: {
    name: { fr: "Offre gratuite", en: "Free Offer" },
    description: { fr: "Pronostic gratuit du jour", en: "Daily Free Prediction" }
  }}
);

// Offre vip
db.categories.updateOne(
  { _id: ObjectId("6949b6c2a9e70426ccc3b026") },
  { $set: {
    name: { fr: "Offre VIP", en: "VIP Offer" },
    description: { fr: "Pronostic VIP du jour", en: "Daily VIP Prediction" }
  }}
);

// === GOODTIPS ===

// Offre Premium
db.categories.updateOne(
  { _id: ObjectId("69651d2b194afe8fb081e517") },
  { $set: {
    name: { fr: "Offre Premium", en: "Premium Offer" },
    description: { fr: "Des pronostics VIP quotidiens, analysés par nos experts", en: "Daily VIP predictions, analyzed by our experts" }
  }}
);

// Offre Basique
db.categories.updateOne(
  { _id: ObjectId("69808096c5261c655e6d5b0d") },
  { $set: {
    name: { fr: "Offre Basique", en: "Basic Offer" },
    description: { fr: "Des pronostics quotidiens de base pour débuter", en: "Basic daily predictions to get started" }
  }}
);

// === WISETIPS ===

// EASY WIN
db.categories.updateOne(
  { _id: ObjectId("696ca3f28a215fcc10ee5c2d") },
  { $set: {
    name: { fr: "EASY WIN | 3.5+ ODDS", en: "EASY WIN | 3.5+ ODDS" },
    description: { fr: "Pronostics rapides sur 2 jours avec cotes garanties de 3.5+", en: "Quick 2-day predictions with guaranteed odds 3.5+" }
  }}
);

// FREE DAILY TIPS (wisetips)
db.categories.updateOne(
  { _id: ObjectId("696cd6c18a215fcc10ee5c34") },
  { $set: {
    name: { fr: "FREE DAILY TIPS", en: "FREE DAILY TIPS" },
    description: { fr: "Découvrez nos pronostics avec des conseils gratuits quotidiens", en: "Discover our predictions with free daily tips" }
  }}
);

// === STRATEGYTIPS ===

// PRO STRATEGY
db.categories.updateOne(
  { _id: ObjectId("696cd57a8a215fcc10ee5c32") },
  { $set: {
    name: { fr: "PRO STRATEGY | 3.5+ ODDS", en: "PRO STRATEGY | 3.5+ ODDS" },
    description: { fr: "Pronostics stratégiques professionnels sur 3 jours avec cotes garanties de 3.5+", en: "Professional 3-day strategic predictions with guaranteed odds 3.5+" }
  }}
);

// FREE DAILY STRATEGY (strategytips)
db.categories.updateOne(
  { _id: ObjectId("696cd6e88a215fcc10ee5c35") },
  { $set: {
    name: { fr: "FREE DAILY STRATEGY", en: "FREE DAILY STRATEGY" },
    description: { fr: "Découvrez nos pronostics avec des conseils gratuits quotidiens", en: "Discover our predictions with free daily tips" }
  }}
);

// Recréer l'index unique sur name.fr
db.categories.createIndex({ appId: 1, 'name.fr': 1 }, { unique: true });
print('✅ Nouvel index appId_1_name.fr_1 créé');

// Vérification
print('\n📊 Vérification - toutes les catégories migrées :');
db.categories.find({}, { name: 1, description: 1, appId: 1 }).forEach(cat => {
  print(`  [${cat.appId}] ${JSON.stringify(cat.name)} | ${JSON.stringify(cat.description)}`);
});

print('\n✅ Migration terminée !');
