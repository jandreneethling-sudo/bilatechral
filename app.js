/**
 * cPanel Passenger entry point for Bilatechral
 */

// Wrap everything in try-catch to prevent crashes
try {
  const app = require('./src/server');
  module.exports = app;
} catch (err) {
  // If the main app fails to load, serve a basic error page
  const express = require('express');
  const fallbackApp = express();
  
  fallbackApp.get('*', (req, res) => {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Bilatechral - Startup Error</title></head>
      <body>
        <h1>Application Startup Error</h1>
        <p>The application failed to start. Error details:</p>
        <pre>${err.stack || err.message || err}</pre>
        <p>Please contact the administrator.</p>
      </body>
      </html>
    `);
  });
  
  module.exports = fallbackApp;
}
