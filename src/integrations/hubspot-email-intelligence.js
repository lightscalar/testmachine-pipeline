#!/usr/bin/env node

const { pool } = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

/**
 * HubSpot Email Intelligence Integration
 * 
 * Integrates the comprehensive email engagement analysis from HubSpot
 * with the TestMachine pipeline database and UI.
 */
class HubSpotEmailIntelligenceIntegration {
  constructor() {
    this.debug = process.env.DEBUG === 'true';
    
    // Tables to update with email intelligence
    this.tables = [
      { name: 'exchanges', entityColumn: 'n', websiteColumn: 'w', segment: 'Exchanges' },
      { name: 'auditors', entityColumn: 'n', websiteColumn: 'w', segment: 'Auditors' },
      { name: 'large_auditors', entityColumn: 'n', websiteColumn: 'w', segment: 'Large Auditors' },
      { name: 'defi', entityColumn: 'n', websiteColumn: 'w', segment: 'DeFi' },
      { name: 'rwa_tokenization', entityColumn: 'n', websiteColumn: 'w', segment: 'RWA/Tokenization' }
    ];
    
    this.stats = {
      totalProcessed: 0,
      matched: 0,
      unmatched: 0,
      updated: 0,
      errors: 0,
      bySegment: {}
    };
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  debug_log(message) {
    if (this.debug) {
      console.log(`[DEBUG] ${message}`);
    }
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

  async ensureEmailEngagementColumns() {
    this.log('🔧 Ensuring email engagement columns exist in all tables...');
    
    const columns = [
      'email_engagement_score INTEGER DEFAULT 0',
      'email_engagement_level TEXT DEFAULT \'None\'',
      'email_last_open_date TEXT',
      'email_last_click_date TEXT',
      'email_last_reply_date TEXT',
      'email_opens_7d INTEGER DEFAULT 0',
      'email_clicks_7d INTEGER DEFAULT 0',
      'email_replies_7d INTEGER DEFAULT 0',
      'hubspot_contact_id TEXT',
      'email_intelligence_updated TEXT'
    ];
    
    for (const table of this.tables) {
      for (const column of columns) {
        try {
          const columnName = column.split(' ')[0];
          const addColumnQuery = `ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${column}`;
          await pool.query(addColumnQuery);
          this.debug_log(`✅ Added/verified column ${columnName} in ${table.name}`);
        } catch (error) {
          // Column might already exist, that's okay
          this.debug_log(`Column already exists or error: ${error.message}`);
        }
      }
    }
    
    this.log('✅ Email engagement columns ready');
  }

  extractDomainFromEmail(email) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[1].toLowerCase();
  }

  extractDomainFromWebsite(website) {
    if (!website) return null;
    
    try {
      // Remove protocol and www
      let domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
      // Take just the domain part (remove paths)
      domain = domain.split('/')[0].toLowerCase();
      return domain;
    } catch (error) {
      return website.toLowerCase();
    }
  }

  async matchContactWithEntity(contact, entities) {
    const contactDomain = this.extractDomainFromEmail(contact.email);
    if (!contactDomain) return null;

    // Try exact domain matches first
    for (const entity of entities) {
      const entityDomain = this.extractDomainFromWebsite(entity.w);
      if (entityDomain && entityDomain === contactDomain) {
        return { entity, matchType: 'exact_domain', confidence: 'high' };
      }
    }

    // Try company name matching
    const contactCompany = contact.company ? contact.company.toLowerCase() : '';
    if (contactCompany) {
      for (const entity of entities) {
        const entityName = entity.n ? entity.n.toLowerCase() : '';
        
        // Exact company name match
        if (entityName && contactCompany === entityName) {
          return { entity, matchType: 'exact_company', confidence: 'high' };
        }
        
        // Partial company name match
        if (entityName && (contactCompany.includes(entityName) || entityName.includes(contactCompany))) {
          return { entity, matchType: 'partial_company', confidence: 'medium' };
        }
      }
    }

    // Try domain similarity (e.g., crypto.com matches with cryptocom)
    const domainBase = contactDomain.replace(/\.(com|io|net|org)$/, '');
    for (const entity of entities) {
      const entityDomain = this.extractDomainFromWebsite(entity.w);
      if (entityDomain) {
        const entityBase = entityDomain.replace(/\.(com|io|net|org)$/, '');
        if (domainBase.includes(entityBase) || entityBase.includes(domainBase)) {
          return { entity, matchType: 'domain_similarity', confidence: 'medium' };
        }
      }
    }

    return null;
  }

  calculateRecencyBonus(dateStr) {
    if (!dateStr) return 0;
    
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const daysDiff = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      
      if (daysDiff <= 7) return 3; // Recent activity bonus
      if (daysDiff <= 30) return 1; // Medium recency bonus
      return 0;
    } catch (error) {
      return 0;
    }
  }

  async updateEntityWithEmailIntelligence(tableName, entity, contact, matchInfo) {
    // Calculate engagement metrics
    const openBonus = this.calculateRecencyBonus(contact.lastOpenDate);
    const clickBonus = this.calculateRecencyBonus(contact.lastClickDate);
    const replyBonus = this.calculateRecencyBonus(contact.lastReplyDate);
    
    const updateQuery = `
      UPDATE ${tableName} 
      SET 
        email_engagement_score = $1,
        email_engagement_level = $2,
        email_last_open_date = $3,
        email_last_click_date = $4,
        email_last_reply_date = $5,
        email_opens_7d = $6,
        email_clicks_7d = $7,
        email_replies_7d = $8,
        hubspot_contact_id = $9,
        email_intelligence_updated = $10
      WHERE id = $11
    `;
    
    const values = [
      contact.engagementScore,
      contact.engagementLevel,
      contact.lastOpenDate || null,
      contact.lastClickDate || null,
      contact.lastReplyDate || null,
      openBonus, // Simplified 7-day activity indicator
      clickBonus, // Simplified 7-day activity indicator
      replyBonus, // Simplified 7-day activity indicator
      contact.id,
      new Date().toISOString()
    ];

    // Add entity ID at the end
    values.push(entity.id);
    
    try {
      await pool.query(updateQuery, values);
      this.stats.updated++;
      
      this.log(`✅ Updated ${entity.n || 'Unknown'} with email intelligence (Score: ${contact.engagementScore}, Level: ${contact.engagementLevel})`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to update entity ${entity.n}:`, error.message);
      this.stats.errors++;
      return false;
    }
  }

  async processEmailIntelligence(emailContacts) {
    this.log(`🚀 Processing ${emailContacts.length} email contacts for entity matching...`);
    
    for (const table of this.tables) {
      this.log(`\\n📊 Processing ${table.segment}...`);
      
      // Get all entities from this table
      const entitiesQuery = `SELECT * FROM ${table.name}`;
      const entitiesResult = await pool.query(entitiesQuery);
      const entities = entitiesResult.rows;
      
      this.log(`   Loaded ${entities.length} entities from ${table.name}`);
      
      let segmentMatched = 0;
      let segmentUnmatched = 0;
      
      // Process each email contact
      for (const contact of emailContacts) {
        if (contact.engagementScore === 0) continue; // Skip zero-engagement contacts
        
        const match = await this.matchContactWithEntity(contact, entities);
        
        if (match) {
          const success = await this.updateEntityWithEmailIntelligence(
            table.name, 
            match.entity, 
            contact, 
            match
          );
          
          if (success) {
            segmentMatched++;
            this.stats.matched++;
          }
        } else {
          segmentUnmatched++;
          this.stats.unmatched++;
          
          this.debug_log(`No match found for ${contact.email} (${contact.company || 'No company'})`);
        }
        
        this.stats.totalProcessed++;
      }
      
      this.log(`   ${table.segment}: ${segmentMatched} matched, ${segmentUnmatched} unmatched`);
      this.stats.bySegment[table.segment] = { matched: segmentMatched, unmatched: segmentUnmatched };
    }
  }

  async generateReport() {
    this.log(`\\n📊 EMAIL INTELLIGENCE INTEGRATION REPORT`);
    this.log(`${'='.repeat(50)}`);
    this.log(`Total Contacts Processed: ${this.stats.totalProcessed}`);
    this.log(`Successfully Matched: ${this.stats.matched}`);
    this.log(`Unmatched: ${this.stats.unmatched}`);
    this.log(`Database Updates: ${this.stats.updated}`);
    this.log(`Errors: ${this.stats.errors}`);
    this.log(`Match Rate: ${((this.stats.matched / this.stats.totalProcessed) * 100).toFixed(1)}%`);
    
    this.log(`\\n📈 BY MARKET SEGMENT:`);
    for (const [segment, stats] of Object.entries(this.stats.bySegment)) {
      const total = stats.matched + stats.unmatched;
      const rate = total > 0 ? ((stats.matched / total) * 100).toFixed(1) : '0';
      this.log(`   ${segment}: ${stats.matched}/${total} (${rate}%)`);
    }
    
    // Query top engaged entities across all tables
    this.log(`\\n🔥 TOP ENGAGED ENTITIES (By Email Intelligence):`);
    
    for (const table of this.tables) {
      const query = `
        SELECT n as name, w as website, email_engagement_score, email_engagement_level,
               email_last_open_date, email_last_click_date, email_last_reply_date
        FROM ${table.name} 
        WHERE email_engagement_score > 0 
        ORDER BY email_engagement_score DESC 
        LIMIT 3
      `;
      
      const result = await pool.query(query);
      if (result.rows.length > 0) {
        this.log(`\\n   ${table.segment.toUpperCase()}:`);
        result.rows.forEach((row, i) => {
          this.log(`   ${i+1}. ${row.name} (Score: ${row.email_engagement_score}, Level: ${row.email_engagement_level})`);
          if (row.email_last_open_date) {
            this.log(`      Last Email Open: ${new Date(row.email_last_open_date).toLocaleDateString()}`);
          }
        });
      }
    }
  }

  async run() {
    try {
      this.log('🚀 Starting HubSpot Email Intelligence Integration...');
      
      // Step 1: Ensure database columns exist
      await this.ensureEmailEngagementColumns();
      
      // Step 2: Load HubSpot email engagement data
      const emailContacts = await this.loadHubSpotEmailData();
      
      // Step 3: Process and match with pipeline entities
      await this.processEmailIntelligence(emailContacts);
      
      // Step 4: Generate report
      await this.generateReport();
      
      this.log('\\n🎉 HubSpot Email Intelligence Integration Complete!');
      this.log('\\n✨ Your pipeline now includes email engagement intelligence!');
      this.log('   Check pipeline.lightscalar.net to see the new email engagement data.');
      
    } catch (error) {
      console.error('❌ Integration failed:', error);
      process.exit(1);
    }
  }
}

// Run the integration
if (require.main === module) {
  const integration = new HubSpotEmailIntelligenceIntegration();
  integration.run()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = HubSpotEmailIntelligenceIntegration;