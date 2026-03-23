#!/usr/bin/env node

const { Client } = require('@hubspot/api-client');
require('dotenv').config();

class HubSpotAnalyzer {
  constructor() {
    this.apiKey = process.env.HUBSPOT_API_KEY;
    this.sampleLimit = parseInt(process.env.SAMPLE_LIMIT) || 5;
    this.debug = process.env.DEBUG === 'true';
    
    if (!this.apiKey) {
      throw new Error('HUBSPOT_API_KEY environment variable is required');
    }
    
    this.client = new Client({ accessToken: this.apiKey });
    
    // TestMachine pipeline schema for comparison
    this.pipelineSchema = {
      marketSegments: ['Exchanges', 'Auditors', 'Large Auditors', 'DeFi', 'RWA/Tokenization'],
      fields: ['Entity', 'Stage', 'Connection', 'Role', 'Owner', 'Timing', 'Provider', 'Listings']
    };
  }

  log(message, data = null) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    if (data && this.debug) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  prettyPrint(label, data) {
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(data, null, 2));
    console.log('='.repeat(label.length + 8));
  }

  async testConnection() {
    try {
      this.log('🔍 Testing HubSpot API connection...');
      const accountInfo = await this.client.oauth.accessTokensApi.get(this.apiKey);
      this.log('✅ Connection successful');
      this.prettyPrint('Account Information', {
        hubId: accountInfo.body.hub_id,
        hubDomain: accountInfo.body.hub_domain,
        scopes: accountInfo.body.scopes
      });
      return true;
    } catch (error) {
      this.log('❌ Connection failed:', error.message);
      return false;
    }
  }

  async getCompanyProperties() {
    try {
      this.log('🏢 Fetching company properties...');
      const response = await this.client.crm.properties.coreApi.getAll('companies');
      const properties = response.body.results.map(prop => ({
        name: prop.name,
        label: prop.label,
        description: prop.description,
        type: prop.type,
        fieldType: prop.fieldType,
        groupName: prop.groupName,
        options: prop.options || []
      }));
      
      this.log(`📋 Found ${properties.length} company properties`);
      return properties;
    } catch (error) {
      this.log('❌ Failed to fetch company properties:', error.message);
      return [];
    }
  }

  async getContactProperties() {
    try {
      this.log('👤 Fetching contact properties...');
      const response = await this.client.crm.properties.coreApi.getAll('contacts');
      const properties = response.body.results.map(prop => ({
        name: prop.name,
        label: prop.label,
        description: prop.description,
        type: prop.type,
        fieldType: prop.fieldType,
        groupName: prop.groupName,
        options: prop.options || []
      }));
      
      this.log(`📋 Found ${properties.length} contact properties`);
      return properties;
    } catch (error) {
      this.log('❌ Failed to fetch contact properties:', error.message);
      return [];
    }
  }

  async getSampleCompanies() {
    try {
      this.log(`🏢 Fetching ${this.sampleLimit} sample companies...`);
      const response = await this.client.crm.companies.basicApi.getPage(
        this.sampleLimit,
        undefined,
        ['name', 'domain', 'industry', 'city', 'state', 'country', 'phone', 'website', 'description']
      );
      
      const companies = response.body.results.map(company => ({
        id: company.id,
        properties: company.properties,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      }));
      
      this.log(`✅ Retrieved ${companies.length} companies`);
      return companies;
    } catch (error) {
      this.log('❌ Failed to fetch companies:', error.message);
      return [];
    }
  }

  async getSampleContacts() {
    try {
      this.log(`👤 Fetching ${this.sampleLimit} sample contacts...`);
      const response = await this.client.crm.contacts.basicApi.getPage(
        this.sampleLimit,
        undefined,
        ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'city', 'state', 'country']
      );
      
      const contacts = response.body.results.map(contact => ({
        id: contact.id,
        properties: contact.properties,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt
      }));
      
      this.log(`✅ Retrieved ${contacts.length} contacts`);
      return contacts;
    } catch (error) {
      this.log('❌ Failed to fetch contacts:', error.message);
      return [];
    }
  }

  analyzeDataStructure(companies, contacts, companyProps, contactProps) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 DATA STRUCTURE ANALYSIS');
    console.log('='.repeat(60));

    // Sample data structures
    if (companies.length > 0) {
      this.prettyPrint('Sample Company Record Structure', companies[0]);
    }
    
    if (contacts.length > 0) {
      this.prettyPrint('Sample Contact Record Structure', contacts[0]);
    }

    // Property analysis
    console.log('\n📋 Available Properties Summary:');
    console.log(`Companies: ${companyProps.length} properties`);
    console.log(`Contacts: ${contactProps.length} properties`);

    // Show some key properties
    console.log('\n🏢 Key Company Properties:');
    companyProps.slice(0, 10).forEach(prop => {
      console.log(`  • ${prop.name}: ${prop.label} (${prop.type})`);
    });

    console.log('\n👤 Key Contact Properties:');  
    contactProps.slice(0, 10).forEach(prop => {
      console.log(`  • ${prop.name}: ${prop.label} (${prop.type})`);
    });
  }

  generateSchemaMapping() {
    console.log('\n' + '='.repeat(60));
    console.log('🗺️  TESTMACHINE PIPELINE SCHEMA MAPPING');
    console.log('='.repeat(60));
    
    console.log('\n📋 TestMachine Pipeline Schema:');
    console.log('Market Segments:', this.pipelineSchema.marketSegments.join(', '));
    console.log('Fields:', this.pipelineSchema.fields.join(', '));
    
    console.log('\n💡 Suggested HubSpot Mappings:');
    const mappings = {
      'Entity': {
        hubspot: 'name (company) / firstname+lastname (contact)',
        notes: 'Primary identifier - company name or contact full name'
      },
      'Stage': {
        hubspot: 'lifecyclestage / hs_lead_status',
        notes: 'Could map to HubSpot lifecycle stage or custom deal stage'
      },
      'Connection': {
        hubspot: 'hs_analytics_source / hs_latest_source',
        notes: 'How they found us - could use HubSpot source tracking'
      },
      'Role': {
        hubspot: 'jobtitle (contact) / custom property',
        notes: 'Contact job title or custom role classification'
      },
      'Owner': {
        hubspot: 'hubspot_owner_id',
        notes: 'Direct mapping to HubSpot owner assignment'
      },
      'Timing': {
        hubspot: 'createdate / hs_date_entered_*',
        notes: 'Created date or stage entry timestamps'
      },
      'Provider': {
        hubspot: 'industry / custom property',
        notes: 'Industry field or custom property for service provider type'
      },
      'Listings': {
        hubspot: 'website / custom property',
        notes: 'Company website or custom field for marketplace listings'
      }
    };

    Object.entries(mappings).forEach(([field, mapping]) => {
      console.log(`\n${field}:`);
      console.log(`  HubSpot: ${mapping.hubspot}`);
      console.log(`  Notes: ${mapping.notes}`);
    });

    console.log('\n📊 Market Segment Mapping Strategy:');
    console.log('• Create custom company property: "testmachine_market_segment"');
    console.log('• Options:', this.pipelineSchema.marketSegments.join(' | '));
    console.log('• Use HubSpot workflows to auto-assign based on industry/keywords');
  }

  generateRecommendations() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 INTEGRATION RECOMMENDATIONS');
    console.log('='.repeat(60));

    const recommendations = [
      {
        title: 'Custom Properties Setup',
        items: [
          'Create "testmachine_market_segment" dropdown property',
          'Add "testmachine_pipeline_stage" property',  
          'Create date properties for timing tracking',
          'Add provider/listings text properties as needed'
        ]
      },
      {
        title: 'Data Synchronization',
        items: [
          'Use HubSpot webhooks for real-time updates',
          'Implement batch sync for initial data migration',
          'Map existing lifecycle stages to pipeline stages',
          'Set up automated workflows for segment assignment'
        ]
      },
      {
        title: 'API Integration Points',
        items: [
          'Companies API for entity management',
          'Contacts API for relationship tracking', 
          'Deals API if tracking opportunities',
          'Properties API for schema management',
          'Webhooks API for change notifications'
        ]
      },
      {
        title: 'Next Steps',
        items: [
          'Review sample data with TestMachine team',
          'Define exact property mappings',
          'Create custom properties in HubSpot',
          'Build data sync prototype',
          'Test with small dataset first'
        ]
      }
    ];

    recommendations.forEach(section => {
      console.log(`\n${section.title}:`);
      section.items.forEach(item => console.log(`  • ${item}`));
    });
  }

  async run() {
    console.log('🚀 HubSpot API Proof of Concept for TestMachine Pipeline Integration');
    console.log('=' .repeat(75));
    
    try {
      // Test connection
      const connected = await this.testConnection();
      if (!connected) {
        process.exit(1);
      }

      // Add small delay to respect rate limits  
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch data in parallel
      const [companies, contacts, companyProps, contactProps] = await Promise.all([
        this.getSampleCompanies(),
        this.getSampleContacts(), 
        this.getCompanyProperties(),
        this.getContactProperties()
      ]);

      // Analyze and generate recommendations
      this.analyzeDataStructure(companies, contacts, companyProps, contactProps);
      this.generateSchemaMapping();
      this.generateRecommendations();

      console.log('\n✅ Analysis complete!');
      console.log('\nNext: Review the output and discuss schema mapping with your team.');

    } catch (error) {
      console.error('❌ Error during analysis:', error.message);
      if (this.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }
}

// Run the analyzer
if (require.main === module) {
  const analyzer = new HubSpotAnalyzer();
  analyzer.run().catch(console.error);
}

module.exports = HubSpotAnalyzer;