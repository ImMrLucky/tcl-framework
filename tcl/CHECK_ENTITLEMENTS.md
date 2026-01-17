# How to Check Organization Entitlements

This guide shows you how to verify if your organization has specific entitlements enabled, such as `batchIngestion`.

## Method 1: Browser Console (Easiest)

1. Open your browser's Developer Console (F12 or Cmd+Option+I)
2. Navigate to the Console tab
3. Run this command:

```javascript
// Check current entitlements from sessionStorage
const cached = sessionStorage.getItem('orgEntitlements');
if (cached) {
  const ent = JSON.parse(cached);
  console.log('Current Entitlements:', {
    tier: ent.tier,
    batchIngestion: ent.features?.batchIngestion,
    allFeatures: ent.features
  });
} else {
  console.log('No cached entitlements found. Try refreshing the page.');
}
```

## Method 2: API Call

1. Open your browser's Developer Console
2. Navigate to the Network tab
3. Make a request to the entitlements endpoint:

```javascript
// Get your API URL (usually https://protectqa.com)
const apiUrl = window.__TCL_API_URL || 'https://protectqa.com';

// Get your auth token (from localStorage)
const token = localStorage.getItem('sb-prod-auth-token') || 
              JSON.parse(localStorage.getItem('supabase.auth.token') || '{}').access_token;

// Make the API call
fetch(`${apiUrl}/api/entitlements`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Active-Org-Id': localStorage.getItem('activeOrgId')
  }
})
.then(r => r.json())
.then(data => {
  console.log('Entitlements Response:', data);
  console.log('Batch Ingestion Enabled:', data.entitlements?.features?.batchIngestion);
  console.log('Tier:', data.entitlements?.tier);
});
```

## Method 3: SQL Query (Supabase Dashboard)

If you have access to the Supabase Dashboard:

```sql
-- Check entitlements for a specific org
SELECT 
  org_id,
  tier,
  features->>'batchIngestion' as batch_ingestion,
  features
FROM public.org_entitlements
WHERE org_id = 'YOUR_ORG_ID_HERE';

-- Or check by org name
SELECT 
  o.name as org_name,
  o.id as org_id,
  e.tier,
  e.features->>'batchIngestion' as batch_ingestion,
  e.features
FROM public.organizations o
LEFT JOIN public.org_entitlements e ON e.org_id = o.id
WHERE o.name ILIKE '%YOUR_ORG_NAME%';
```

## Method 4: Check in Application

1. Navigate to `/ingest` page
2. Open browser console (F12)
3. Look for log message: `[IngestionComponent] Batch ingestion entitlement check:`
4. If `hasBatchIngestion` is `false`, the banner won't show

## Expected Values

- **SANDBOX tier**: `batchIngestion: false`
- **TEAM tier**: `batchIngestion: true`
- **ENTERPRISE tier**: `batchIngestion: true`

## Troubleshooting

If `batchIngestion` is `false` for an ENTERPRISE org:

1. **Check the org's tier**:
   ```sql
   SELECT id, name, plan_tier FROM public.organizations WHERE id = 'YOUR_ORG_ID';
   ```

2. **Re-initialize entitlements** (if you have admin access):
   ```sql
   SELECT public.init_org_entitlements('YOUR_ORG_ID', 'ENTERPRISE');
   ```

3. **Manually update the entitlement** (if you have admin access):
   ```sql
   UPDATE public.org_entitlements
   SET features = jsonb_set(features, '{batchIngestion}', 'true')
   WHERE org_id = 'YOUR_ORG_ID';
   ```

4. **Clear browser cache**:
   - Clear `sessionStorage` in browser console: `sessionStorage.removeItem('orgEntitlements')`
   - Refresh the page

## Quick Check Script

Run this in the browser console for a complete check:

```javascript
(async () => {
  const apiUrl = window.__TCL_API_URL || 'https://protectqa.com';
  const orgId = localStorage.getItem('activeOrgId');
  const token = localStorage.getItem('sb-prod-auth-token') || 
                JSON.parse(localStorage.getItem('supabase.auth.token') || '{}').access_token;
  
  console.log('=== Entitlement Check ===');
  console.log('Active Org ID:', orgId);
  
  try {
    const response = await fetch(`${apiUrl}/api/entitlements`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Active-Org-Id': orgId
      }
    });
    const data = await response.json();
    
    console.log('Tier:', data.entitlements?.tier);
    console.log('Batch Ingestion:', data.entitlements?.features?.batchIngestion);
    console.log('All Features:', data.entitlements?.features);
    
    if (!data.entitlements?.features?.batchIngestion) {
      console.warn('⚠️ Batch Ingestion is NOT enabled for this org');
      console.log('Expected: true for TEAM/ENTERPRISE, false for SANDBOX');
    } else {
      console.log('✅ Batch Ingestion is enabled');
    }
  } catch (error) {
    console.error('Error checking entitlements:', error);
  }
})();
```

