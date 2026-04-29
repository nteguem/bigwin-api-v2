// src/utils/locale.js
//
// Détermine la langue préférée d'un user à partir de son countryCode.
// Utilisé notamment pour choisir la version FR/EN d'un email transactionnel.

/**
 * Pays francophones où on envoie des contenus en français.
 * Pour tous les autres pays → anglais par défaut.
 *
 * Liste construite pour cibler l'Afrique francophone (cœur de cible des apps)
 * + les autres pays francophones courants (France, Belgique, Suisse, Canada FR).
 * Codes ISO 3166-1 alpha-2.
 */
const FRENCH_SPEAKING_COUNTRIES = new Set([
  // Afrique francophone — Afrique de l'Ouest
  'BJ', // Bénin
  'BF', // Burkina Faso
  'CI', // Côte d'Ivoire
  'GN', // Guinée
  'GW', // Guinée-Bissau (parfois FR/PT)
  'ML', // Mali
  'NE', // Niger
  'SN', // Sénégal
  'TG', // Togo
  // Afrique francophone — Afrique centrale
  'CM', // Cameroun
  'CF', // Centrafrique
  'TD', // Tchad
  'CG', // Congo (Brazzaville)
  'CD', // RD Congo (Kinshasa)
  'GA', // Gabon
  'GQ', // Guinée équatoriale
  // Afrique francophone — Maghreb / Afrique du Nord
  'DZ', // Algérie
  'MA', // Maroc
  'TN', // Tunisie
  'MR', // Mauritanie
  // Afrique francophone — autres
  'MG', // Madagascar
  'KM', // Comores
  'DJ', // Djibouti
  'BI', // Burundi
  'RW', // Rwanda (FR/EN/RW)
  // Europe francophone
  'FR', // France
  'BE', // Belgique
  'CH', // Suisse
  'LU', // Luxembourg
  'MC', // Monaco
  // Amérique francophone
  'CA', // Canada (Québec)
  'HT', // Haïti
  // Outre-mer français (au cas où)
  'GP', 'MQ', 'GF', 'RE', 'YT', 'NC', 'PF',
]);

/**
 * Retourne le code de langue ('fr' ou 'en') selon le countryCode de l'user.
 * Si countryCode absent ou inconnu → 'en' par défaut (audience la plus large).
 *
 * @param {String|null|undefined} countryCode - Code ISO 3166-1 alpha-2
 * @returns {'fr'|'en'}
 */
function langFromCountryCode(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return 'en';
  const normalized = countryCode.toUpperCase().trim();
  return FRENCH_SPEAKING_COUNTRIES.has(normalized) ? 'fr' : 'en';
}

module.exports = {
  langFromCountryCode,
  FRENCH_SPEAKING_COUNTRIES,
};
