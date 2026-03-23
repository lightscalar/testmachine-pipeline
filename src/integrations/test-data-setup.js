#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Setup test/sample data for the pipeline
 * This creates sample entities across all market segments for testing HubSpot integration
 */
class TestDataSetup {
  constructor() {
    this.dbPath = path.join(__dirname, '../../pipeline.db');
  }

  async runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath);
      db.run(sql, params, function(err) {
        db.close();
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  async createSampleData() {
    console.log('🏗️ Setting up sample pipeline data...');

    const sampleData = {
      exchanges: [
        { name: 'Coinbase', website: 'coinbase.com', stage: 'Prospecting' },
        { name: 'Binance', website: 'binance.com', stage: 'Qualified' },
        { name: 'Kraken', website: 'kraken.com', stage: 'Prospecting' },
        { name: 'FTX', website: 'ftx.com', stage: 'Closed' },
        { name: 'Gemini', website: 'gemini.com', stage: 'Prospecting' }
      ],
      auditors: [
        { name: 'ConsenSys Diligence', website: 'consensys.net', stage: 'Prospecting' },
        { name: 'OpenZeppelin', website: 'openzeppelin.com', stage: 'Qualified' },
        { name: 'Trail of Bits', website: 'trailofbits.com', stage: 'Prospecting' },
        { name: 'Quantstamp', website: 'quantstamp.com', stage: 'Prospecting' },
        { name: 'CertiK', website: 'certik.com', stage: 'Qualified' }
      ],
      large_auditors: [
        { name: 'PwC', website: 'pwc.com', stage: 'Prospecting' },
        { name: 'Deloitte', website: 'deloitte.com', stage: 'Qualified' },
        { name: 'EY', website: 'ey.com', stage: 'Prospecting' },
        { name: 'KPMG', website: 'kpmg.com', stage: 'Prospecting' }
      ],
      defi_protocols: [
        { name: 'Uniswap', website: 'uniswap.org', stage: 'Qualified' },
        { name: 'Compound', website: 'compound.finance', stage: 'Prospecting' },
        { name: 'Aave', website: 'aave.com', stage: 'Qualified' },
        { name: 'MakerDAO', website: 'makerdao.com', stage: 'Prospecting' },
        { name: 'Curve', website: 'curve.fi', stage: 'Prospecting' },
        { name: '1inch', website: '1inch.io', stage: 'Qualified' }
      ],
      rwa_tokenization: [
        { name: 'Centrifuge', website: 'centrifuge.io', stage: 'Prospecting' },
        { name: 'Maple Finance', website: 'maple.finance', stage: 'Qualified' },
        { name: 'TrueFi', website: 'truefi.io', stage: 'Prospecting' },
        { name: 'Goldfinch', website: 'goldfinch.finance', stage: 'Prospecting' }
      ]
    };

    // Create tables and insert data
    for (const [tableName, entities] of Object.entries(sampleData)) {
      console.log(`📊 Setting up ${tableName}...`);
      
      // Create table with full schema
      await this.runQuery(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          n TEXT NOT NULL,
          w TEXT,
          s TEXT DEFAULT 'Prospecting',
          c TEXT,
          r TEXT,
          o TEXT,
          t TEXT,
          p TEXT,
          l TEXT,
          github_repos TEXT,
          news TEXT,
          
          -- HubSpot Engagement Intelligence
          hubspot_company_id TEXT,
          hubspot_contact_ids TEXT,
          engagement_score INTEGER DEFAULT 0,
          engagement_level TEXT DEFAULT 'Unknown',
          confidence_score REAL DEFAULT 0,
          
          -- Detailed engagement metrics
          recent_meetings INTEGER DEFAULT 0,
          email_responses INTEGER DEFAULT 0,
          meeting_count_total INTEGER DEFAULT 0,
          email_opens INTEGER DEFAULT 0,
          email_clicks INTEGER DEFAULT 0,
          call_duration_total INTEGER DEFAULT 0,
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

      // Clear existing data
      await this.runQuery(`DELETE FROM ${tableName}`);
      
      // Insert sample entities
      for (const entity of entities) {
        await this.runQuery(`
          INSERT INTO ${tableName} (n, w, s) VALUES (?, ?, ?)
        `, [entity.name, entity.website, entity.stage]);
      }
      
      console.log(`✅ Added ${entities.length} sample entities to ${tableName}`);
    }

    console.log('\n🎉 Sample data setup complete!');
    console.log('You can now run the HubSpot integration to match these entities with real HubSpot data.');
  }

  async showCurrentData() {
    console.log('📊 CURRENT PIPELINE DATA:');
    console.log('=' .repeat(40));
    
    const tables = ['exchanges', 'auditors', 'large_auditors', 'defi_protocols', 'rwa_tokenization'];
    
    for (const tableName of tables) {
      try {
        const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY);
        
        const entities = await new Promise((resolve, reject) => {
          db.all(`SELECT n, w, s FROM ${tableName} ORDER BY n`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });
        
        db.close();
        
        console.log(`\n📋 ${tableName.replace('_', ' ').toUpperCase()} (${entities.length} entities):`);
        entities.forEach(entity => {
          console.log(`  • ${entity.n}${entity.w ? ` (${entity.w})` : ''} - ${entity.s}`);
        });
        
      } catch (error) {
        console.log(`  ⚠️ Could not read ${tableName}: ${error.message}`);
      }
    }
  }

  async run(command = 'setup') {
    if (command === 'setup') {
      await this.createSampleData();
    } else if (command === 'show') {
      await this.showCurrentData();
    } else {
      console.log('Usage: node test-data-setup.js [setup|show]');
    }
  }
}

// CLI usage
if (require.main === module) {
  const command = process.argv[2] || 'setup';
  const setup = new TestDataSetup();
  
  setup.run(command)
    .then(() => {
      console.log('\n✅ Operation complete!');
    })
    .catch(error => {
      console.error('❌ Error:', error.message);
      process.exit(1);
    });
}

module.exports = TestDataSetup;