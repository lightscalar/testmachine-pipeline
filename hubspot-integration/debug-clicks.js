#!/usr/bin/env node

const fs = require('fs');

// Load the data
const data = JSON.parse(fs.readFileSync('hubspot-email-engagement-analysis.json', 'utf8'));

const now = new Date();
const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

console.log(`Now: ${now.toISOString()}`);
console.log(`Seven days ago: ${sevenDaysAgo.toISOString()}`);
console.log('');

// Find contacts with recent clicks
const recentClicks = data.fullAnalysis.filter(contact => {
  if (contact.lastClickDate && contact.lastClickDate !== '') {
    const clickDate = new Date(contact.lastClickDate);
    return clickDate > sevenDaysAgo;
  }
  return false;
});

console.log(`Found ${recentClicks.length} contacts with clicks in the last 7 days:`);
recentClicks.forEach(contact => {
  console.log(`- ${contact.email}: clicked on ${contact.lastClickDate}`);
});

// Also check some specific recent ones
console.log('\nChecking specific recent click dates:');
const testDates = [
  '2026-03-24T07:25:16.019Z',
  '2026-03-30T14:56:23.783Z',  
  '2026-03-25T10:00:00.000Z'
];

testDates.forEach(dateStr => {
  const clickDate = new Date(dateStr);
  const isRecent = clickDate > sevenDaysAgo;
  console.log(`${dateStr} -> ${isRecent ? 'RECENT (should be 1)' : 'OLD (should be 0)'}`);
});