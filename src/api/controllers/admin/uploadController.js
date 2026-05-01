// src/api/controllers/admin/uploadController.js
//
// Endpoint d'upload générique pour l'admin.
// Renvoie l'URL publique du fichier (sera mise dans le formulaire gift par
// le front).

const path = require('path');
const fs = require('fs');
const { MIME_BY_PURPOSE } = require('../../middlewares/admin/uploadMiddleware');
const { AppError } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Construit l'URL publique d'un fichier uploadé.
 *
 * Préférence : env PUBLIC_API_URL pour que les URLs persistées en BD soient
 * stables même si le déploiement change.
 *
 * Sinon on utilise le host de la requête, mais on force `https://` en prod :
 * derrière un load balancer / proxy qui termine TLS, `req.protocol` peut
 * renvoyer `http` même si le client a tapé en HTTPS. Comme les URLs sont
 * persistées en BD et lues par le mobile (qui bloque le clear-text HTTP par
 * défaut sur Android moderne), on évite le piège en forçant le scheme HTTPS
 * sauf en local (host = localhost).
 */
function buildPublicUrl(req, relativePath) {
  if (process.env.PUBLIC_API_URL) {
    return `${process.env.PUBLIC_API_URL.replace(/\/$/, '')}${relativePath}`;
  }
  const host = req.get('host') || '';
  const isLocal = /^(localhost|127\.0\.0\.1)/.test(host);
  const scheme = isLocal ? req.protocol : 'https';
  return `${scheme}://${host}${relativePath}`;
}

exports.uploadFile = catchAsync(async (req, res, next) => {
  if (!req.file) {
    throw new AppError('Aucun fichier fourni', 400);
  }

  const purpose = req.body?.purpose || req.query?.purpose;
  const config = MIME_BY_PURPOSE[purpose];

  // Re-check de la limite de taille spécifique au purpose (multer ne gère
  // que la limite globale).
  if (config && req.file.size > config.maxBytes) {
    // Le fichier a déjà été écrit sur disk → on le supprime pour ne pas
    // accumuler de déchets.
    fs.unlinkSync(req.file.path);
    throw new AppError(
      `Fichier trop lourd pour ${purpose} : ${(req.file.size / 1024 / 1024).toFixed(1)} MB. Max ${(config.maxBytes / 1024 / 1024).toFixed(0)} MB.`,
      400
    );
  }

  // Path relatif depuis la racine du projet → URL publique
  // req.file.path est ABSOLU sur le filesystem ; on dérive la portion
  // accessible par Express static qui sert /uploads.
  const relPath = req.file.path
    .replace(path.join(__dirname, '..', '..', '..', '..'), '')
    .replace(/\\/g, '/');
  // Garantit que l'URL commence bien par /uploads/
  const publicPath = relPath.startsWith('/uploads')
    ? relPath
    : `/uploads${relPath.split('uploads')[1] || ''}`;

  const url = buildPublicUrl(req, publicPath);

  res.status(201).json({
    success: true,
    message: 'Fichier uploadé avec succès',
    data: {
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      purpose,
    },
  });
});
