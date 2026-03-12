const axios = require('axios');

class CoinGeckoDiscovery {
  constructor(apiKey = 'demo-api-key') {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.coingecko.com/api/v3';
  }

  async discoverExchanges() {
    try {
      const response = await axios.get(`${this.baseUrl}/exchanges`, {
        params: { per_page: 50, page: 1 }
      });
      
      return response.data.map(exchange => ({
        name: exchange.name,
        website: exchange.url,
        segment: 'Exchange',
        status: 'PIPELINE',
        source: 'CoinGecko',
        trust_score: exchange.trust_score,
        year_established: exchange.year_established,
        country: exchange.country
      }));
    } catch (error) {
      console.error('CoinGecko exchange discovery error:', error.message);
      return [];
    }
  }

  async discoverDeFiProtocols() {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/markets`, {
        params: { 
          vs_currency: 'usd',
          category: 'decentralized-finance-defi',
          order: 'market_cap_desc',
          per_page: 50,
          page: 1
        }
      });
      
      return response.data.map(coin => ({
        name: coin.name,
        website: coin.homepage ? coin.homepage[0] : null,
        segment: 'DeFi Protocol',
        status: 'PIPELINE', 
        source: 'CoinGecko',
        market_cap: coin.market_cap,
        symbol: coin.symbol
      }));
    } catch (error) {
      console.error('CoinGecko DeFi discovery error:', error.message);
      return [];
    }
  }
}

module.exports = CoinGeckoDiscovery;