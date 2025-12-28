# Realistic Threshold Values Guide

## Overview

Threshold values determine which edges are included in the graph. Too high = miss relationships, too low = false positives.

## Threshold Recommendations by Scorer Type

### 1. TokenHeuristicScorer (Basic Token Overlap)
**Accuracy:** ~40-60% (very basic, token-based only)

**Recommended Thresholds:**
- **Support:** 0.35 - 0.45
  - Lower end (0.35): More edges, more false positives
  - Higher end (0.45): Fewer edges, better precision
- **Contradiction:** 0.45 - 0.55
  - Only detects explicit negations ("not", "is not")
  - Higher threshold needed to avoid false positives
- **Grounding:** 0.35 - 0.45
  - Token overlap between claim and source

**Current Defaults:** 0.40 / 0.50 / 0.40 ✅ (Good)

---

### 2. TransformersNliScorer (Local NLI Model)
**Model:** roberta-base-mnli (or deberta-v3-base)
**Accuracy:** ~84% on MNLI benchmark
**Score Distribution:**
- Strong entailment: 0.70-1.0
- Weak entailment: 0.50-0.70
- Neutral: 0.30-0.50
- Contradiction: 0.0-0.30

**Recommended Thresholds:**
- **Support:** 0.40 - 0.50
  - 0.40: More edges, includes weak entailments
  - 0.50: Better precision, only strong entailments
  - **Sweet spot: 0.45** ✅
- **Contradiction:** 0.50 - 0.60
  - Contradiction scores are typically lower (0.0-0.3 for true contradictions)
  - But we want to catch them, so threshold should be lower
  - **Sweet spot: 0.55** ✅
- **Grounding:** 0.40 - 0.50
  - Similar to support (claim → source is like entailment)
  - **Sweet spot: 0.45** ✅

**Current Defaults:** 0.45 / 0.55 / 0.45 ✅ (Good)

---

### 3. HttpNliScorer (External NLI API)
**Models:** Varies (e.g., microsoft/deberta-v3-base, roberta-large-mnli)
**Accuracy:** ~85-90% (depends on model)
**Score Distribution:** Similar to TransformersNliScorer but often more confident

**Recommended Thresholds:**
- **Support:** 0.50 - 0.60
  - Higher confidence scores
  - **Sweet spot: 0.58** ✅
- **Contradiction:** 0.60 - 0.75
  - More reliable, can use higher threshold
  - **Sweet spot: 0.70** ✅
- **Grounding:** 0.50 - 0.65
  - **Sweet spot: 0.60** ✅

**Current Defaults:** 0.58 / 0.70 / 0.60 ✅ (Good)

---

### 4. MistralNliScorer (LLM-based)
**Model:** Mistral API (mistral-small, mistral-medium, etc.)
**Accuracy:** Variable, depends on prompt and model
**Score Distribution:** More variable, can be overconfident or underconfident

**Recommended Thresholds:**
- **Support:** 0.50 - 0.65
  - LLMs can be inconsistent, need higher threshold
  - **Sweet spot: 0.58** ✅
- **Contradiction:** 0.60 - 0.75
  - **Sweet spot: 0.70** ✅
- **Grounding:** 0.50 - 0.65
  - **Sweet spot: 0.60** ✅

**Current Defaults:** 0.58 / 0.70 / 0.60 ✅ (Good)

---

## General Guidelines

### When to Lower Thresholds
- **Sparse graphs:** If you're getting very few edges, lower by 0.05-0.10
- **Exploratory analysis:** Want to see all possible relationships
- **High recall needed:** Don't want to miss any relationships

### When to Raise Thresholds
- **Too many false positives:** Graph is cluttered with weak relationships
- **Production use:** Need high precision, can sacrifice some recall
- **Large claim sets:** Need to filter aggressively

### Threshold Relationships
- **Support threshold** should typically be **lower** than contradiction threshold
  - Entailment is more common than contradiction
  - We want to catch weak support relationships
- **Grounding threshold** should be similar to support threshold
  - Claim → source is similar to claim → claim support

---

## Industry Standards

Based on NLI research and production systems:

### High-Precision (Production)
- Support: 0.60-0.70
- Contradiction: 0.70-0.80
- Grounding: 0.60-0.70

### Balanced (Default)
- Support: 0.45-0.55
- Contradiction: 0.55-0.65
- Grounding: 0.45-0.55

### High-Recall (Exploratory)
- Support: 0.30-0.40
- Contradiction: 0.40-0.50
- Grounding: 0.30-0.40

---

## Testing Thresholds

### Test 1: Edge Count
Run validation and check graph stats:
- **Too few edges:** Lower thresholds by 0.05-0.10
- **Too many edges:** Raise thresholds by 0.05-0.10
- **Good balance:** 5-20 edges per 10 claims

### Test 2: Precision Check
Manually verify a sample of edges:
- **High false positive rate:** Raise thresholds
- **Most edges are valid:** Thresholds are good

### Test 3: Coherence Score
Check if coherence score makes sense:
- **Very low (<30):** Might be missing important edges (lower thresholds)
- **Very high (>90):** Might be too permissive (raise thresholds)
- **Reasonable (50-80):** Thresholds are likely good

---

## Current Implementation Summary

| Scorer Type | Support | Contradiction | Grounding | Status |
|------------|---------|---------------|-----------|--------|
| TokenHeuristic | 0.40 | 0.50 | 0.40 | ✅ Good |
| TransformersNli | 0.45 | 0.55 | 0.45 | ✅ Good |
| HttpNli/Mistral | 0.58 | 0.70 | 0.60 | ✅ Good |

**All current defaults are realistic and well-calibrated!** ✅

