// src/api/controllers/common/deviceController.js

const deviceService = require('../../services/common/deviceService');
const catchAsync = require('../../../utils/catchAsync');

class DeviceController {
  
  registerDevice = catchAsync(async (req, res) => {
    // ⭐ Récupérer appId
    const appId = req.appId;
    
    const { deviceId, playerId, platform, deviceInfo } = req.body;
    const userId = req.user ? req.user.id : null;
    
    // ⭐ Passer appId au service
    const device = await deviceService.registerDevice(appId, {
      deviceId,
      playerId,
      platform,
      deviceInfo,
      user: userId
    });
    
    res.status(200).json({
      success: true,
      data: device
    });
  });
  
  linkDevice = catchAsync(async (req, res) => {
    // ⭐ Récupérer appId
    const appId = req.appId;
    
    const { deviceId } = req.body;
    const userId = req.user.id;
    
    // ⭐ Passer appId au service
    const device = await deviceService.linkDeviceToUser(appId, deviceId, userId);
    
    res.status(200).json({
      success: true,
      data: device
    });
  });
  
  unlinkDevice = catchAsync(async (req, res) => {
    // ⭐ Récupérer appId
    const appId = req.appId;
    
    const { deviceId } = req.body;
    
    // ⭐ Passer appId au service
    const device = await deviceService.unlinkDeviceFromUser(appId, deviceId);
    
    res.status(200).json({
      success: true,
      data: device
    });
  });
  
  updateDevice = catchAsync(async (req, res) => {
    // ⭐ Récupérer appId
    const appId = req.appId;
    
    const { deviceId } = req.params;
    const updateData = req.body;
    
    // ⭐ Passer appId au service
    const device = await deviceService.updateDevice(appId, deviceId, updateData);
    
    res.status(200).json({
      success: true,
      data: device
    });
  });
  
  deactivateDevice = catchAsync(async (req, res) => {
    // ⭐ Récupérer appId
    const appId = req.appId;
    
    const { deviceId } = req.params;
    
    // ⭐ Passer appId au service
    const device = await deviceService.deactivateDevice(appId, deviceId);
    
    res.status(200).json({
      success: true,
      data: device
    });
  });
}

module.exports = new DeviceController();