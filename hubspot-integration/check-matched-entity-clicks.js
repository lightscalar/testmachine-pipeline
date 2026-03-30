#!/usr/bin/env node

const fs = require('fs');
const { pool } = require('../testmachine-pipeline/src/database/connection');

async function checkMatchedEntityClicks() {
  try {
    console.log('🔍 Checking for recent clicks among contacts that match pipeline entities...');
    
    // Load HubSpot data
    const data = JSON.parse(fs.readFileSync('hubspot-email-engagement-analysis.json', 'utf8'));
    
    // Load all pipeline entities
    const allEntities = [];
    const tables = ['exchanges', 'auditors', 'large_auditors', 'defi', 'rwa_tokenization'];
    
    for (const table of tables) {
      const query = `SELECT id, n, w FROM ${table}`;
      const result = await pool.query(query);
      
      result.rows.forEach(entity => {
        allEntities.push({
          ...entity,
          tableName: table
        });
      });
    }
    
    console.log(`📊 Loaded ${allEntities.length} pipeline entities`);
    
    // Function to extract domain from email
    function extractDomainFromEmail(email) {
      if (!email || !email.includes('@')) return null;
      return email.split('@')[1].toLowerCase();
    }
    
    // Function to extract domain from website
    function extractDomainFromWebsite(website) {
      if (!website) return null;
      
      try {
        let domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
        domain = domain.split('/')[0].toLowerCase();
        return domain;
      } catch (error) {
        return website.toLowerCase();
      }
    }
    
    // Now check for HubSpot contacts that match entities AND have recent clicks
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    let matchedContactsWithClicks = [];
    
    for (const contact of data.fullAnalysis) {
      // Skip if no engagement
      if (contact.engagementScore === 0) continue;
      
      // Check if has recent click
      let hasRecentClick = false;
      if (contact.lastClickDate && contact.lastClickDate !== '') {
        try {
          const clickDate = new Date(contact.lastClickDate);
          hasRecentClick = clickDate > sevenDaysAgo;
        } catch (e) {
          // Invalid date
        }
      }
      
      if (!hasRecentClick) continue;
      
      // Check if matches any pipeline entity
      const contactDomain = extractDomainFromEmail(contact.email);
      if (!contactDomain) continue;
      
      let matchedEntity = null;
      
      // Try domain matching
      for (const entity of allEntities) {
        const entityDomain = extractDomainFromWebsite(entity.w);
        if (entityDomain && entityDomain === contactDomain) {
          matchedEntity = entity;
          break;
        }
      }
      
      // Try company name matching if no domain match
      if (!matchedEntity && contact.company) {
        const contactCompany = contact.company.toLowerCase();
        for (const entity of allEntities) {
          const entityName = entity.n ? entity.n.toLowerCase() : '';
          if (entityName && (contactCompany === entityName || contactCompany.includes(entityName) || entityName.includes(contactCompany))) {
            matchedEntity = entity;
            break;
          }
        }
      }
      
      if (matchedEntity) {
        matchedContactsWithClicks.push({
          contact,
          entity: matchedEntity,
          clickDate: contact.lastClickDate
        });
      }
    }
    
    console.log(`\n🎯 RESULTS:`);
    if (matchedContactsWithClicks.length > 0) {
      console.log(`✅ Found ${matchedContactsWithClicks.length} pipeline entities with contacts who have recent clicks:`);
      matchedContactsWithClicks.forEach(match => {
        console.log(`   - ${match.entity.n} (${match.entity.tableName})`);
        console.log(`     Contact: ${match.contact.email}`);
        console.log(`     Clicked: ${match.clickDate}`);
        console.log('');
      });
    } else {
      console.log(`❌ No pipeline entities have contacts with clicks in the last 7 days`);
      console.log(`   This explains why all entities show "Clicks: 0"`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkMatchedEntityClicks();