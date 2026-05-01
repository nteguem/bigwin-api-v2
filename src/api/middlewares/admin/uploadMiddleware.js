// src/api/middlewares/admin/uploadMiddleware.js
//
// Middleware multer pour les uploads admin (cadeaux statiques + previews).
// - Stockage sur disk dans uploads/gifts/{appId}/
// - Nom de fichier randomisé (UUID + timestamp + ext) pour éviter collisions
// - Validation MIME selon le `purpose` (preview = image only, content = format spécifique)
// - Limite de taille selon le format
//
// Usage :
//   router.post('/admin/uploads',
//     adminAuth.protect,
//     authorize('super_admin'),
//     uploadMiddleware.single('file'),
//     uploadController.uploadFile
//   );

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { AppError } = require('../../../utils/AppError');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', '..', '..', 'uploads');

// ===== MIME types autorisés selon le purpose =====
const MIME_BY_PURPOSE = {
  'gift-preview': {
    types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: 5 * 1024 * 1024, // 5 MB
    label: 'image (JPG/PNG/WebP/GIF)',
  },
  'gift-content-pdf': {
    types: ['application/pdf'],
    maxBytes: 20 * 1024 * 1024,
    label: 'PDF',
  },
  'gift-content-audio': {
    types: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/x-m4a', 'audio/ogg'],
    maxBytes: 50 * 1024 * 1024,
    label: 'audio (MP3/WAV/M4A/OGG)',
  },
  'gift-content-zip': {
    types: ['application/zip', 'application/x-zip-compressed'],
    maxBytes: 50 * 1024 * 1024,
    label: 'ZIP',
  },
  'gift-content-image': {
    types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: 5 * 1024 * 1024,
    label: 'image (JPG/PNG/WebP/GIF)',
  },
};

const PURPOSE_TO_SUBFOLDER = {
  'gift-preview': 'gifts',
  'gift-content-pdf': 'gifts',
  'gift-content-audio': 'gifts',
  'gift-content-zip': 'gifts',
  'gift-content-image': 'gifts',
};

// ===== Storage : disk =====
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const purpose = req.body?.purpose || req.query?.purpose;
    const appId = (req.body?.appId || req.query?.appId || 'shared').toLowerCase();

    const subfolder = PURPOSE_TO_SUBFOLDER[purpose] || 'misc';
    const dir = path.join(UPLOADS_ROOT, subfolder, appId);

    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    // 8 chars d'entropie + timestamp pour rester triable et lisible
    const id = crypto.randomBytes(6).toString('hex');
    const ts = Date.now();
    cb(null, `${ts}-${id}${ext}`);
  },
});

// ===== File filter : valide MIME type =====
function fileFilter(req, file, cb) {
  const purpose = req.body?.purpose || req.query?.purpose;
  if (!purpose) {
    return cb(new AppError('Paramètre `purpose` requis', 400));
  }

  const config = MIME_BY_PURPOSE[purpose];
  if (!config) {
    return cb(
      new AppError(
        `Purpose inconnu : "${purpose}". Valides : ${Object.keys(MIME_BY_PURPOSE).join(', ')}`,
        400
      )
    );
  }

  if (!config.types.includes(file.mimetype)) {
    return cb(
      new AppError(
        `Type de fichier non autorisé pour ${purpose} : "${file.mimetype}". Attendu : ${config.label}.`,
        400
      )
    );
  }

  cb(null, true);
}

// ===== Limite globale : on prend le max possible (50 MB) =====
// La limite spécifique par purpose est rechecked dans le controller
// (multer gère seulement la limite globale).
const MAX_GLOBAL_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_GLOBAL_BYTES,
    files: 1,
    fields: 10,
  },
});

module.exports = {
  uploadSingle: upload.single('file'),
  MIME_BY_PURPOSE,
  UPLOADS_ROOT,
};
