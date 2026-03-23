#!/usr/bin/env node

const { Client } = require('@hubspot/api-client');
const { pool } = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

/**
 * FULL-SCALE HubSpot Integration for ALL 582+ Entities
 * 
 * Improvements from original:
 * ✅ Uses PostgreSQL instead of SQLite (where the real 582+ entities are)
 * ✅ Fixed rate limiting: batch size 100→50, proper delays, retry logic  
 * ✅ Comprehensive error handling and logging
 * ✅ Scales to all market segments simultaneously
 * ✅ Strategic prioritization based on engagement scores
 */
class HubSpotFullScaleIntegration {
  constructor() {
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    this.debug = process.env.DEBUG === 'true';
    
    // FIXED: Reduced batch size from 100 to 50 for rate limit compliance
    this.batchSize = 50;
    
    // FIXED: Proper rate limiting delays
    this.delays = {
      between_batches: 500,      // 500ms between batches (was 150ms)
      between_requests: 200,     // 200ms between individual requests (was 100ms)  
      rate_limit_retry: 12000,   // 12s on rate limit (was 10s)
      engagement_fetch: 300      // 300ms between engagement API calls (was 200ms)
    };
    
    // FIXED: Retry configuration for 429 responses
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 2000,
      backoffMultiplier: 2
    };
    
    if (!this.accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN environment variable is required');
    }
    
    this.client = new Client({ accessToken: this.accessToken });
    
    // ALL market segments with their PostgreSQL table names and column mappings
    this.tables = [
      { name: 'exchanges', entityColumn: 'n', websiteColumn: 'w', segment: 'Exchanges' },
      { name: 'auditors', entityColumn: 'n', websiteColumn: 'w', segment: 'Auditors' },
      { name: 'large_auditors', entityColumn: 'n', websiteColumn: 'w', segment: 'Large Auditors' },
      { name: 'defi', entityColumn: 'n', websiteColumn: 'w', segment: 'DeFi Protocols' },
      { name: 'rwa_tokenization', entityColumn: 'n', websiteColumn: 'w', segment: 'RWA/Tokenization' }
    ];
    
    // Enhanced engagement scoring weights
    this.engagementWeights = {
      recent_meetings: 3.0,      
      email_responses: 2.5,      
      meeting_count_total: 2.0,  
      email_opens: 1.5,          
      email_clicks: 2.0,         
      call_duration_total: 1.8,  
      note_count: 1.2,           
      task_completions: 1.0,     
      days_since_last_activity: -0.1
    };

    this.stats = {
      processed: 0,
      matched: 0,
      unmatched: 0,
      high_confidence: 0,
      medium_confidence: 0,
      low_confidence: 0,
      errors: 0,
      rate_limits: 0,
      retries: 0,
      by_segment: {},
      start_time: Date.now(),
      logs: []
    };

    // Initialize segment stats
    this.tables.forEach(table => {
      this.stats.by_segment[table.segment] = {
        total: 0,
        processed: 0,
        matched: 0,
        high_confidence: 0
      };
    });
  }

  log(message, data = null) {
    const timestamp = new Date().toISOString();
    const elapsed = ((Date.now() - this.stats.start_time) / 1000).toFixed(1);
    const logMessage = `[${timestamp}] [+${elapsed}s] ${message}`;
    
    console.log(logMessage);
    this.stats.logs.push({ timestamp, message, data, elapsed: elapsed + 's' });
    
    if (data && this.debug) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  async ensureEngagementColumns() {
    this.log('🏗️ Ensuring engagement columns exist in all tables...');
    
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
      'last_hubspot_sync TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP',
      'matching_method TEXT',
      'matching_details JSONB'
    ];

    for (const table of this.tables) {
      for (const columnDef of engagementColumns) {
        try {
          const [columnName] = columnDef.split(' ');
          await pool.query(`ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${columnDef}`);
        } catch (error) {
          // Column might already exist, which is fine
          if (!error.message.includes('already exists')) {
            this.log(`⚠️ Warning adding column to ${table.name}: ${error.message}`);
          }
        }
      }
      
      this.log(`✅ Updated schema for ${table.name}`);
    }
  }

  async getAllPipelineEntities() {
    this.log('📊 Fetching ALL pipeline entities from PostgreSQL...');
    
    const allEntities = [];
    
    for (const table of this.tables) {
      try {
        const query = `SELECT id, ${table.entityColumn} as n, ${table.websiteColumn} as w FROM ${table.name} ORDER BY id`;
        const result = await pool.query(query);
        
        const entities = result.rows.map(entity => ({
          ...entity,
          table_name: table.name,
          segment: table.segment
        }));
        
        allEntities.push(...entities);
        this.stats.by_segment[table.segment].total = entities.length;
        
        this.log(`📦 Found ${entities.length} entities in ${table.name} (${table.segment})`);
        
      } catch (error) {
        this.log(`❌ Could not read from table ${table.name}: ${error.message}`);
        this.stats.errors++;
      }
    }
    
    this.log(`✅ Total pipeline entities loaded: ${allEntities.length}`);
    return allEntities;
  }

  async fetchAllHubSpotCompaniesWithRetry() {
    this.log('🏢 Fetching ALL HubSpot companies with improved rate limiting...');
    
    const companies = [];
    let hasMore = true;
    let offset = 0;
    let batchNumber = 0;
    
    const properties = [
      'name', 'domain', 'website', 'industry', 'linkedin_company_page',
      'twitterhandle', 'phone', 'city', 'state', 'country', 
      'num_associated_contacts', 'createdate', 'hs_lastmodifieddate'
    ];

    while (hasMore) {
      batchNumber++;
      let retryCount = 0;
      let batchSuccess = false;

      while (!batchSuccess && retryCount < this.retryConfig.maxRetries) {
        try {
          const response = await this.client.crm.companies.basicApi.getPage(
            this.batchSize,  // FIXED: Now using 50 instead of 100
            offset, 
            properties
          );

          companies.push(...response.results);
          
          this.log(`📦 Batch ${batchNumber}: Fetched ${response.results.length} companies (total: ${companies.length})`);
          
          if (response.paging && response.paging.next) {
            offset = response.paging.next.after;
            
            // FIXED: Proper delay between batches
            await this.sleep(this.delays.between_batches);
          } else {
            hasMore = false;
          }
          
          batchSuccess = true;
          
        } catch (error) {
          retryCount++;
          this.stats.retries++;
          
          if (error.message.includes('rate limit') || error.message.includes('429')) {
            this.stats.rate_limits++;
            const waitTime = this.delays.rate_limit_retry * retryCount;
            this.log(`⏳ Rate limited on batch ${batchNumber}, retry ${retryCount}/${this.retryConfig.maxRetries}. Waiting ${waitTime/1000}s...`);
            await this.sleep(waitTime);
            
          } else if (retryCount >= this.retryConfig.maxRetries) {
            this.log(`❌ Failed to fetch batch ${batchNumber} after ${this.retryConfig.maxRetries} retries: ${error.message}`);
            this.stats.errors++;
            throw error;
          } else {
            const backoffDelay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount - 1);
            this.log(`⚠️ Error on batch ${batchNumber}, retry ${retryCount}/${this.retryConfig.maxRetries} in ${backoffDelay/1000}s: ${error.message}`);
            await this.sleep(backoffDelay);
          }
        }
      }

      if (!batchSuccess) {
        this.log(`❌ Failed to fetch companies batch ${batchNumber} after all retries`);
        break;
      }
    }
    
    this.log(`✅ Retrieved ${companies.length} total HubSpot companies with ${this.stats.retries} retries and ${this.stats.rate_limits} rate limits`);
    return companies;
  }

  async fetchAllHubSpotContactsWithRetry() {
    this.log('👤 Fetching ALL HubSpot contacts with improved rate limiting...');
    
    const contacts = [];
    let hasMore = true;
    let offset = 0;
    let batchNumber = 0;
    
    const properties = [
      'firstname', 'lastname', 'email', 'company', 'jobtitle',
      'phone', 'linkedin_profile', 'twitter_username', 'city', 'state',
      'createdate', 'lastmodifieddate', 'hs_lead_status', 'lifecyclestage'
    ];

    while (hasMore) {
      batchNumber++;
      let retryCount = 0;
      let batchSuccess = false;

      while (!batchSuccess && retryCount < this.retryConfig.maxRetries) {
        try {
          const response = await this.client.crm.contacts.basicApi.getPage(
            this.batchSize,  // FIXED: Now using 50 instead of 100
            offset,
            properties
          );

          contacts.push(...response.results);
          
          this.log(`📦 Contact Batch ${batchNumber}: Fetched ${response.results.length} contacts (total: ${contacts.length})`);
          
          if (response.paging && response.paging.next) {
            offset = response.paging.next.after;
            await this.sleep(this.delays.between_batches);
          } else {
            hasMore = false;
          }
          
          batchSuccess = true;
          
        } catch (error) {
          retryCount++;
          this.stats.retries++;
          
          if (error.message.includes('rate limit') || error.message.includes('429')) {
            this.stats.rate_limits++;
            const waitTime = this.delays.rate_limit_retry * retryCount;
            this.log(`⏳ Rate limited on contact batch ${batchNumber}, retry ${retryCount}. Waiting ${waitTime/1000}s...`);
            await this.sleep(waitTime);
            
          } else if (retryCount >= this.retryConfig.maxRetries) {
            this.log(`❌ Failed to fetch contact batch ${batchNumber}: ${error.message}`);
            this.stats.errors++;
            throw error;
          } else {
            const backoffDelay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount - 1);
            this.log(`⚠️ Contact batch ${batchNumber} error, retry ${retryCount} in ${backoffDelay/1000}s: ${error.message}`);
            await this.sleep(backoffDelay);
          }
        }
      }
    }
    
    this.log(`✅ Retrieved ${contacts.length} total HubSpot contacts`);
    return contacts;
  }

  async fetchEngagementDataWithRetry(companyId, contactIds = []) {
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

    const objectIds = [companyId, ...contactIds].filter(Boolean);
    if (objectIds.length === 0) return engagement;

    // FIXED: Process contacts in smaller batches to avoid rate limits
    const contactBatches = this.chunkArray(objectIds, 25); // Process 25 at a time instead of all at once

    for (let i = 0; i < contactBatches.length; i++) {
      const batch = contactBatches[i];
      
      try {
        for (const objectId of batch) {
          await this.fetchObjectEngagementsWithRetry(objectId, engagement);
          // FIXED: Proper delay between engagement API calls
          await this.sleep(this.delays.engagement_fetch);
        }
        
        // Delay between batches
        if (i < contactBatches.length - 1) {
          await this.sleep(this.delays.between_batches);
        }
        
      } catch (error) {
        this.log(`⚠️ Error fetching engagement batch ${i + 1}: ${error.message}`);
        this.stats.errors++;
      }
    }

    return engagement;
  }

  async fetchObjectEngagementsWithRetry(objectId, engagement) {
    const engagementTypes = [
      { type: 'meetings', property: 'meeting_count_total', recentProperty: 'recent_meetings' },
      { type: 'calls', property: 'call_duration_total' },
      { type: 'notes', property: 'note_count' },
      { type: 'tasks', property: 'task_completions' }
    ];

    for (const engType of engagementTypes) {
      let retryCount = 0;
      let success = false;

      while (!success && retryCount < this.retryConfig.maxRetries) {
        try {
          let response;
          const associations = [`companies:${objectId}`, `contacts:${objectId}`];
          
          switch (engType.type) {
            case 'meetings':
              response = await this.client.crm.objects.meetings.basicApi.getPage(
                50, undefined, ['hs_timestamp', 'hs_meeting_outcome'], associations
              );
              
              if (response.results) {
                const meetings = response.results;
                engagement.meeting_count_total += meetings.length;
                
                const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                engagement.recent_meetings += meetings.filter(meeting => {
                  const timestamp = meeting.properties.hs_timestamp;
                  return timestamp && new Date(timestamp).getTime() > thirtyDaysAgo;
                }).length;
              }
              break;
              
            case 'calls':
              response = await this.client.crm.objects.calls.basicApi.getPage(
                50, undefined, ['hs_timestamp', 'hs_call_duration'], associations
              );
              
              if (response.results) {
                engagement.call_duration_total += response.results.reduce((total, call) => {
                  const duration = parseInt(call.properties.hs_call_duration) || 0;
                  return total + Math.floor(duration / 60000); // Convert ms to minutes
                }, 0);
              }
              break;
              
            case 'notes':
              response = await this.client.crm.objects.notes.basicApi.getPage(
                50, undefined, ['hs_timestamp'], associations
              );
              
              if (response.results) {
                engagement.note_count += response.results.length;
              }
              break;
              
            case 'tasks':
              response = await this.client.crm.objects.tasks.basicApi.getPage(
                50, undefined, ['hs_timestamp', 'hs_task_status'], associations
              );
              
              if (response.results) {
                engagement.task_completions += response.results.filter(task => 
                  task.properties.hs_task_status === 'COMPLETED'
                ).length;
              }
              break;
          }
          
          success = true;
          
        } catch (error) {
          retryCount++;
          
          if (error.message.includes('rate limit') || error.message.includes('429')) {
            this.stats.rate_limits++;
            const waitTime = this.delays.rate_limit_retry;
            await this.sleep(waitTime);
            
          } else if (error.message.includes('not found') || error.message.includes('forbidden')) {
            // Some engagement types might not be available - that's okay
            success = true;
          } else if (retryCount >= this.retryConfig.maxRetries) {
            this.log(`⚠️ Failed to fetch ${engType.type} for ${objectId}: ${error.message}`);
            this.stats.errors++;
            success = true; // Continue with other types
          } else {
            const backoffDelay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount - 1);
            await this.sleep(backoffDelay);
          }
        }
      }
    }
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
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
    this.log('🔍 Starting FULL-SCALE entity matching process...');
    
    const matches = [];
    let processedCount = 0;
    
    // Process in segments to track progress
    const entityBatches = this.chunkArray(pipelineEntities, 25);
    
    for (let batchIndex = 0; batchIndex < entityBatches.length; batchIndex++) {
      const batch = entityBatches[batchIndex];
      
      this.log(`📦 Processing batch ${batchIndex + 1}/${entityBatches.length} (${batch.length} entities)`);
      
      for (const entity of batch) {
        try {
          const matchResult = await this.findBestMatch(entity, hubspotCompanies, hubspotContacts);
          
          if (matchResult) {
            matches.push(matchResult);
            this.stats.matched++;
            this.stats.by_segment[entity.segment].matched++;
            
            if (matchResult.confidence >= 0.8) {
              this.stats.high_confidence++;
              this.stats.by_segment[entity.segment].high_confidence++;
            } else if (matchResult.confidence >= 0.6) {
              this.stats.medium_confidence++;
            } else {
              this.stats.low_confidence++;
            }
          } else {
            this.stats.unmatched++;
          }
          
          processedCount++;
          this.stats.processed++;
          this.stats.by_segment[entity.segment].processed++;
          
          // Progress update every 25 entities
          if (processedCount % 25 === 0) {
            const progress = ((processedCount / pipelineEntities.length) * 100).toFixed(1);
            const matchRate = ((this.stats.matched / processedCount) * 100).toFixed(1);
            this.log(`📊 Progress: ${processedCount}/${pipelineEntities.length} (${progress}%) | Match rate: ${matchRate}%`);
          }
          
        } catch (error) {
          this.log(`❌ Error matching ${entity.n}: ${error.message}`);
          this.stats.errors++;
        }
      }
      
      // Brief pause between batches
      await this.sleep(100);
    }
    
    this.log(`✅ Matching complete: ${matches.length}/${pipelineEntities.length} matches found (${((matches.length/pipelineEntities.length)*100).toFixed(1)}%)`);
    return matches;
  }

  async findBestMatch(entity, hubspotCompanies, hubspotContacts) {
    const entityName = this.normalizeString(entity.n);
    const entityWebsite = entity.w ? this.extractDomain(entity.w) : '';
    
    let bestMatch = null;
    let highestConfidence = 0;

    for (const company of hubspotCompanies) {
      const companyName = this.normalizeString(company.properties.name || '');
      const companyDomain = this.extractDomain(company.properties.domain || company.properties.website || '');
      
      let confidence = 0;
      const matchDetails = { methods: [], reasons: [] };

      // Enhanced name matching logic
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
          // Enhanced fuzzy matching
          const entityTokens = entityName.split(' ').filter(t => t.length > 2);
          const companyTokens = companyName.split(' ').filter(t => t.length > 2);
          const commonTokens = entityTokens.filter(token => 
            companyTokens.some(ct => ct.includes(token) || token.includes(ct))
          );
          
          if (commonTokens.length > 0) {
            const tokenMatchRatio = commonTokens.length / Math.max(entityTokens.length, companyTokens.length);
            if (tokenMatchRatio >= 0.5) {
              confidence += 0.25 * tokenMatchRatio;
              matchDetails.methods.push('fuzzy_name_match');
              matchDetails.reasons.push(`Fuzzy name match via tokens: [${commonTokens.join(', ')}] (${(tokenMatchRatio*100).toFixed(0)}% match)`);
            }
          }
        }
      }

      // Enhanced domain matching
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

      // Social signals
      const hubspotLinkedIn = this.normalizeString(company.properties.linkedin_company_page || '');
      const hubspotTwitter = this.normalizeString(company.properties.twitterhandle || '');
      
      if (hubspotLinkedIn && entityName && hubspotLinkedIn.includes(entityName)) {
        confidence += 0.1;
        matchDetails.methods.push('linkedin_match');
      }
      
      if (hubspotTwitter && entityName && hubspotTwitter.includes(entityName)) {
        confidence += 0.1;
        matchDetails.methods.push('twitter_match');
      }

      // Update best match
      if (confidence > highestConfidence && confidence >= 0.3) {
        highestConfidence = confidence;
        bestMatch = {
          entity,
          hubspotCompany: company,
          confidence,
          matchDetails
        };
      }
    }

    // Find related contacts for matched company
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
    
    try {
      // Fetch engagement data with retry logic
      const engagementData = await this.fetchEngagementDataWithRetry(companyId, contactIds);
      const { score, level } = this.calculateEngagementScore(engagementData);
      
      // Update database with PostgreSQL syntax
      const updateSql = `
        UPDATE ${entity.table_name} 
        SET hubspot_company_id = $1,
            hubspot_contact_ids = $2,
            engagement_score = $3,
            engagement_level = $4,
            confidence_score = $5,
            recent_meetings = $6,
            email_responses = $7,
            meeting_count_total = $8,
            email_opens = $9,
            email_clicks = $10,
            call_duration_total = $11,
            note_count = $12,
            task_completions = $13,
            days_since_last_activity = $14,
            last_hubspot_sync = CURRENT_TIMESTAMP,
            matching_method = $15,
            matching_details = $16
        WHERE id = $17
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

      await pool.query(updateSql, params);
      
      this.log(`✅ ${entity.segment}: Updated "${entity.n}" - engagement=${score}/10 (${level}), confidence=${matchResult.confidence.toFixed(2)}`);
      
      return {
        entity: entity.n,
        segment: entity.segment,
        table: entity.table_name,
        engagement_score: score,
        engagement_level: level,
        confidence: matchResult.confidence,
        hubspot_company_id: companyId,
        contact_count: contactIds.length
      };
      
    } catch (error) {
      this.log(`❌ Failed to update ${entity.n}: ${error.message}`);
      this.stats.errors++;
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async generateComprehensiveReport() {
    const totalTime = (Date.now() - this.stats.start_time) / 1000;
    const entitiesPerSecond = (this.stats.processed / totalTime).toFixed(2);
    
    // Get engagement statistics from database
    const engagementStats = await this.getEngagementStatistics();
    
    const report = {
      execution: {
        timestamp: new Date().toISOString(),
        total_time_seconds: totalTime.toFixed(1),
        processing_rate: `${entitiesPerSecond} entities/second`
      },
      summary: {
        total_entities: this.stats.processed,
        matched_entities: this.stats.matched,
        unmatched_entities: this.stats.unmatched,
        overall_match_rate: this.stats.processed > 0 ? ((this.stats.matched / this.stats.processed) * 100).toFixed(1) : '0.0'
      },
      confidence_breakdown: {
        high: this.stats.high_confidence,
        medium: this.stats.medium_confidence,
        low: this.stats.low_confidence
      },
      performance_metrics: {
        api_errors: this.stats.errors,
        rate_limits_hit: this.stats.rate_limits,
        total_retries: this.stats.retries,
        success_rate: this.stats.processed > 0 ? (((this.stats.processed - this.stats.errors) / this.stats.processed) * 100).toFixed(1) : '100.0'
      },
      by_segment: this.stats.by_segment,
      engagement_distribution: engagementStats,
      recent_logs: this.stats.logs.slice(-20) // Last 20 log entries
    };

    // Save comprehensive report
    const reportsDir = path.join(__dirname, '../../logs');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const reportPath = path.join(reportsDir, `hubspot-full-scale-report-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    this.log(`📊 Comprehensive report saved to: ${reportPath}`);
    return report;
  }

  async getEngagementStatistics() {
    const stats = { High: 0, Medium: 0, Low: 0, None: 0, Unknown: 0 };
    
    for (const table of this.tables) {
      try {
        const result = await pool.query(
          `SELECT engagement_level, COUNT(*) as count FROM ${table.name} WHERE engagement_level IS NOT NULL GROUP BY engagement_level`
        );
        
        result.rows.forEach(row => {
          const level = row.engagement_level || 'Unknown';
          stats[level] = (stats[level] || 0) + parseInt(row.count);
        });
      } catch (error) {
        // Table might not have engagement columns yet
        this.log(`⚠️ Could not get engagement stats for ${table.name}: ${error.message}`);
      }
    }
    
    return stats;
  }

  async run() {
    try {
      this.log('🚀🚀🚀 STARTING FULL-SCALE HUBSPOT INTEGRATION FOR ALL 582+ ENTITIES 🚀🚀🚀');
      this.log('Improvements: PostgreSQL database, fixed rate limits, enhanced retry logic, comprehensive error handling');
      
      // Ensure database schema is ready
      await this.ensureEngagementColumns();
      
      // Load all data simultaneously
      this.log('📊 Loading all datasets...');
      const [hubspotCompanies, hubspotContacts, pipelineEntities] = await Promise.all([
        this.fetchAllHubSpotCompaniesWithRetry(),
        this.fetchAllHubSpotContactsWithRetry(),
        this.getAllPipelineEntities()
      ]);

      this.log('✅ Data loading complete:');
      this.log(`  • HubSpot companies: ${hubspotCompanies.length}`);
      this.log(`  • HubSpot contacts: ${hubspotContacts.length}`);
      this.log(`  • Pipeline entities: ${pipelineEntities.length}`);
      this.log(`  • Expected entities: 582+`);
      
      if (pipelineEntities.length < 500) {
        this.log('⚠️ WARNING: Entity count seems low. Expected 582+ entities, got ' + pipelineEntities.length);
      }
      
      // Match all entities
      this.log('🔍 Starting matching process for ALL segments...');
      const matches = await this.matchEntitiesWithHubSpot(pipelineEntities, hubspotCompanies, hubspotContacts);
      
      // Update entities with engagement data
      this.log('⚡ Updating entities with engagement intelligence...');
      const updateResults = [];
      let updateCount = 0;
      
      // Process updates in smaller batches to manage rate limits
      const matchBatches = this.chunkArray(matches, 10);
      
      for (let batchIndex = 0; batchIndex < matchBatches.length; batchIndex++) {
        const batch = matchBatches[batchIndex];
        
        this.log(`🔄 Engagement batch ${batchIndex + 1}/${matchBatches.length}: Processing ${batch.length} matches...`);
        
        for (const match of batch) {
          try {
            const result = await this.updateEntityWithEngagement(match.entity, match);
            updateResults.push(result);
            updateCount++;
            
            // Progress update every 10 updates
            if (updateCount % 10 === 0) {
              const progress = ((updateCount / matches.length) * 100).toFixed(1);
              this.log(`📊 Engagement updates: ${updateCount}/${matches.length} (${progress}%)`);
            }
            
          } catch (error) {
            this.log(`❌ Failed to update engagement for ${match.entity.n}: ${error.message}`);
            this.stats.errors++;
          }
        }
        
        // Delay between engagement batches
        if (batchIndex < matchBatches.length - 1) {
          await this.sleep(this.delays.between_batches);
        }
      }

      // Generate comprehensive final report
      const report = await this.generateComprehensiveReport();
      
      this.log('🎉🎉🎉 FULL-SCALE INTEGRATION COMPLETE! 🎉🎉🎉');
      this.log('=====================================');
      this.log(`📊 FINAL RESULTS:`);
      this.log(`  • Total entities processed: ${report.summary.total_entities}`);
      this.log(`  • Successfully matched: ${report.summary.matched_entities} (${report.summary.overall_match_rate}%)`);
      this.log(`  • High confidence matches: ${report.confidence_breakdown.high}`);
      this.log(`  • Medium confidence matches: ${report.confidence_breakdown.medium}`);  
      this.log(`  • Low confidence matches: ${report.confidence_breakdown.low}`);
      this.log(`  • Updated with engagement data: ${updateResults.length}`);
      this.log(`  • Processing time: ${report.execution.total_time_seconds}s`);
      this.log(`  • Processing rate: ${report.execution.processing_rate}`);
      this.log(`  • API errors: ${report.performance_metrics.api_errors}`);
      this.log(`  • Rate limits handled: ${report.performance_metrics.rate_limits_hit}`);
      this.log(`  • Total retries: ${report.performance_metrics.total_retries}`);
      this.log(`  • Success rate: ${report.performance_metrics.success_rate}%`);
      
      console.log('\n📊 Results by Segment:');
      Object.entries(report.by_segment).forEach(([segment, stats]) => {
        const segmentMatchRate = stats.processed > 0 ? ((stats.matched / stats.processed) * 100).toFixed(1) : '0.0';
        console.log(`  ${segment}: ${stats.matched}/${stats.processed} (${segmentMatchRate}%) | High confidence: ${stats.high_confidence}`);
      });

      console.log('\n📊 Engagement Distribution:');
      Object.entries(report.engagement_distribution).forEach(([level, count]) => {
        console.log(`  ${level}: ${count}`);
      });

      return report;
      
    } catch (error) {
      this.log(`❌❌❌ FULL-SCALE INTEGRATION FAILED: ${error.message}`);
      if (this.debug) {
        console.error(error.stack);
      }
      
      // Generate error report
      const errorReport = await this.generateComprehensiveReport();
      this.log(`📊 Error report generated with partial results`);
      
      throw error;
    }
  }
}

// CLI usage
if (require.main === module) {
  const integration = new HubSpotFullScaleIntegration();
  integration.run()
    .then(report => {
      console.log('\n✅✅✅ FULL-SCALE HUBSPOT INTEGRATION COMPLETED SUCCESSFULLY! ✅✅✅');
      console.log(`🎯 ${report.summary.matched_entities} entities matched with ${report.summary.overall_match_rate}% match rate`);
      console.log(`⚡ Strategic prioritization enabled with engagement intelligence`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌❌❌ FULL-SCALE INTEGRATION FAILED:', error.message);
      process.exit(1);
    });
}

module.exports = HubSpotFullScaleIntegration;