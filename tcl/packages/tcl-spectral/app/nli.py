"""
NLI (Natural Language Inference) scorer using Hugging Face transformers.
This module provides high-quality entailment/contradiction/neutral scoring
for claim pairs, which feeds into the spectral analysis graph.
"""

from transformers import pipeline, AutoModelForSequenceClassification, AutoTokenizer
import torch
from typing import List, Tuple, Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Global model instance (lazy loaded)
_nli_pipeline = None
_model_name = "roberta-large-mnli"  # Best for NLI tasks

def get_nli_pipeline():
    """Lazy load the NLI pipeline (downloads model on first call)."""
    global _nli_pipeline
    if _nli_pipeline is None:
        logger.info(f"Loading NLI model: {_model_name}...")
        try:
            # Use GPU if available
            device = 0 if torch.cuda.is_available() else -1
            _nli_pipeline = pipeline(
                "text-classification",
                model=f"FacebookAI/{_model_name}",
                device=device,
                top_k=None  # Return all labels with scores
            )
            logger.info(f"NLI model loaded successfully (device: {'GPU' if device == 0 else 'CPU'})")
        except Exception as e:
            logger.error(f"Failed to load NLI model: {e}")
            raise
    return _nli_pipeline


def score_pair(premise: str, hypothesis: str) -> Dict[str, float]:
    """
    Score a single premise-hypothesis pair.
    Returns dict with 'entailment', 'neutral', 'contradiction' probabilities.
    """
    pipe = get_nli_pipeline()
    
    # roberta-large-mnli expects: "premise </s></s> hypothesis"
    # But pipeline handles this automatically when using text pairs
    result = pipe({"text": premise, "text_pair": hypothesis})
    
    # Convert result to normalized dict
    scores = {"entailment": 0.0, "neutral": 0.0, "contradiction": 0.0}
    
    if isinstance(result, list):
        for item in result:
            if isinstance(item, list):
                for subitem in item:
                    label = subitem.get("label", "").lower()
                    score = subitem.get("score", 0.0)
                    if "entail" in label:
                        scores["entailment"] = score
                    elif "contrad" in label:
                        scores["contradiction"] = score
                    elif "neutral" in label:
                        scores["neutral"] = score
            else:
                label = item.get("label", "").lower()
                score = item.get("score", 0.0)
                if "entail" in label:
                    scores["entailment"] = score
                elif "contrad" in label:
                    scores["contradiction"] = score
                elif "neutral" in label:
                    scores["neutral"] = score
    
    return scores


def score_batch(pairs: List[Tuple[str, str]]) -> List[Dict[str, float]]:
    """
    Score multiple premise-hypothesis pairs in batch.
    More efficient than scoring one at a time.
    
    Args:
        pairs: List of (premise, hypothesis) tuples
        
    Returns:
        List of score dicts, each with 'entailment', 'neutral', 'contradiction'
    """
    if not pairs:
        return []
    
    pipe = get_nli_pipeline()
    
    # Format for pipeline batch processing
    inputs = [{"text": p, "text_pair": h} for p, h in pairs]
    
    try:
        results = pipe(inputs, batch_size=min(32, len(inputs)))
    except Exception as e:
        logger.error(f"Batch NLI scoring failed: {e}")
        # Fallback to individual scoring
        return [score_pair(p, h) for p, h in pairs]
    
    # Convert results
    all_scores = []
    for result in results:
        scores = {"entailment": 0.0, "neutral": 0.0, "contradiction": 0.0}
        
        if isinstance(result, list):
            for item in result:
                label = item.get("label", "").lower()
                score = item.get("score", 0.0)
                if "entail" in label:
                    scores["entailment"] = score
                elif "contrad" in label:
                    scores["contradiction"] = score
                elif "neutral" in label:
                    scores["neutral"] = score
        
        all_scores.append(scores)
    
    return all_scores


def build_edges_from_claims(
    claims: List[Dict[str, str]],
    sources: List[Dict[str, str]],
    support_threshold: float = 0.5,
    contradiction_threshold: float = 0.5,
    grounding_threshold: float = 0.4
) -> Dict:
    """
    Build graph edges from claims using NLI scoring.
    
    Args:
        claims: List of {"id": str, "text": str}
        sources: List of {"id": str, "text": str} (evidence sources from transcript)
        support_threshold: Min entailment score for support edge
        contradiction_threshold: Min contradiction score for contradiction edge
        grounding_threshold: Min entailment score for grounding edge
        
    Returns:
        Dict with 'supports', 'contradictions', 'grounding', 'groundedClaimIds'
    """
    supports = []
    contradictions = []
    grounding = []
    grounded_claim_ids = set()
    
    logger.info(f"Building edges from {len(claims)} claims and {len(sources)} sources")
    
    # 1. Claim-to-claim edges (support and contradiction)
    if len(claims) > 1:
        claim_pairs = []
        pair_indices = []
        
        for i, c1 in enumerate(claims):
            for j, c2 in enumerate(claims):
                if i < j:  # Only check each pair once
                    claim_pairs.append((c1["text"], c2["text"]))
                    pair_indices.append((i, j))
        
        if claim_pairs:
            logger.info(f"Scoring {len(claim_pairs)} claim-claim pairs...")
            scores = score_batch(claim_pairs)
            
            for (i, j), score in zip(pair_indices, scores):
                c1, c2 = claims[i], claims[j]
                
                # Support edge (high entailment)
                if score["entailment"] >= support_threshold:
                    supports.append({
                        "claimA": c1["id"],
                        "claimB": c2["id"],
                        "weight": score["entailment"]
                    })
                
                # Contradiction edge
                if score["contradiction"] >= contradiction_threshold:
                    contradictions.append({
                        "claimA": c1["id"],
                        "claimB": c2["id"],
                        "weight": score["contradiction"]
                    })
    
    # 2. Claim-to-source edges (grounding)
    if sources:
        grounding_pairs = []
        grounding_indices = []
        
        for i, claim in enumerate(claims):
            for j, source in enumerate(sources):
                grounding_pairs.append((source["text"], claim["text"]))  # source entails claim?
                grounding_indices.append((i, j))
        
        if grounding_pairs:
            logger.info(f"Scoring {len(grounding_pairs)} claim-source pairs for grounding...")
            scores = score_batch(grounding_pairs)
            
            for (claim_idx, source_idx), score in zip(grounding_indices, scores):
                claim = claims[claim_idx]
                source = sources[source_idx]
                
                # Grounding edge (source entails claim)
                if score["entailment"] >= grounding_threshold:
                    grounding.append({
                        "claimId": claim["id"],
                        "sourceId": source["id"],
                        "weight": score["entailment"],
                        "quote": source["text"][:200]
                    })
                    grounded_claim_ids.add(claim["id"])
    
    logger.info(f"Built edges: {len(supports)} supports, {len(contradictions)} contradictions, {len(grounding)} grounding")
    
    return {
        "supports": supports,
        "contradictions": contradictions,
        "grounding": grounding,
        "groundedClaimIds": list(grounded_claim_ids)
    }

