from pydantic import BaseModel, Field
from typing import List, Optional, Dict

class ClaimIn(BaseModel):
    id: str
    text: str

class EdgeIn(BaseModel):
    claimA: str
    claimB: str
    weight: float = Field(default=1.0, ge=0.0)

class SpectralRequest(BaseModel):
    claims: List[ClaimIn]
    supports: List[EdgeIn] = []          # directed edges
    contradictions: List[EdgeIn] = []    # can be directed or undirected
    grounded: List[str] = []             # grounded claim ids (from evidence)

    # Tuning knobs
    w_support: float = Field(default=1.0, ge=0.0)
    w_contradiction: float = Field(default=1.0, ge=0.0)
    w_circularity: float = Field(default=1.0, ge=0.0)
    cycle_max_len: int = Field(default=4, ge=2, le=8)  # consider cycles up to this length

class SpectralResponse(BaseModel):
    coherenceScore: int
    contradictionEnergy: float
    supportEnergy: float
    circularityScore: int
    spectralGap: float
    cycleMass: float
    heatTrace: Optional[List[float]] = None

# ============================================================================
# NEW PLATFORM-GRADE MODELS (Additive - does not modify existing)
# ============================================================================

class EdgeAttribution(BaseModel):
    claimAIndex: int
    claimBIndex: int
    weight: float
    badness: float

class SpectralAnalyzeResponse(BaseModel):
    # Required existing fields (same as SpectralResponse)
    coherenceScore: int
    contradictionEnergy: float
    supportEnergy: float
    circularityScore: int
    spectralGap: float
    cycleMass: float
    heatTrace: Optional[List[float]] = None
    
    # New platform-grade fields
    truthVector: List[float]
    truthStates: List[str]
    topBadContradictions: List[EdgeAttribution]
    topBadSupports: List[EdgeAttribution]
    nodeBlame: Optional[List[float]] = None
    fingerprint: Optional[Dict[str, object]] = None
