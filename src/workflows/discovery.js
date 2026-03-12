const CoinGeckoDiscovery = require('../discovery/coingecko');
const GitHubDiscovery = require('../discovery/github');
const { pool } = require('../database/connection');

require('dotenv').config();

class DiscoveryWorkflow {
  constructor() {
    this.coinGecko = new CoinGeckoDiscovery();
    this.github = new GitHubDiscovery();
  }

  async runFullDiscovery() {
    console.log('🔍 Starting prospect discovery...');
    
    try {
      // Discover from all sources
      const [exchanges, defiProtocols, githubProjects] = await Promise.all([
        this.coinGecko.discoverExchanges(),
        this.coinGecko.discoverDeFiProtocols(),
        this.github.discoverTrendingCrypto()
      ]);

      const allDiscoveries = [
        ...exchanges.slice(0, 5),    // Top 5 new exchanges
        ...defiProtocols.slice(0, 5), // Top 5 new DeFi protocols  
        ...githubProjects.slice(0, 5) // Top 5 trending projects
      ];

      console.log(`📊 Discovered ${allDiscoveries.length} potential prospects`);

      // Filter out existing companies
      const newCompanies = await this.filterExisting(allDiscoveries);
      console.log(`✨ ${newCompanies.length} new companies to add`);

      // Insert new companies
      const results = await this.insertCompanies(newCompanies);
      
      console.log('✅ Discovery complete:', {
        discovered: allDiscoveries.length,
        new: newCompanies.length,
        inserted: results.length
      });

      return results;

    } catch (error) {
      console.error('❌ Discovery workflow error:', error);
      throw error;
    }
  }

  async filterExisting(discoveries) {
    if (discoveries.length === 0) return [];
    
    const existingNames = new Set();
    
    // Check across all segment tables
    const tables = ['exchanges', 'auditors', 'large_auditors', 'defi', 'rwa_tokenization'];
    
    for (const table of tables) {
      const names = discoveries.map(d => d.name);
      const query = `SELECT n as name FROM ${table} WHERE n = ANY($1)`;
      const result = await pool.query(query, [names]);
      result.rows.forEach(row => existingNames.add(row.name));
    }
    
    return discoveries.filter(d => !existingNames.has(d.name));
  }

  async insertCompanies(companies) {
    const results = [];
    
    for (const company of companies) {
      try {
        // Map segment to table
        const tableMap = {
          'Exchange': 'exchanges',
          'DeFi Protocol': 'defi', 
          'Auditor': 'auditors',
          'RWA/Tokenization': 'rwa_tokenization'
        };
        
        const table = tableMap[company.segment] || 'defi'; // Default to defi for crypto projects
        
        const query = `
          INSERT INTO ${table} (n, w, github_repos, s, news)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, n as name
        `;
        
        const metadata = {
          source: company.source,
          stars: company.stars,
          language: company.language,
          description: company.description,
          trust_score: company.trust_score,
          market_cap: company.market_cap
        };
        
        const values = [
          company.name,                                    // n (name)
          company.website || '',                           // w (website)  
          JSON.stringify(company.github_repos || []),      // github_repos
          'Prospecting',                                   // s (status)
          JSON.stringify(metadata)                         // news (metadata)
        ];

        const result = await pool.query(query, values);
        results.push({ ...result.rows[0], segment: company.segment, table });
        console.log(`✅ Inserted: ${company.name} into ${table}`);
        
      } catch (error) {
        console.error(`❌ Failed to insert ${company.name}:`, error.message);
      }
    }
    
    return results;
  }
}

// CLI usage
if (require.main === module) {
  const workflow = new DiscoveryWorkflow();
  workflow.runFullDiscovery()
    .then(results => {
      console.log(`🎉 Discovery complete! Added ${results.length} companies`);
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Discovery failed:', error);
      process.exit(1);
    });
}

module.exports = DiscoveryWorkflow;