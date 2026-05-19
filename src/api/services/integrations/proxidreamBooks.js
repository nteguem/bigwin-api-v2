// src/api/services/integrations/proxidreamBooks.js
//
// Accès à la collection `books` de la BD `proxidream` (même cluster que
// `bigwin` mais base différente). Sert d'alias commercial pour les
// libellés de transaction envoyés aux PSP (CinetPay, etc.).
//
// On utilise `connection.useDb('proxidream')` plutôt qu'une 2ème
// connexion : ça partage le pool, l'auth, et la résolution DNS de la
// connexion principale.

const mongoose = require('mongoose');

let _proxidreamConn = null;

function getProxidreamConnection() {
  if (_proxidreamConn) return _proxidreamConn;
  // useCache:true → mongoose retourne la même instance à chaque appel
  _proxidreamConn = mongoose.connection.useDb('proxidream', { useCache: true });
  return _proxidreamConn;
}

/**
 * Récupère un livre par son _id (string) depuis proxidream.books.
 * Retourne null si l'id est falsy ou si le livre n'existe pas / est inactif.
 *
 * @param {string|null} bookId - _id string du livre
 * @returns {Promise<{ _id: string, title: string, author: string }|null>}
 */
async function getBookById(bookId) {
  if (!bookId) return null;
  try {
    const conn = getProxidreamConnection();
    // Les _id de proxidream.books sont des ObjectId malgré l'apparence
    // string dans les exports JSON. On cast pour faire matcher.
    let oid;
    try {
      oid = new mongoose.Types.ObjectId(String(bookId));
    } catch (_) {
      return null; // bookId malformé
    }
    const book = await conn.collection('books').findOne(
      { _id: oid, isActive: { $ne: false } },
      { projection: { title: 1, author: 1, category: 1 } }
    );
    return book || null;
  } catch (err) {
    // Ne jamais throw : un échec de lookup ne doit pas casser une init de
    // paiement. Le service fallback sur le nom du package.
    return null;
  }
}

module.exports = {
  getBookById,
  getProxidreamConnection,
};
