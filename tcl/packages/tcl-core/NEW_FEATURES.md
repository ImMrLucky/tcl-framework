# New TCL Features

## Overview

TCL now includes four powerful new features that work for both Call Center QA and general QA use cases, while keeping the core framework decoupled from specific implementations.

---

## 1. Confidence Scores Per Claim

### What It Does
Provides detailed confidence metrics for each claim, showing how confident we are that the claim is true.

### How It Works
Each claim now includes `confidenceMetrics` with:
- **groundingScore** (0-1): Based on evidence/sources
- **supportScore** (0-1): Based on support from other claims
- **contradictionScore** (0-1): Inverse of contradictions (higher = fewer contradictions)
- **overall** (0-1): Weighted average of all metrics

### Usage
```typescript
// Enabled by default, can disable with:
{
  options: {
    includeConfidenceMetrics: false
  }
}

// In response:
{
  report: {
    claims: [
      {
        id: "c1",
        text: "...",
        confidence: 0.75,
        confidenceMetrics: {
          groundingScore: 0.8,
          supportScore: 0.6,
          contradictionScore: 0.9,
          overall: 0.77
        }
      }
    ]
  }
}
```

### Use Cases
- **Call Center QA**: Identify which statements need review (low confidence)
- **General QA**: Prioritize which claims to verify first

---

## 2. Suggested Fixes

### What It Does
Generates actionable suggestions for fixing validation issues.

### How It Works
Automatically generates suggestions for:
- **Fix Contradictions**: How to resolve conflicting claims
- **Add Evidence**: Which claims need sources
- **Improve Consistency**: Claims with many contradictions
- **Custom Rule Violations**: How to fix domain-specific rule failures

### Usage
```typescript
// Enabled by default, can disable with:
{
  options: {
    includeSuggestions: false
  }
}

// In response:
{
  report: {
    suggestions: [
      {
        type: 'fix_contradiction',
        claimIds: ['c1', 'c2'],
        priority: 'high',
        title: 'Resolve Contradiction',
        description: 'These claims contradict each other...',
        suggestedAction: 'Review and reconcile these statements...',
        example: 'If one claim says "X is true" and another says "X is false"...'
      }
    ]
  }
}
```

### Use Cases
- **Call Center QA**: Tell reviewers exactly what to fix
- **General QA**: Provide actionable feedback to improve answers

---

## 3. Batch Validation API

### What It Does
Validates multiple items in a single API call for efficiency. **Supports both batch QA and batch call transcripts.**

### How It Works
New `/validate/batch` endpoint accepts an array of validation requests and processes them in parallel (with concurrency limit). Each item can be:
- **QA mode**: `question` + `answer` (general QA validation)
- **Call transcript mode**: `question` only (empty or omitted `answer`)

### Usage

#### Batch QA (Question + Answer)
```typescript
POST /validate/batch
{
  "items": [
    {
      "question": "What is AI?",
      "answer": "AI is artificial intelligence...",
      "options": { ... }
    },
    {
      "question": "How does ML work?",
      "answer": "Machine learning uses algorithms..."
    }
  ],
  "options": {
    // Shared options for all items
    "spectral": true,
    "supportThreshold": 0.45
  }
}
```

#### Batch Call Transcripts (Transcripts Only)
```typescript
POST /validate/batch
{
  "items": [
    {
      "question": "Agent: Thank you for calling...\nCustomer: Hi, I need help...",
      "answer": "" // Empty or omitted = call transcript mode
    },
    {
      "question": "Agent: How can I assist you?\nCustomer: I have a billing question...",
      // answer can be omitted entirely
    }
  ],
  "options": {
    "customRules": ExampleRuleSets.callCenter,
    "supportThreshold": 0.35 // Lower threshold for conversational data
  }
}
```

#### Mixed Batch (QA + Transcripts)
```typescript
POST /validate/batch
{
  "items": [
    {
      "question": "What is AI?",
      "answer": "AI is artificial intelligence..." // QA mode
    },
    {
      "question": "Agent: Thank you for calling...",
      "answer": "" // Call transcript mode
    }
  ]
}

// Response:
{
  "results": [
    { /* ValidateOutput for item 1 */ },
    { /* ValidateOutput for item 2 */ }
  ],
  "summary": {
    "total": 2,
    "passed": 1,
    "failed": 1,
    "averageScore": 65,
    "averageLatency": 120
  }
}
```

### Use Cases
- **Call Center QA**: Validate 100 call transcripts at once for batch review
- **General QA**: Validate multiple LLM outputs (Q+A pairs) in parallel
- **Mixed Workflows**: Process both QA and call transcripts in the same batch
- **Enterprise**: Process large volumes efficiently

### Limits
- Maximum 100 items per batch request
- 10 minute timeout
- Processes 10 items concurrently (prevents overload)

---

## 4. Custom Rule Sets

### What It Does
Allows domain-specific validation rules (call center policies, legal requirements, medical guidelines, etc.).

### How It Works
Define custom rules that check for:
- **Pattern matching**: Contains text, regex patterns
- **Semantic rules**: NLI-based checks (future)
- **Claim-level or document-level**: Rules that apply to individual claims or entire document

### Usage
```typescript
{
  options: {
    customRules: [
      {
        id: "cc-refund-auth",
        name: "Refund Authorization",
        description: "Agent must mention manager approval for refunds over $100",
        pattern: {
          type: "contains",
          value: "refund",
          caseSensitive: false
        },
        scope: "document", // or "claim"
        severity: "error", // or "warning", "info"
        suggestion: "Ensure refund mentions include authorization details"
      }
    ]
  }
}
```

### Example Rule Sets
TCL includes example rule sets for common domains:
- **Call Center**: Refund authorization, policy consistency
- **Legal**: Disclaimer requirements
- **Medical**: Emergency warnings

See `custom_rules.ts` for `ExampleRuleSets`.

### Use Cases
- **Call Center QA**: Enforce company policies (e.g., "must mention manager approval")
- **Legal**: Require disclaimers
- **Medical**: Require emergency warnings
- **Financial**: Compliance checks

---

## Architecture: Decoupled Design

All features are designed to be **domain-agnostic**:

1. **No hardcoded assumptions**: Works for any use case
2. **Optional features**: All can be enabled/disabled
3. **Flexible rules**: Customers define their own rules
4. **Generic suggestions**: Suggestions work for any domain

### Example: Call Center vs General QA

**Call Center QA:**
```typescript
{
  question: "Call transcript...",
  answer: "",
  options: {
    customRules: ExampleRuleSets.callCenter,
    includeSuggestions: true,
    includeConfidenceMetrics: true
  }
}
```

**General QA:**
```typescript
{
  question: "What is...?",
  answer: "The answer is...",
  options: {
    customRules: [], // No domain-specific rules
    includeSuggestions: true,
    includeConfidenceMetrics: true
  }
}
```

Both work with the same core TCL framework!

---

## Migration Guide

### Existing Code
No changes required - all features are **opt-in** and enabled by default.

### Disable Features
```typescript
{
  options: {
    includeConfidenceMetrics: false, // Disable confidence scores
    includeSuggestions: false, // Disable suggestions
    customRules: [] // No custom rules
  }
}
```

### Enable All Features
```typescript
{
  options: {
    includeConfidenceMetrics: true, // Default
    includeSuggestions: true, // Default
    customRules: ExampleRuleSets.callCenter // Add domain rules
  }
}
```

---

## Performance Considerations

1. **Confidence Metrics**: Minimal overhead (~5ms per validation)
2. **Suggestions**: Minimal overhead (~10ms per validation)
3. **Custom Rules**: Depends on rule complexity (pattern matching is fast)
4. **Batch API**: Processes 10 items concurrently to prevent overload

---

## Next Steps

1. **Test the features** with your use cases
2. **Define custom rules** for your domain
3. **Use batch API** for high-volume scenarios
4. **Leverage suggestions** to improve your validation workflow

