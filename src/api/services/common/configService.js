/**
 * @fileoverview Service de gestion de la configuration par pays (GLOBAL)
 * Gère la détection du pays et les opérations CRUD
 *
 * Détection IP : MaxMind GeoLite2 en local (fichier mmdb).
 * Plus de dépendance ip-api.com (qui timeout / rate-limit).
 * La DB est téléchargée via `npm run geoip:update` (cron mensuel).
 */
const path = require('path');
const fs = require('fs');
const maxmind = require('maxmind');
const AppConfig = require('../../models/common/AppConfig');
const logger = require('../../../utils/logger');

const GEOIP_DB_PATH = path.join(__dirname, '..', '..', '..', '..', 'data', 'geoip', 'GeoLite2-Country.mmdb');

// Mapping pays → devise + préfixe pour les configs auto-créées. MaxMind
// fournit le countryCode mais pas la currency ni le callingCode (ip-api
// avait les mêmes limites en plan gratuit). On utilise un mapping local
// pour les pays Mobile Money pertinents — les autres tombent en USD/+1.
const COUNTRY_DEFAULTS = {
  // Zone CFA UEMOA (XOF)
  CI: { currency: 'XOF', phonePrefix: '+225' },
  SN: { currency: 'XOF', phonePrefix: '+221' },
  BJ: { currency: 'XOF', phonePrefix: '+229' },
  TG: { currency: 'XOF', phonePrefix: '+228' },
  ML: { currency: 'XOF', phonePrefix: '+223' },
  BF: { currency: 'XOF', phonePrefix: '+226' },
  NE: { currency: 'XOF', phonePrefix: '+227' },
  GW: { currency: 'XOF', phonePrefix: '+245' },
  // Zone CFA CEMAC (XAF)
  CM: { currency: 'XAF', phonePrefix: '+237' },
  GA: { currency: 'XAF', phonePrefix: '+241' },
  CG: { currency: 'XAF', phonePrefix: '+242' },
  CF: { currency: 'XAF', phonePrefix: '+236' },
  TD: { currency: 'XAF', phonePrefix: '+235' },
  GQ: { currency: 'XAF', phonePrefix: '+240' },
  // Autres devises africaines
  CD: { currency: 'CDF', phonePrefix: '+243' },
  GN: { currency: 'GNF', phonePrefix: '+224' },
  GM: { currency: 'GMD', phonePrefix: '+220' },
  NG: { currency: 'NGN', phonePrefix: '+234' },
  GH: { currency: 'GHS', phonePrefix: '+233' },
  KE: { currency: 'KES', phonePrefix: '+254' },
  EG: { currency: 'EGP', phonePrefix: '+20' },
  TZ: { currency: 'TZS', phonePrefix: '+255' },
  ZA: { currency: 'ZAR', phonePrefix: '+27' },
};

class ConfigService {
  constructor() {
    this._lookup = null;
    this._lookupPromise = null;
  }

  /**
   * Charge la base GeoLite2 en mémoire (lazy + cached). Le lookup MaxMind
   * lit le fichier mmdb une fois puis garde l'index en RAM (~10-30 MB).
   * Les lookups suivants sont sub-millisecondes.
   */
  async _getLookup() {
    if (this._lookup) return this._lookup;
    if (this._lookupPromise) return this._lookupPromise;

    if (!fs.existsSync(GEOIP_DB_PATH)) {
      throw new Error(
        `GeoLite2-Country.mmdb introuvable. Lance "npm run geoip:update" d'abord. ` +
        `Path attendu : ${GEOIP_DB_PATH}`
      );
    }

    this._lookupPromise = maxmind.open(GEOIP_DB_PATH).then((lookup) => {
      this._lookup = lookup;
      logger.info('[ConfigService] GeoLite2 chargé en mémoire');
      return lookup;
    });
    return this._lookupPromise;
  }

  /**
   * Détecter le pays depuis une adresse IP (lookup MaxMind local).
   * @param {string} ipAddress
   * @returns {Promise<Object>} {countryCode, countryName, currency, phonePrefix}
   */
  async detectCountryFromIp(ipAddress) {
    try {
      const lookup = await this._getLookup();
      const result = lookup.get(ipAddress);

      if (!result || !result.country || !result.country.iso_code) {
        // IP privée, IPv6 mal formée, IP non-localisée → pas un crash
        // On laisse le mobile gérer le fallback côté client (map locale)
        logger.warn(`[ConfigService] Pays non résolu pour IP: ${ipAddress}`);
        throw new Error(`Pays non résolu pour IP: ${ipAddress}`);
      }

      const countryCode = result.country.iso_code.toUpperCase();
      const countryName =
        (result.country.names && (result.country.names.fr || result.country.names.en)) ||
        countryCode;
      const defaults = COUNTRY_DEFAULTS[countryCode] || { currency: 'USD', phonePrefix: '+1' };

      const countryInfo = {
        countryCode,
        countryName,
        currency: defaults.currency,
        phonePrefix: defaults.phonePrefix,
      };

      logger.info(`[ConfigService] Pays détecté: ${JSON.stringify(countryInfo)}`);
      return countryInfo;
    } catch (error) {
      // Downgrade en warn — le mobile gère le fallback, ce n'est pas critique
      logger.warn(`[ConfigService] Erreur détection IP: ${error.message}`);
      throw new Error(`Impossible de détecter le pays depuis l'IP: ${error.message}`);
    }
  }

  /**
   * Obtenir ou créer automatiquement une configuration par code pays
   * @param {string} countryCode - Code pays (ex: "CM")
   * @param {Object} countryInfo - Informations du pays {countryName, currency, phonePrefix}
   * @returns {Promise<Object>} Configuration du pays
   */
  async getOrCreateConfigByCountryCode(countryCode, countryInfo) {
    try {
      const upperCountryCode = countryCode.toUpperCase();

      let config = await AppConfig.findOne({ countryCode: upperCountryCode });

      if (!config) {
        logger.info(`[ConfigService] Création automatique de la config pour: ${upperCountryCode}`);

        // À la création, on utilise les vraies devise + préfixe du mapping
        // (avant : currency hardcodée à USD pour tous les pays — bug fixé).
        const defaults = COUNTRY_DEFAULTS[upperCountryCode] || { currency: 'USD', phonePrefix: '+1' };

        config = await AppConfig.create({
          countryCode: upperCountryCode,
          countryName: countryInfo.countryName,
          currency: countryInfo.currency || defaults.currency,
          language: 'en',
          phonePrefix: countryInfo.phonePrefix || defaults.phonePrefix,
          paymentProvider: 'googlepay',
          isActive: true,
          metadata: {
            autoCreated: true,
            createdAt: new Date().toISOString()
          }
        });

        logger.info(`[ConfigService] Config créée automatiquement: ${upperCountryCode}`);
      }

      const clientConfig = config.toClientJSON ? config.toClientJSON() : config.toObject();

      logger.info(`[ConfigService] Config récupérée/créée: ${upperCountryCode}`);
      return clientConfig;
    } catch (error) {
      logger.error(`[ConfigService] Erreur getOrCreateConfigByCountryCode: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtenir la configuration par adresse IP (avec création automatique)
   * @param {string} ipAddress - Adresse IP de l'utilisateur
   * @returns {Promise<Object>} Configuration du pays
   */
  async getConfigByIp(ipAddress) {
    try {
      const countryInfo = await this.detectCountryFromIp(ipAddress);
      return await this.getOrCreateConfigByCountryCode(
        countryInfo.countryCode,
        countryInfo
      );
    } catch (error) {
      // Downgrade en warn : le mobile a son fallback local, on ne casse rien
      logger.warn(`[ConfigService] getConfigByIp fallback: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtenir la configuration par code pays (sans création automatique)
   * @param {string} countryCode - Code pays (ex: "CM")
   * @returns {Promise<Object>} Configuration du pays
   */
  async getConfigByCountryCode(countryCode) {
    try {
      const upperCountryCode = countryCode.toUpperCase();

      const config = await AppConfig.findOne({ countryCode: upperCountryCode });

      if (!config) {
        throw new Error(`Configuration non trouvée pour le pays: ${upperCountryCode}`);
      }

      const clientConfig = config.toClientJSON ? config.toClientJSON() : config.toObject();

      logger.info(`[ConfigService] Config récupérée: ${upperCountryCode}`);
      return clientConfig;
    } catch (error) {
      logger.error(`[ConfigService] Erreur getConfigByCountryCode: ${error.message}`);
      throw error;
    }
  }

  async getAllConfigs() {
    try {
      const configs = await AppConfig.find().sort({ countryName: 1 });
      return configs;
    } catch (error) {
      logger.error(`[ConfigService] Erreur getAllConfigs: ${error.message}`);
      throw error;
    }
  }

  async upsertConfig(countryCode, configData) {
    try {
      const config = await AppConfig.findOneAndUpdate(
        { countryCode: countryCode.toUpperCase() },
        { ...configData, countryCode: countryCode.toUpperCase() },
        { new: true, upsert: true, runValidators: true }
      );

      logger.info(`[ConfigService] Config upsert: ${countryCode}`);
      return config;
    } catch (error) {
      logger.error(`[ConfigService] Erreur upsertConfig: ${error.message}`);
      throw error;
    }
  }

  async deleteConfig(countryCode) {
    try {
      const result = await AppConfig.findOneAndDelete({
        countryCode: countryCode.toUpperCase(),
      });

      if (!result) {
        throw new Error('Configuration non trouvée');
      }

      logger.info(`[ConfigService] Config supprimée: ${countryCode}`);
      return result;
    } catch (error) {
      logger.error(`[ConfigService] Erreur deleteConfig: ${error.message}`);
      throw error;
    }
  }

  async toggleCountry(countryCode, isActive) {
    try {
      const config = await AppConfig.findOneAndUpdate(
        { countryCode: countryCode.toUpperCase() },
        { isActive },
        { new: true }
      );

      if (!config) {
        throw new Error('Configuration non trouvée');
      }

      logger.info(`[ConfigService] Config toggle: ${countryCode} -> ${isActive}`);
      return config;
    } catch (error) {
      logger.error(`[ConfigService] Erreur toggleCountry: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new ConfigService();
