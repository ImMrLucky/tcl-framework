# TCL Framework Integration Guide

## Overview

The TCL framework is a **backend service** that validates LLM outputs. The UI we built is just a **demo** - companies integrate TCL into their own systems via API calls.

---

## Architecture

```
┌─────────────────┐
│  Company's App  │
│  (Your Product) │
└────────┬────────┘
         │
         │ HTTP POST /validate
         │
         ▼
┌─────────────────┐
│   TCL Core API  │
│  (Backend Only) │
└─────────────────┘
```

**Key Point:** TCL is a **service**, not a UI. Companies call it from their own applications.

---

## Integration Patterns

### Pattern 1: Direct API Integration (Most Common)

**How it works:**
- Company deploys TCL Core as a service (Railway, AWS, etc.)
- Their application makes HTTP requests to TCL
- TCL returns validation results
- Company displays results in their own UI

**Example:**
```python
# Python example
import requests

def validate_llm_output(question, answer, sources=None):
    response = requests.post(
        "https://your-tcl-service.com/validate",
        json={
            "question": question,
            "answer": answer,
            "sources": sources,
            "options": {
                "spectral": True,
                "ann": True
            }
        }
    )
    return response.json()

# Use in your app
result = validate_llm_output(
    question="What is the capital of France?",
    answer="The capital of France is Paris."
)

if result["refusal"]:
    print("Answer rejected - score too low")
    print(f"Score: {result['scores']['overall']}")
    print(f"Contradictions: {len(result['report']['contradictions'])}")
else:
    print("Answer accepted")
```

---

### Pattern 2: Middleware Integration

**How it works:**
- TCL sits between LLM and your application
- All LLM responses go through TCL first
- TCL validates before returning to user

**Example:**
```python
# Middleware pattern
class LLMWithValidation:
    def __init__(self, llm_client, tcl_endpoint):
        self.llm = llm_client
        self.tcl = tcl_endpoint
    
    def generate(self, prompt):
        # 1. Get LLM response
        answer = self.llm.generate(prompt)
        
        # 2. Validate with TCL
        validation = requests.post(
            self.tcl + "/validate",
            json={
                "question": prompt,
                "answer": answer,
                "options": {"spectral": True}
            }
        ).json()
        
        # 3. Return with validation metadata
        return {
            "answer": answer,
            "validation": validation,
            "approved": not validation["refusal"]
        }
```

---

### Pattern 3: Batch Processing

**How it works:**
- Validate multiple LLM outputs in batch
- Useful for content moderation, fact-checking pipelines

**Example:**
```python
def validate_batch(questions_and_answers):
    results = []
    for qa in questions_and_answers:
        result = requests.post(
            "https://your-tcl-service.com/validate",
            json={
                "question": qa["question"],
                "answer": qa["answer"],
                "sources": qa.get("sources")
            }
        ).json()
        results.append(result)
    return results
```

---

### Pattern 4: Webhook Integration

**How it works:**
- Company sends LLM output to TCL
- TCL validates asynchronously
- TCL calls back with results via webhook

**Example:**
```python
# Your app sends request
requests.post(
    "https://your-tcl-service.com/validate",
    json={
        "question": question,
        "answer": answer,
        "webhook": "https://your-app.com/webhook/tcl-results"
    }
)

# TCL calls your webhook when done
# POST https://your-app.com/webhook/tcl-results
# Body: { validation results }
```

---

## API Contract

### Endpoint: `POST /validate`

**Request:**
```json
{
  "question": "What is the capital of France?",
  "answer": "The capital of France is Paris.",
  "sources": [
    {
      "id": "source1",
      "text": "Paris is the capital and largest city of France."
    }
  ],
  "options": {
    "spectral": true,
    "ann": true,
    "cache": true,
    "nliEndpoint": "https://custom-nli.com",
    "thresholds": {
      "truth": 50,
      "consistency": 50,
      "overall": 60
    }
  }
}
```

**Response:**
```json
{
  "answer": "The capital of France is Paris.",
  "refusal": false,
  "scorerId": "transformers-deberta-v3-base",
  "scores": {
    "truth": 100,
    "consistency": 100,
    "coherence": 85,
    "overall": 95
  },
  "report": {
    "claims": [
      {
        "id": "c1",
        "text": "The capital of France is Paris.",
        "confidence": 0.95,
        "evidence": [
          {
            "source_id": "source1",
            "weight": 0.92
          }
        ]
      }
    ],
    "violations": [],
    "missingEvidence": [],
    "contradictions": [],
    "spectral": {
      "coherenceScore": 85,
      "contradictionEnergy": 0.1,
      "supportEnergy": 2.5,
      "circularityScore": 5
    },
    "graph": {
      "supports": [],
      "contradictions": [],
      "grounding": [
        {
          "claimId": "c1",
          "sourceId": "source1",
          "weight": 0.92
        }
      ]
    }
  }
}
```

---

## Integration Examples by Use Case

### Use Case 1: Content Moderation

**Scenario:** Validate user-generated content or LLM responses before publishing

```python
def moderate_content(content):
    result = tcl.validate(
        question="Is this content safe?",
        answer=content,
        options={"spectral": True}
    )
    
    if result["refusal"]:
        return {
            "approved": False,
            "reason": "Failed validation",
            "score": result["scores"]["overall"],
            "issues": {
                "contradictions": len(result["report"]["contradictions"]),
                "ungrounded": len(result["report"]["missingEvidence"])
            }
        }
    return {"approved": True}
```

---

### Use Case 2: Fact-Checking Pipeline

**Scenario:** Verify LLM-generated summaries against sources

```python
def fact_check(llm_summary, sources):
    result = tcl.validate(
        question="Is this summary accurate?",
        answer=llm_summary,
        sources=sources,
        options={"spectral": True}
    )
    
    # Check truth score (how many claims are grounded)
    truth_score = result["scores"]["truth"]
    
    if truth_score < 70:
        return {
            "verified": False,
            "ungrounded_claims": result["report"]["missingEvidence"]
        }
    
    return {"verified": True, "score": truth_score}
```

---

### Use Case 3: Legal/Medical Advice Validation

**Scenario:** Ensure advice is consistent and doesn't contradict itself

```python
def validate_advice(question, advice, sources):
    result = tcl.validate(
        question=question,
        answer=advice,
        sources=sources,
        options={
            "spectral": True,
            "thresholds": {
                "consistency": 80,  # Higher threshold for critical advice
                "overall": 75
            }
        }
    )
    
    # Reject if contradictions found
    if result["report"]["contradictions"]:
        return {
            "approved": False,
            "reason": "Contradictions detected",
            "contradictions": result["report"]["contradictions"]
        }
    
    return {"approved": True, "score": result["scores"]["overall"]}
```

---

### Use Case 4: Research Paper Validation

**Scenario:** Validate research summaries for accuracy and consistency

```python
def validate_research(summary, citations):
    sources = [{"id": f"cite{i}", "text": cite} for i, cite in enumerate(citations)]
    
    result = tcl.validate(
        question="Is this research summary accurate?",
        answer=summary,
        sources=sources,
        options={"spectral": True}
    )
    
    # Use graph data to show relationships
    graph = result["report"]["graph"]
    
    return {
        "score": result["scores"]["overall"],
        "graph": {
            "supports": graph["supports"],
            "contradictions": graph["contradictions"],
            "grounding": graph["grounding"]
        },
        "claims": result["report"]["claims"]
    }
```

---

## Deployment Options

### Option 1: Self-Hosted (Company's Infrastructure)

**Setup:**
1. Deploy TCL Core to company's cloud (AWS, GCP, Azure)
2. Set up environment variables
3. Configure NLI scorer (local or API)
4. Expose API endpoint internally or publicly

**Benefits:**
- Full control
- Data stays in company infrastructure
- Custom configuration

---

### Option 2: Managed Service (TCL as SaaS)

**Setup:**
1. Company signs up for TCL service
2. Gets API key
3. Calls TCL API from their app

**Benefits:**
- No infrastructure management
- Automatic updates
- Scalable

---

### Option 3: Hybrid (On-Premise + Cloud)

**Setup:**
1. TCL Core runs on company servers
2. NLI scoring uses cloud API (Mistral, etc.)
3. Spectral analysis on-premise or cloud

**Benefits:**
- Data privacy (core on-premise)
- Performance (cloud NLI)
- Flexibility

---

## What Companies Need to Provide

### Required:
- ✅ **Question:** The prompt/query
- ✅ **Answer:** The LLM output to validate

### Optional but Recommended:
- ✅ **Sources:** Evidence to ground claims against
- ✅ **Options:** Configuration (Spectral, thresholds, etc.)

### What TCL Provides:
- ✅ **Validation scores** (truth, consistency, coherence, overall)
- ✅ **Claim extraction** (automatically extracts claims from answer)
- ✅ **Graph data** (relationships between claims)
- ✅ **Violations** (contradictions, missing evidence)
- ✅ **Refusal flag** (should answer be rejected?)

---

## Integration Checklist

### Phase 1: Setup
- [ ] Deploy TCL Core service
- [ ] Configure NLI scorer (local or API)
- [ ] Set up Spectral service (optional)
- [ ] Test API endpoint

### Phase 2: Integration
- [ ] Add TCL API client to your app
- [ ] Implement validation calls
- [ ] Handle validation responses
- [ ] Display results in your UI

### Phase 3: Customization
- [ ] Set custom thresholds
- [ ] Configure NLI endpoint (if using custom)
- [ ] Tune scoring parameters
- [ ] Add your own UI for graph visualization (optional)

---

## Code Examples

### JavaScript/TypeScript
```typescript
async function validateWithTCL(question: string, answer: string, sources?: Source[]) {
  const response = await fetch('https://your-tcl-service.com/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      answer,
      sources,
      options: {
        spectral: true,
        thresholds: { overall: 60 }
      }
    })
  });
  
  const result = await response.json();
  
  if (result.refusal) {
    // Handle rejection
    console.error('Answer rejected:', result.scores);
  }
  
  return result;
}
```

### Python
```python
import requests

def validate_with_tcl(question, answer, sources=None):
    response = requests.post(
        'https://your-tcl-service.com/validate',
        json={
            'question': question,
            'answer': answer,
            'sources': sources,
            'options': {
                'spectral': True,
                'thresholds': {'overall': 60}
            }
        }
    )
    return response.json()
```

### Go
```go
func ValidateWithTCL(question, answer string, sources []Source) (*ValidationResult, error) {
    payload := map[string]interface{}{
        "question": question,
        "answer": answer,
        "sources": sources,
        "options": map[string]interface{}{
            "spectral": true,
        },
    }
    
    resp, err := http.Post(
        "https://your-tcl-service.com/validate",
        "application/json",
        bytes.NewBuffer(jsonPayload),
    )
    // ... handle response
}
```

---

## Custom UI Integration

**Companies can:**
- Use TCL's graph data to build their own visualization
- Integrate scores into their existing dashboards
- Create custom reports using the validation results
- Build their own UI components

**Example:**
```typescript
// Use graph data in your own UI
const graph = result.report.graph;

// Render your own graph visualization
renderGraph({
  nodes: result.report.claims,
  edges: [
    ...graph.supports.map(e => ({ ...e, type: 'support' })),
    ...graph.contradictions.map(e => ({ ...e, type: 'contradiction' }))
  ]
});
```

---

## Key Points

1. **TCL is a service** - Companies call it via API
2. **UI is just a demo** - Companies build their own UI
3. **Flexible integration** - Works with any language/framework
4. **Graph data available** - Companies can visualize however they want
5. **Self-hosted or SaaS** - Companies choose deployment model

---

## Next Steps for Companies

1. **Evaluate:** Test TCL with their LLM outputs
2. **Deploy:** Set up TCL Core service
3. **Integrate:** Add API calls to their application
4. **Customize:** Configure thresholds and options
5. **Visualize:** Build their own UI using graph data (optional)

The framework is designed to be **integrated**, not just used as-is!

