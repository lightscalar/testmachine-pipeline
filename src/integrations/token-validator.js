#!/usr/bin/env node

const { Client } = require('@hubspot/api-client');
require('dotenv').config();

class HubSpotTokenValidator {
  constructor() {
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  }

  async validateToken() {
    if (!this.accessToken) {
      return {
        valid: false,
        error: 'HUBSPOT_ACCESS_TOKEN not found in environment variables',
        guidance: 'Add HUBSPOT_ACCESS_TOKEN to your .env file'
      };
    }

    console.log(`🔍 Validating token: ${this.accessToken.substring(0, 15)}...`);

    const client = new Client({ accessToken: this.accessToken });

    try {
      // Try to fetch a small number of companies as a test
      const response = await client.crm.companies.basicApi.getPage(1, undefined, ['name']);
      
      if (response.results || response.body?.results) {
        return {
          valid: true,
          message: 'Token is valid and has company read access',
          companiesFound: (response.results || response.body.results).length
        };
      } else {
        return {
          valid: false,
          error: 'Unexpected response structure from HubSpot API',
          guidance: 'The API response doesn\'t contain expected results array'
        };
      }

    } catch (error) {
      let guidance = 'Check your HubSpot token configuration';
      let specificError = error.message;

      if (error.message.includes('correct format')) {
        guidance = `
❌ Token Format Issue
Current token: ${this.accessToken?.substring(0, 20)}...

✅ Correct HubSpot token formats:
• Private App: pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (longer format)
• OAuth: Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

📋 How to get a valid token:
1. Go to HubSpot Settings → Integrations → Private Apps
2. Create a new private app
3. Add scopes: crm.objects.companies.read, crm.objects.contacts.read
4. Copy the generated access token
5. Update your .env file with the new token

See HUBSPOT_SETUP.md for detailed instructions.`;
      } else if (error.message.includes('401') || error.message.includes('403')) {
        guidance = 'Token is invalid or doesn\'t have required permissions. Please check your HubSpot token.';
      } else if (error.message.includes('rate limit')) {
        guidance = 'Rate limited by HubSpot API. Try again in a few minutes.';
      }

      return {
        valid: false,
        error: specificError,
        guidance: guidance
      };
    }
  }

  async run() {
    console.log('🔐 HubSpot Token Validator');
    console.log('='.repeat(30));
    
    const result = await this.validateToken();
    
    if (result.valid) {
      console.log('✅ Token is valid!');
      console.log(`   ${result.message}`);
      if (result.companiesFound !== undefined) {
        console.log(`   Found ${result.companiesFound} companies in test query`);
      }
    } else {
      console.log('❌ Token validation failed');
      console.log(`   Error: ${result.error}`);
      console.log(`   Guidance: ${result.guidance}`);
    }
    
    return result;
  }
}

// CLI usage
if (require.main === module) {
  const validator = new HubSpotTokenValidator();
  validator.run()
    .then(result => {
      if (result.valid) {
        console.log('\n🚀 Ready to run HubSpot integration!');
        console.log('Next: npm run hubspot:full-sync');
      } else {
        console.log('\n🔧 Please fix token configuration before proceeding.');
        console.log('See HUBSPOT_SETUP.md for detailed setup instructions.');
      }
    })
    .catch(console.error);
}

module.exports = HubSpotTokenValidator;