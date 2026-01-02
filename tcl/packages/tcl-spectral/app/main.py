from fastapi import FastAPI, HTTPException
from .models import (
    SpectralRequest, SpectralResponse, SpectralAnalyzeResponse, EdgeAttribution,
    NliBatchRequest, NliBatchResponse, NliScore,
    BuildEdgesRequest, BuildEdgesResponse, EdgeIn, GroundingEdge
)
from .spectral import build_index, spectral_metrics, spectral_truth_vector, spectral_edge_attribution, spectral_fingerprint
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TCL-Spectral", version="0.5.0")  # v0.5.0: ONNX Runtime for 2-4x faster NLI

# Lazy import NLI to allow app to start even if torch fails
nli = None
nli_error = None

def get_nli():
    global nli, nli_error
    if nli is None and nli_error is None:
        try:
            from . import nli as nli_module
            nli = nli_module
            logger.info("NLI module loaded successfully")
        except Exception as e:
            nli_error = str(e)
            logger.error(f"Failed to load NLI module: {e}")
    return nli, nli_error


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
def health():
    """Health check endpoint."""
    nli_module, error = get_nli()
    
    # Check if ONNX is being used
    onnx_enabled = False
    if nli_module:
        onnx_enabled = getattr(nli_module, '_use_onnx', False)
    
    return {
        "status": "ok", 
        "version": "0.5.0",
        "nli_available": nli_module is not None,
        "nli_error": error,
        "onnx_enabled": onnx_enabled,
        "inference_mode": "onnx" if onnx_enabled else "pytorch"
    }


@app.get("/nli/test")
def nli_test():
    """
    Quick test of the NLI model.
    Returns entailment/contradiction scores for known test cases.
    CRITICAL: This verifies the label mapping is correct.
    """
    import time
    nli_module, error = get_nli()
    
    if error:
        return {
            "status": "error",
            "error": f"NLI module failed to load: {error}"
        }
    
    if nli_module is None:
        return {
            "status": "error", 
            "error": "NLI module not loaded"
        }
    
    try:
        # Get model config for verification
        model_config = {
            "name": nli_module._model_name,
            "onnx_enabled": getattr(nli_module, '_use_onnx', False),
            "inference_mode": "onnx" if getattr(nli_module, '_use_onnx', False) else "pytorch"
        }
        
        # Time the inference to show speed improvement
        start = time.time()
        
        # Test case 1: obvious entailment
        result1 = nli_module.score_pair("The sky is blue.", "The sky has a blue color.")
        
        # Test case 2: obvious contradiction
        result2 = nli_module.score_pair("The door is open.", "The door is closed.")
        
        # Test case 3: neutral
        result3 = nli_module.score_pair("The cat is on the mat.", "It is raining outside.")
        
        # Test case 4: transcript-like (source entails claim)
        result4 = nli_module.score_pair(
            "Agent: Yes, you can cancel at any time without a cancellation fee.",
            "you can cancel at any time without a cancellation fee"
        )
        
        # Test case 5: transcript-like contradiction
        result5 = nli_module.score_pair(
            "you can cancel at any time without a cancellation fee",
            "there may be an early termination charge"
        )
        
        elapsed = time.time() - start
        
        # Verify expected behavior
        tests_passed = (
            result1["entailment"] > 0.5 and  # Should be high entailment
            result2["contradiction"] > 0.5 and  # Should be high contradiction
            result4["entailment"] > 0.3  # Transcript case should have some entailment
        )
        
        return {
            "status": "ok" if tests_passed else "warning",
            "model_config": model_config,
            "inference_time_seconds": round(elapsed, 3),
            "avg_time_per_pair_ms": round(elapsed * 1000 / 5, 1),
            "tests": {
                "entailment_test": {
                    "premise": "The sky is blue.",
                    "hypothesis": "The sky has a blue color.",
                    "scores": result1,
                    "expected": "entailment should be high (>0.5)",
                    "passed": result1["entailment"] > 0.5
                },
                "contradiction_test": {
                    "premise": "The door is open.",
                    "hypothesis": "The door is closed.",
                    "scores": result2,
                    "expected": "contradiction should be high (>0.5)",
                    "passed": result2["contradiction"] > 0.5
                },
                "neutral_test": {
                    "premise": "The cat is on the mat.",
                    "hypothesis": "It is raining outside.",
                    "scores": result3,
                    "expected": "neutral should be high (>0.5)",
                    "passed": result3["neutral"] > 0.3
                },
                "transcript_grounding_test": {
                    "premise": "Agent: Yes, you can cancel at any time without a cancellation fee.",
                    "hypothesis": "you can cancel at any time without a cancellation fee",
                    "scores": result4,
                    "expected": "entailment should be >= 0.3 (source entails claim)",
                    "passed": result4["entailment"] >= 0.3
                },
                "transcript_contradiction_test": {
                    "premise": "you can cancel at any time without a cancellation fee",
                    "hypothesis": "there may be an early termination charge",
                    "scores": result5,
                    "expected": "contradiction should be >= 0.3 (conflicting fee statements)",
                    "passed": result5["contradiction"] >= 0.3
                }
            },
            "summary": {
                "tests_passed": tests_passed,
                "entailment_working": result1["entailment"] > 0.5,
                "contradiction_working": result2["contradiction"] > 0.5,
                "transcript_grounding_working": result4["entailment"] >= 0.3
            }
        }
    except Exception as e:
        logger.error(f"NLI test error: {e}")
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }


# ============================================================================
# NLI SCORING ENDPOINTS
# ============================================================================

@app.post("/nli/score", response_model=NliBatchResponse)
def nli_score(req: NliBatchRequest):
    """
    Score premise-hypothesis pairs using NLI model.
    Returns entailment, neutral, contradiction probabilities for each pair.
    
    This is the core NLI endpoint that the Node.js backend calls
    instead of trying to run transformers.js locally.
    """
    nli_module, error = get_nli()
    
    if error or nli_module is None:
        raise HTTPException(status_code=500, detail=f"NLI module not available: {error}")
    
    try:
        pairs = [(p.premise, p.hypothesis) for p in req.pairs]
        results = nli_module.score_batch(pairs)
        
        scores = []
        for i, result in enumerate(results):
            key = req.pairs[i].key if i < len(req.pairs) else None
            scores.append(NliScore(
                key=key,
                entailment=result["entailment"],
                neutral=result["neutral"],
                contradiction=result["contradiction"]
            ))
        
        model_name = getattr(nli_module, '_model_name', 'unknown')
        inference_mode = "onnx" if getattr(nli_module, '_use_onnx', False) else "pytorch"
        return NliBatchResponse(scores=scores, model=f"{model_name} ({inference_mode})")
    except Exception as e:
        logger.error(f"NLI scoring error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/nli/build-edges", response_model=BuildEdgesResponse)
def build_edges(req: BuildEdgesRequest):
    """
    Build graph edges from claims and sources using NLI scoring.
    
    This is a convenience endpoint that:
    1. Scores all claim-claim pairs for support/contradiction
    2. Scores all claim-source pairs for grounding
    3. Returns edges ready for spectral analysis
    
    The Node.js backend can call this instead of doing NLI locally.
    """
    nli_module, error = get_nli()
    
    if error or nli_module is None:
        raise HTTPException(status_code=500, detail=f"NLI module not available: {error}")
    
    try:
        claims = [{"id": c.id, "text": c.text} for c in req.claims]
        sources = [{"id": s.id, "text": s.text} for s in req.sources]
        
        result = nli_module.build_edges_from_claims(
            claims=claims,
            sources=sources,
            support_threshold=req.supportThreshold,
            contradiction_threshold=req.contradictionThreshold,
            grounding_threshold=req.groundingThreshold
        )
        
        return BuildEdgesResponse(
            supports=[EdgeIn(claimA=e["claimA"], claimB=e["claimB"], weight=e["weight"]) 
                     for e in result["supports"]],
            contradictions=[EdgeIn(claimA=e["claimA"], claimB=e["claimB"], weight=e["weight"]) 
                           for e in result["contradictions"]],
            grounding=[GroundingEdge(**e) for e in result["grounding"]],
            groundedClaimIds=result["groundedClaimIds"],
            stats={
                "claimsCount": len(claims),
                "sourcesCount": len(sources),
                "supportsCount": len(result["supports"]),
                "contradictionsCount": len(result["contradictions"]),
                "groundingCount": len(result["grounding"]),
                "groundedClaimsCount": len(result["groundedClaimIds"])
            }
        )
    except Exception as e:
        logger.error(f"Build edges error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/nli/benchmark")
def nli_benchmark():
    """
    Benchmark NLI performance with a realistic batch size.
    This helps verify ONNX speedup is working.
    """
    import time
    nli_module, error = get_nli()
    
    if error or nli_module is None:
        return {"status": "error", "error": error or "NLI not loaded"}
    
    # Create 50 test pairs (realistic for a transcript)
    test_pairs = [
        ("The agent promised free shipping.", "Free shipping was mentioned."),
        ("There is no cancellation fee.", "You can cancel anytime."),
        ("The product costs $99.", "The price is under $100."),
        ("Delivery takes 3-5 business days.", "You'll receive it within a week."),
        ("This offer expires tomorrow.", "There is a deadline for this offer."),
    ] * 10  # 50 pairs
    
    # Warm up (first run is slower due to ONNX session creation)
    _ = nli_module.score_pair("warmup", "warmup")
    
    # Benchmark batch
    start = time.time()
    results = nli_module.score_batch(test_pairs)
    elapsed = time.time() - start
    
    avg_ms = (elapsed * 1000) / len(test_pairs)
    pairs_per_second = len(test_pairs) / elapsed
    
    return {
        "status": "ok",
        "batch_size": len(test_pairs),
        "total_time_seconds": round(elapsed, 3),
        "avg_time_per_pair_ms": round(avg_ms, 1),
        "pairs_per_second": round(pairs_per_second, 1),
        "onnx_enabled": getattr(nli_module, '_use_onnx', False),
        "inference_mode": "onnx" if getattr(nli_module, '_use_onnx', False) else "pytorch",
        "performance_rating": (
            "excellent" if avg_ms < 50 else
            "good" if avg_ms < 100 else
            "acceptable" if avg_ms < 200 else
            "slow"
        )
    }


@app.post("/spectral/score", response_model=SpectralResponse)
def score(req: SpectralRequest):
    ids = [c.id for c in req.claims]
    idx = build_index(ids)

    supports = []
    for e in req.supports:
        if e.claimA in idx and e.claimB in idx:
            supports.append((idx[e.claimA], idx[e.claimB], float(e.weight)))

    contradictions = []
    for e in req.contradictions:
        if e.claimA in idx and e.claimB in idx:
            contradictions.append((idx[e.claimA], idx[e.claimB], float(e.weight)))

    grounded_ids = set()
    for cid in req.grounded:
        if cid in idx:
            grounded_ids.add(idx[cid])

    m = spectral_metrics(
        n=len(ids),
        support_edges=supports,
        contradiction_edges=contradictions,
        grounded_ids=grounded_ids,
        w_support=req.w_support,
        w_contradiction=req.w_contradiction,
        w_circularity=req.w_circularity,
        cycle_max_len=req.cycle_max_len
    )

    return SpectralResponse(
        coherenceScore=m["coherenceScore"],
        contradictionEnergy=m["contradictionEnergy"],
        supportEnergy=m["supportEnergy"],
        circularityScore=m["circularityScore"],
        spectralGap=m["spectralGap"],
        cycleMass=m["cycleMass"],
        heatTrace=m["heatTrace"]
    )

# ============================================================================
# NEW PLATFORM-GRADE ENDPOINT (Additive - does not modify existing)
# ============================================================================

@app.post("/spectral/analyze", response_model=SpectralAnalyzeResponse)
def analyze(req: SpectralRequest):
    """
    Enhanced spectral analysis with per-claim truth vectors and edge attribution.
    
    Returns all existing metrics from /spectral/score plus:
    - truthVector: per-claim truth values
    - truthStates: per-claim state labels
    - topBadContradictions: problematic contradiction edges (with claim IDs)
    - topBadSupports: problematic support edges (with claim IDs)
    - nodeBlame: blame scores per node
    - nodeBlameNorm: normalized node blame (0..1)
    - fingerprint: monitoring fingerprint
    """
    ids = [c.id for c in req.claims]
    idx = build_index(ids)
    
    # Build reverse index: index -> claim ID
    idx_to_id = {i: ids[i] for i in range(len(ids))}

    supports = []
    for e in req.supports:
        if e.claimA in idx and e.claimB in idx:
            supports.append((idx[e.claimA], idx[e.claimB], float(e.weight)))

    contradictions = []
    for e in req.contradictions:
        if e.claimA in idx and e.claimB in idx:
            contradictions.append((idx[e.claimA], idx[e.claimB], float(e.weight)))

    grounded_ids = set()
    for cid in req.grounded:
        if cid in idx:
            grounded_ids.add(idx[cid])

    n = len(ids)
    
    # 1. Get existing metrics (unchanged behavior)
    m = spectral_metrics(
        n=n,
        support_edges=supports,
        contradiction_edges=contradictions,
        grounded_ids=grounded_ids,
        w_support=req.w_support,
        w_contradiction=req.w_contradiction,
        w_circularity=req.w_circularity,
        cycle_max_len=req.cycle_max_len
    )
    
    # 2. Compute truth vector (new)
    truth_result = spectral_truth_vector(
        n=n,
        support_edges=supports,
        contradiction_edges=contradictions,
        grounded_ids=grounded_ids,
        w_support=req.w_support,
        w_contradiction=req.w_contradiction
    )
    
    # 3. Compute edge attribution (new)
    attribution_result = spectral_edge_attribution(
        truth_vector=truth_result["truthVector"],
        support_edges=supports,
        contradiction_edges=contradictions,
        top_k=10
    )
    
    # 4. Normalize node blame (0..1)
    node_blame = attribution_result["nodeBlame"]
    max_blame = max(node_blame) if node_blame and max(node_blame) > 0 else 1.0
    node_blame_norm = [float(x) / float(max_blame) for x in node_blame]
    
    # 5. Add claim IDs to edge attribution
    def with_ids(edge):
        """Add claimAId and claimBId to edge attribution"""
        e = dict(edge)
        a_idx = int(e.get("claimAIndex", -1))
        b_idx = int(e.get("claimBIndex", -1))
        e["claimAId"] = idx_to_id.get(a_idx)
        e["claimBId"] = idx_to_id.get(b_idx)
        return e
    
    top_bad_contradictions_with_ids = [with_ids(e) for e in attribution_result["topBadContradictions"]]
    top_bad_supports_with_ids = [with_ids(e) for e in attribution_result["topBadSupports"]]
    
    # 6. Generate fingerprint (new)
    fingerprint = spectral_fingerprint(
        coherence_score=m["coherenceScore"],
        spectral_gap=m["spectralGap"],
        contradiction_energy=m["contradictionEnergy"],
        circularity_score=m["circularityScore"],
        heat_trace=m["heatTrace"]
    )
    
    # 7. Build response with all fields
    return SpectralAnalyzeResponse(
        # Existing fields (same as SpectralResponse)
        coherenceScore=m["coherenceScore"],
        contradictionEnergy=m["contradictionEnergy"],
        supportEnergy=m["supportEnergy"],
        circularityScore=m["circularityScore"],
        spectralGap=m["spectralGap"],
        cycleMass=m["cycleMass"],
        heatTrace=m["heatTrace"],
        # New fields
        truthVector=truth_result["truthVector"],
        truthStates=truth_result["truthStates"],
        topBadContradictions=[EdgeAttribution(**e) for e in top_bad_contradictions_with_ids],
        topBadSupports=[EdgeAttribution(**e) for e in top_bad_supports_with_ids],
        nodeBlame=attribution_result["nodeBlame"],
        nodeBlameNorm=node_blame_norm,  # Added normalized blame
        fingerprint=fingerprint
    )
