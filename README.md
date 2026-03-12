# TestMachine Pipeline Automation

Daily prospect discovery and intelligence research system.

## Setup
- Run `npm install` to install dependencies
- Configure API keys in `config/keys.js`
- Run `npm run automation:discover` to discover new prospects
- Run `npm run automation:research "Company Name"` to research specific company

## Cron Job
Runs daily at 7am ET to discover 5-15 new prospects across all pipeline segments.