#!/usr/bin/env node

const HubSpotEngagementIntelligence = require('./hubspot-engagement');

/**
 * Lightweight sync script for regular updates
 * - Updates engagement scores for entities that already have HubSpot matches
 * - Skips the heavy matching process
 * - Can be run more frequently (daily/weekly)
 */
class HubSpotSyncUpdate {
  constructor() {
    this.intelligence = new HubSpotEngagementIntelligence();
  }

  async syncExistingMatches() {
    console.log('🔄 Starting incremental HubSpot engagement sync...');
    
    await this.intelligence.initDatabase();
    
    // Find entities that already have HubSpot company IDs
    const entitiesWithHubSpot = [];
    
    for (const table of this.intelligence.tables) {
      try {
        const entities = await this.intelligence.runQuery(`
          SELECT id, ${table.entityColumn} as n, ${table.websiteColumn} as w, 
                 hubspot_company_id, hubspot_contact_ids, table_name
          FROM ${table.name} 
          WHERE hubspot_company_id IS NOT NULL AND hubspot_company_id != ''
        `);
        
        entities.forEach(entity => {
          entity.table_name = table.name;
          entity.hubspot_contact_ids = JSON.parse(entity.hubspot_contact_ids || '[]');
        });
        
        entitiesWithHubSpot.push(...entities);
      } catch (error) {
        console.log(`⚠️ Could not read from table ${table.name}: ${error.message}`);
      }
    }

    console.log(`📊 Found ${entitiesWithHubSpot.length} entities with existing HubSpot matches`);

    // Update engagement data for each
    const results = [];
    for (const entity of entitiesWithHubSpot) {
      try {
        const engagementData = await this.intelligence.fetchEngagementData(
          entity.hubspot_company_id, 
          entity.hubspot_contact_ids
        );
        
        const { score, level } = this.intelligence.calculateEngagementScore(engagementData);
        
        // Update only engagement fields
        const updateSql = `
          UPDATE ${entity.table_name}
          SET engagement_score = ?,
              engagement_level = ?,
              recent_meetings = ?,
              email_responses = ?,
              meeting_count_total = ?,
              email_opens = ?,
              email_clicks = ?,
              call_duration_total = ?,
              note_count = ?,
              task_completions = ?,
              days_since_last_activity = ?,
              last_hubspot_sync = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        
        await this.intelligence.runQuery(updateSql, [
          score, level,
          engagementData.recent_meetings,
          engagementData.email_responses,
          engagementData.meeting_count_total,
          engagementData.email_opens,
          engagementData.email_clicks,
          engagementData.call_duration_total,
          engagementData.note_count,
          engagementData.task_completions,
          engagementData.days_since_last_activity,
          entity.id
        ]);

        results.push({
          name: entity.n,
          table: entity.table_name,
          old_score: entity.engagement_score || 0,
          new_score: score,
          level: level
        });

        console.log(`✅ Updated ${entity.n}: ${score}/10 (${level})`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.log(`❌ Failed to update ${entity.n}: ${error.message}`);
      }
    }

    this.intelligence.db.close();

    console.log(`\n🎉 Sync complete! Updated ${results.length} entities`);
    
    // Show changes summary
    const changed = results.filter(r => r.old_score !== r.new_score);
    console.log(`📊 Changes: ${changed.length} entities had engagement score updates`);
    
    return results;
  }
}

// CLI usage
if (require.main === module) {
  const sync = new HubSpotSyncUpdate();
  sync.syncExistingMatches()
    .then(results => {
      console.log('\n✅ HubSpot sync completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Sync failed:', error.message);
      process.exit(1);
    });
}

module.exports = HubSpotSyncUpdate;