from fastapi import FastAPI
from .models import SpectralRequest, SpectralResponse
from .spectral import build_index, spectral_metrics

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
