// migrations/add-appId-to-existing-data.js

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Charger les variables d'environnement
dotenv.config();

// Import des modèles
const User = require('./src/api/models/user/User');
const Affiliate = require('./src/api/models/affiliate/Affiliate');
const AffiliateType = require('./src/api/models/affiliate/AffiliateType');
const Package = require('./src/api/models/common/Package');
const Category = require('./src/api/models/common/Category');
const Ticket = require('./src/api/models/common/Ticket');
const Prediction = require('./src/api/models/common/Prediction');
const Subscription = require('./src/api/models/common/Subscription');
const Commission = require('./src/api/models/common/Commission');
const Formation = require('./src/api/models/common/Formation');
const Device = require('./src/api/models/common/Device');
const Topic = require('./src/api/models/common/Topic');
const GooglePlayTransaction = require('./src/api/models/user/GooglePlayTransaction');
const CinetpayTransaction = require('./src/api/models/user/CinetpayTransaction');
const SmobilpayTransaction = require('./src/api/models/user/SmobilpayTransaction');
const AfribaPayTransaction = require('./src/api/models/user/AfribaPayTransaction');
const App = require('./src/api/models/common/App');

const DEFAULT_APP_ID = 'bigwin';

/**
 * Connexion à MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connexion MongoDB réussie');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
}

/**
 * Créer l'application bigwin si elle n'existe pas
 */
async function createBigwinApp() {
  try {
    const existingApp = await App.findOne({ appId: DEFAULT_APP_ID });
    
    if (existingApp) {
      console.log(`✅ L'application '${DEFAULT_APP_ID}' existe déjà`);
      return existingApp;
    }
    
    const bigwinApp = await App.create({
      appId: DEFAULT_APP_ID,
      name: 'BigWin',
      displayName: {
        fr: 'BigWin Pronos',
        en: 'BigWin Predictions'
      },
      description: {
        fr: 'Application de pronostics sportifs BigWin',
        en: 'BigWin sports predictions app'
      },
      googlePlay: {
        packageName: 'com.bigwin.application',
        serviceAccountKeyPath: './config/google-service-account.json'
      },
      oneSignal: {
        appId: '2daef6c5-6318-41b1-86d2-4c14420ab189',
        restApiKey: 'os_v2_app_fwxpnrlddba3dbwsjqkeecvrrfpgi55oaaculefntu3hdm44zo3jkjhbmfwd5zq4r4gz3xqavpkq3xwj5ebrtefbp4ji2pxrlyuygfq'
      },
      payments: {
        smobilpay: {
          apiUrl: 'https://s3pv2cm.smobilpay.com/v2',
          apiKey: 'd1a38446-bc57-469b-8f80-637529cea7d5',
          apiSecret: '43fdd3c0-ddb5-4984-90e9-27a2a3dd55c6',
          enabled: true
        },
        cinetpay: {
          xof: {
            siteId: '105899691',
            secretKey: '1996169631685cf5634bc441.43417923'
          },
          xaf: {
            siteId: '329705',
            secretKey: '7954945265bbf3983565ae9.99916042'
          },
          enabled: true,
          apiUrl: 'https://api-checkout.cinetpay.com/v2/payment'
        },
        afribapay: {
          apiUrl: 'https://api.afribapay.com',
          apiUser: 'pk_c6af254ff7e9d1cd254f5c99952550fc',
          apiKey: 'sk_04ZzDVPXEZBn3Uvhvd',
          merchantKey: 'mk_5501481uXP250703042851',
          enabled: true
        }
      },
      branding: {
        primaryColor: '#FF6B35',
        logo: 'https://res.cloudinary.com/nwccompany/image/upload/v1764532275/logo_lyfyso.png',
        icon: 'https://res.cloudinary.com/nwccompany/image/upload/v1764532275/logo_lyfyso.png'
      },
      isActive: true
    });
    
    console.log(`✅ Application '${DEFAULT_APP_ID}' créée avec succès`);
    return bigwinApp;
    
  } catch (error) {
    console.error('❌ Erreur création app bigwin:', error);
    throw error;
  }
}

/**
 * Supprimer tous les index composites avec appId pour User
 */
async function dropUserAppIdIndexes() {
  try {
    console.log('\n🗑️  Suppression temporaire des index User avec appId...');
    
    const collection = mongoose.connection.collection('users');
    const indexes = await collection.indexes();
    
    const indexesToDrop = [
      'appId_1_phoneNumber_1',
      'appId_1_dialCode_1_phoneNumber_1',
      'appId_1_email_1',
      'appId_1_googleId_1',
      'appId_1_pseudo_1'
    ];
    
    for (const indexName of indexesToDrop) {
      const indexExists = indexes.find(idx => idx.name === indexName);
      if (indexExists) {
        console.log(`   🗑️  Suppression de l'index: ${indexName}`);
        await collection.dropIndex(indexName);
        console.log(`   ✅ Index ${indexName} supprimé`);
      }
    }
    
    console.log('   ✅ Tous les index appId supprimés');
    
  } catch (error) {
    console.error('   ❌ Erreur suppression index:', error.message);
    throw error;
  }
}

/**
 * Recréer les index pour User avec la nouvelle logique
 */
async function recreateUserIndexes() {
  try {
    console.log('\n🔨 Recréation des index User avec nouvelle logique...');
    
    const collection = mongoose.connection.collection('users');
    
    // Index pour dialCode + phoneNumber (uniquement si les deux existent)
    await collection.createIndex(
      { appId: 1, dialCode: 1, phoneNumber: 1 },
      { 
        unique: true, 
        partialFilterExpression: { 
          phoneNumber: { $type: 'string' },
          dialCode: { $type: 'string' }
        },
        name: 'appId_1_dialCode_1_phoneNumber_1'
      }
    );
    console.log('   ✅ Index appId_dialCode_phoneNumber créé');
    
    // Index pour email (uniquement si email existe)
    await collection.createIndex(
      { appId: 1, email: 1 },
      { 
        unique: true, 
        partialFilterExpression: { email: { $type: 'string' } },
        name: 'appId_1_email_1'
      }
    );
    console.log('   ✅ Index appId_email créé');
    
    // Index pour googleId (uniquement si googleId existe)
    await collection.createIndex(
      { appId: 1, googleId: 1 },
      { 
        unique: true, 
        partialFilterExpression: { googleId: { $type: 'string' } },
        name: 'appId_1_googleId_1'
      }
    );
    console.log('   ✅ Index appId_googleId créé');
    
    // ❌ PSEUDO N'EST PLUS UNIQUE - Index retiré
    // Le pseudo peut être dupliqué entre utilisateurs
    
    // Index pour isActive (non unique)
    await collection.createIndex({ appId: 1, isActive: 1 });
    console.log('   ✅ Index appId_isActive créé');
    
    console.log('   ✅ Tous les index User recréés avec succès');
    
  } catch (error) {
    console.error('   ❌ Erreur recréation index:', error.message);
    throw error;
  }
}

/**
 * Migrer une collection
 */
async function migrateCollection(Model, collectionName) {
  try {
    console.log(`\n📦 Migration de ${collectionName}...`);
    
    // Compter les documents sans appId
    const countWithoutAppId = await Model.countDocuments({ appId: { $exists: false } });
    
    if (countWithoutAppId === 0) {
      console.log(`   ✅ Aucun document à migrer dans ${collectionName}`);
      return { updated: 0, total: 0 };
    }
    
    console.log(`   📊 ${countWithoutAppId} documents à migrer`);
    
    // Mettre à jour tous les documents sans appId
    const result = await Model.updateMany(
      { appId: { $exists: false } },
      { $set: { appId: DEFAULT_APP_ID } }
    );
    
    console.log(`   ✅ ${result.modifiedCount} documents migrés dans ${collectionName}`);
    
    return {
      updated: result.modifiedCount,
      total: countWithoutAppId
    };
    
  } catch (error) {
    console.error(`   ❌ Erreur migration ${collectionName}:`, error.message);
    throw error;
  }
}

/**
 * Fonction principale de migration
 */
async function migrate() {
  try {
    console.log('🚀 Début de la migration des données existantes vers multi-tenant\n');
    
    // Connexion à la DB
    await connectDB();
    
    // Créer l'app bigwin
    await createBigwinApp();
    
    // ÉTAPE 1: Supprimer les index problématiques AVANT la migration
    await dropUserAppIdIndexes();
    
    console.log('\n📋 Migration des collections...');
    
    const collections = [
      { model: User, name: 'Users' },
      { model: Affiliate, name: 'Affiliates' },
      { model: AffiliateType, name: 'AffiliateTypes' },
      { model: Package, name: 'Packages' },
      { model: Category, name: 'Categories' },
      { model: Ticket, name: 'Tickets' },
      { model: Prediction, name: 'Predictions' },
      { model: Subscription, name: 'Subscriptions' },
      { model: Commission, name: 'Commissions' },
      { model: Formation, name: 'Formations' },
      { model: Device, name: 'Devices' },
      { model: Topic, name: 'Topics' },
      { model: GooglePlayTransaction, name: 'GooglePlayTransactions' },
      { model: CinetpayTransaction, name: 'CinetpayTransactions' },
      { model: SmobilpayTransaction, name: 'SmobilpayTransactions' },
      { model: AfribaPayTransaction, name: 'AfribaPayTransactions' },
    ];
    
    const results = [];
    
    for (const collection of collections) {
      const result = await migrateCollection(collection.model, collection.name);
      results.push({ name: collection.name, ...result });
    }
    
    // ÉTAPE 2: Recréer les index APRÈS la migration
    await recreateUserIndexes();
    
    // Afficher le résumé
    console.log('\n' + '='.repeat(60));
    console.log('📊 RÉSUMÉ DE LA MIGRATION');
    console.log('='.repeat(60));
    
    let totalUpdated = 0;
    let totalDocuments = 0;
    
    results.forEach(result => {
      console.log(`${result.name.padEnd(30)} : ${result.updated}/${result.total} documents`);
      totalUpdated += result.updated;
      totalDocuments += result.total;
    });
    
    console.log('='.repeat(60));
    console.log(`TOTAL : ${totalUpdated}/${totalDocuments} documents migrés`);
    console.log('='.repeat(60));
    
    console.log('\n✅ Migration terminée avec succès !');
    console.log(`\n💡 Toutes les données existantes ont été assignées à l'app '${DEFAULT_APP_ID}'`);
    console.log(`\n🔑 Contraintes d'unicité:`);
    console.log(`   - appId + dialCode + phoneNumber (UNIQUE)`);
    console.log(`   - appId + email (UNIQUE)`);
    console.log(`   - appId + googleId (UNIQUE)`);
    console.log(`   - pseudo (NON UNIQUE - peut être dupliqué)`);
    
  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Déconnexion MongoDB');
  }
}

/**
 * Fonction de rollback (si besoin d'annuler la migration)
 */
async function rollback() {
  try {
    console.log('🔄 Début du rollback...\n');
    
    await connectDB();
    
    const collections = [
      User, Affiliate, AffiliateType, Package, Category, Ticket, 
      Prediction, Subscription, Commission, Formation, Device, Topic,
      GooglePlayTransaction, CinetpayTransaction, SmobilpayTransaction,
      AfribaPayTransaction
    ];
    
    for (const Model of collections) {
      const result = await Model.updateMany(
        { appId: DEFAULT_APP_ID },
        { $unset: { appId: "" } }
      );
      console.log(`✅ ${Model.collection.name}: ${result.modifiedCount} documents`);
    }
    
    // Supprimer l'app bigwin
    await App.deleteOne({ appId: DEFAULT_APP_ID });
    console.log(`✅ Application '${DEFAULT_APP_ID}' supprimée`);
    
    console.log('\n✅ Rollback terminé !');
    
  } catch (error) {
    console.error('❌ Erreur rollback:', error);
  } finally {
    await mongoose.connection.close();
  }
}

// Exécution
const args = process.argv.slice(2);

if (args.includes('--rollback')) {
  rollback();
} else {
  migrate();
}