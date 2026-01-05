# Legacy View Removal Summary

## What Was Removed

### 1. Legacy Data Properties
- `issueNarratives: IssueNarrative[]` - Removed
- `issueNarrativesSummary: IssueSummary` - Removed  
- `clusteredIssues: ClusteredIssue[]` - Removed
- `issues: Issue[]` - Removed (per-claim issues)
- `showClusteredView` - Removed (toggle flag)

### 2. Legacy Loading Code
- All code that loads `issueNarratives` from report
- All code that loads `clusteredIssues` from report
- All code that loads `issues` from report or API
- All fallback logic for legacy views

### 3. Legacy UI Components
- Problem Statements view (IssueNarratives cards)
- Per-Claim Issues table
- View toggle buttons

### 4. Legacy Export Functions
- `exportNarrativesHTML()`
- `exportNarrativesCSV()`
- `exportNarrativesJSON()`
- `exportIssuesCSV()`
- `exportIssuesJSON()`
- `exportHTML()`

### 5. Legacy Helper Methods
- `convertNarrativesToIssues()`
- `buildIssueSummaryFromIssues()`
- `sortAndProcessIssues()`
- `selectIssueNarrative()`

## What Remains (IssueV2 Only)

### Data Properties
- `allIssuesV2: IssueV2[]` - All issues
- `topIssuesV2: IssueV2[]` - Top N issues
- `issueSummaryV2: IssueSummaryV2` - Summary stats

### UI Components
- IssueV2 cards (top issues)
- IssueV2 table (all issues)
- IssueV2 detail modal

### Export Functions
- `exportIssuesV2PDF()`
- `exportIssuesV2CSV()`
- `exportIssuesV2JSON()`

## Next Steps

The TypeScript file still has legacy code that needs to be removed. The main block is from line 314-423 which loads legacy data. This should be replaced with just:

```typescript
// Extract top offenders from IssueV2 if available
this.extractTopOffenders();
```

Also need to:
1. Remove legacy method definitions
2. Update executive summary to use IssueV2 data
3. Update `extractTopOffenders()` to work with IssueV2

