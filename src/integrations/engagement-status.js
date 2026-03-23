#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Utility to view current engagement intelligence status
 */
class EngagementStatusViewer {
  constructor() {
    this.dbPath = path.join(__dirname, '../../pipeline.db');
    this.tables = [
      { name: 'exchanges', entityColumn: 'n' },
      { name: 'auditors', entityColumn: 'n' },
      { name: 'large_auditors', entityColumn: 'n' },
      { name: 'defi_protocols', entityColumn: 'n' },
      { name: 'rwa_tokenization', entityColumn: 'n' }
    ];
  }

  async runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY);
      db.all(sql, params, (err, rows) => {
        db.close();
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async showOverallStatus() {
    console.log('📊 HUBSPOT ENGAGEMENT INTELLIGENCE STATUS');
    console.log('=' .repeat(50));

    const summary = {
      total: 0,
      with_hubspot: 0,
      engagement_levels: { High: 0, Medium: 0, Low: 0, None: 0, Unknown: 0 }
    };

    for (const table of this.tables) {
      try {
        // Get total count
        const [totalResult] = await this.runQuery(`SELECT COUNT(*) as count FROM ${table.name}`);
        const total = totalResult.count;
        
        // Get HubSpot matched count
        const [hubspotResult] = await this.runQuery(`
          SELECT COUNT(*) as count FROM ${table.name} 
          WHERE hubspot_company_id IS NOT NULL AND hubspot_company_id != ''
        `);
        const withHubspot = hubspotResult.count;

        // Get engagement levels
        const engagementResults = await this.runQuery(`
          SELECT engagement_level, COUNT(*) as count 
          FROM ${table.name} 
          GROUP BY engagement_level
        `);
        
        console.log(`\n📋 ${table.name.toUpperCase().replace('_', ' ')}:`);
        console.log(`  Total entities: ${total}`);
        console.log(`  HubSpot matched: ${withHubspot} (${withHubspot ? (withHubspot/total*100).toFixed(1) : 0}%)`);
        
        const levelCounts = {};
        engagementResults.forEach(row => {
          const level = row.engagement_level || 'Unknown';
          levelCounts[level] = row.count;
          summary.engagement_levels[level] = (summary.engagement_levels[level] || 0) + row.count;
        });
        
        console.log(`  Engagement: High=${levelCounts.High||0}, Medium=${levelCounts.Medium||0}, Low=${levelCounts.Low||0}, None=${levelCounts.None||0}`);

        summary.total += total;
        summary.with_hubspot += withHubspot;

      } catch (error) {
        console.log(`  ⚠️ Could not read ${table.name}: ${error.message}`);
      }
    }

    console.log('\n🎯 OVERALL SUMMARY:');
    console.log(`  Total entities: ${summary.total}`);
    console.log(`  HubSpot matched: ${summary.with_hubspot} (${summary.with_hubspot ? (summary.with_hubspot/summary.total*100).toFixed(1) : 0}%)`);
    console.log(`  Engagement distribution:`);
    Object.entries(summary.engagement_levels).forEach(([level, count]) => {
      if (count > 0) {
        console.log(`    ${level}: ${count} (${(count/summary.total*100).toFixed(1)}%)`);
      }
    });

    return summary;
  }

  async showTopEngagement(limit = 10) {
    console.log(`\n🚀 TOP ${limit} MOST ENGAGED ENTITIES:`);
    console.log('=' .repeat(40));

    const allEntities = [];
    
    for (const table of this.tables) {
      try {
        const entities = await this.runQuery(`
          SELECT ${table.entityColumn} as name, engagement_score, engagement_level,
                 recent_meetings, meeting_count_total, email_responses,
                 last_hubspot_sync, '${table.name}' as segment
          FROM ${table.name}
          WHERE engagement_score IS NOT NULL AND engagement_score > 0
          ORDER BY engagement_score DESC
          LIMIT ${limit}
        `);
        
        allEntities.push(...entities);
      } catch (error) {
        // Skip tables without engagement data
      }
    }

    // Sort all entities by engagement score
    allEntities.sort((a, b) => (b.engagement_score || 0) - (a.engagement_score || 0));
    
    allEntities.slice(0, limit).forEach((entity, index) => {
      console.log(`${index + 1}. ${entity.name} (${entity.segment.replace('_', ' ')})`);
      console.log(`   Score: ${entity.engagement_score}/10 (${entity.engagement_level})`);
      console.log(`   Activity: ${entity.recent_meetings} recent meetings, ${entity.meeting_count_total} total meetings, ${entity.email_responses} email responses`);
      console.log(`   Last sync: ${entity.last_hubspot_sync || 'Never'}`);
      console.log('');
    });
  }

  async showUnmatched(limit = 10) {
    console.log(`\n❓ ENTITIES WITHOUT HUBSPOT MATCHES (showing ${limit}):`);
    console.log('=' .repeat(45));

    for (const table of this.tables) {
      try {
        const unmatched = await this.runQuery(`
          SELECT ${table.entityColumn} as name, w as website
          FROM ${table.name}
          WHERE hubspot_company_id IS NULL OR hubspot_company_id = ''
          LIMIT ${limit}
        `);
        
        if (unmatched.length > 0) {
          console.log(`\n📋 ${table.name.replace('_', ' ').toUpperCase()}:`);
          unmatched.forEach(entity => {
            console.log(`  • ${entity.name}${entity.website ? ` (${entity.website})` : ''}`);
          });
        }
      } catch (error) {
        // Skip tables that don't exist
      }
    }
  }

  async showRecentSync() {
    console.log('\n🔄 RECENT SYNC ACTIVITY:');
    console.log('=' .repeat(30));

    for (const table of this.tables) {
      try {
        const recentSyncs = await this.runQuery(`
          SELECT ${table.entityColumn} as name, engagement_score, engagement_level,
                 last_hubspot_sync
          FROM ${table.name}
          WHERE last_hubspot_sync IS NOT NULL
          ORDER BY last_hubspot_sync DESC
          LIMIT 5
        `);
        
        if (recentSyncs.length > 0) {
          console.log(`\n📋 ${table.name.replace('_', ' ').toUpperCase()} (last 5 syncs):`);
          recentSyncs.forEach(entity => {
            console.log(`  • ${entity.name}: ${entity.engagement_score}/10 (${entity.engagement_level}) - ${entity.last_hubspot_sync}`);
          });
        }
      } catch (error) {
        // Skip tables without sync data
      }
    }
  }

  async run(command = 'all') {
    try {
      if (command === 'all' || command === 'status') {
        await this.showOverallStatus();
      }
      
      if (command === 'all' || command === 'top') {
        await this.showTopEngagement();
      }
      
      if (command === 'all' || command === 'unmatched') {
        await this.showUnmatched();
      }
      
      if (command === 'all' || command === 'recent') {
        await this.showRecentSync();
      }

    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  }
}

// CLI usage
if (require.main === module) {
  const command = process.argv[2] || 'all';
  const viewer = new EngagementStatusViewer();
  
  viewer.run(command).then(() => {
    console.log('\n✅ Status report complete!');
    console.log('\nAvailable commands:');
    console.log('  node engagement-status.js [all|status|top|unmatched|recent]');
  });
}

module.exports = EngagementStatusViewer;