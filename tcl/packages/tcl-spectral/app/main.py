from fastapi import FastAPI
from .models import SpectralRequest, SpectralResponse, SpectralAnalyzeResponse, EdgeAttribution
from .spectral import build_index, spectral_metrics, spectral_truth_vector, spectral_edge_attribution, spectral_fingerprint

app = FastAPI(title="TCL-Spectral", version="0.3.0")

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
    - topBadContradictions: problematic contradiction edges
    - topBadSupports: problematic support edges
    - nodeBlame: blame scores per node
    - fingerprint: monitoring fingerprint
    """
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
    
    # 4. Generate fingerprint (new)
    fingerprint = spectral_fingerprint(
        coherence_score=m["coherenceScore"],
        spectral_gap=m["spectralGap"],
        contradiction_energy=m["contradictionEnergy"],
        circularity_score=m["circularityScore"],
        heat_trace=m["heatTrace"]
    )
    
    # 5. Build response with all fields
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
        topBadContradictions=[EdgeAttribution(**e) for e in attribution_result["topBadContradictions"]],
        topBadSupports=[EdgeAttribution(**e) for e in attribution_result["topBadSupports"]],
        nodeBlame=attribution_result["nodeBlame"],
        fingerprint=fingerprint
    )
