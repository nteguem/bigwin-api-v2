require('dotenv').config();
const mongoose = require('mongoose');

async function migratePackages() {
  try {
    // Connexion à MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    const Package = require('./src/api/models/common/Package');

    // Migration : Mettre googleProductType = 'SUBSCRIPTION' pour les packages existants avec Google Play
    const result = await Package.updateMany(
      { 
        availableOnGooglePlay: true, 
        googleProductId: { $exists: true, $ne: null },
        googleProductType: { $exists: false }
      },
      { $set: { googleProductType: 'SUBSCRIPTION' } }
    );

    console.log(`✅ ${result.modifiedCount} packages mis à jour avec googleProductType: 'SUBSCRIPTION'`);

    // Vérification
    const updatedPackages = await Package.find({ 
      availableOnGooglePlay: true,
      googleProductType: { $exists: true }
    }).select('name googleProductId googleProductType');

    console.log('\n📦 Packages Google Play après migration :');
    updatedPackages.forEach(pkg => {
      console.log(`- ${pkg.name.fr}: ${pkg.googleProductType} (${pkg.googleProductId})`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Migration terminée');

  } catch (error) {
    console.error('❌ Erreur migration:', error);
    process.exit(1);
  }
}

migratePackages();