require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/api/models/user/User');

async function fixMissingEmails() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bigwin', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('🔄 Recherche des users sans email...');
    
    // Trouver tous les users sans email ou avec email vide
    const usersWithoutEmail = await User.find({
      $or: [
        { email: null },
        { email: '' },
        { email: { $exists: false } }
      ],
      authProvider: 'local'
    });
    
    console.log(`📊 ${usersWithoutEmail.length} user(s) sans email trouvé(s)`);
    
    let updated = 0;
    for (const user of usersWithoutEmail) {
      if (user.phoneNumber) {
        const generatedEmail = `user${user.phoneNumber}@bigwinpronos.com`;
        
        // Vérifier que cet email n'existe pas déjà
        const existingEmail = await User.findOne({ email: generatedEmail });
        if (!existingEmail) {
          user.email = generatedEmail;
          await user.save();
          updated++;
          console.log(`✅ Email généré pour ${user.phoneNumber}: ${generatedEmail}`);
        }
      }
    }
    
    console.log(`✅ ${updated} user(s) mis à jour avec un email généré`);
    
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await mongoose.connection.close();
  }
}

fixMissingEmails();