# Enterprise Workflow Features - Issues Review Queue

## What "Unverified" Means

### Verification Levels

The system uses three verification levels to indicate the strength of evidence backing an issue:

1. **EXTERNAL_VERIFIED** (Verified)
   - The issue has been confirmed against external evidence sources
   - Evidence includes: policy documents, system records, compliance documentation, etc.
   - **Most reliable** - backed by documented evidence
   - Display: Green "Verified" badge

2. **TRANSCRIPT_ONLY** (Transcript-only)
   - The issue is based on transcript content only
   - **Not verified** against external evidence (policies, documents, system records)
   - May still be valid, but requires manual verification
   - Common in "transcript-only" mode where external evidence isn't available
   - Display: Orange "Transcript-only" badge with tooltip
   - **Why it matters**: In transcript-only mode, claims can't be verified against policy documents or system records, so they're marked as "unverified" until external evidence is provided

3. **NONE** (Unverified)
   - The issue has no grounding evidence at all
   - Requires investigation to determine validity
   - **Least reliable** - needs manual review
   - Display: Red "Unverified" badge

### Why This Matters for Enterprises

- **Compliance**: External verification is required for audit trails
- **Risk Management**: Unverified issues need review before action
- **Defensibility**: Verified issues have evidence backing them
- **Workflow**: Unverified issues should be prioritized for manual review

## Fixed Issues

### 1. Blank Columns (Severity, Impact, Summary)
**Problem**: Columns were showing blank values
**Fix**: 
- Added null-safe access (`?.`) in template bindings
- Added fallback displays ("-") for missing data
- Ensured backend provides default values for all required fields

### 2. Data Structure
**Problem**: Some issues were missing nested objects
**Fix**: Backend now ensures all nested objects exist:
- `what` (issueSummary, issueDetail)
- `verification` (level, reasonCodes)
- `who` (speaker, turnIndex)
- `evidence` (refs, edges)
- `compliance` (tags, disclaimers)
- `audit` (createdAt, engineVersion, etc.)

## Enterprise Workflow Features

### Export Capabilities

**Individual Issue Export**
- Export single issue as JSON
- Accessible from Actions menu → Export Issue

**Bulk Export**
- Export selected issues as CSV or JSON
- Accessible from bulk actions toolbar
- CSV includes: Issue ID, Type, Category, Severity, Impact, Score, Status, Verification, Summary, Created At
- JSON includes full issue data with all nested objects

**Future**: PDF export (coming soon)

### External System Integrations (Coming Soon)

**Planned Integrations**:
1. **Jira**
   - Create Jira tickets from issues
   - Bulk create tickets for selected issues
   - Map issue fields to Jira fields (summary, description, priority, labels)

2. **Salesforce**
   - Create Salesforce cases from issues
   - Link to customer records
   - Track resolution in Salesforce

3. **ServiceNow**
   - Create ServiceNow tickets
   - Integrate with IT service management workflows
   - Track issues through resolution lifecycle

**Integration Features**:
- OAuth authentication
- Field mapping configuration
- Custom templates for ticket creation
- Two-way sync (status updates, comments)
- Webhook support for real-time updates

### Current Workflow Actions

**Status Management**:
- OPEN → ACKNOWLEDGED → RESOLVED
- FALSE_POSITIVE (mark as not an issue)
- Bulk status updates

**Assignment**:
- Assign issues to team members
- Bulk assignment
- Unassign

**Comments & Activity**:
- Add comments to issues
- View activity log (status changes, assignments, comments)
- Audit trail for compliance

## Enterprise Value Propositions

### 1. Compliance & Audit
- **Verification tracking**: Know which issues are verified vs. unverified
- **Audit trail**: Complete activity log for all issue actions
- **Export capabilities**: Export issues for external audit systems
- **Defensibility**: Verified issues have evidence backing them

### 2. Risk Management
- **Prioritization**: Risk scores help prioritize issues
- **Verification levels**: Understand evidence strength
- **Impact assessment**: Business impact ratings
- **Status tracking**: Track resolution progress

### 3. Workflow Integration
- **Export to external systems**: Jira, Salesforce, ServiceNow (coming soon)
- **Bulk operations**: Efficient handling of multiple issues
- **Assignment**: Route issues to appropriate teams
- **Comments**: Collaboration on issue resolution

### 4. Transparency
- **Verification tooltips**: Clear explanation of verification levels
- **Score breakdowns**: Understand why issues are scored as they are
- **Evidence references**: See what evidence backs each issue
- **Activity logs**: Complete history of all actions

## Recommendations for Enterprise Readiness

### Immediate (Current)
✅ Export to CSV/JSON
✅ Status workflow (OPEN → ACKNOWLEDGED → RESOLVED)
✅ Assignment and comments
✅ Activity logging
✅ Verification level tracking

### Short-term (Next Sprint)
- [ ] PDF export with formatted reports
- [ ] Jira integration (OAuth, ticket creation)
- [ ] Salesforce integration (case creation)
- [ ] Email notifications for assignments
- [ ] Custom fields for issue metadata

### Medium-term (Next Quarter)
- [ ] ServiceNow integration
- [ ] Two-way sync with external systems
- [ ] Custom workflow states (configurable per org)
- [ ] SLA tracking (time to acknowledge, time to resolve)
- [ ] Automated routing rules (assign based on category/type)

### Long-term (Future)
- [ ] AI-powered issue prioritization
- [ ] Predictive analytics (which issues are likely to escalate)
- [ ] Integration marketplace (Zapier, webhooks)
- [ ] Custom dashboards and reporting
- [ ] Mobile app for issue management

## User Experience Improvements

### Verification Clarity
- Added tooltips explaining verification levels
- Color-coded badges (Green = Verified, Orange = Transcript-only, Red = Unverified)
- Help icon in column header with explanation

### Export Workflow
- One-click export for individual issues
- Bulk export for selected issues
- Multiple formats (CSV, JSON, PDF coming soon)

### Integration Readiness
- Menu structure ready for integrations
- Placeholder actions show planned features
- "Coming Soon" labels set expectations

## Next Steps

1. **Test blank columns fix**: Verify all columns display correctly
2. **Test export functionality**: Export individual and bulk issues
3. **Gather feedback**: What other export formats are needed?
4. **Prioritize integrations**: Which external system is most important?
5. **Design integration UI**: How should field mapping work?

