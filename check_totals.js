const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'testmachine_pipeline',
  user: 'fermi',
  password: ''
});

async function getTotals() {
  try {
    // Get total companies
    const result = await pool.query('SELECT COUNT(*) as total FROM companies');
    console.log('Total companies in pipeline:', result.rows[0].total);
    
    // Check table structure
    const schema = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'companies' ORDER BY ordinal_position");
    console.log('\nColumns in companies table:');
    schema.rows.forEach(row => console.log('- ' + row.column_name));
    
    // Get a sample to see the structure
    const sample = await pool.query('SELECT * FROM companies LIMIT 3');
    console.log('\nSample data:');
    sample.rows.forEach((row, i) => {
      console.log(`Company ${i+1}:`, JSON.stringify(row, null, 2));
    });
    
    // Try to group by segment/type if such column exists
    const trySegments = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'companies' AND column_name LIKE '%type%' OR column_name LIKE '%segment%' OR column_name LIKE '%category%'");
    if (trySegments.rows.length > 0) {
      const segmentCol = trySegments.rows[0].column_name;
      const segments = await pool.query(`SELECT ${segmentCol}, COUNT(*) as count FROM companies GROUP BY ${segmentCol} ORDER BY count DESC`);
      console.log(`\nBreakdown by ${segmentCol}:`);
      segments.rows.forEach(row => {
        console.log(`${row[segmentCol]}: ${row.count} companies`);
      });
    }
    
    // Get total contacts
    const totalContacts = await pool.query('SELECT COUNT(*) as total FROM contacts');
    console.log('\nTotal contacts:', totalContacts.rows[0].total);
    
    await pool.end();
  } catch (error) {
    console.error('Database query error:', error.message);
    process.exit(1);
  }
}

getTotals();