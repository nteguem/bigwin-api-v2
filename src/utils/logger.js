/**
 * Compat ascendante : l'ancien logger vivait ici et était importé par des
 * dizaines de fichiers. On re-exporte le nouveau logger centralisé dans
 * `core/logger` pour que rien ne casse pendant la migration progressive.
 *
 * Préférez `require('../../core/logger')` dans le nouveau code.
 * Préférez `req.log` dans les controllers (inclut requestId / appId / userId).
 */
module.exports = require('../core/logger');
