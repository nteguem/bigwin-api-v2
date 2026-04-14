const express = require('express');
const authController = require('../../controllers/admin/authController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

/**
 * Public routes — 2FA login flow
 */
router.post('/login', authController.login);              // step 1: credentials → OTP email
router.post('/verify-otp', authController.verifyOtp);     // step 2: verify OTP → JWT or requirePasswordChange
router.post('/resend-otp', authController.resendOtp);
router.post('/set-password', authController.setPassword); // step 3: first-login password set → JWT
router.post('/refresh', adminAuth.verifyRefreshToken, authController.refresh);

/**
 * Protected routes (authenticated admin)
 */
router.use(adminAuth.protect);

router.post('/logout', authController.logout);
router.post('/logout-all', authController.logoutAll);
router.get('/me', authController.getMe);
router.patch('/me', authController.updateMe);
router.patch('/change-password', authController.changePassword);

module.exports = router;
