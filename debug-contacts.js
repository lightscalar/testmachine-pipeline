#!/usr/bin/env node

const { Client } = require('@hubspot/api-client');
require('dotenv').config();

async function debugContacts() {
  console.log('🔍 Debugging HubSpot Contacts API...');
  
  const client = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  
  try {
    console.log('\n📊 Testing basic contacts getPage...');
    const response = await client.crm.contacts.basicApi.getPage(5);
    
    console.log('Full response structure:');
    console.log('- Response type:', typeof response);
    console.log('- Response keys:', Object.keys(response));
    
    if (response.body) {
      console.log('- Body type:', typeof response.body);
      console.log('- Body keys:', Object.keys(response.body));
      
      if (response.body.results) {
        console.log('- Results found:', response.body.results.length);
        console.log('- First result keys:', response.body.results[0] ? Object.keys(response.body.results[0]) : 'No results');
      } else {
        console.log('- No results in body');
      }
    }
    
    if (response.results) {
      console.log('- Direct results found:', response.results.length);
    } else {
      console.log('- No direct results property');
    }
    
  } catch (error) {
    console.error('❌ Contacts API Error:', error.message);
    if (error.body) {
      console.error('Error response:', JSON.stringify(error.body, null, 2));
    }
  }
}

debugContacts().catch(console.error);