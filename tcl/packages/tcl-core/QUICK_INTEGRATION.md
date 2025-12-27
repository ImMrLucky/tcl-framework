# Quick Integration Guide

## TL;DR: How Companies Use TCL

**TCL is a backend API service.** Companies call it from their own applications.

---

## Simple Integration (3 Steps)

### 1. Deploy TCL Service
```bash
# Deploy to Railway, AWS, GCP, etc.
# Get your TCL endpoint: https://your-tcl-service.com
```

### 2. Call TCL from Your App
```python
import requests

def validate_llm_output(question, answer):
    response = requests.post(
        "https://your-tcl-service.com/validate",
        json={
            "question": question,
            "answer": answer,
            "options": {"spectral": True}
        }
    )
    return response.json()
```

### 3. Use Results in Your App
```python
result = validate_llm_output(
    question="What is the capital of France?",
    answer="The capital of France is Paris."
)

if result["refusal"]:
    # Reject the answer
    print("Answer rejected - score too low")
else:
    # Accept the answer
    print(f"Answer approved - score: {result['scores']['overall']}")
```

---

## Integration Patterns

### Pattern 1: Pre-Validation (Before Showing to User)
```python
def generate_and_validate(prompt):
    # 1. Generate LLM response
    llm_response = your_llm.generate(prompt)
    
    # 2. Validate with TCL
    validation = requests.post(
        "https://your-tcl-service.com/validate",
        json={
            "question": prompt,
            "answer": llm_response,
            "options": {"spectral": True}
        }
    ).json()
    
    # 3. Only show if approved
    if not validation["refusal"]:
        return llm_response
    else:
        return "I cannot provide a reliable answer to this question."
```

### Pattern 2: Post-Validation (Show with Warnings)
```python
def generate_with_validation(prompt):
    llm_response = your_llm.generate(prompt)
    
    validation = requests.post(
        "https://your-tcl-service.com/validate",
        json={
            "question": prompt,
            "answer": llm_response
        }
    ).json()
    
    return {
        "answer": llm_response,
        "score": validation["scores"]["overall"],
        "warnings": {
            "contradictions": len(validation["report"]["contradictions"]),
            "ungrounded": len(validation["report"]["missingEvidence"])
        }
    }
```

### Pattern 3: Batch Validation
```python
def validate_batch(questions_and_answers):
    results = []
    for qa in questions_and_answers:
        result = requests.post(
            "https://your-tcl-service.com/validate",
            json={
                "question": qa["question"],
                "answer": qa["answer"]
            }
        ).json()
        results.append(result)
    return results
```

---

## What Companies Get

### Scores
- `truth`: How many claims are grounded (0-100)
- `consistency`: How consistent claims are (0-100)
- `coherence`: Spectral coherence score (0-100)
- `overall`: Combined score (0-100)

### Report Data
- `claims`: Extracted claims from answer
- `contradictions`: Conflicting claims
- `missingEvidence`: Ungrounded claims
- `graph`: Relationship data (for visualization)

### Decision Flag
- `refusal`: Should answer be rejected? (true/false)

---

## Example: Content Moderation

```python
def moderate_content(content):
    result = requests.post(
        "https://your-tcl-service.com/validate",
        json={
            "question": "Is this content safe?",
            "answer": content,
            "options": {
                "spectral": True,
                "thresholds": {"overall": 60}
            }
        }
    ).json()
    
    if result["refusal"]:
        return {
            "approved": False,
            "reason": "Failed validation",
            "score": result["scores"]["overall"]
        }
    return {"approved": True}
```

---

## Example: Fact-Checking

```python
def fact_check(summary, sources):
    result = requests.post(
        "https://your-tcl-service.com/validate",
        json={
            "question": "Is this summary accurate?",
            "answer": summary,
            "sources": sources,
            "options": {"spectral": True}
        }
    ).json()
    
    truth_score = result["scores"]["truth"]
    
    if truth_score < 70:
        return {
            "verified": False,
            "ungrounded_claims": result["report"]["missingEvidence"]
        }
    
    return {"verified": True, "score": truth_score}
```

---

## Key Points

1. **TCL is a service** - Companies deploy it and call it via API
2. **UI is just a demo** - Companies build their own UI
3. **Graph data available** - Companies can visualize however they want
4. **Flexible** - Works with any language/framework
5. **Self-hosted or SaaS** - Companies choose deployment model

---

## Next Steps

1. **Deploy TCL** to your infrastructure
2. **Test** with your LLM outputs
3. **Integrate** API calls into your app
4. **Customize** thresholds and options
5. **Build** your own UI (optional)

See `INTEGRATION_GUIDE.md` for detailed examples and patterns.

