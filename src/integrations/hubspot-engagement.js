#!/usr/bin/env node

const { Client } = require('@hubspot/api-client');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class HubSpotEngagementIntelligence {
  constructor() {
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    this.dbPath = path.join(__dirname, '../../pipeline.db');
    this.debug = process.env.DEBUG === 'true';
    this.batchSize = 50; // Process in batches to handle rate limits
    
    if (!this.accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN environment variable is required');
    }
    
    this.client = new Client({ accessToken: this.accessToken });
    this.db = null;
    
    // Tables and their key columns for entity matching
    this.tables = [
      { name: 'exchanges', entityColumn: 'n', websiteColumn: 'w' },
      { name: 'auditors', entityColumn: 'n', websiteColumn: 'w' },
      { name: 'large_auditors', entityColumn: 'n', websiteColumn: 'w' },
      { name: 'defi_protocols', entityColumn: 'n', websiteColumn: 'w' },
      { name: 'rwa_tokenization', entityColumn: 'n', websiteColumn: 'w' }
    ];
    
    // Engagement scoring weights
    this.engagementWeights = {
      recent_meetings: 3.0,      // Meetings in last 30 days
      email_responses: 2.5,      // Email replies received
      meeting_count_total: 2.0,  // All-time meetings
      email_opens: 1.5,          // Email opens
      email_clicks: 2.0,         // Email clicks  
      call_duration_total: 1.8,  // Total call time (minutes)
      note_count: 1.2,           // Sales notes/activities
      task_completions: 1.0,     // Completed tasks
      days_since_last_activity: -0.1  // Recency penalty
    };

    this.matchingResults = {
      matched: 0,
      unmatched: 0,
      confidence_high: 0,
      confidence_medium: 0,
      confidence_low: 0,
      logs: []
    };
  }

  log(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    
    this.matchingResults.logs.push({ timestamp, message, data });
    
    if (data && this.debug) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  async initDatabase() {
    this.log('🗄️ Initializing SQLite database...');
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to connect to database: ${err.message}`));
        } else {
          this.log('✅ Database connection established');
          resolve();
        }
      });
    });
  }

  async createTables() {
    this.log('🏗️ Creating/updating database schema...');
    
    const createTableQueries = this.tables.map(table => `
      CREATE TABLE IF NOT EXISTS ${table.name} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        n TEXT NOT NULL,  -- Entity name
        w TEXT,           -- Website
        s TEXT DEFAULT 'Prospecting',  -- Stage
        c TEXT,           -- Connection
        r TEXT,           -- Role  
        o TEXT,           -- Owner
        t TEXT,           -- Timing
        p TEXT,           -- Provider
        l TEXT,           -- Listings
        github_repos TEXT,
        news TEXT,
        
        -- HubSpot Engagement Intelligence
        hubspot_company_id TEXT,
        hubspot_contact_ids TEXT,  -- JSON array of contact IDs
        engagement_score INTEGER DEFAULT 0,
        engagement_level TEXT DEFAULT 'Unknown',
        confidence_score REAL DEFAULT 0,
        
        -- Detailed engagement metrics
        recent_meetings INTEGER DEFAULT 0,
        email_responses INTEGER DEFAULT 0, 
        meeting_count_total INTEGER DEFAULT 0,
        email_opens INTEGER DEFAULT 0,
        email_clicks INTEGER DEFAULT 0,
        call_duration_total INTEGER DEFAULT 0,  -- minutes
        note_count INTEGER DEFAULT 0,
        task_completions INTEGER DEFAULT 0,
        days_since_last_activity INTEGER,
        
        -- Metadata
        last_hubspot_sync DATETIME,
        matching_method TEXT,
        matching_details TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const query of createTableQueries) {
      await this.runQuery(query);
    }
    
    // Add engagement columns to existing tables if they don't exist
    for (const table of this.tables) {
      await this.addEngagementColumnsIfMissing(table.name);
    }
    
    this.log('✅ Database schema ready');
  }

  async addEngagementColumnsIfMissing(tableName) {
    const engagementColumns = [
      'hubspot_company_id TEXT',
      'hubspot_contact_ids TEXT',
      'engagement_score INTEGER DEFAULT 0',
      'engagement_level TEXT DEFAULT \'Unknown\'',
      'confidence_score REAL DEFAULT 0',
      'recent_meetings INTEGER DEFAULT 0',
      'email_responses INTEGER DEFAULT 0',
      'meeting_count_total INTEGER DEFAULT 0', 
      'email_opens INTEGER DEFAULT 0',
      'email_clicks INTEGER DEFAULT 0',
      'call_duration_total INTEGER DEFAULT 0',
      'note_count INTEGER DEFAULT 0',
      'task_completions INTEGER DEFAULT 0',
      'days_since_last_activity INTEGER',
      'last_hubspot_sync DATETIME',
      'matching_method TEXT',
      'matching_details TEXT'
    ];

    for (const column of engagementColumns) {
      try {
        await this.runQuery(`ALTER TABLE ${tableName} ADD COLUMN ${column}`);
      } catch (err) {
        // Column probably already exists, which is fine
        if (!err.message.includes('duplicate column name')) {
          this.log(`⚠️ Warning adding column to ${tableName}: ${err.message}`);
        }
      }
    }
  }

  async runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async fetchAllHubSpotCompanies() {
    this.log('🏢 Fetching ALL HubSpot companies...');
    
    const companies = [];
    let hasMore = true;
    let offset = 0;
    
    const properties = [
      'name', 'domain', 'website', 'industry', 'linkedin_company_page',
      'twitterhandle', 'phone', 'city', 'state', 'country', 
      'num_associated_contacts', 'createdate', 'hs_lastmodifieddate'
    ];

    while (hasMore) {
      try {
        const response = await this.client.crm.companies.basicApi.getPage(
          this.batchSize, 
          offset, 
          properties,
          undefined, // associations
          undefined  // archived
        );

        companies.push(...response.results);
        
        if (response.paging && response.paging.next) {
          offset = response.paging.next.after;
          this.log(`📦 Fetched ${companies.length} companies so far...`);
          
          // Rate limiting - HubSpot allows 100 requests per 10 seconds
          await new Promise(resolve => setTimeout(resolve, 150));
        } else {
          hasMore = false;
        }
        
      } catch (error) {
        this.log(`❌ Error fetching companies at offset ${offset}: ${error.message}`);
        
        if (error.message.includes('rate limit')) {
          this.log('⏳ Rate limited, waiting 10 seconds...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue;
        }
        
        throw error;
      }
    }
    
    this.log(`✅ Retrieved ${companies.length} total HubSpot companies`);
    return companies;
  }

  async fetchAllHubSpotContacts() {
    this.log('👤 Fetching ALL HubSpot contacts...');
    
    const contacts = [];
    let hasMore = true;
    let offset = 0;
    
    const properties = [
      'firstname', 'lastname', 'email', 'company', 'jobtitle',
      'phone', 'linkedin_profile', 'twitter_username', 'city', 'state',
      'createdate', 'lastmodifieddate', 'hs_lead_status', 'lifecyclestage'
    ];

    while (hasMore) {
      try {
        const response = await this.client.crm.contacts.basicApi.getPage(
          this.batchSize,
          offset,
          properties
        );

        contacts.push(...response.results);
        
        if (response.paging && response.paging.next) {
          offset = response.paging.next.after;
          this.log(`📦 Fetched ${contacts.length} contacts so far...`);
          
          await new Promise(resolve => setTimeout(resolve, 150));
        } else {
          hasMore = false;
        }
        
      } catch (error) {
        this.log(`❌ Error fetching contacts at offset ${offset}: ${error.message}`);
        
        if (error.message.includes('rate limit')) {
          this.log('⏳ Rate limited, waiting 10 seconds...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue;
        }
        
        throw error;
      }
    }
    
    this.log(`✅ Retrieved ${contacts.length} total HubSpot contacts`);
    return contacts;
  }

  async fetchEngagementData(companyId, contactIds = []) {
    const engagement = {
      recent_meetings: 0,
      email_responses: 0,
      meeting_count_total: 0,
      email_opens: 0,
      email_clicks: 0,
      call_duration_total: 0,
      note_count: 0,
      task_completions: 0,
      days_since_last_activity: null
    };

    // Combine company and contact IDs for activity lookup
    const objectIds = [companyId, ...contactIds].filter(Boolean);
    
    if (objectIds.length === 0) return engagement;

    try {
      // Fetch engagements (meetings, calls, emails, notes, tasks)
      for (const objectId of objectIds) {
        await this.fetchObjectEngagements(objectId, engagement);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      this.log(`⚠️ Error fetching engagement data: ${error.message}`);
    }

    return engagement;
  }

  async fetchObjectEngagements(objectId, engagement) {
    try {
      // Get meetings
      const meetingsResponse = await this.client.crm.objects.meetings.basicApi.getPage(
        this.batchSize, undefined, ['hs_timestamp', 'hs_meeting_outcome'], 
        [`companies:${objectId}`, `contacts:${objectId}`]
      );
      
      if (meetingsResponse.results) {
        const meetings = meetingsResponse.results;
        engagement.meeting_count_total += meetings.length;
        
        // Count recent meetings (last 30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        engagement.recent_meetings += meetings.filter(meeting => {
          const timestamp = meeting.properties.hs_timestamp;
          return timestamp && new Date(timestamp).getTime() > thirtyDaysAgo;
        }).length;
      }

      // Get calls
      const callsResponse = await this.client.crm.objects.calls.basicApi.getPage(
        this.batchSize, undefined, ['hs_timestamp', 'hs_call_duration'],
        [`companies:${objectId}`, `contacts:${objectId}`]
      );
      
      if (callsResponse.results) {
        engagement.call_duration_total += callsResponse.results.reduce((total, call) => {
          const duration = parseInt(call.properties.hs_call_duration) || 0;
          return total + Math.floor(duration / 60000); // Convert ms to minutes
        }, 0);
      }

      // Get notes
      const notesResponse = await this.client.crm.objects.notes.basicApi.getPage(
        this.batchSize, undefined, ['hs_timestamp'],
        [`companies:${objectId}`, `contacts:${objectId}`]
      );
      
      if (notesResponse.results) {
        engagement.note_count += notesResponse.results.length;
      }

      // Get tasks
      const tasksResponse = await this.client.crm.objects.tasks.basicApi.getPage(
        this.batchSize, undefined, ['hs_timestamp', 'hs_task_status'],
        [`companies:${objectId}`, `contacts:${objectId}`]
      );
      
      if (tasksResponse.results) {
        engagement.task_completions += tasksResponse.results.filter(task => 
          task.properties.hs_task_status === 'COMPLETED'
        ).length;
      }

      // Get emails and email engagement
      const emailsResponse = await this.client.crm.objects.emails.basicApi.getPage(
        this.batchSize, undefined, [
          'hs_timestamp', 'hs_email_direction', 'hs_email_status',
          'hs_email_open_count', 'hs_email_click_count', 'hs_email_reply_count'
        ],
        [`companies:${objectId}`, `contacts:${objectId}`]
      );
      
      if (emailsResponse.results) {
        for (const email of emailsResponse.results) {
          const props = email.properties;
          
          // Count email opens
          const openCount = parseInt(props.hs_email_open_count) || 0;
          engagement.email_opens += openCount;
          
          // Count email clicks  
          const clickCount = parseInt(props.hs_email_click_count) || 0;
          engagement.email_clicks += clickCount;
          
          // Count email responses (replies we received)
          if (props.hs_email_direction === 'INCOMING' || 
              (props.hs_email_reply_count && parseInt(props.hs_email_reply_count) > 0)) {
            engagement.email_responses += 1;
          }
        }
      }

    } catch (error) {
      // Some engagement types might not be available - that's okay
      if (!error.message.includes('not found') && !error.message.includes('forbidden')) {
        this.log(`⚠️ Error fetching engagements for ${objectId}: ${error.message}`);
      }
    }
  }

  normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractDomain(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      return urlObj.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return url.replace(/^www\./, '').toLowerCase();
    }
  }

  async matchEntitiesWithHubSpot(pipelineEntities, hubspotCompanies, hubspotContacts) {
    this.log('🔍 Starting entity matching process...');
    
    const matches = [];
    
    for (const entity of pipelineEntities) {
      const matchResult = await this.findBestMatch(entity, hubspotCompanies, hubspotContacts);
      
      if (matchResult) {
        matches.push(matchResult);
        this.matchingResults.matched++;
        
        // Count confidence levels
        if (matchResult.confidence >= 0.8) this.matchingResults.confidence_high++;
        else if (matchResult.confidence >= 0.6) this.matchingResults.confidence_medium++;
        else this.matchingResults.confidence_low++;
        
      } else {
        this.matchingResults.unmatched++;
      }
    }
    
    this.log(`✅ Matching complete: ${matches.length} matches found`);
    return matches;
  }

  async findBestMatch(entity, hubspotCompanies, hubspotContacts) {
    const entityName = this.normalizeString(entity.n);
    const entityWebsite = entity.w ? this.extractDomain(entity.w) : '';
    
    let bestMatch = null;
    let highestConfidence = 0;

    // Try exact name match first
    for (const company of hubspotCompanies) {
      const companyName = this.normalizeString(company.properties.name || '');
      const companyDomain = this.extractDomain(company.properties.domain || company.properties.website || '');
      
      let confidence = 0;
      const matchDetails = { methods: [], reasons: [] };

      // Name matching (highest weight)
      if (entityName && companyName) {
        if (entityName === companyName) {
          confidence += 0.5;
          matchDetails.methods.push('exact_name_match');
          matchDetails.reasons.push(`Exact name match: "${entity.n}"`);
        } else if (entityName.includes(companyName) || companyName.includes(entityName)) {
          confidence += 0.3;
          matchDetails.methods.push('partial_name_match');
          matchDetails.reasons.push(`Partial name match: "${entity.n}" ~ "${company.properties.name}"`);
        } else {
          // Fuzzy matching for variations like "Coinbase" vs "Coinbase Global Inc"
          const entityTokens = entityName.split(' ');
          const companyTokens = companyName.split(' ');
          const commonTokens = entityTokens.filter(token => 
            token.length > 2 && companyTokens.some(ct => ct.includes(token) || token.includes(ct))
          );
          
          if (commonTokens.length > 0 && commonTokens.length >= Math.min(entityTokens.length, companyTokens.length) * 0.5) {
            confidence += 0.25;
            matchDetails.methods.push('fuzzy_name_match');
            matchDetails.reasons.push(`Fuzzy name match via tokens: [${commonTokens.join(', ')}]`);
          }
        }
      }

      // Website/domain matching
      if (entityWebsite && companyDomain) {
        if (entityWebsite === companyDomain) {
          confidence += 0.4;
          matchDetails.methods.push('exact_domain_match');
          matchDetails.reasons.push(`Domain match: ${entityWebsite}`);
        } else if (entityWebsite.includes(companyDomain) || companyDomain.includes(entityWebsite)) {
          confidence += 0.2;
          matchDetails.methods.push('partial_domain_match');
          matchDetails.reasons.push(`Partial domain match: ${entityWebsite} ~ ${companyDomain}`);
        }
      }

      // Social handles matching (bonus)
      const hubspotLinkedIn = this.normalizeString(company.properties.linkedin_company_page || '');
      const hubspotTwitter = this.normalizeString(company.properties.twitterhandle || '');
      
      if (hubspotLinkedIn && entityName && hubspotLinkedIn.includes(entityName)) {
        confidence += 0.1;
        matchDetails.methods.push('linkedin_match');
        matchDetails.reasons.push(`LinkedIn handle contains entity name`);
      }
      
      if (hubspotTwitter && entityName && hubspotTwitter.includes(entityName)) {
        confidence += 0.1;
        matchDetails.methods.push('twitter_match');
        matchDetails.reasons.push(`Twitter handle contains entity name`);
      }

      // Update best match if this is better
      if (confidence > highestConfidence && confidence >= 0.3) { // Minimum confidence threshold
        highestConfidence = confidence;
        bestMatch = {
          entity,
          hubspotCompany: company,
          confidence,
          matchDetails
        };
      }
    }

    // Also find related contacts for the matched company
    if (bestMatch) {
      const companyDomain = this.extractDomain(
        bestMatch.hubspotCompany.properties.domain || 
        bestMatch.hubspotCompany.properties.website || ''
      );
      
      bestMatch.hubspotContacts = hubspotContacts.filter(contact => {
        const contactEmail = contact.properties.email || '';
        const contactCompany = this.normalizeString(contact.properties.company || '');
        const entityNameNorm = this.normalizeString(entity.n);
        
        return (companyDomain && contactEmail.includes(companyDomain)) ||
               (contactCompany && entityNameNorm && contactCompany.includes(entityNameNorm));
      });
    }

    return bestMatch;
  }

  calculateEngagementScore(engagementData) {
    let score = 0;
    
    // Apply weights to engagement metrics
    Object.entries(this.engagementWeights).forEach(([metric, weight]) => {
      const value = engagementData[metric] || 0;
      score += value * weight;
    });
    
    // Normalize to 0-10 scale
    score = Math.max(0, Math.min(10, Math.round(score)));
    
    // Determine engagement level
    let level;
    if (score >= 8) level = 'High';
    else if (score >= 4) level = 'Medium';
    else if (score >= 1) level = 'Low';
    else level = 'None';

    return { score, level };
  }

  async updateEntityWithEngagement(entity, matchResult) {
    const companyId = matchResult.hubspotCompany.id;
    const contactIds = matchResult.hubspotContacts.map(c => c.id);
    
    // Fetch engagement data
    const engagementData = await this.fetchEngagementData(companyId, contactIds);
    const { score, level } = this.calculateEngagementScore(engagementData);
    
    // Update database
    const updateSql = `
      UPDATE ${entity.table_name} 
      SET hubspot_company_id = ?,
          hubspot_contact_ids = ?,
          engagement_score = ?,
          engagement_level = ?,
          confidence_score = ?,
          recent_meetings = ?,
          email_responses = ?,
          meeting_count_total = ?,
          email_opens = ?,
          email_clicks = ?,
          call_duration_total = ?,
          note_count = ?,
          task_completions = ?,
          days_since_last_activity = ?,
          last_hubspot_sync = CURRENT_TIMESTAMP,
          matching_method = ?,
          matching_details = ?
      WHERE id = ?
    `;
    
    const params = [
      companyId,
      JSON.stringify(contactIds),
      score,
      level,
      matchResult.confidence,
      engagementData.recent_meetings,
      engagementData.email_responses,
      engagementData.meeting_count_total,
      engagementData.email_opens,
      engagementData.email_clicks,
      engagementData.call_duration_total,
      engagementData.note_count,
      engagementData.task_completions,
      engagementData.days_since_last_activity,
      matchResult.matchDetails.methods.join(','),
      JSON.stringify(matchResult.matchDetails),
      entity.id
    ];

    await this.runQuery(updateSql, params);
    
    this.log(`✅ Updated ${entity.n}: engagement=${score}/10 (${level}), confidence=${matchResult.confidence.toFixed(2)}`);
    
    return {
      entity: entity.n,
      table: entity.table_name,
      engagement_score: score,
      engagement_level: level,
      confidence: matchResult.confidence,
      hubspot_company_id: companyId,
      contact_count: contactIds.length
    };
  }

  async getAllPipelineEntities() {
    this.log('📊 Fetching all pipeline entities...');
    
    const allEntities = [];
    
    for (const table of this.tables) {
      try {
        const entities = await this.runQuery(`SELECT id, ${table.entityColumn} as n, ${table.websiteColumn} as w FROM ${table.name}`);
        entities.forEach(entity => {
          entity.table_name = table.name;
        });
        allEntities.push(...entities);
        this.log(`📦 Found ${entities.length} entities in ${table.name}`);
      } catch (error) {
        this.log(`⚠️ Could not read from table ${table.name}: ${error.message}`);
      }
    }
    
    this.log(`✅ Total pipeline entities: ${allEntities.length}`);
    return allEntities;
  }

  async generateReport() {
    const report = {
      summary: {
        timestamp: new Date().toISOString(),
        total_entities: this.matchingResults.matched + this.matchingResults.unmatched,
        matched_entities: this.matchingResults.matched,
        unmatched_entities: this.matchingResults.unmatched,
        match_rate: this.matchingResults.matched / (this.matchingResults.matched + this.matchingResults.unmatched) * 100
      },
      confidence_breakdown: {
        high: this.matchingResults.confidence_high,
        medium: this.matchingResults.confidence_medium,
        low: this.matchingResults.confidence_low
      },
      logs: this.matchingResults.logs.slice(-50) // Last 50 log entries
    };

    // Get engagement distribution
    const engagementStats = await this.getEngagementStatistics();
    report.engagement_distribution = engagementStats;

    // Save report
    const reportPath = path.join(__dirname, '../../logs/hubspot-engagement-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    this.log(`📊 Full report saved to: ${reportPath}`);
    return report;
  }

  async getEngagementStatistics() {
    const stats = { High: 0, Medium: 0, Low: 0, None: 0, Unknown: 0 };
    
    for (const table of this.tables) {
      try {
        const results = await this.runQuery(
          `SELECT engagement_level, COUNT(*) as count FROM ${table.name} GROUP BY engagement_level`
        );
        
        results.forEach(row => {
          const level = row.engagement_level || 'Unknown';
          stats[level] = (stats[level] || 0) + row.count;
        });
      } catch (error) {
        // Table might not have engagement columns yet
      }
    }
    
    return stats;
  }

  async run() {
    try {
      this.log('🚀 Starting comprehensive HubSpot engagement intelligence integration...');
      
      // Initialize database
      await this.initDatabase();
      await this.createTables();
      
      // Fetch all data
      const [hubspotCompanies, hubspotContacts, pipelineEntities] = await Promise.all([
        this.fetchAllHubSpotCompanies(),
        this.fetchAllHubSpotContacts(),
        this.getAllPipelineEntities()
      ]);

      this.log(`📊 Data loaded: ${hubspotCompanies.length} HubSpot companies, ${hubspotContacts.length} contacts, ${pipelineEntities.length} pipeline entities`);
      
      // Match entities
      const matches = await this.matchEntitiesWithHubSpot(pipelineEntities, hubspotCompanies, hubspotContacts);
      
      // Update entities with engagement data
      const updateResults = [];
      for (const match of matches) {
        try {
          const result = await this.updateEntityWithEngagement(match.entity, match);
          updateResults.push(result);
          
          // Rate limiting for engagement API calls
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          this.log(`❌ Failed to update ${match.entity.n}: ${error.message}`);
        }
      }

      // Generate final report
      const report = await this.generateReport();
      
      this.log('🎉 Integration complete! Summary:');
      this.log(`  • Total entities processed: ${report.summary.total_entities}`);
      this.log(`  • Successfully matched: ${report.summary.matched_entities} (${report.summary.match_rate.toFixed(1)}%)`);
      this.log(`  • High confidence matches: ${report.confidence_breakdown.high}`);
      this.log(`  • Medium confidence matches: ${report.confidence_breakdown.medium}`);
      this.log(`  • Low confidence matches: ${report.confidence_breakdown.low}`);
      this.log(`  • Updated with engagement data: ${updateResults.length}`);
      
      console.log('\n📊 Engagement Distribution:');
      Object.entries(report.engagement_distribution).forEach(([level, count]) => {
        console.log(`  ${level}: ${count}`);
      });

      return report;
      
    } catch (error) {
      this.log(`❌ Integration failed: ${error.message}`);
      if (this.debug) {
        console.error(error.stack);
      }
      throw error;
      
    } finally {
      if (this.db) {
        this.db.close();
      }
    }
  }
}

// CLI usage
if (require.main === module) {
  const integration = new HubSpotEngagementIntelligence();
  integration.run()
    .then(report => {
      console.log('\n✅ HubSpot engagement intelligence integration completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Integration failed:', error.message);
      process.exit(1);
    });
}

module.exports = HubSpotEngagementIntelligence;