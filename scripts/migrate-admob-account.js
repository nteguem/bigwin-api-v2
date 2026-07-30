// scripts/migrate-admob-account.js
//
// Bascule les identifiants AdMob stockes en base de l'ancien compte
// pub-1782439846938659 vers le nouveau pub-1646156961307365.
//
// Ces champs ne sont exposes par aucun ecran d'admin : ils ont ete ecrits
// directement en base, d'ou ce script.
//
//   node scripts/migrate-admob-account.js           -> inspection seule, n'ecrit rien
//   node scripts/migrate-admob-account.js --apply   -> applique les changements
//
// Concerne les 5 apps servies par ce backend. predict_foot et win_tips
// dependent d'un autre backend et ne sont pas traites ici.

require('dotenv').config();
const mongoose = require('mongoose');
const App = require('../src/api/models/common/App');

const ANCIEN = 'ca-app-pub-1782439846938659';
const NOUVEAU = 'ca-app-pub-1646156961307365';

// ancien identifiant -> nouvel identifiant
const APP_IDS = {
  '~6951224910': '~2703983137', // bigwin
  '~2113120764': '~5242166465', // goat_tips
  '~8625188648': '~4555770754', // good_tips
  '~7625673995': '~2811710175', // strategy_tips
  '~5795807337': '~7014533271', // wise_tips
};

const REWARDED = {
  '/8638382119': '/5297090877', // bigwin
  '/6026113911': '/8858243770', // goat_tips
  '/1777422614': '/3270875179', // good_tips
  '/8970186462': '/6404873195', // strategy_tips
  '/6449978686': '/8579730532', // wise_tips
};

// Traduit une valeur stockee vers sa contrepartie sur le nouveau compte.
// Tolere les deux formats rencontres : avec ou sans le prefixe ca-app-pub-.
function traduire(valeur, table) {
  if (!valeur) return null;
  for (const [avant, apres] of Object.entries(table)) {
    if (valeur.endsWith(avant)) {
      return valeur.startsWith(ANCIEN)
        ? NOUVEAU + apres
        : valeur.replace(avant, apres);
    }
  }
  return null;
}

async function main() {
  const appliquer = process.argv.includes('--apply');

  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    console.error('MONGODB_URI absent du .env — abandon.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const apps = await App.find({}).select('appId displayName admobAppId admobRewardedAdUnitId');

  console.log(appliquer ? '=== APPLICATION DES CHANGEMENTS ===' : '=== INSPECTION (aucune ecriture) ===');
  console.log('');

  let aChanger = 0;
  let inconnus = 0;

  for (const app of apps) {
    const nouveauAppId = traduire(app.admobAppId, APP_IDS);
    const nouveauRewardAndroid = traduire(app.admobRewardedAdUnitId?.android, REWARDED);

    const rienAFaire = !nouveauAppId && !nouveauRewardAndroid;

    // Signale les valeurs qui referencent l'ancien compte sans correspondance
    // connue : elles resteraient orphelines apres migration.
    const orphelin =
      rienAFaire &&
      [app.admobAppId, app.admobRewardedAdUnitId?.android].some(
        (v) => v && v.startsWith(ANCIEN)
      );

    if (rienAFaire && !orphelin) continue;

    console.log(`${app.appId || app._id} — ${app.displayName || ''}`);
    if (orphelin) {
      inconnus++;
      console.log('   !! reference l ancien compte mais aucune correspondance connue');
      console.log(`      admobAppId  : ${app.admobAppId}`);
      console.log(`      rewarded    : ${app.admobRewardedAdUnitId?.android}`);
      console.log('');
      continue;
    }

    aChanger++;
    if (nouveauAppId) {
      console.log(`   admobAppId  : ${app.admobAppId}  ->  ${nouveauAppId}`);
    }
    if (nouveauRewardAndroid) {
      console.log(`   rewarded    : ${app.admobRewardedAdUnitId.android}  ->  ${nouveauRewardAndroid}`);
    }

    if (appliquer) {
      if (nouveauAppId) app.admobAppId = nouveauAppId;
      if (nouveauRewardAndroid) app.admobRewardedAdUnitId.android = nouveauRewardAndroid;
      await app.save();
      console.log('   enregistre');
    }
    console.log('');
  }

  console.log('---');
  console.log(`${aChanger} app(s) a migrer, ${inconnus} valeur(s) orpheline(s), ${apps.length} app(s) en base.`);
  if (!appliquer && aChanger > 0) {
    console.log('Relancer avec --apply pour ecrire les changements.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
