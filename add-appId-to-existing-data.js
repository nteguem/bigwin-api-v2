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
const DpoPayTransaction = require('./src/api/models/user/DpoPayTransaction');
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
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
        serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
      },
      oneSignal: {
        appId: process.env.ONESIGNAL_APP_ID,
        restApiKey: process.env.ONESIGNAL_REST_API_KEY
      },
      payments: {
        smobilpay: {
          apiUrl: process.env.SMOBILPAY_API_URL,
          apiKey: process.env.SMOBILPAY_API_KEY,
          apiSecret: process.env.SMOBILPAY_API_SECRET,
          enabled: true
        },
        cinetpay: {
          xof: {
            apiKey: process.env.CINETPAY_XOF_API_KEY,
            siteId: process.env.CINETPAY_XOF_SITE_ID,
            secretKey: process.env.CINETPAY_XOF_SECRET_KEY
          },
          xaf: {
            apiKey: process.env.CINETPAY_XAF_API_KEY,
            siteId: process.env.CINETPAY_XAF_SITE_ID,
            secretKey: process.env.CINETPAY_XAF_SECRET_KEY
          },
          enabled: true
        },
        afribapay: {
          apiUrl: process.env.AFRIBAPAY_API_URL,
          apiUser: process.env.AFRIBAPAY_API_USER,
          apiKey: process.env.AFRIBAPAY_API_KEY,
          merchantKey: process.env.AFRIBAPAY_MERCHANT_KEY,
          enabled: true
        },
        dpopay: {
          companyToken: process.env.DPO_COMPANY_TOKEN,
          serviceType: process.env.DPO_SERVICE_TYPE,
          enabled: true
        }
      },
      branding: {
        primaryColor: '#FF6B35',
        logo: '/assets/bigwin-logo.png',
        icon: '/assets/bigwin-icon.png'
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
      { model: DpoPayTransaction, name: 'DpoPayTransactions' }
    ];
    
    const results = [];
    
    for (const collection of collections) {
      const result = await migrateCollection(collection.model, collection.name);
      results.push({ name: collection.name, ...result });
    }
    
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
      AfribaPayTransaction, DpoPayTransaction
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