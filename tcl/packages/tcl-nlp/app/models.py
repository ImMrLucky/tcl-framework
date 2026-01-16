from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class Entity(BaseModel):
    type: str
    value: str
    normalized: str
    span: Dict[str, int]  # {start: int, end: int}
    confidence: float
    coreference_id: Optional[str] = None  # Links to other entities via coreference

class ExtractEntitiesRequest(BaseModel):
    texts: List[str]
    enable_coreference: bool = True
    custom_entities: Optional[List[Dict[str, Any]]] = None  # Custom entity patterns

class ExtractEntitiesResponse(BaseModel):
    results: List[List[Entity]]  # One list of entities per input text
    coreference_chains: Optional[List[List[str]]] = None  # Groups of coreferent entity IDs

class BatchExtractRequest(BaseModel):
    texts: List[str]
    enable_coreference: bool = True

class BatchExtractResponse(BaseModel):
    entities: List[List[Entity]]
    coreference_chains: Optional[List[List[str]]] = None
    processing_time_ms: float

