#!/usr/bin/env node
// scripts/download-geoip-db.js
//
// Télécharge la base GeoLite2-Country (MMDB) depuis MaxMind en utilisant
// la license key configurée dans .env (MAXMIND_LICENSE_KEY).
//
// La DB est extraite vers data/geoip/GeoLite2-Country.mmdb. À lancer :
//   - une fois après le 1er déploiement
//   - puis chaque mois (cron) pour récupérer la version à jour
//
// MaxMind publie une nouvelle version le 1er mardi de chaque mois.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const tar = require('tar');
const os = require('os');

const LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY;
const DB_DIR = path.join(__dirname, '..', 'data', 'geoip');
const DB_PATH = path.join(DB_DIR, 'GeoLite2-Country.mmdb');

if (!LICENSE_KEY) {
  console.error('❌ MAXMIND_LICENSE_KEY manquant dans .env');
  console.error('');
  console.error('Étapes pour en obtenir une (gratuit, 5 min) :');
  console.error('  1. Créer un compte sur https://www.maxmind.com/en/geolite2/signup');
  console.error('  2. Une fois connecté → My License Key → Generate new license key');
  console.error('  3. Copier la clé dans .env :');
  console.error('     MAXMIND_LICENSE_KEY=votre_license_key_ici');
  process.exit(1);
}

const URL = `https://download.maxmind.com/app/geoip_download` +
  `?edition_id=GeoLite2-Country&license_key=${encodeURIComponent(LICENSE_KEY)}&suffix=tar.gz`;

console.log('📥 Téléchargement de GeoLite2-Country.mmdb depuis MaxMind...');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const tmpFile = path.join(os.tmpdir(), `geolite2-${Date.now()}.tar.gz`);

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        file.close();
        fs.unlinkSync(dest);
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} : ${res.statusMessage}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function extract() {
  // Le tarball MaxMind contient un dossier GeoLite2-Country_YYYYMMDD/
  // avec dedans GeoLite2-Country.mmdb. On parcourt et on extrait juste le .mmdb.
  return new Promise((resolve, reject) => {
    fs.createReadStream(tmpFile)
      .pipe(zlib.createGunzip())
      .pipe(tar.t({
        onentry: (entry) => {
          if (entry.path.endsWith('GeoLite2-Country.mmdb')) {
            const out = fs.createWriteStream(DB_PATH);
            entry.pipe(out);
            out.on('finish', () => {
              console.log(`✅ DB extraite vers ${DB_PATH}`);
            });
          } else {
            entry.resume();
          }
        }
      }))
      .on('end', resolve)
      .on('error', reject);
  });
}

(async () => {
  try {
    await download(URL, tmpFile);
    console.log('✅ Archive téléchargée');
    await extract();
    fs.unlinkSync(tmpFile);
    const stat = fs.statSync(DB_PATH);
    console.log(`✅ Done. Taille DB : ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ Échec :', err.message);
    process.exit(1);
  }
})();
