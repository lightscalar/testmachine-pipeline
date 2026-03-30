#!/usr/bin/env node

const { pool } = require('./src/database/connection');

async function checkVulsightMatch() {
  try {
    console.log('🔍 Checking if vulsight.com matches any pipeline entities...');
    
    const tables = ['exchanges', 'auditors', 'large_auditors', 'defi', 'rwa_tokenization'];
    
    for (const table of tables) {
      const query = `SELECT id, n, w FROM ${table} WHERE w ILIKE '%vulsight%' OR n ILIKE '%vulsight%'`;
      const result = await pool.query(query);
      
      if (result.rows.length > 0) {
        console.log(`✅ Found ${result.rows.length} matches in ${table}:`);
        result.rows.forEach(row => {
          console.log(`   - ${row.n}: ${row.w}`);
        });
      } else {
        console.log(`❌ No matches in ${table}`);
      }
    }
    
    console.log('\n🔍 Let me also check what entities might match "vulsight" domain...');
    
    // Check if there are any entities with similar domains
    const domainQuery = `
      SELECT 'exchanges' as table_name, n, w FROM exchanges WHERE w ILIKE '%vul%' OR n ILIKE '%vul%'
      UNION ALL
      SELECT 'auditors' as table_name, n, w FROM auditors WHERE w ILIKE '%vul%' OR n ILIKE '%vul%'
      UNION ALL  
      SELECT 'large_auditors' as table_name, n, w FROM large_auditors WHERE w ILIKE '%vul%' OR n ILIKE '%vul%'
      UNION ALL
      SELECT 'defi' as table_name, n, w FROM defi WHERE w ILIKE '%vul%' OR n ILIKE '%vul%'
      UNION ALL
      SELECT 'rwa_tokenization' as table_name, n, w FROM rwa_tokenization WHERE w ILIKE '%vul%' OR n ILIKE '%vul%'
    `;
    
    const domainResult = await pool.query(domainQuery);
    
    if (domainResult.rows.length > 0) {
      console.log(`✅ Found ${domainResult.rows.length} potential matches with 'vul':`, );
      domainResult.rows.forEach(row => {
        console.log(`   - [${row.table_name}] ${row.n}: ${row.w}`);
      });
    } else {
      console.log('❌ No entities found with "vul" in name or website');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkVulsightMatch();