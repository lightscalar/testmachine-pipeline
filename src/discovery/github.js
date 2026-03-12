const axios = require('axios');

class GitHubDiscovery {
  constructor() {
    this.baseUrl = 'https://api.github.com';
  }

  async discoverTrendingCrypto() {
    try {
      const queries = [
        'blockchain+language:javascript+stars:>100',
        'cryptocurrency+language:solidity+stars:>50',
        'defi+language:typescript+stars:>100',
        'smart+contracts+language:solidity+stars:>200'
      ];

      const discoveries = [];
      
      for (const query of queries) {
        const response = await axios.get(`${this.baseUrl}/search/repositories`, {
          params: { 
            q: query,
            sort: 'updated',
            order: 'desc',
            per_page: 10
          }
        });

        const repos = response.data.items.map(repo => ({
          name: repo.full_name.split('/')[0],
          website: repo.homepage || repo.html_url,
          github_repos: [repo.html_url],
          segment: this.categorizeRepo(repo),
          status: 'PIPELINE',
          source: 'GitHub',
          stars: repo.stargazers_count,
          language: repo.language,
          description: repo.description
        }));

        discoveries.push(...repos);
      }

      return this.deduplicateByName(discoveries);
    } catch (error) {
      console.error('GitHub discovery error:', error.message);
      return [];
    }
  }

  categorizeRepo(repo) {
    const name = repo.name.toLowerCase();
    const description = (repo.description || '').toLowerCase();
    
    if (name.includes('exchange') || description.includes('exchange')) return 'Exchange';
    if (name.includes('defi') || description.includes('defi')) return 'DeFi Protocol';
    if (name.includes('audit') || description.includes('audit')) return 'Auditor';
    if (name.includes('rwa') || description.includes('tokenization')) return 'RWA/Tokenization';
    
    return 'DeFi Protocol'; // Default for crypto projects
  }

  deduplicateByName(discoveries) {
    const seen = new Set();
    return discoveries.filter(item => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });
  }
}

module.exports = GitHubDiscovery;