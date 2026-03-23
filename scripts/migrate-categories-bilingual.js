/**
 * Migration script: Convert Category name/description from String to { fr, en }
 *
 * Usage: node scripts/migrate-categories-bilingual.js
 *
 * This script:
 * 1. Finds all categories where name is a plain string (not yet migrated)
 * 2. Converts name: "CSJ" → name: { fr: "CSJ", en: "CSJ" }
 * 3. Converts description: "Coup sur du jour" → description: { fr: "Coup sur du jour", en: "Coup sur du jour" }
 *
 * NOTE: After migration, you should manually update the English translations.
 * The script copies the French text to both languages as a safe default.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/bigwin';

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoURI);
  console.log('✅ Connected');

  const db = mongoose.connection.db;
  const collection = db.collection('categories');

  // Find categories where name is still a string (not yet migrated)
  const categories = await collection.find({
    name: { $type: 'string' }
  }).toArray();

  console.log(`📋 Found ${categories.length} categories to migrate`);

  if (categories.length === 0) {
    console.log('✅ Nothing to migrate - all categories already have bilingual format');
    await mongoose.disconnect();
    return;
  }

  let migrated = 0;
  let errors = 0;

  for (const cat of categories) {
    try {
      const oldName = cat.name;
      const oldDesc = cat.description || '';

      await collection.updateOne(
        { _id: cat._id },
        {
          $set: {
            name: { fr: oldName, en: oldName },
            description: { fr: oldDesc, en: oldDesc }
          }
        }
      );

      migrated++;
      console.log(`  ✅ [${cat.appId}] "${oldName}" → { fr: "${oldName}", en: "${oldName}" }`);
    } catch (err) {
      errors++;
      console.error(`  ❌ [${cat.appId}] "${cat.name}" - Error: ${err.message}`);
    }
  }

  console.log(`\n📊 Migration complete: ${migrated} migrated, ${errors} errors`);
  console.log('⚠️  Remember to update English translations manually!');

  // Drop old index and recreate
  try {
    await collection.dropIndex('appId_1_name_1');
    console.log('🗑️  Dropped old index appId_1_name_1');
  } catch (e) {
    console.log('ℹ️  Old index not found or already dropped');
  }

  try {
    await collection.createIndex({ appId: 1, 'name.fr': 1 }, { unique: true });
    console.log('✅ Created new index appId_1_name.fr_1');
  } catch (e) {
    console.error('❌ Error creating index:', e.message);
  }

  await mongoose.disconnect();
  console.log('🔌 Disconnected');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
