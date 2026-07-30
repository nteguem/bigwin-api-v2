// scripts/check-admob-credentials.js
//
// Verifie que les identifiants AdMob du .env donnent bien acces au compte
// attendu, AVANT de basculer quoi que ce soit en base.
//
//   node scripts/check-admob-credentials.js
//
// accounts.list renvoie les comptes auxquels le refresh token donne acces :
// c'est la preuve directe que le token appartient au bon compte Google.

require('dotenv').config();
const { google } = require('googleapis');

const ATTENDU = 'pub-1646156961307365'; // nouveau compte
const ANCIEN = 'pub-1782439846938659';

async function main() {
  const manquantes = ['ADMOB_CLIENT_ID', 'ADMOB_CLIENT_SECRET', 'ADMOB_REFRESH_TOKEN', 'ADMOB_PUBLISHER_ID']
    .filter((k) => !process.env[k]);
  if (manquantes.length) {
    console.error('Variables manquantes :', manquantes.join(', '));
    process.exit(1);
  }

  const configure = process.env.ADMOB_PUBLISHER_ID;
  console.log('ADMOB_PUBLISHER_ID configure :', configure);
  console.log('');

  const auth = new google.auth.OAuth2(
    process.env.ADMOB_CLIENT_ID,
    process.env.ADMOB_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  auth.setCredentials({ refresh_token: process.env.ADMOB_REFRESH_TOKEN });

  const admob = google.admob({ version: 'v1', auth });

  // 1) A quels comptes ce token donne-t-il acces ?
  let comptes = [];
  try {
    const res = await admob.accounts.list({});
    comptes = res.data.account || [];
  } catch (err) {
    console.error('Echec de accounts.list :', err.message);
    if (String(err.message).includes('invalid_grant')) {
      console.error('  -> le refresh token est invalide, revoque, ou lie a un autre compte Google.');
    }
    if (String(err.message).includes('403') || String(err.message).includes('PERMISSION_DENIED')) {
      console.error('  -> API AdMob non activee sur le projet Cloud, ou compte sans acces.');
    }
    process.exit(1);
  }

  if (!comptes.length) {
    console.error('Le token est valide mais ne donne acces a aucun compte AdMob.');
    process.exit(1);
  }

  console.log('Comptes accessibles avec ce token :');
  comptes.forEach((c) => {
    const id = (c.name || '').replace('accounts/', '');
    let note = '';
    if (id === ATTENDU) note = '  <-- nouveau compte, attendu';
    else if (id === ANCIEN) note = '  <-- ANCIEN compte';
    console.log(`   ${id}   devise=${c.currencyCode || '?'}   fuseau=${c.reportingTimeZone || '?'}${note}`);
  });
  console.log('');

  const ids = comptes.map((c) => (c.name || '').replace('accounts/', ''));

  if (!ids.includes(configure)) {
    console.error(`PROBLEME : ADMOB_PUBLISHER_ID vaut "${configure}" mais le token n'y donne pas acces.`);
    console.error('Corrigez la variable, ou regenerez le token avec le bon compte Google.');
    process.exit(1);
  }

  // 2) Requete de rapport reelle sur les 7 derniers jours.
  const fin = new Date();
  const debut = new Date(fin.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d = (x) => ({ year: x.getFullYear(), month: x.getMonth() + 1, day: x.getDate() });

  try {
    const res = await admob.accounts.networkReport.generate({
      parent: `accounts/${configure}`,
      requestBody: {
        reportSpec: {
          dateRange: { startDate: d(debut), endDate: d(fin) },
          dimensions: ['APP'],
          metrics: ['ESTIMATED_EARNINGS', 'IMPRESSIONS'],
        },
      },
    });

    const lignes = (res.data || []).filter((i) => i.row);
    console.log(`Rapport 7 jours : ${lignes.length} ligne(s) par app.`);
    if (!lignes.length) {
      console.log('Aucune donnee — normal si les apps viennent de basculer sur ce compte.');
    }
    lignes.forEach((i) => {
      const app = i.row.dimensionValues?.APP;
      const gains = i.row.metricValues?.ESTIMATED_EARNINGS?.microsValue;
      const imp = i.row.metricValues?.IMPRESSIONS?.integerValue;
      console.log(
        `   ${app?.value || '?'}  ${app?.displayLabel || ''}  ` +
        `gains=${gains ? (parseFloat(gains) / 1e6).toFixed(2) : 0}  impressions=${imp || 0}`
      );
    });
    console.log('');
    console.log('OK — les identifiants fonctionnent sur le compte attendu.');
    console.log('Les valeurs de la colonne APP ci-dessus sont celles que le script');
    console.log('migrate-admob-account.js doit retrouver dans App.admobAppId.');
  } catch (err) {
    console.error('accounts.list a fonctionne mais le rapport a echoue :', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
