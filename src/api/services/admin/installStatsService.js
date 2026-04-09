// src/api/services/admin/installStatsService.js
// Service pour récupérer les stats d'installations depuis Google Cloud Storage

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const logger = require('../../../utils/logger');
const App = require('../../models/common/App');

const GCS_BUCKET = 'pubsite_prod_6527488144572965454';
const STATS_PREFIX = 'stats/installs/';
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '../../../../config/google-service-account.json');

let storageClient = null;

function getStorage() {
  if (!storageClient) {
    storageClient = new Storage({
      keyFilename: SERVICE_ACCOUNT_PATH,
    });
  }
  return storageClient;
}

/**
 * Lire et parser un fichier CSV d'installs depuis GCS
 * Format: Date,Package Name,Current Device Installs,Daily Device Installs,Daily Device Uninstalls,
 *         Daily Device Upgrades,Current User Installs,Total User Installs,Daily User Installs,Daily User Uninstalls
 */
function parseCsv(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || '';
    });
    return row;
  });
}

/**
 * Lister les fichiers CSV disponibles dans le bucket
 */
async function listAvailableFiles() {
  const storage = getStorage();
  const [files] = await storage.bucket(GCS_BUCKET).getFiles({
    prefix: STATS_PREFIX,
  });
  return files.map(f => f.name).filter(n => n.endsWith('.csv'));
}

/**
 * Télécharger et parser un fichier CSV
 */
async function downloadAndParse(fileName) {
  const storage = getStorage();
  const [content] = await storage.bucket(GCS_BUCKET).file(fileName).download();
  return parseCsv(content.toString('utf-8'));
}

/**
 * Récupérer le fichier le plus récent (format: installs_PKGNAME_YYYYMM_overview.csv)
 */
function getMostRecentFile(files) {
  // Trier par date décroissante (les noms contiennent YYYYMM)
  return files.sort().reverse()[0] || null;
}

/**
 * Récupérer les stats d'installation pour toutes les apps
 * Retourne les installs actuels, installs du jour, et tendance
 */
async function getInstallStats() {
  // Charger les apps depuis la DB
  const apps = await App.find({ isActive: true })
    .select('appId displayName branding googlePlay')
    .lean();

  const packageToApp = {};
  apps.forEach(app => {
    if (app.googlePlay?.packageName) {
      packageToApp[app.googlePlay.packageName] = app;
    }
  });

  // Lister tous les fichiers CSV
  let files;
  try {
    files = await listAvailableFiles();
  } catch (err) {
    logger.error('[INSTALLS] Erreur listing GCS files:', err.message);
    throw new Error('Impossible d\'accéder au bucket Google Play Stats');
  }

  if (files.length === 0) {
    return { apps: [], fetchedAt: new Date().toISOString() };
  }

  // Grouper les fichiers par package name
  const filesByPackage = {};
  files.forEach(f => {
    // Format: stats/installs/installs_com.bigwin.application_YYYYMM_overview.csv
    const match = f.match(/installs_([^_]+\.[^_]+(?:\.[^_]+)*)_(\d{6})_/);
    if (match) {
      const pkg = match[1];
      if (!filesByPackage[pkg]) filesByPackage[pkg] = [];
      filesByPackage[pkg].push(f);
    }
  });

  // Pour chaque app, prendre le fichier le plus récent et extraire les dernières données
  const results = await Promise.all(
    Object.entries(filesByPackage)
      .filter(([pkg]) => packageToApp[pkg]) // seulement nos apps
      .map(async ([pkg, pkgFiles]) => {
        try {
          const latestFile = getMostRecentFile(pkgFiles);
          if (!latestFile) return null;

          const rows = await downloadAndParse(latestFile);
          if (rows.length === 0) return null;

          // Dernière ligne = données les plus récentes
          const latest = rows[rows.length - 1];
          // Avant-dernière pour calculer la tendance
          const previous = rows.length > 1 ? rows[rows.length - 2] : null;

          const currentInstalls = parseInt(latest['Current Device Installs'] || latest['Current User Installs'] || '0');
          const totalInstalls = parseInt(latest['Total User Installs'] || '0');
          const dailyInstalls = parseInt(latest['Daily Device Installs'] || latest['Daily User Installs'] || '0');
          const dailyUninstalls = parseInt(latest['Daily Device Uninstalls'] || latest['Daily User Uninstalls'] || '0');

          const prevDaily = previous ? parseInt(previous['Daily Device Installs'] || previous['Daily User Installs'] || '0') : 0;
          const trend = prevDaily > 0 ? Math.round(((dailyInstalls - prevDaily) / prevDaily) * 100) : 0;

          const app = packageToApp[pkg];
          return {
            appId: app.appId,
            displayName: app.displayName,
            branding: app.branding,
            packageName: pkg,
            currentInstalls,
            totalInstalls,
            dailyInstalls,
            dailyUninstalls,
            netDaily: dailyInstalls - dailyUninstalls,
            trend,
            date: latest['Date'] || null,
          };
        } catch (err) {
          logger.error(`[INSTALLS] Erreur parsing ${pkg}:`, err.message);
          return null;
        }
      })
  );

  return {
    apps: results.filter(Boolean).sort((a, b) => b.currentInstalls - a.currentInstalls),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  getInstallStats,
};
