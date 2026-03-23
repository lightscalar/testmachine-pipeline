# HubSpot Integration Setup

## Issue Identified

The current token is not in the correct format for HubSpot API access.

## HubSpot Access Token Setup

To get a valid HubSpot access token, you need to:

### Option 1: Private App (Recommended)
1. Go to HubSpot Settings → Integrations → Private Apps
2. Click "Create a private app"
3. Configure the required scopes:
   - **CRM**: `crm.objects.companies.read`, `crm.objects.contacts.read`
   - **Engagements**: `tickets`, `e-commerce` (if available)
   - **Timeline**: `timeline` (for activities)
4. The token will be in format: `pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (longer)

### Option 2: OAuth App
1. Create an OAuth app in HubSpot developer portal
2. Implement OAuth flow to get access tokens
3. Tokens will be in format: `Cxxxxxxxxxxxxxx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

## Required Scopes for Full Functionality

The integration needs these scopes:
- `crm.objects.companies.read` - Read company data
- `crm.objects.contacts.read` - Read contact data  
- `crm.objects.deals.read` - Read deal/opportunity data
- `timeline` - Read activities and engagements
- `files` - Read attached files (optional)

## Testing the Token

Once you have a valid token, update `.env`:

```bash
HUBSPOT_ACCESS_TOKEN=your-actual-token-here
```

Then test with:
```bash
npm run hubspot:full-sync
```

## Token Validation

The debug script will help verify your token works:
```bash
node debug-hubspot.js
```

## Current Status

❌ **Token Invalid**: The current token format is not recognized by HubSpot
🔧 **Action Required**: Generate a proper HubSpot access token
📊 **Infrastructure Ready**: Database schema and matching logic are implemented
✅ **Sample Data**: 24 test entities are loaded and ready for matching

Once you provide a valid HubSpot access token, the integration will:
1. Fetch all companies and contacts from your HubSpot account
2. Match them to the 24 pipeline entities by name and domain
3. Calculate engagement scores based on meetings, emails, calls, and notes
4. Update the database with engagement intelligence
5. Generate a comprehensive report

## Next Steps

1. **Get a valid HubSpot token** (see options above)
2. **Update `.env` file** with the correct token
3. **Run the integration**: `npm run hubspot:full-sync`
4. **View results**: `npm run hubspot:status`