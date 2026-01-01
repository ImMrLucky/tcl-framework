"""
NLI (Natural Language Inference) scorer using Hugging Face transformers.
This module provides high-quality entailment/contradiction/neutral scoring
for claim pairs, which feeds into the spectral analysis graph.
"""

from transformers import AutoModelForSequenceClassification, AutoTokenizer
import torch
import torch.nn.functional as F
from typing import List, Tuple, Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Global model instances (lazy loaded)
_model = None
_tokenizer = None
# Use smaller model to fit in Railway memory constraints (~300MB vs 2GB)
# cross-encoder/nli-distilroberta-base is specifically trained for NLI
_model_name = "cross-encoder/nli-distilroberta-base"
_device = None

# MNLI label mapping 
# For cross-encoder/nli-distilroberta-base: 0 = contradiction, 1 = entailment, 2 = neutral
LABEL_MAP = {0: "contradiction", 1: "entailment", 2: "neutral"}


def get_model_and_tokenizer():
    """Lazy load the NLI model and tokenizer."""
    global _model, _tokenizer, _device
    
    if _model is None:
        logger.info(f"Loading NLI model: {_model_name}...")
        try:
            _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            _tokenizer = AutoTokenizer.from_pretrained(_model_name)
            _model = AutoModelForSequenceClassification.from_pretrained(_model_name)
            _model.to(_device)
            _model.eval()
            logger.info(f"NLI model loaded successfully (device: {_device})")
        except Exception as e:
            logger.error(f"Failed to load NLI model: {e}")
            raise
    
    return _model, _tokenizer, _device


def score_pair(premise: str, hypothesis: str) -> Dict[str, float]:
    """
    Score a single premise-hypothesis pair.
    Returns dict with 'entailment', 'neutral', 'contradiction' probabilities.
    """
    model, tokenizer, device = get_model_and_tokenizer()
    
    # Tokenize the premise-hypothesis pair
    inputs = tokenizer(
        premise, 
        hypothesis, 
        return_tensors="pt", 
        truncation=True, 
        max_length=512,
        padding=True
    )
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    # Get model predictions
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits
        probs = F.softmax(logits, dim=-1)[0]
    
    # Map to labels based on model
    # cross-encoder/nli-distilroberta-base: 0=contradiction, 1=entailment, 2=neutral
    scores = {
        "contradiction": float(probs[0]),
        "entailment": float(probs[1]),
        "neutral": float(probs[2])
    }
    
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
    
    model, tokenizer, device = get_model_and_tokenizer()
    
    # Tokenize all pairs at once
    premises = [p for p, h in pairs]
    hypotheses = [h for p, h in pairs]
    
    inputs = tokenizer(
        premises,
        hypotheses,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True
    )
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    # Get model predictions
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits
        probs = F.softmax(logits, dim=-1)
    
    # Convert to list of score dicts
    # cross-encoder/nli-distilroberta-base: 0=contradiction, 1=entailment, 2=neutral
    all_scores = []
    for i in range(len(pairs)):
        scores = {
            "contradiction": float(probs[i][0]),
            "entailment": float(probs[i][1]),
            "neutral": float(probs[i][2])
        }
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

