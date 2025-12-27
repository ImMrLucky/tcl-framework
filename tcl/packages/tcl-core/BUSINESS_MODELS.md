# TCL Framework: Business Models & Deployment Options

## Overview

Companies can use TCL in **three main ways**, depending on their needs, budget, and data privacy requirements:

1. **SaaS Model** (You host, they call API)
2. **Self-Hosted** (They deploy, you provide support)
3. **Hybrid** (Mix of both)

---

## Model 1: SaaS (Software as a Service) ⭐ **Recommended for Most Companies**

### How It Works

**You (the provider):**
- Host TCL Core on your infrastructure (Railway, AWS, GCP, etc.)
- Manage scaling, updates, and maintenance
- Provide API endpoint: `https://api.tcl-framework.com`

**Company (the customer):**
- Signs up for your service
- Gets an API key
- Calls your API from their application
- Pays per request or monthly subscription

### Architecture

```
┌─────────────────┐
│ Company's App   │
│ (Their Product) │
└────────┬────────┘
         │
         │ POST /validate
         │ API Key: xyz123
         │
         ▼
┌─────────────────┐
│  Your TCL API    │  ← You host this
│  (SaaS Service)  │
└─────────────────┘
```

### Example Integration

```python
# Company's code
import requests

def validate_llm_output(question, answer):
    response = requests.post(
        "https://api.tcl-framework.com/validate",
        headers={"Authorization": "Bearer YOUR_API_KEY"},
        json={
            "question": question,
            "answer": answer,
            "options": {"spectral": True}
        }
    )
    return response.json()

# Use in their app
result = validate_llm_output(
    question="What is the capital of France?",
    answer="The capital of France is Paris."
)

if result["refusal"]:
    # Reject answer
    return "Answer rejected"
else:
    # Show answer to user
    return result["answer"]
```

### Pricing Models

**Option A: Pay-Per-Request**
- $0.01 per validation
- Good for: Startups, low volume
- Example: 1,000 validations/month = $10/month

**Option B: Tiered Subscription**
- Free: 100 validations/month
- Starter: $99/month - 10,000 validations
- Pro: $499/month - 100,000 validations
- Enterprise: Custom pricing

**Option C: Usage-Based**
- $0.005 per validation
- Volume discounts
- Good for: High-volume customers

### Benefits for Companies

✅ **No infrastructure management** - You handle everything  
✅ **Automatic updates** - Always latest version  
✅ **Scalable** - Handles traffic spikes  
✅ **Fast setup** - Just get API key and start calling  
✅ **Support included** - You provide customer support  

### Benefits for You (Provider)

✅ **Recurring revenue** - Monthly subscriptions  
✅ **Scalable business** - One service, many customers  
✅ **Control** - You manage updates and features  
✅ **Analytics** - See usage patterns across customers  

---

## Model 2: Self-Hosted (On-Premise or Their Cloud)

### How It Works

**You (the provider):**
- Provide TCL Core code (open source or licensed)
- Provide deployment guides and support
- Charge for license, support, or consulting

**Company (the customer):**
- Deploys TCL on their infrastructure (AWS, GCP, on-premise)
- Manages their own instance
- Calls their own TCL endpoint

### Architecture

```
┌─────────────────┐
│ Company's App   │
│ (Their Product) │
└────────┬────────┘
         │
         │ POST /validate
         │
         ▼
┌─────────────────┐
│  TCL Core        │  ← They host this
│  (Their Instance)│
└─────────────────┘
```

### Example Integration

```python
# Company's code - calling their own TCL instance
import requests

def validate_llm_output(question, answer):
    response = requests.post(
        "https://tcl.internal.company.com/validate",  # Their endpoint
        json={
            "question": question,
            "answer": answer,
            "options": {"spectral": True}
        }
    )
    return response.json()
```

### Pricing Models

**Option A: One-Time License**
- $10,000 - $50,000 one-time fee
- Includes deployment support
- Good for: Enterprise customers

**Option B: Annual License + Support**
- $5,000/year license
- $2,000/year support contract
- Includes updates and support

**Option C: Open Source + Support**
- Code is open source (MIT/Apache)
- Charge for support, consulting, custom features
- Good for: Building community

### Benefits for Companies

✅ **Data privacy** - Data never leaves their infrastructure  
✅ **Customization** - Can modify code for their needs  
✅ **No per-request costs** - Fixed cost regardless of volume  
✅ **Compliance** - Meets regulatory requirements (HIPAA, GDPR)  

### Benefits for You (Provider)

✅ **Enterprise sales** - Higher value deals  
✅ **Long-term relationships** - Support contracts  
✅ **Community building** - If open source  

---

## Model 3: Hybrid (Best of Both Worlds)

### How It Works

**Core validation logic:** Self-hosted by company  
**NLI scoring:** Cloud API (Mistral, Hugging Face)  
**Spectral analysis:** Optional cloud service  

### Architecture

```
┌─────────────────┐
│ Company's App   │
└────────┬────────┘
         │
         │ POST /validate
         │
         ▼
┌─────────────────┐
│  TCL Core       │  ← Self-hosted
│  (On-Premise)   │
└────────┬────────┘
         │
         │ Calls cloud NLI
         │
         ▼
┌─────────────────┐
│  NLI Service     │  ← Cloud API
│  (Mistral/HF)    │
└─────────────────┘
```

### Benefits

✅ **Privacy** - Core logic on-premise  
✅ **Performance** - Cloud NLI for speed  
✅ **Cost control** - Pay only for NLI calls  
✅ **Flexibility** - Mix and match services  

---

## Real-World Use Cases

### Use Case 1: Content Moderation SaaS

**Company:** Social media platform  
**Model:** SaaS  
**Integration:**
```python
def moderate_post(content):
    result = requests.post(
        "https://api.tcl-framework.com/validate",
        json={
            "question": "Is this content safe?",
            "answer": content,
            "options": {"spectral": True}
        }
    ).json()
    
    if result["refusal"] or result["scores"]["overall"] < 60:
        return {"approved": False, "reason": "Failed validation"}
    return {"approved": True}
```

### Use Case 2: Enterprise Customer Support

**Company:** Large enterprise  
**Model:** Self-hosted  
**Why:** Data privacy, compliance requirements  
**Integration:** Same API, but deployed on their infrastructure

### Use Case 3: Healthcare AI Assistant

**Company:** Healthcare provider  
**Model:** Hybrid  
**Why:** HIPAA compliance (data on-premise) + cloud NLI for performance  
**Integration:** TCL Core on-premise, calls cloud NLI API

---

## Implementation Roadmap

### Phase 1: MVP (SaaS Only)

1. **Deploy TCL Core** to Railway/AWS
2. **Add API key authentication**
3. **Set up billing** (Stripe, etc.)
4. **Create customer dashboard** (optional)
5. **Launch** with pay-per-request model

### Phase 2: Add Self-Hosted Option

1. **Create deployment packages** (Docker, Kubernetes)
2. **Add license management**
3. **Create support portal**
4. **Offer enterprise packages**

### Phase 3: Enterprise Features

1. **Multi-tenant support**
2. **Custom NLI endpoints**
3. **Advanced analytics**
4. **White-label options**

---

## Pricing Recommendations

### SaaS Pricing

| Tier | Price | Validations/Month | Best For |
|------|-------|------------------|----------|
| Free | $0 | 100 | Testing, demos |
| Starter | $99 | 10,000 | Small startups |
| Pro | $499 | 100,000 | Growing companies |
| Enterprise | Custom | Unlimited | Large companies |

### Self-Hosted Pricing

| Package | Price | Includes |
|---------|-------|----------|
| License | $10,000 | One-time, perpetual |
| Support | $2,000/year | Updates, support |
| Enterprise | Custom | Custom features, SLA |

---

## Key Selling Points

### For SaaS Model

- **"Get started in 5 minutes"** - Just get API key
- **"No infrastructure to manage"** - We handle everything
- **"Pay only for what you use"** - Scalable pricing
- **"Always up-to-date"** - Automatic updates

### For Self-Hosted Model

- **"Your data stays private"** - On your infrastructure
- **"Unlimited usage"** - Fixed cost
- **"Full control"** - Customize as needed
- **"Compliance ready"** - Meets regulatory requirements

---

## Next Steps

1. **Decide on business model** (SaaS, self-hosted, or both)
2. **Add API authentication** (if SaaS)
3. **Create pricing tiers**
4. **Set up billing** (Stripe, etc.)
5. **Build customer dashboard** (optional)
6. **Create deployment guides** (if self-hosted)
7. **Launch!**

---

## FAQ

**Q: Can companies use both models?**  
A: Yes! Some companies use SaaS for development/testing, then self-host for production.

**Q: What about the UI we built?**  
A: The UI is a **demo/showcase**. Companies build their own UI using the API data.

**Q: Do companies need to deploy Spectral service?**  
A: Optional. They can use your hosted Spectral service or deploy their own.

**Q: How do companies handle NLI costs?**  
A: They can use free tiers (Hugging Face), cheap APIs (Mistral), or local models (Ollama).

**Q: Can companies white-label TCL?**  
A: Yes, with enterprise packages. They can rebrand and customize.

---

## Summary

**TCL is an API service** that companies integrate into their applications. They can:

1. **Use your SaaS** - Call your hosted API (easiest)
2. **Self-host** - Deploy on their infrastructure (most control)
3. **Hybrid** - Mix of both (best of both worlds)

The UI you built is just a **demo** - companies build their own UI using the API response data (scores, claims, graph, etc.).

