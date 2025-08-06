// routes/user/afribaPayRoutes.js
const express = require('express');
// Avant la route webhook, ajoutez ce middleware de debug
router.use('/webhook', (req, res, next) => {
  console.log('=== AFRIBAPAY ROUTER - WEBHOOK MIDDLEWARE ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Base URL:', req.baseUrl);
  console.log('Original URL:', req.originalUrl);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

router.post('/webhook', (req, res, next) => {
  console.log('=== WEBHOOK ROUTE HANDLER CALLED ===');
  console.log('About to call controller...');
  afribaPayController.webhook(req, res, next);
});

module.exports = router;