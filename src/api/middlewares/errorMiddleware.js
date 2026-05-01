const { AppError, ErrorCodes } = require('../../utils/AppError');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const keys = Object.keys(err.keyValue || {});
    const field = keys[0];
    if (field === 'email') {
      error = new AppError('Cet email est déjà utilisé', 400, ErrorCodes.AUTH_EMAIL_EXISTS);
    } else {
      // Champs significatifs (hors appId qui est juste le scope multi-app)
      const meaningful = keys.filter(k => k !== 'appId');
      const conflictField = meaningful[0] || field;
      const conflictValue = err.keyValue?.[conflictField];
      error = new AppError(
        `Le champ "${conflictField}" avec la valeur "${conflictValue}" existe déjà`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(e => e.message).join(', ');
    error = new AppError(message, 400, ErrorCodes.VALIDATION_ERROR);
  }

  // Mongoose CastError : ObjectId mal formaté dans :id, ou cast d'un type incompatible.
  // Sans ce handler, un GET /xxx/abc renvoyait un 500 alors que c'est une erreur cliente 400.
  if (err.name === 'CastError') {
    error = new AppError(
      `Identifiant invalide pour le champ "${err.path}"`,
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  // Multer errors (uploads) : message clair côté client au lieu d'un 500.
  if (err.name === 'MulterError') {
    const map = {
      LIMIT_FILE_SIZE: 'Fichier trop lourd. Vérifie la limite pour ce type de fichier.',
      LIMIT_FILE_COUNT: 'Trop de fichiers envoyés.',
      LIMIT_UNEXPECTED_FILE: `Champ de fichier inattendu : ${err.field}`,
      LIMIT_PART_COUNT: 'Formulaire trop volumineux.',
      LIMIT_FIELD_KEY: 'Nom de champ trop long.',
      LIMIT_FIELD_VALUE: 'Valeur de champ trop longue.',
      LIMIT_FIELD_COUNT: 'Trop de champs dans le formulaire.',
    };
    error = new AppError(
      map[err.code] || `Erreur upload : ${err.message}`,
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.errorCode || ErrorCodes.INTERNAL_ERROR,
      message: error.message || 'Erreur serveur',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
};

module.exports = errorHandler;