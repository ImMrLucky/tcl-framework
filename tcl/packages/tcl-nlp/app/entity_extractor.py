"""
spaCy-based entity extraction with coreference resolution.

This module provides enhanced entity extraction using spaCy's NER,
dependency parsing, and optional coreference resolution.
"""

import spacy
from spacy.tokens import Doc, Span
from typing import List, Dict, Any, Optional, Tuple
import logging
import hashlib
from functools import lru_cache

logger = logging.getLogger(__name__)

# Global spaCy model (loaded lazily)
_nlp = None
_nlp_model_name = "en_core_web_sm"  # Start with small model for speed

def get_nlp(model_name: Optional[str] = None) -> spacy.Language:
    """Get or load the spaCy NLP model."""
    global _nlp, _nlp_model_name
    
    if model_name:
        _nlp_model_name = model_name
    
    if _nlp is None:
        try:
            logger.info(f"Loading spaCy model: {_nlp_model_name}")
            _nlp = spacy.load(_nlp_model_name)
            
            # Add custom entity ruler for domain-specific entities
            if "entity_ruler" not in _nlp.pipe_names:
                ruler = _nlp.add_pipe("entity_ruler", before="ner")
                ruler.add_patterns(_get_domain_patterns())
            
            logger.info(f"✅ spaCy model loaded: {_nlp_model_name}")
        except OSError:
            logger.error(f"❌ Model {_nlp_model_name} not found. Install with: python -m spacy download {_nlp_model_name}")
            raise
    
    return _nlp

def _get_domain_patterns() -> List[Dict[str, Any]]:
    """Domain-specific entity patterns for call center/telecom domain."""
    return [
        # Fees
        {"label": "FEE", "pattern": [{"LOWER": {"IN": ["fee", "charge", "cost", "penalty"]}}]},
        {"label": "FEE", "pattern": "early termination fee"},
        {"label": "FEE", "pattern": "cancellation fee"},
        {"label": "FEE", "pattern": "service adjustment fee"},
        {"label": "FEE", "pattern": "late fee"},
        {"label": "FEE", "pattern": "activation fee"},
        
        # Amounts
        {"label": "AMOUNT", "pattern": [{"TEXT": {"REGEX": r"\$\d+(?:\.\d{2})?"}}]},
        {"label": "AMOUNT", "pattern": [{"LIKE_NUM": True}, {"LOWER": {"IN": ["dollars", "cents", "percent", "%"]}}]},
        
        # Plans
        {"label": "PLAN", "pattern": [{"LOWER": {"IN": ["plan", "package", "subscription", "service", "tier"]}}]},
        {"label": "PLAN", "pattern": [{"LOWER": "premium"}, {"LOWER": "plan"}]},
        {"label": "PLAN", "pattern": [{"LOWER": "basic"}, {"LOWER": "plan"}]},
        
        # Time periods
        {"label": "TIME_PERIOD", "pattern": [{"LOWER": {"IN": ["cycle", "month", "year", "period", "today", "tomorrow"]}}]},
        {"label": "TIME_PERIOD", "pattern": [{"LOWER": "billing"}, {"LOWER": "cycle"}]},
        {"label": "TIME_PERIOD", "pattern": [{"LOWER": "promotional"}, {"LOWER": "period"}]},
        
        # Documents
        {"label": "DOCUMENT", "pattern": [{"LOWER": {"IN": ["email", "confirmation", "receipt", "invoice", "statement"]}}]},
        
        # Actions
        {"label": "ACTION", "pattern": [{"LOWER": {"IN": ["cancel", "canceled", "cancelled", "refund", "credit", "apply"]}}]},
    ]

def extract_entities(
    text: str,
    enable_coreference: bool = True,
    custom_patterns: Optional[List[Dict[str, Any]]] = None
) -> Tuple[List[Dict[str, Any]], Optional[List[List[str]]]]:
    """
    Extract entities from text using spaCy.
    
    Returns:
        - List of entities (each with type, value, normalized, span, confidence)
        - Optional coreference chains (groups of entity IDs that refer to the same thing)
    """
    nlp = get_nlp()
    
    # Process text
    doc = nlp(text)
    
    entities = []
    entity_id_map = {}  # Maps (start, end) -> entity_id for coreference
    
    # Extract named entities from spaCy
    for ent in doc.ents:
        normalized = _normalize_entity(ent.text, ent.label_)
        entity_id = f"ent_{ent.start_char}_{ent.end_char}"
        
        entity = {
            "type": ent.label_,
            "value": ent.text,
            "normalized": normalized,
            "span": {"start": ent.start_char, "end": ent.end_char},
            "confidence": 0.9,  # spaCy NER confidence
            "coreference_id": entity_id
        }
        entities.append(entity)
        entity_id_map[(ent.start_char, ent.end_char)] = entity_id
    
    # Extract custom domain entities (from entity ruler)
    # These are already in doc.ents, but we can add more from patterns
    if custom_patterns:
        # Temporarily add custom patterns
        ruler = nlp.get_pipe("entity_ruler")
        original_patterns = ruler.patterns.copy()
        ruler.add_patterns(custom_patterns)
        
        # Re-process to get custom entities
        doc_custom = nlp(text)
        for ent in doc_custom.ents:
            # Skip if already added
            if (ent.start_char, ent.end_char) not in entity_id_map:
                normalized = _normalize_entity(ent.text, ent.label_)
                entity_id = f"ent_{ent.start_char}_{ent.end_char}"
                
                entity = {
                    "type": ent.label_,
                    "value": ent.text,
                    "normalized": normalized,
                    "span": {"start": ent.start_char, "end": ent.end_char},
                    "confidence": 0.85,
                    "coreference_id": entity_id
                }
                entities.append(entity)
                entity_id_map[(ent.start_char, ent.end_char)] = entity_id
        
        # Restore original patterns
        ruler.patterns = original_patterns
    
    # Extract noun chunks (for better entity coverage)
    for chunk in doc.noun_chunks:
        # Skip if already covered by an entity
        if any(e["span"]["start"] <= chunk.start_char < e["span"]["end"] 
               for e in entities):
            continue
        
        # Check if it's a relevant noun chunk (has money, fee, plan, etc.)
        chunk_lower = chunk.text.lower()
        if any(keyword in chunk_lower for keyword in ["fee", "charge", "plan", "price", "amount", "refund"]):
            normalized = _normalize_entity(chunk.text, "NOUN_CHUNK")
            entity_id = f"chunk_{chunk.start_char}_{chunk.end_char}"
            
            entity = {
                "type": "NOUN_CHUNK",
                "value": chunk.text,
                "normalized": normalized,
                "span": {"start": chunk.start_char, "end": chunk.end_char},
                "confidence": 0.7,
                "coreference_id": entity_id
            }
            entities.append(entity)
            entity_id_map[(chunk.start_char, chunk.end_char)] = entity_id
    
    # Coreference resolution (if enabled)
    coreference_chains = None
    if enable_coreference:
        try:
            # Try to use neuralcoref if available
            if hasattr(doc._, "coref_clusters"):
                coreference_chains = []
                for cluster in doc._.coref_clusters:
                    chain = []
                    for mention in cluster.mentions:
                        # Find entity IDs for this mention
                        for (start, end), eid in entity_id_map.items():
                            if start <= mention.start_char < end:
                                chain.append(eid)
                    if len(chain) > 1:  # Only add chains with multiple mentions
                        coreference_chains.append(chain)
        except Exception as e:
            logger.warning(f"Coreference resolution failed: {e}")
            # Fall back to simple pronoun resolution
            coreference_chains = _simple_coreference_resolution(doc, entities, entity_id_map)
    
    # Deduplicate overlapping entities (keep highest confidence)
    entities = _deduplicate_entities(entities)
    
    return entities, coreference_chains

def _normalize_entity(text: str, label: str) -> str:
    """Normalize entity text for comparison."""
    normalized = text.lower().strip()
    normalized = " ".join(normalized.split())  # Collapse whitespace
    
    # Special handling for money
    if label == "MONEY" or "$" in text:
        # Extract numeric value
        import re
        match = re.search(r'\$?(\d+(?:\.\d{2})?)', text)
        if match:
            return f"amount_{match.group(1)}"
    
    # Replace spaces with underscores for consistency
    normalized = normalized.replace(" ", "_")
    
    return normalized

def _simple_coreference_resolution(
    doc: Doc,
    entities: List[Dict[str, Any]],
    entity_id_map: Dict[Tuple[int, int], str]
) -> List[List[str]]:
    """
    Simple coreference resolution using dependency parsing.
    
    Resolves pronouns (it, that, this, the fee) to their antecedents.
    """
    chains = []
    
    # Find pronouns and link them to nearby entities
    for token in doc:
        if token.pos_ == "PRON" and token.text.lower() in ["it", "that", "this", "the"]:
            # Look for nearby entities (within 10 tokens)
            pronoun_start = token.idx
            pronoun_end = token.idx + len(token.text)
            
            # Find closest entity before the pronoun
            closest_entity = None
            min_distance = float('inf')
            
            for entity in entities:
                entity_end = entity["span"]["end"]
                if entity_end < pronoun_start:
                    distance = pronoun_start - entity_end
                    if distance < min_distance and distance < 100:  # Within 100 chars
                        min_distance = distance
                        closest_entity = entity
            
            if closest_entity:
                pronoun_id = f"pron_{pronoun_start}_{pronoun_end}"
                entity_id = closest_entity.get("coreference_id")
                if entity_id:
                    # Add to existing chain or create new
                    found_chain = False
                    for chain in chains:
                        if entity_id in chain:
                            chain.append(pronoun_id)
                            found_chain = True
                            break
                    
                    if not found_chain:
                        chains.append([entity_id, pronoun_id])
    
    return chains if chains else None

def _deduplicate_entities(entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove overlapping entities, keeping highest confidence."""
    # Sort by start position, then by confidence (descending)
    entities.sort(key=lambda e: (e["span"]["start"], -e["confidence"]))
    
    result = []
    last_end = -1
    
    for entity in entities:
        start = entity["span"]["start"]
        end = entity["span"]["end"]
        
        # Skip if overlaps with previous (which has higher or equal confidence)
        if start < last_end:
            continue
        
        result.append(entity)
        last_end = end
    
    return result

@lru_cache(maxsize=10000)
def _cached_extract(text_hash: str, text: str, enable_coref: bool) -> Tuple[tuple, Optional[tuple]]:
    """
    Cached version of extract_entities.
    Note: Returns tuples for hashability, caller should convert back to dicts.
    """
    entities, chains = extract_entities(text, enable_coref)
    # Convert to tuples for caching
    entities_tuple = tuple(tuple(e.items()) for e in entities)
    chains_tuple = tuple(tuple(c) for c in chains) if chains else None
    return entities_tuple, chains_tuple

def extract_entities_cached(
    text: str,
    enable_coreference: bool = True
) -> Tuple[List[Dict[str, Any]], Optional[List[List[str]]]]:
    """Extract entities with caching."""
    text_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
    
    entities_tuple, chains_tuple = _cached_extract(text_hash, text, enable_coreference)
    
    # Convert back to dicts
    entities = [dict(e) for e in entities_tuple]
    chains = [list(c) for c in chains_tuple] if chains_tuple else None
    
    return entities, chains

