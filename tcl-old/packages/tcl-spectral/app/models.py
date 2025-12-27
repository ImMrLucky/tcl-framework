from pydantic import BaseModel, Field
from typing import List, Optional

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
