const axios = require('axios');
const fs = require('fs').promises;
require('dotenv').config();

class HubSpotEmailIntelligence {
  constructor() {
    this.accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    this.portalId = process.env.HUBSPOT_PORTAL_ID;
    this.baseURL = 'https://api.hubapi.com';
    this.headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  async makeRequest(endpoint, params = {}) {
    try {
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        headers: this.headers,
        params
      });
      return response.data;
    } catch (error) {
      console.error(`❌ Error making request to ${endpoint}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getAllContacts() {
    console.log('📧 Fetching all contacts with email engagement data...');
    let contacts = [];
    let after = undefined;
    let totalFetched = 0;

    // Define the properties we want to retrieve
    const properties = [
      'email', 'firstname', 'lastname', 'company', 'jobtitle',
      'hs_email_last_email_name', 'hs_email_last_send_date',
      'hs_email_last_open_date', 'hs_email_last_click_date',
      'hs_email_last_reply_date', 'hs_email_bounce',
      'hs_email_optout', 'num_contacted_notes',
      'notes_last_contacted', 'notes_last_updated',
      'hs_lead_status', 'lifecyclestage'
    ];

    do {
      const params = {
        limit: 100,
        properties: properties.join(','),
        ...(after && { after })
      };

      const data = await this.makeRequest('/crm/v3/objects/contacts', params);
      contacts = contacts.concat(data.results || []);
      after = data.paging?.next?.after;
      totalFetched += data.results?.length || 0;
      console.log(`   Fetched ${totalFetched} contacts...`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (after);

    console.log(`✅ Total contacts retrieved: ${contacts.length}`);
    return contacts;
  }

  async getEmailEvents(contactId, limit = 100) {
    // Get email events for a specific contact
    try {
      const endpoint = `/events/v3/events`;
      const params = {
        objectType: 'contact',
        objectId: contactId,
        eventType: 'e_email_sent,e_email_delivered,e_email_opened,e_email_clicked,e_email_bounced,e_email_replied',
        limit
      };
      return await this.makeRequest(endpoint, params);
    } catch (error) {
      // Email events might require different permissions/endpoint
      return { results: [] };
    }
  }

  calculateEngagementScore(contact) {
    const props = contact.properties;
    let score = 0;
    let factors = [];

    // Email engagement signals (most important)
    if (props.hs_email_last_open_date) {
      const daysSinceOpen = Math.floor((Date.now() - new Date(props.hs_email_last_open_date).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceOpen <= 7) {
        score += 40; factors.push('Recent email open (7 days)');
      } else if (daysSinceOpen <= 30) {
        score += 25; factors.push('Email open (30 days)');
      } else if (daysSinceOpen <= 90) {
        score += 15; factors.push('Email open (90 days)');
      }
    }

    if (props.hs_email_last_click_date) {
      const daysSinceClick = Math.floor((Date.now() - new Date(props.hs_email_last_click_date).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceClick <= 7) {
        score += 30; factors.push('Recent email click (7 days)');
      } else if (daysSinceClick <= 30) {
        score += 20; factors.push('Email click (30 days)');
      } else if (daysSinceClick <= 90) {
        score += 10; factors.push('Email click (90 days)');
      }
    }

    if (props.hs_email_last_reply_date) {
      const daysSinceReply = Math.floor((Date.now() - new Date(props.hs_email_last_reply_date).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceReply <= 30) {
        score += 50; factors.push('Email reply (30 days)');
      } else if (daysSinceReply <= 90) {
        score += 30; factors.push('Email reply (90 days)');
      }
    }

    // Negative signals
    if (props.hs_email_bounce === 'true') {
      score -= 20; factors.push('Email bounced');
    }
    if (props.hs_email_optout === 'true') {
      score -= 30; factors.push('Opted out');
    }

    // Contact activity
    if (props.num_contacted_notes && parseInt(props.num_contacted_notes) > 0) {
      score += 10; factors.push('Has contact notes');
    }

    if (props.notes_last_contacted) {
      const daysSinceContact = Math.floor((Date.now() - new Date(props.notes_last_contacted).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceContact <= 30) {
        score += 15; factors.push('Recent contact (30 days)');
      }
    }

    // Lifecycle stage
    if (props.lifecyclestage) {
      switch(props.lifecyclestage) {
        case 'customer': score += 30; factors.push('Customer'); break;
        case 'opportunity': score += 25; factors.push('Opportunity'); break;
        case 'marketingqualifiedlead': score += 20; factors.push('MQL'); break;
        case 'salesqualifiedlead': score += 25; factors.push('SQL'); break;
        case 'lead': score += 10; factors.push('Lead'); break;
      }
    }

    // Cap at 100
    score = Math.min(score, 100);

    return {
      score,
      factors,
      level: score >= 70 ? 'High' : score >= 40 ? 'Medium' : score >= 20 ? 'Low' : 'None'
    };
  }

  async analyzeEmailEngagement() {
    console.log('🔍 Starting Email Engagement Intelligence Analysis...\n');
    
    const contacts = await this.getAllContacts();
    
    // Filter contacts with email addresses
    const emailContacts = contacts.filter(contact => contact.properties.email);
    console.log(`📧 Contacts with email addresses: ${emailContacts.length}`);

    // Analyze each contact
    const analysis = emailContacts.map(contact => {
      const engagement = this.calculateEngagementScore(contact);
      return {
        id: contact.id,
        email: contact.properties.email,
        firstName: contact.properties.firstname || '',
        lastName: contact.properties.lastname || '',
        company: contact.properties.company || '',
        jobTitle: contact.properties.jobtitle || '',
        lastEmailName: contact.properties.hs_email_last_email_name || '',
        lastSendDate: contact.properties.hs_email_last_send_date || '',
        lastOpenDate: contact.properties.hs_email_last_open_date || '',
        lastClickDate: contact.properties.hs_email_last_click_date || '',
        lastReplyDate: contact.properties.hs_email_last_reply_date || '',
        bounced: contact.properties.hs_email_bounce === 'true',
        optedOut: contact.properties.hs_email_optout === 'true',
        lifecycleStage: contact.properties.lifecyclestage || '',
        engagementScore: engagement.score,
        engagementLevel: engagement.level,
        engagementFactors: engagement.factors
      };
    });

    // Sort by engagement score
    analysis.sort((a, b) => b.engagementScore - a.engagementScore);

    return analysis;
  }

  async generateReport(analysis) {
    console.log('\n📊 Email Engagement Intelligence Report\n');
    console.log('=' * 50);

    // Summary statistics
    const total = analysis.length;
    const high = analysis.filter(c => c.engagementLevel === 'High').length;
    const medium = analysis.filter(c => c.engagementLevel === 'Medium').length;
    const low = analysis.filter(c => c.engagementLevel === 'Low').length;
    const none = analysis.filter(c => c.engagementLevel === 'None').length;

    console.log(`📈 ENGAGEMENT SUMMARY:`);
    console.log(`   Total Contacts: ${total}`);
    console.log(`   High Engagement (70+): ${high} (${(high/total*100).toFixed(1)}%)`);
    console.log(`   Medium Engagement (40-69): ${medium} (${(medium/total*100).toFixed(1)}%)`);
    console.log(`   Low Engagement (20-39): ${low} (${(low/total*100).toFixed(1)}%)`);
    console.log(`   No Engagement (0-19): ${none} (${(none/total*100).toFixed(1)}%)`);

    // Top 10 most engaged contacts
    console.log(`\n🔥 TOP 10 MOST ENGAGED CONTACTS:`);
    analysis.slice(0, 10).forEach((contact, i) => {
      console.log(`   ${i+1}. ${contact.firstName} ${contact.lastName} (${contact.email})`);
      console.log(`      Company: ${contact.company || 'N/A'} | Score: ${contact.engagementScore} | Level: ${contact.engagementLevel}`);
      if (contact.lastOpenDate) console.log(`      Last Email Open: ${new Date(contact.lastOpenDate).toLocaleDateString()}`);
      if (contact.lastClickDate) console.log(`      Last Email Click: ${new Date(contact.lastClickDate).toLocaleDateString()}`);
      if (contact.lastReplyDate) console.log(`      Last Email Reply: ${new Date(contact.lastReplyDate).toLocaleDateString()}`);
      console.log(`      Factors: ${contact.engagementFactors.join(', ')}`);
      console.log('');
    });

    // Recent email activity
    const recentOpens = analysis.filter(c => {
      if (!c.lastOpenDate) return false;
      const daysSince = Math.floor((Date.now() - new Date(c.lastOpenDate).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince <= 7;
    });

    const recentClicks = analysis.filter(c => {
      if (!c.lastClickDate) return false;
      const daysSince = Math.floor((Date.now() - new Date(c.lastClickDate).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince <= 7;
    });

    const recentReplies = analysis.filter(c => {
      if (!c.lastReplyDate) return false;
      const daysSince = Math.floor((Date.now() - new Date(c.lastReplyDate).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince <= 7;
    });

    console.log(`⚡ RECENT ACTIVITY (Last 7 Days):`);
    console.log(`   Email Opens: ${recentOpens.length}`);
    console.log(`   Email Clicks: ${recentClicks.length}`);
    console.log(`   Email Replies: ${recentReplies.length}`);

    return {
      summary: { total, high, medium, low, none },
      topEngaged: analysis.slice(0, 20),
      recentActivity: { recentOpens, recentClicks, recentReplies },
      fullAnalysis: analysis
    };
  }

  async saveResults(report, filename = 'hubspot-email-engagement-analysis.json') {
    const filepath = `./${filename}`;
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Results saved to: ${filepath}`);
    
    // Also save a CSV for easy Excel import
    const csvPath = filepath.replace('.json', '.csv');
    const csvRows = [
      'Email,First Name,Last Name,Company,Job Title,Engagement Score,Engagement Level,Last Open Date,Last Click Date,Last Reply Date,Bounced,Opted Out,Lifecycle Stage'
    ];
    
    report.fullAnalysis.forEach(contact => {
      const row = [
        contact.email,
        contact.firstName,
        contact.lastName,
        contact.company,
        contact.jobTitle,
        contact.engagementScore,
        contact.engagementLevel,
        contact.lastOpenDate,
        contact.lastClickDate,
        contact.lastReplyDate,
        contact.bounced,
        contact.optedOut,
        contact.lifecycleStage
      ].map(field => `"${field}"`).join(',');
      csvRows.push(row);
    });
    
    await fs.writeFile(csvPath, csvRows.join('\n'));
    console.log(`📊 CSV export saved to: ${csvPath}`);
  }
}

// Run the analysis
async function main() {
  try {
    const intelligence = new HubSpotEmailIntelligence();
    const analysis = await intelligence.analyzeEmailEngagement();
    const report = await intelligence.generateReport(analysis);
    await intelligence.saveResults(report);
    
    console.log('\n🎉 Email Engagement Intelligence Analysis Complete!');
    console.log('\nKey Insights:');
    console.log(`• ${report.summary.high} high-engagement contacts ready for outreach`);
    console.log(`• ${report.recentActivity.recentOpens.length} contacts opened emails in last 7 days`);
    console.log(`• ${report.recentActivity.recentReplies.length} contacts replied to emails recently`);
    console.log('\nNext steps: Review top engaged contacts for priority outreach!');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = HubSpotEmailIntelligence;