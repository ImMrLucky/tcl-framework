"""
NLI (Natural Language Inference) scorer using ONNX Runtime for fast CPU inference.
This module provides high-quality entailment/contradiction/neutral scoring
for claim pairs, which feeds into the spectral analysis graph.

Uses ONNX Runtime for 2-4x faster inference on CPU compared to PyTorch.
"""

from transformers import AutoTokenizer
import numpy as np
from typing import List, Tuple, Dict, Optional
import logging
import os
import traceback
import warnings

logger = logging.getLogger(__name__)

# Suppress noisy warnings from transformers/optimum during ONNX conversion
# These warnings are harmless - they're just the library being verbose about internal operations
warnings.filterwarnings("ignore", message=".*torch_dtype.*")
warnings.filterwarnings("ignore", message=".*already converted to ONNX.*")
warnings.filterwarnings("ignore", message=".*TracerWarning.*")
warnings.filterwarnings("ignore", message=".*file_name.*will be ignored.*")

# Global instances (lazy loaded)
_session = None
_tokenizer = None
_use_onnx = os.getenv("USE_ONNX", "true").lower() == "true"  # Can be disabled via env var
_onnx_error = None  # Store error for diagnostics
_model_loaded = False

# Model name - cross-encoder/nli-distilroberta-base is fast and accurate
_model_name = "cross-encoder/nli-distilroberta-base"


def get_status() -> Dict:
    """Get current NLI module status for health checks."""
    return {
        "model_name": _model_name,
        "model_loaded": _model_loaded,
        "using_onnx": _use_onnx,
        "onnx_error": _onnx_error
    }


def get_onnx_session():
    """Get ONNX Runtime session for fast inference."""
    global _session, _tokenizer, _use_onnx, _onnx_error, _model_loaded
    
    if _session is not None:
        return _session, _tokenizer
    
    try:
        from optimum.onnxruntime import ORTModelForSequenceClassification
        import onnxruntime as ort
        
        logger.info(f"Loading NLI model with ONNX Runtime: {_model_name}...")
        
        # Use a more persistent cache location
        # Prefer /app/.cache (inside container, persists if volume mounted) or fallback to /tmp
        cache_base = os.getenv("ONNX_CACHE_DIR", "/app/.cache")
        cache_dir = os.path.join(cache_base, "nli_onnx")
        os.makedirs(cache_dir, exist_ok=True)
        
        logger.info(f"Using ONNX cache directory: {cache_dir}")
        
        # Check if ONNX model files actually exist in cache
        model_onnx_path = os.path.join(cache_dir, "model.onnx")
        config_path = os.path.join(cache_dir, "config.json")
        cache_exists = os.path.exists(model_onnx_path) and os.path.exists(config_path)
        
        logger.info(f"Cache check: model_onnx_path={model_onnx_path}, exists={os.path.exists(model_onnx_path)}")
        logger.info(f"Cache check: config_path={config_path}, exists={os.path.exists(config_path)}")
        logger.info(f"Cache exists: {cache_exists}")
        
        if cache_exists:
            try:
                logger.info(f"Loading ONNX model from cache: {cache_dir}")
                _session = ORTModelForSequenceClassification.from_pretrained(
                    cache_dir,
                    file_name="model.onnx"
                )
                logger.info("✅ Loaded ONNX model from cache")
            except Exception as cache_err:
                logger.warning(f"Cache load failed (will re-export): {cache_err}")
                cache_exists = False  # Force re-export
        
        if not cache_exists:
            # Convert PyTorch model to ONNX
            # This is memory-intensive, so we do it lazily (only when first needed)
            logger.info("Converting model to ONNX (one-time operation, may take 1-2 minutes and use significant memory)...")
            logger.warning("⚠️ ONNX conversion uses 2-4GB memory. If OOM occurs, set USE_ONNX=false to skip.")
            
            try:
                # Force garbage collection before conversion to free up memory
                import gc
                gc.collect()
                
                # Suppress warnings during conversion
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    # Convert model to ONNX
                    # Note: This is memory-intensive. If OOM occurs, it will fall back to PyTorch
                    # Use low_memory mode if available
                    _session = ORTModelForSequenceClassification.from_pretrained(
                        _model_name,
                        export=True,
                    )
                
                # Force garbage collection after conversion to free PyTorch model memory
                gc.collect()
                
                # Save for next time
                logger.info(f"Saving ONNX model to cache: {cache_dir}")
                _session.save_pretrained(cache_dir)
                
                # Verify save succeeded
                if os.path.exists(model_onnx_path):
                    logger.info(f"✅ ONNX model saved to cache ({os.path.getsize(model_onnx_path) / 1024 / 1024:.1f} MB)")
                else:
                    logger.warning("⚠️ ONNX model save may have failed - cache file not found after save")
            except MemoryError as mem_err:
                logger.error(f"❌ Out of memory during ONNX conversion: {mem_err}")
                logger.warning("⚠️ Falling back to PyTorch (slower but uses less memory)")
                _use_onnx = False
                _onnx_error = f"MemoryError during conversion: {mem_err}"
                return get_pytorch_model()
            except Exception as conv_err:
                logger.error(f"❌ ONNX conversion failed: {conv_err}")
                logger.warning("⚠️ Falling back to PyTorch")
                _use_onnx = False
                _onnx_error = f"{type(conv_err).__name__}: {conv_err}"
                return get_pytorch_model()
        
        _tokenizer = AutoTokenizer.from_pretrained(_model_name)
        
        # Log optimization info
        providers = ort.get_available_providers()
        logger.info(f"ONNX Runtime providers: {providers}")
        logger.info("✅ NLI model loaded with ONNX Runtime (2-4x faster than PyTorch)")
        _model_loaded = True
        
        return _session, _tokenizer
        
    except ImportError as e:
        _onnx_error = f"ImportError: {e}"
        logger.warning(f"ONNX Runtime not available: {e}")
        logger.warning("Falling back to PyTorch (slower)")
        _use_onnx = False
        return get_pytorch_model()
    except Exception as e:
        _onnx_error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        logger.error(f"Error loading ONNX model: {e}")
        logger.error(traceback.format_exc())
        logger.warning("Falling back to PyTorch")
        _use_onnx = False
        return get_pytorch_model()


def get_pytorch_model():
    """Fallback to PyTorch model if ONNX not available."""
    global _session, _tokenizer, _model_loaded
    
    import torch
    from transformers import AutoModelForSequenceClassification
    import gc
    
    logger.info(f"Loading PyTorch NLI model: {_model_name}...")
    
    # Force garbage collection before loading
    gc.collect()
    
    device = torch.device("cpu")  # Force CPU
    _tokenizer = AutoTokenizer.from_pretrained(_model_name)
    _session = AutoModelForSequenceClassification.from_pretrained(_model_name)
    _session.to(device)
    _session.eval()
    
    # Force garbage collection after loading
    gc.collect()
    
    logger.info("⚠️ PyTorch NLI model loaded (slower than ONNX)")
    _model_loaded = True
    
    return _session, _tokenizer


def softmax(x):
    """Compute softmax values for numpy array."""
    exp_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return exp_x / np.sum(exp_x, axis=-1, keepdims=True)


def score_batch_onnx(pairs: List[Tuple[str, str]]) -> List[Dict[str, float]]:
    """Score batch using ONNX Runtime."""
    session, tokenizer = get_onnx_session()
    
    if not _use_onnx:
        return score_batch_pytorch(pairs)
    
    premises = [p for p, h in pairs]
    hypotheses = [h for p, h in pairs]
    
    # Tokenize
    inputs = tokenizer(
        premises,
        hypotheses,
        return_tensors="np",
        truncation=True,
        max_length=256,  # Reduced for speed
        padding=True
    )
    
    # Run inference
    outputs = session(**inputs)
    logits = outputs.logits if hasattr(outputs, 'logits') else outputs[0]
    
    if hasattr(logits, 'numpy'):
        logits = logits.numpy()
    
    probs = softmax(logits)
    
    # Map to scores: 0=contradiction, 1=entailment, 2=neutral
    all_scores = []
    for i in range(len(pairs)):
        scores = {
            "contradiction": float(probs[i][0]),
            "entailment": float(probs[i][1]),
            "neutral": float(probs[i][2])
        }
        all_scores.append(scores)
    
    return all_scores


def score_batch_pytorch(pairs: List[Tuple[str, str]]) -> List[Dict[str, float]]:
    """Score batch using PyTorch (fallback)."""
    import torch
    import torch.nn.functional as F
    
    model, tokenizer = get_pytorch_model()
    
    premises = [p for p, h in pairs]
    hypotheses = [h for p, h in pairs]
    
    inputs = tokenizer(
        premises,
        hypotheses,
        return_tensors="pt",
        truncation=True,
        max_length=256,
        padding=True
    )
    
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits
        probs = F.softmax(logits, dim=-1)
    
    all_scores = []
    for i in range(len(pairs)):
        scores = {
            "contradiction": float(probs[i][0]),
            "entailment": float(probs[i][1]),
            "neutral": float(probs[i][2])
        }
        all_scores.append(scores)
    
    return all_scores


def score_batch(pairs: List[Tuple[str, str]]) -> List[Dict[str, float]]:
    """
    Score multiple premise-hypothesis pairs in batch.
    Uses ONNX Runtime for fast inference, with PyTorch fallback.
    
    Args:
        pairs: List of (premise, hypothesis) tuples
        
    Returns:
        List of score dicts, each with 'entailment', 'neutral', 'contradiction'
    """
    if not pairs:
        return []
    
    # Process in smaller batches to avoid memory issues
    MAX_BATCH = 32
    all_scores = []
    
    for i in range(0, len(pairs), MAX_BATCH):
        batch = pairs[i:i + MAX_BATCH]
        if _use_onnx:
            scores = score_batch_onnx(batch)
        else:
            scores = score_batch_pytorch(batch)
        all_scores.extend(scores)
    
    return all_scores


def score_pair(premise: str, hypothesis: str) -> Dict[str, float]:
    """Score a single premise-hypothesis pair."""
    results = score_batch([(premise, hypothesis)])
    return results[0] if results else {"entailment": 0, "neutral": 0, "contradiction": 0}


def build_edges_from_claims(
    claims: List[Dict[str, str]],
    sources: List[Dict[str, str]],
    support_threshold: float = 0.5,
    contradiction_threshold: float = 0.5,
    grounding_threshold: float = 0.4
) -> Dict:
    """
    Build graph edges from claims using NLI scoring.
    """
    supports = []
    contradictions = []
    grounding = []
    grounded_claim_ids = set()
    
    logger.info(f"Building edges from {len(claims)} claims and {len(sources)} sources")
    
    # 1. Claim-to-claim edges
    if len(claims) > 1:
        claim_pairs = []
        pair_indices = []
        
        for i, c1 in enumerate(claims):
            for j, c2 in enumerate(claims):
                if i < j:
                    claim_pairs.append((c1["text"], c2["text"]))
                    pair_indices.append((i, j))
        
        if claim_pairs:
            logger.info(f"Scoring {len(claim_pairs)} claim-claim pairs...")
            scores = score_batch(claim_pairs)
            
            for (i, j), score in zip(pair_indices, scores):
                c1, c2 = claims[i], claims[j]
                
                if score["entailment"] >= support_threshold:
                    supports.append({
                        "claimA": c1["id"],
                        "claimB": c2["id"],
                        "weight": score["entailment"]
                    })
                
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
                grounding_pairs.append((source["text"], claim["text"]))
                grounding_indices.append((i, j))
        
        if grounding_pairs:
            logger.info(f"Scoring {len(grounding_pairs)} grounding pairs...")
            scores = score_batch(grounding_pairs)
            
            for (claim_idx, source_idx), score in zip(grounding_indices, scores):
                claim = claims[claim_idx]
                source = sources[source_idx]
                
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
