#!/usr/bin/env node

const { pool } = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

/**
 * CORRECTED HubSpot Email Intelligence Integration
 * 
 * Fixes the click/reply counts issue by using actual engagement counts
 * instead of recency bonuses.
 */
class HubSpotEmailIntelligenceCorrected {
  constructor() {
    this.debug = process.env.DEBUG === 'true';
    
    this.tables = [
      { name: 'exchanges', entityColumn: 'n', websiteColumn: 'w', segment: 'Exchanges' },
      { name: 'auditors', entityColumn: 'n', websiteColumn: 'w', segment: 'Auditors' },
      { name: 'large_auditors', entityColumn: 'n', websiteColumn: 'w', segment: 'Large Auditors' },
      { name: 'defi', entityColumn: 'n', websiteColumn: 'w', segment: 'DeFi' },
      { name: 'rwa_tokenization', entityColumn: 'n', websiteColumn: 'w', segment: 'RWA/Tokenization' }
    ];
    
    this.stats = {
      totalProcessed: 0,
      updated: 0,
      errors: 0
    };
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async loadHubSpotEmailData() {
    this.log('📧 Loading HubSpot email engagement data...');
    
    const emailDataPath = path.join(__dirname, '../../../testmachine-hubspot-email/hubspot-email-engagement-analysis.json');
    
    try {
      const rawData = await fs.readFile(emailDataPath, 'utf8');
      const data = JSON.parse(rawData);
      
      this.log(`✅ Loaded ${data.fullAnalysis.length} contacts with email engagement data`);
      
      return data.fullAnalysis;
    } catch (error) {
      console.error('❌ Failed to load HubSpot email data:', error.message);
      throw error;
    }
  }

  calculateEngagementCounts(contact) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    let clicks7d = 0;
    let clicks30d = 0;
    let replies7d = 0;
    let replies30d = 0;
    let opens7d = 0;
    let opens30d = 0;
    
    // Count clicks
    if (contact.lastClickDate && contact.lastClickDate !== '') {
      try {
        const clickDate = new Date(contact.lastClickDate);
        if (clickDate > sevenDaysAgo) clicks7d = 1;
        if (clickDate > thirtyDaysAgo) clicks30d = 1;
      } catch (e) {
        // Invalid date, ignore
      }
    }
    
    // Count replies  
    if (contact.lastReplyDate && contact.lastReplyDate !== '') {
      try {
        const replyDate = new Date(contact.lastReplyDate);
        if (replyDate > sevenDaysAgo) replies7d = 1;
        if (replyDate > thirtyDaysAgo) replies30d = 1;
      } catch (e) {
        // Invalid date, ignore
      }
    }
    
    // Count opens
    if (contact.lastOpenDate && contact.lastOpenDate !== '') {
      try {
        const openDate = new Date(contact.lastOpenDate);
        if (openDate > sevenDaysAgo) opens7d = 1;
        if (openDate > thirtyDaysAgo) opens30d = 1;
      } catch (e) {
        // Invalid date, ignore
      }
    }
    
    return {
      clicks7d,
      clicks30d,
      replies7d, 
      replies30d,
      opens7d,
      opens30d
    };
  }

  extractDomainFromEmail(email) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[1].toLowerCase();
  }

  extractDomainFromWebsite(website) {
    if (!website) return null;
    
    try {
      let domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
      domain = domain.split('/')[0].toLowerCase();
      return domain;
    } catch (error) {
      return website.toLowerCase();
    }
  }

  async findMatchingEntity(contact, allEntities) {
    const contactDomain = this.extractDomainFromEmail(contact.email);
    if (!contactDomain) return null;

    // Try exact domain matches first
    for (const entityData of allEntities) {
      const entityDomain = this.extractDomainFromWebsite(entityData.entity.w);
      if (entityDomain && entityDomain === contactDomain) {
        return entityData;
      }
    }

    // Try company name matching
    const contactCompany = contact.company ? contact.company.toLowerCase() : '';
    if (contactCompany) {
      for (const entityData of allEntities) {
        const entityName = entityData.entity.n ? entityData.entity.n.toLowerCase() : '';
        
        if (entityName && contactCompany === entityName) {
          return entityData;
        }
        
        if (entityName && (contactCompany.includes(entityName) || entityName.includes(contactCompany))) {
          return entityData;
        }
      }
    }

    return null;
  }

  async updateEntityWithCorreectedEngagement(tableName, entity, contact, engagementCounts) {
    const updateQuery = `
      UPDATE ${tableName} 
      SET 
        email_opens_7d = $1,
        email_clicks_7d = $2,
        email_replies_7d = $3,
        email_intelligence_updated = $4
      WHERE id = $5
    `;
    
    const values = [
      engagementCounts.opens7d,
      engagementCounts.clicks7d,
      engagementCounts.replies7d,
      new Date().toISOString(),
      entity.id
    ];
    
    try {
      await pool.query(updateQuery, values);
      this.stats.updated++;
      
      this.log(`✅ Updated ${entity.n || 'Unknown'} - Opens: ${engagementCounts.opens7d}, Clicks: ${engagementCounts.clicks7d}, Replies: ${engagementCounts.replies7d}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to update entity ${entity.n}:`, error.message);
      this.stats.errors++;
      return false;
    }
  }

  async run() {
    try {
      this.log('🔧 Starting CORRECTED HubSpot Email Intelligence Integration...');
      
      // Load HubSpot email engagement data
      const emailContacts = await this.loadHubSpotEmailData();
      
      // Load all entities from all tables with table info
      const allEntities = [];
      
      for (const table of this.tables) {
        const entitiesQuery = `SELECT * FROM ${table.name}`;
        const entitiesResult = await pool.query(entitiesQuery);
        
        for (const entity of entitiesResult.rows) {
          allEntities.push({
            entity,
            tableName: table.name,
            segment: table.segment
          });
        }
      }
      
      this.log(`📊 Loaded ${allEntities.length} total entities across all segments`);
      
      // Process each contact and update matching entities
      for (const contact of emailContacts) {
        if (contact.engagementScore === 0) continue;
        
        const match = await this.findMatchingEntity(contact, allEntities);
        
        if (match) {
          const engagementCounts = this.calculateEngagementCounts(contact);
          
          await this.updateEntityWithCorreectedEngagement(
            match.tableName,
            match.entity,
            contact,
            engagementCounts
          );
        }
        
        this.stats.totalProcessed++;
      }
      
      this.log(`\\n🎉 CORRECTED Integration Complete!`);
      this.log(`✅ Updated: ${this.stats.updated} entities`);
      this.log(`❌ Errors: ${this.stats.errors}`);
      this.log(`\\n📊 Email click and reply counts should now be accurate!`);
      
    } catch (error) {
      console.error('❌ Integration failed:', error);
      process.exit(1);
    }
  }
}

// Run the corrected integration
if (require.main === module) {
  const integration = new HubSpotEmailIntelligenceCorrected();
  integration.run()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = HubSpotEmailIntelligenceCorrected;