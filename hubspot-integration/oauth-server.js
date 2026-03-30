const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

// HubSpot OAuth credentials
const CLIENT_ID = 'ddf95dde-890b-4503-95d9-ef6832e7cf41';
const CLIENT_SECRET = '21c2f5b2-30d6-4fa5-ac1c-f1e0258978ea';
// Support both direct access and SSH port forwarding
const REDIRECT_URI = 'http://localhost:3000';
const REDIRECT_URI_FORWARDED = 'http://localhost:3000';

let authCode = null;
let accessToken = null;

app.get('/', async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    // No OAuth code, show waiting message
    return res.send(`
      <h1>🔄 Waiting for HubSpot OAuth...</h1>
      <p>OAuth server ready for HubSpot authorization redirect.</p>
      <p><strong>Accessible via SSH port forwarding</strong></p>
    `);
  }

  // Handle OAuth callback with code
  authCode = code;
  console.log('\n✅ Authorization code received:', code);

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI_FORWARDED,
        code: code
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    accessToken = tokenResponse.data.access_token;
    console.log('✅ Access token received:', accessToken);

    res.send(`
      <h1>🎉 OAuth Success!</h1>
      <p><strong>Authorization Code:</strong> ${code}</p>
      <p><strong>Access Token:</strong> ${accessToken}</p>
      <p>You can now close this window. The server will automatically close in 30 seconds.</p>
    `);

    // Auto-close server after success
    setTimeout(() => {
      console.log('\n🏁 OAuth complete. Server closing...');
      process.exit(0);
    }, 30000);

  } catch (error) {
    console.error('❌ Error exchanging code for token:', error.response?.data || error.message);
    res.status(500).send(`
      <h1>❌ OAuth Error</h1>
      <p>Failed to exchange authorization code for access token.</p>
      <p><strong>Error:</strong> ${error.response?.data?.message || error.message}</p>
    `);
  }
});



app.listen(PORT, () => {
  console.log(`🚀 OAuth server running on http://localhost:${PORT}`);
  console.log('Ready for SSH port forwarding access!');
  
  // Auto-close after 10 minutes if no OAuth received
  setTimeout(() => {
    console.log('\n⏰ Timeout: Server closing after 10 minutes.');
    process.exit(0);
  }, 10 * 60 * 1000);
});