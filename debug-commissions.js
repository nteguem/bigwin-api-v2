// debug-commissions.js - À placer dans votre projet Node.js
require('dotenv').config(); // Charger les variables d'environnement
const mongoose = require('mongoose');
const Commission = require('./src/api/models/common/Commission'); // Ajustez le chemin
const Subscription = require('./src/api/models/common/Subscription'); // Ajustez le chemin

// Remplacez par votre string de connexion MongoDB
const DB_CONNECTION = process.env.MONGO_URI;

async function investigateCorruptedCommissions() {
  try {
    await mongoose.connect(DB_CONNECTION);
    console.log('✅ Connecté à MongoDB');

    const corruptedIds = [
      "68a833198e59ce92585433dc",
      "6899f8554a70f2d4cfdea3b6", 
      "6898b57a4a70f2d4cfde1976",
      "689796bf4a70f2d4cfdda212",
      "68971fd9c52f49fc9abc8913",
      "68971d8d96bcc781fd894bda"
    ];

    console.log('\n=== 1. EXAMEN DES COMMISSIONS CORROMPUES ===');
    for (const id of corruptedIds) {
      const commission = await Commission.findById(id);
      if (commission) {
        console.log(`\nCommission ID: ${commission._id}`);
        console.log(`User ID: ${commission.user}`);
        console.log(`Subscription ID: ${commission.subscription}`);
        console.log(`Amount: ${commission.commissionAmount} ${commission.currency}`);
        console.log(`Created: ${commission.createdAt}`);
        console.log(`Month/Year: ${commission.month}/${commission.year}`);
      }
    }

    console.log('\n=== 2. VÉRIFICATION EXISTENCE DES SUBSCRIPTIONS ===');
    for (const id of corruptedIds) {
      const commission = await Commission.findById(id);
      if (commission && commission.subscription) {
        const subscription = await Subscription.findById(commission.subscription);
        console.log(`Commission ${id} -> Subscription ${commission.subscription}: ${subscription ? '✅ EXISTS' : '❌ MISSING'}`);
      } else {
        console.log(`Commission ${id} -> Subscription: ❌ NULL`);
      }
    }

    console.log('\n=== 3. RECHERCHE DE SUBSCRIPTIONS CANDIDATES ===');
    for (const id of corruptedIds) {
      const commission = await Commission.findById(id).populate('user');
      if (commission && commission.user) {
        const oneDayBefore = new Date(commission.createdAt.getTime() - 24*60*60*1000);
        const oneDayAfter = new Date(commission.createdAt.getTime() + 24*60*60*1000);

        const candidateSubscriptions = await Subscription.find({
          user: commission.user._id,
          createdAt: {
            $gte: oneDayBefore,
            $lte: oneDayAfter
          }
        }).populate('package');

        console.log(`\nCommission ${id} (${commission.user.phone}):`);
        console.log(`  Commission: ${commission.commissionAmount} ${commission.currency} le ${commission.createdAt}`);
        console.log(`  Subscriptions candidates: ${candidateSubscriptions.length}`);
        
        candidateSubscriptions.forEach((sub, index) => {
          console.log(`    ${index + 1}. ID: ${sub._id}`);
          console.log(`       Package: ${sub.package?.name || 'Unknown'}`);
          console.log(`       Amount: ${sub.pricing.amount} ${sub.pricing.currency}`);
          console.log(`       Date: ${sub.createdAt}`);
          
          // Vérifier si c'est un match probable
          const currencyMatch = sub.pricing.currency === commission.currency;
          console.log(`       Match devise: ${currencyMatch ? '✅' : '❌'}`);
        });
      }
    }

    console.log('\n=== 4. RECOMMANDATIONS ===');
    console.log('Basé sur l\'analyse ci-dessus, vous devriez:');
    console.log('1. Vérifier si des subscriptions ont été supprimées récemment');
    console.log('2. Si oui, annuler les commissions orphelines');
    console.log('3. Si non, essayer de réparer les références cassées');

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Déconnecté de MongoDB');
  }
}

// Exécuter l'investigation
investigateCorruptedCommissions();