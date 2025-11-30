// services/common/deviceService.js

const Device = require('../../models/common/Device');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class DeviceService {
  
  /**
   * Enregistrer un device
   * @param {String} appId - ID de l'application
   */
  async registerDevice(appId, deviceData) {
    const { deviceId, playerId, platform, deviceInfo, user = null } = deviceData;
    
    // ⭐ Chercher device POUR CETTE APP
    let device = await Device.findOne({ deviceId, appId });
    
    if (device) {
      device.playerId = playerId;
      device.platform = platform;
      device.deviceInfo = deviceInfo || device.deviceInfo;
      device.isActive = true;
      device.lastActiveAt = new Date();
      
      if (user) {
        device.user = user;
        device.userType = 'registered';
      }
      
      return await device.save();
    }
    
    // ⭐ Créer nouveau device AVEC APPID
    device = new Device({
      appId, // ⭐ AJOUT
      deviceId,
      playerId,
      platform,
      deviceInfo,
      user,
      userType: user ? 'registered' : 'guest'
    });
    
    return await device.save();
  }
  
  /**
   * Lier un device à un utilisateur
   * @param {String} appId - ID de l'application
   */
  async linkDeviceToUser(appId, deviceId, userId) {
    // ⭐ Filtrer par appId
    const device = await Device.findOne({ deviceId, appId, isActive: true });
    
    if (!device) {
      throw new AppError('Device non trouvé', 404, ErrorCodes.NOT_FOUND);
    }
    
    return await device.linkToUser(userId);
  }
  
  /**
   * Délier un device d'un utilisateur
   * @param {String} appId - ID de l'application
   */
  async unlinkDeviceFromUser(appId, deviceId) {
    // ⭐ Filtrer par appId
    const device = await Device.findOne({ deviceId, appId, isActive: true });
    
    if (device) {
      return await device.unlinkFromUser();
    }
    
    return null;
  }
  
  /**
   * Récupérer les devices par type d'utilisateur
   * @param {String} appId - ID de l'application
   */
  async getDevicesByUserType(appId, userType) {
    // ⭐ Filtrer par appId
    return await Device.find({ appId, userType, isActive: true });
  }
  
  /**
   * Désactiver un device
   * @param {String} appId - ID de l'application
   */
  async deactivateDevice(appId, deviceId) {
    // ⭐ Filtrer par appId
    return await Device.findOneAndUpdate(
      { deviceId, appId }, // ⭐ AJOUT
      { isActive: false, lastActiveAt: new Date() },
      { new: true }
    );
  }
  
  /**
   * Mettre à jour un device
   * @param {String} appId - ID de l'application
   */
  async updateDevice(appId, deviceId, updateData) {
    // ⭐ Filtrer par appId
    return await Device.findOneAndUpdate(
      { deviceId, appId, isActive: true }, // ⭐ AJOUT
      { ...updateData, lastActiveAt: new Date() },
      { new: true }
    );
  }
}

module.exports = new DeviceService();