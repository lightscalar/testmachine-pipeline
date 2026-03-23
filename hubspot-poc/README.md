# HubSpot API Proof of Concept

This proof of concept script explores HubSpot's API structure to understand their data format and plan schema mapping for TestMachine pipeline integration.

## 🎯 Purpose

- Connect to HubSpot API and retrieve sample data
- Analyze company and contact data structures  
- Map HubSpot properties to TestMachine pipeline fields
- Provide integration recommendations

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd ~/testmachine-pipeline/hubspot-poc
npm install
```

### 2. Set Up Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your HubSpot API key
nano .env
```

### 3. Get HubSpot API Key

1. Go to your HubSpot account: https://app.hubspot.com
2. Navigate to Settings → Integrations → Private Apps
3. Create a new private app or use existing one
4. Copy the access token and add it to your `.env` file

### 4. Run the Analysis

```bash
npm start
```

Or run directly:
```bash
node hubspot-poc.js
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HUBSPOT_API_KEY` | Your HubSpot API access token | **Required** |
| `SAMPLE_LIMIT` | Number of records to fetch for analysis | `5` |
| `DEBUG` | Enable detailed logging | `false` |

### Example .env

```env
HUBSPOT_API_KEY=your_api_key_here
SAMPLE_LIMIT=10
DEBUG=true
```

## 📊 What This Script Does

### 1. Connection Test
- Validates API key and permissions
- Shows account information and available scopes

### 2. Data Retrieval  
- Fetches sample companies with key properties
- Retrieves sample contacts with standard fields
- Gets complete property schemas for both object types

### 3. Structure Analysis
- Displays sample record structures
- Shows available properties and their types
- Analyzes data format and field organization

### 4. Schema Mapping
- Compares HubSpot structure to TestMachine pipeline fields
- Suggests specific property mappings
- Provides market segment classification strategy

### 5. Integration Recommendations
- Custom properties setup guidance
- API integration points
- Data synchronization strategies
- Next steps for implementation

## 📋 TestMachine Pipeline Schema

### Market Segments
- Exchanges
- Auditors  
- Large Auditors
- DeFi
- RWA/Tokenization

### Core Fields
- **Entity**: Company/contact name
- **Stage**: Current pipeline stage
- **Connection**: How they found us
- **Role**: Contact role/title
- **Owner**: Account owner
- **Timing**: Stage entry dates
- **Provider**: Service provider type
- **Listings**: Marketplace presence

## 🗺️ Proposed HubSpot Mappings

| Pipeline Field | HubSpot Property | Notes |
|----------------|------------------|--------|
| Entity | `name` / `firstname+lastname` | Primary identifier |
| Stage | `lifecyclestage` / custom | Pipeline stage tracking |
| Connection | `hs_analytics_source` | Original source |
| Role | `jobtitle` / custom | Contact role |
| Owner | `hubspot_owner_id` | Direct mapping |
| Timing | `createdate` / stage dates | Timestamp tracking |
| Provider | `industry` / custom | Service type |
| Listings | `website` / custom | Marketplace links |

## 🔍 Sample Output

```
🚀 HubSpot API Proof of Concept for TestMachine Pipeline Integration
===========================================================================

[2024-01-15T10:30:00.000Z] 🔍 Testing HubSpot API connection...
[2024-01-15T10:30:01.000Z] ✅ Connection successful

=== Account Information ===
{
  "hubId": 12345678,
  "hubDomain": "your-domain",
  "scopes": ["crm.objects.companies.read", "crm.objects.contacts.read"]
}

[2024-01-15T10:30:02.000Z] 🏢 Fetching 5 sample companies...
[2024-01-15T10:30:03.000Z] ✅ Retrieved 5 companies

📊 DATA STRUCTURE ANALYSIS
============================================================

=== Sample Company Record Structure ===
{
  "id": "12345",
  "properties": {
    "name": "Acme Corp",
    "domain": "acme.com",
    "industry": "Technology",
    "city": "San Francisco"
  },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-15T09:00:00.000Z"
}
```

## 🚨 Error Handling

### Common Issues

1. **Invalid API Key**
   ```
   Error: Unauthorized - Check your HUBSPOT_API_KEY
   ```

2. **Missing Permissions**
   ```
   Error: Forbidden - API key needs additional scopes
   ```

3. **Rate Limiting**
   ```
   Error: Too Many Requests - Script includes built-in delays
   ```

### Required HubSpot Scopes

Your HubSpot private app needs these scopes:
- `crm.objects.companies.read`
- `crm.objects.contacts.read` 
- `crm.schemas.companies.read`
- `crm.schemas.contacts.read`

## 🔒 Security Notes

- This is a **READ-ONLY** script - no data modifications
- API key is loaded from environment variables
- Never commit `.env` file to version control
- Use HubSpot private apps for better security than API keys

## 📝 Output Files

The script generates console output only. To save results:

```bash
# Save full output
npm start > hubspot-analysis-$(date +%Y%m%d).txt

# Save just the mappings section  
npm start | grep -A 50 "SCHEMA MAPPING" > schema-mapping.txt
```

## 🔄 Next Steps

1. **Review Output**: Analyze the generated schema mapping
2. **Team Discussion**: Share findings with TestMachine team
3. **Property Planning**: Decide on custom properties needed
4. **Test Environment**: Set up HubSpot sandbox for testing
5. **Prototype Build**: Create data sync prototype
6. **Integration**: Build full pipeline integration

## 🛠️ Development

### Adding New Analysis

To extend the script with additional analysis:

1. Add methods to the `HubSpotAnalyzer` class
2. Call from the main `run()` method
3. Follow the existing logging and error handling patterns

### Testing

```bash
# Dry run (if implemented)
npm run test

# Debug mode
DEBUG=true npm start

# Limited sample size  
SAMPLE_LIMIT=2 npm start
```

## 📚 Resources

- [HubSpot API Documentation](https://developers.hubspot.com/docs/api/overview)
- [HubSpot Node.js SDK](https://github.com/HubSpot/hubspot-api-nodejs)
- [HubSpot CRM Objects](https://developers.hubspot.com/docs/api/crm/understanding-the-crm)
- [HubSpot Private Apps](https://developers.hubspot.com/docs/api/private-apps)

---

**Created for TestMachine Pipeline Integration Analysis**  
*Read-only exploration of HubSpot API structure and data format*