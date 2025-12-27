# Call Center QA Transformation Plan

## Overview
Transform TCL Framework UI from general validation demo to Call Center QA application.

## Key Changes

### 1. Terminology Updates
- **Question/Answer** → **Call Transcript**
- **Claims** → **Risky Statements** / **Compliance Issues**
- **Validation** → **QA Review** / **Compliance Check**
- **Scores** → **Compliance Score** / **Risk Score**
- **Contradictions** → **Policy Violations** / **Risky Statements**

### 2. New Features (MVP)

#### Input
- Call transcript upload/input (replaces question/answer)
- Optional: Call metadata (agent ID, customer ID, date, duration)

#### Scoring & Display
- **Compliance Score** (0-100) - replaces "Overall Score"
- **Risk Level**: Low / Medium / High / Critical
- **Compliance Flags**: Count of violations
- **Evidence Snippets**: Show specific quotes from transcript that support/contradict claims

#### Metrics Dashboard
- **Minutes Saved per Review**: Estimated time saved vs manual review
- **Escalations Avoided**: Count of high-risk calls caught
- **Compliance Flags Reduced**: Before/after comparison

#### Export
- **CSV Export**: Call ID, Score, Flags, Timestamp
- **PDF Export**: Full report with transcript, scores, evidence snippets

#### Reviewer UI
- List view of calls with scores
- Filter by risk level, date, agent
- Quick review workflow

### 3. Component Updates

#### Input Panel → Call Transcript Panel
- Single large textarea for transcript
- Optional metadata fields
- File upload support (future)

#### Summary Panel → Compliance Score Panel
- Large compliance score (0-100)
- Risk level badge
- Flags count
- Metrics (minutes saved, escalations avoided)

#### Claim Table → Risky Statements Table
- Show statements with risk level
- Evidence snippets column
- Policy violation tags

#### New: Evidence Snippets Component
- Show quotes from transcript
- Highlight supporting/contradicting evidence
- Link to specific transcript sections

#### New: Export Component
- CSV export button
- PDF export button
- Export options (include transcript, include evidence)

### 4. Backend Considerations
- TCL framework already supports this use case
- May need to add call metadata to ValidateInput
- Export endpoints (CSV/PDF generation)

### 5. SSO (Future)
- OAuth/SAML integration
- User roles (Manager, Reviewer, Agent)
- Audit logging

## Implementation Priority

### Phase 1: Core UI Changes (MVP)
1. ✅ Update terminology throughout UI
2. ✅ Change input to call transcript
3. ✅ Update summary panel for compliance scoring
4. ✅ Add evidence snippets display
5. ✅ Add export buttons (CSV/PDF)

### Phase 2: Metrics & Dashboard
1. Add metrics calculation
2. Create dashboard view
3. Add call list view

### Phase 3: Advanced Features
1. File upload
2. Batch processing
3. SSO integration
4. Advanced filtering

