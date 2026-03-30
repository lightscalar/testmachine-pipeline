const { pool } = require('./src/database/connection');

async function checkTables() {
  try {
    console.log('🔍 Checking database tables...');
    
    // Get all table names
    const query = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    
    const result = await pool.query(query);
    
    console.log('📋 Available tables:');
    result.rows.forEach((row, i) => {
      console.log(`   ${i+1}. ${row.table_name}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkTables();