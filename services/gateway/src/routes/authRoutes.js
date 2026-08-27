const express = require('express');
const authController = require('../controllers/authController');
const { requireJwtAuth } = require('../middlewares/authenticate');
const { authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/switch-context', requireJwtAuth, authController.switchContext);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireJwtAuth, authController.getMe);
router.patch('/password', requireJwtAuth, authLimiter, authController.changePassword);

// 3-Step Forgot Password & OTP Recovery
router.post('/forgot-password/request-otp', authLimiter, authController.requestPasswordResetOtp);
router.post('/forgot-password/verify-otp', authLimiter, authController.verifyPasswordResetOtp);
router.post('/forgot-password/reset', authLimiter, authController.resetPasswordWithToken);

module.exports = router;
