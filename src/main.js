const cron = require('node-cron');
const DiscoveryWorkflow = require('./workflows/discovery');

require('dotenv').config();

console.log('🚀 TestMachine Pipeline Automation Started');

// Daily discovery at 7:00 AM ET (12:00 PM UTC)
cron.schedule('0 12 * * *', async () => {
  console.log('⏰ Running scheduled discovery at 7:00 AM ET');
  
  try {
    const workflow = new DiscoveryWorkflow();
    const results = await workflow.runFullDiscovery();
    console.log(`✅ Scheduled discovery completed: ${results.length} companies added`);
  } catch (error) {
    console.error('❌ Scheduled discovery failed:', error);
  }
}, {
  timezone: 'America/New_York'
});

console.log('📅 Cron job scheduled: Daily at 7:00 AM ET');
console.log('🏃 Service running... Press Ctrl+C to stop');

// Keep the process alive
process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});