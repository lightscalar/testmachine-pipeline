#!/usr/bin/env node

const { Client } = require('@hubspot/api-client');
require('dotenv').config();

async function debugHubSpot() {
  console.log('🔍 Debugging HubSpot API connection...');
  
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  console.log('Token present:', !!accessToken);
  console.log('Token prefix:', accessToken ? accessToken.substring(0, 10) + '...' : 'N/A');
  
  const client = new Client({ accessToken });
  
  try {
    // Test companies API
    console.log('\n📊 Testing companies API...');
    const companiesResponse = await client.crm.companies.basicApi.getPage(5);
    console.log('Companies API Response Structure:');
    console.log('- Response keys:', Object.keys(companiesResponse));
    console.log('- Body keys:', Object.keys(companiesResponse.body || {}));
    console.log('- Results type:', typeof (companiesResponse.body?.results));
    console.log('- Results length:', companiesResponse.body?.results?.length);
    
    if (companiesResponse.body?.results?.length > 0) {
      console.log('- Sample company keys:', Object.keys(companiesResponse.body.results[0]));
    }
    
  } catch (error) {
    console.error('❌ Companies API Error:', error.message);
    if (error.body) {
      console.error('Error body:', JSON.stringify(error.body, null, 2));
    }
  }
  
  try {
    // Test contacts API
    console.log('\n👤 Testing contacts API...');
    const contactsResponse = await client.crm.contacts.basicApi.getPage(5);
    console.log('Contacts API Response Structure:');
    console.log('- Response keys:', Object.keys(contactsResponse));
    console.log('- Body keys:', Object.keys(contactsResponse.body || {}));
    console.log('- Results type:', typeof (contactsResponse.body?.results));
    console.log('- Results length:', contactsResponse.body?.results?.length);
    
    if (contactsResponse.body?.results?.length > 0) {
      console.log('- Sample contact keys:', Object.keys(contactsResponse.body.results[0]));
    }
    
  } catch (error) {
    console.error('❌ Contacts API Error:', error.message);
    if (error.body) {
      console.error('Error body:', JSON.stringify(error.body, null, 2));
    }
  }
  
  try {
    // Test access token validation
    console.log('\n🔐 Testing access token validation...');
    const tokenInfo = await client.oauth.accessTokensApi.get(accessToken);
    console.log('Token info:', {
      hubId: tokenInfo.body?.hub_id,
      scopes: tokenInfo.body?.scopes?.slice(0, 5) // Show first 5 scopes
    });
    
  } catch (error) {
    console.error('❌ Token validation error:', error.message);
    if (error.body) {
      console.error('Error body:', JSON.stringify(error.body, null, 2));
    }
  }
}

debugHubSpot().catch(console.error);