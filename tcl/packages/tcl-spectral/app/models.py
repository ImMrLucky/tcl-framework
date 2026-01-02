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
    claimAId: Optional[str] = None  # Added: claim ID for claimA
    claimBId: Optional[str] = None  # Added: claim ID for claimB

class ClaimImportance(BaseModel):
    """Claim importance ranking data."""
    claimIndex: int
    claimId: Optional[str] = None  # Added: claim ID
    importanceScore: float
    centrality: float
    influence: float
    groundingDistance: int  # -1 if unreachable
    truthValue: float
    priority: str  # "CRITICAL", "HIGH", "MEDIUM"

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
    nodeBlameNorm: List[float]  # Added: normalized node blame (0..1)
    fingerprint: Optional[Dict[str, object]] = None
    # Claim importance ranking (new)
    rankedClaims: Optional[List[ClaimImportance]] = None
    topCriticalClaims: Optional[List[ClaimImportance]] = None


# ============================================================================
# NLI SCORING MODELS
# ============================================================================

class NliPair(BaseModel):
    """A premise-hypothesis pair to score."""
    premise: str
    hypothesis: str
    key: Optional[str] = None  # Optional identifier for the pair


class NliScore(BaseModel):
    """NLI score result for a single pair."""
    key: Optional[str] = None
    entailment: float
    neutral: float
    contradiction: float


class NliBatchRequest(BaseModel):
    """Batch NLI scoring request."""
    pairs: List[NliPair]


class NliBatchResponse(BaseModel):
    """Batch NLI scoring response."""
    scores: List[NliScore]
    model: str = "roberta-large-mnli"


class SourceIn(BaseModel):
    """An evidence source (transcript turn)."""
    id: str
    text: str


class BuildEdgesRequest(BaseModel):
    """Request to build graph edges from claims and sources using NLI."""
    claims: List[ClaimIn]
    sources: List[SourceIn] = []
    supportThreshold: float = Field(default=0.5, ge=0.0, le=1.0)
    contradictionThreshold: float = Field(default=0.5, ge=0.0, le=1.0)
    groundingThreshold: float = Field(default=0.4, ge=0.0, le=1.0)


class GroundingEdge(BaseModel):
    claimId: str
    sourceId: str
    weight: float
    quote: Optional[str] = None


class BuildEdgesResponse(BaseModel):
    """Response with computed graph edges."""
    supports: List[EdgeIn]
    contradictions: List[EdgeIn]
    grounding: List[GroundingEdge]
    groundedClaimIds: List[str]
    stats: Dict[str, int]
