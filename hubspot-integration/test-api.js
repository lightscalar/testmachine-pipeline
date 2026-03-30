const axios = require('axios');

// HubSpot OAuth credentials and access token
const ACCESS_TOKEN = 'CIW_rYHUMxIVQlNQMl8kQEwrAggACAIHFhIJIgEBGM_EmAsgs8OEKyjY-esQMhRbTNbZBjfWKK2bkz0JXnRMnTX-CDpbQlNQMl8kQEwrA1EAByELdAT_AQSHAgvAAgTLAgn1AgYNDhkfWG5vf4ABhgGQAaYBwwHFAdwB3QHeAfoB-wH8AZkC0gPkA-wD7QPuA_AD8gP_BJKlBZOlBYjCBUIUUoRzZF3qOl4WhYOQJZE8H0He8xZKA25hMVIAWgBgAGj7m4sXcAF4AQ';

async function testHubSpotAPI() {
  console.log('🔬 Testing HubSpot API Access...\n');

  try {
    // Test 1: Get account info
    console.log('📊 1. Testing account access...');
    const accountResponse = await axios.get('https://api.hubapi.com/account-info/v3/details', {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Account Info:', {
      portalId: accountResponse.data.portalId,
      domain: accountResponse.data.domain,
      name: accountResponse.data.name
    });

    // Test 2: Get contacts (first 10)
    console.log('\n👥 2. Testing contacts access...');
    const contactsResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts?limit=10', {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Contacts: Retrieved ${contactsResponse.data.results.length} contacts`);
    if (contactsResponse.data.results.length > 0) {
      const firstContact = contactsResponse.data.results[0];
      console.log('   Sample contact:', {
        id: firstContact.id,
        email: firstContact.properties.email,
        firstname: firstContact.properties.firstname,
        lastname: firstContact.properties.lastname
      });
    }

    // Test 3: Get companies (first 10)
    console.log('\n🏢 3. Testing companies access...');
    const companiesResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/companies?limit=10', {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Companies: Retrieved ${companiesResponse.data.results.length} companies`);
    if (companiesResponse.data.results.length > 0) {
      const firstCompany = companiesResponse.data.results[0];
      console.log('   Sample company:', {
        id: firstCompany.id,
        name: firstCompany.properties.name,
        domain: firstCompany.properties.domain
      });
    }

    // Test 4: Get deals (first 10)
    console.log('\n💼 4. Testing deals access...');
    const dealsResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/deals?limit=10', {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Deals: Retrieved ${dealsResponse.data.results.length} deals`);

    console.log('\n🎉 All API tests successful! HubSpot integration is working perfectly.');
    
  } catch (error) {
    console.error('❌ API Test Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testHubSpotAPI();