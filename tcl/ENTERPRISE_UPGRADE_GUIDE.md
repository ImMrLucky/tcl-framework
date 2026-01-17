# Enterprise Upgrade Guide

This guide explains how to upgrade organizations to Enterprise tier and ensure entitlements are properly set.

## How Entitlements Are Automatically Updated

### Database Trigger (Automatic)
When an organization's `plan_tier` is updated in the `organizations` table, a database trigger automatically calls `init_org_entitlements()` to update the `org_entitlements` table with the correct features for that tier.

**Trigger:** `trg_org_entitlements_on_tier_change`
- Fires on: `UPDATE` of `plan_tier` column
- Function: `update_org_entitlements_on_tier_change()`
- Action: Calls `init_org_entitlements(org_id, new_tier)`

### Entitlement Features by Tier

**SANDBOX:**
- All features: `false`

**TEAM:**
- `batchIngestion`: `true`
- `issueDecisions`: `true`
- All other features: `false`

**ENTERPRISE:**
- All features: `true` (including `batchIngestion`, `enterpriseGovernance`, `integrations`, `connectorsS3`, `connectorsDropbox`, `connectorsGDrive`, etc.)

## Upgrade Methods

### Method 1: Admin UI (Recommended)

1. Navigate to `/admin` page (superuser only)
2. Click on the **"Org Upgrades"** tab
3. Find the organization you want to upgrade
4. Click the appropriate button:
   - **Sandbox** - Downgrade to free tier
   - **Team** - Upgrade to Team tier
   - **Enterprise** - Upgrade to Enterprise tier
5. Confirm the upgrade
6. The system will:
   - Update `organizations.plan_tier`
   - Trigger automatic entitlement refresh
   - Explicitly call `init_org_entitlements()` as a safety measure
   - Verify entitlements were updated
   - Log the upgrade action

### Method 2: API Endpoint (Programmatic)

**Endpoint:** `POST /api/admin/orgs/:orgId/upgrade`

**Authentication:** Superuser only

**Request Body:**
```json
{
  "planTier": "ENTERPRISE",  // or "TEAM", "SANDBOX"
  "planStatus": "ACTIVE",     // optional: "ACTIVE", "PAST_DUE", "CANCELED"
  "billingMode": "COMPED"     // optional: "STRIPE", "COMPED"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Organization upgraded to ENTERPRISE",
  "org": {
    "id": "...",
    "name": "...",
    "planTier": "ENTERPRISE",
    "planStatus": "ACTIVE",
    "billingMode": "COMPED"
  },
  "entitlements": {
    "tier": "ENTERPRISE",
    "batchIngestion": true,
    "allFeatures": {
      "batchIngestion": true,
      "enterpriseGovernance": true,
      "integrations": true,
      // ... all other features
    }
  }
}
```

**Example using curl:**
```bash
curl -X POST https://protectqa.com/api/admin/orgs/YOUR_ORG_ID/upgrade \
  -H "Authorization: Bearer YOUR_SUPERUSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"planTier": "ENTERPRISE", "planStatus": "ACTIVE", "billingMode": "COMPED"}'
```

### Method 3: Direct SQL (Supabase Dashboard)

**⚠️ Use with caution - only if API/UI methods don't work**

```sql
-- 1. Update the organization's plan_tier
UPDATE public.organizations
SET 
  plan_tier = 'ENTERPRISE',
  plan_status = 'ACTIVE',
  plan_changed_at = now()
WHERE id = 'YOUR_ORG_ID';

-- 2. Explicitly refresh entitlements (trigger should do this, but this ensures it)
SELECT public.init_org_entitlements('YOUR_ORG_ID', 'ENTERPRISE');

-- 3. Verify entitlements were updated
SELECT 
  org_id,
  tier,
  features->>'batchIngestion' as batch_ingestion,
  features->>'enterpriseGovernance' as enterprise_governance,
  features
FROM public.org_entitlements
WHERE org_id = 'YOUR_ORG_ID';
```

## Verification

After upgrading, verify entitlements are correct:

### 1. Check via API
```bash
curl https://protectqa.com/api/entitlements \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Active-Org-Id: YOUR_ORG_ID"
```

### 2. Check via Browser Console
```javascript
// Check cached entitlements
const cached = sessionStorage.getItem('orgEntitlements');
if (cached) {
  const ent = JSON.parse(cached);
  console.log('Batch Ingestion:', ent.features?.batchIngestion);
  console.log('Tier:', ent.tier);
}
```

### 3. Check via SQL
```sql
SELECT 
  tier,
  features->>'batchIngestion' as batch_ingestion,
  features
FROM public.org_entitlements
WHERE org_id = 'YOUR_ORG_ID';
```

## Troubleshooting

### Entitlements Not Updating After Upgrade

1. **Check if trigger fired:**
   ```sql
   -- Check if org_entitlements row exists
   SELECT * FROM public.org_entitlements WHERE org_id = 'YOUR_ORG_ID';
   ```

2. **Manually refresh entitlements:**
   ```sql
   SELECT public.init_org_entitlements('YOUR_ORG_ID', 'ENTERPRISE');
   ```

3. **Clear frontend cache:**
   - Open browser console
   - Run: `sessionStorage.removeItem('orgEntitlements')`
   - Refresh the page

4. **Check organization tier:**
   ```sql
   SELECT id, name, plan_tier FROM public.organizations WHERE id = 'YOUR_ORG_ID';
   ```

### Upgrade Endpoint Returns Error

- **403 Forbidden:** User is not a superuser
- **404 Not Found:** Organization doesn't exist
- **500 Internal Server Error:** Check server logs for details

### Entitlements Show Wrong Tier

- Verify `organizations.plan_tier` matches `org_entitlements.tier`
- If mismatch, manually call `init_org_entitlements()`
- Check if there are multiple `org_entitlements` rows (should only be one per org)

## Best Practices

1. **Always use the Admin UI or API endpoint** - Don't manually update `plan_tier` in SQL unless absolutely necessary
2. **Verify after upgrade** - Check entitlements via API or SQL to confirm they're correct
3. **Clear frontend cache** - Users may need to refresh their browser or clear sessionStorage
4. **Log upgrades** - All upgrades are logged in the audit system for compliance

## Related Files

- **Database Migration:** `tcl/supabase/sql/033_org_entitlements.sql`
- **Backend Endpoint:** `tcl/packages/tcl-core/src/server/admin/routes.ts`
- **Frontend Service:** `tcl/packages/tcl-ui/src/app/admin/admin.service.ts`
- **Frontend Component:** `tcl/packages/tcl-ui/src/app/admin/admin.component.ts`

