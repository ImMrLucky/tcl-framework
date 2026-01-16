from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from .models import (
    ExtractEntitiesRequest,
    ExtractEntitiesResponse,
    BatchExtractRequest,
    BatchExtractResponse,
    Entity
)
from .entity_extractor import extract_entities, extract_entities_cached, get_nlp
import logging
import time
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global state
_nlp_loaded = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: preload spaCy model to avoid cold start."""
    global _nlp_loaded
    
    logger.info("🚀 Starting up - preloading spaCy model...")
    start = time.time()
    
    try:
        # Load model
        model_name = os.getenv("SPACY_MODEL", "en_core_web_sm")
        nlp = get_nlp(model_name)
        
        # Warm up with a test extraction
        test_text = "There may be an early termination fee of $50."
        entities, _ = extract_entities(test_text, enable_coreference=False)
        
        elapsed = time.time() - start
        logger.info(f"✅ spaCy model preloaded in {elapsed:.1f}s")
        logger.info(f"   Model: {model_name}")
        logger.info(f"   Test extraction: {len(entities)} entities found")
        
        _nlp_loaded = True
    except Exception as e:
        logger.error(f"❌ spaCy model failed to load: {e}")
        logger.warning("⚠️ Service may still work, but first request will be slower")
        _nlp_loaded = False
    
    yield  # App runs here
    
    logger.info("👋 Shutting down")

app = FastAPI(title="TCL-NLP", version="0.1.0", lifespan=lifespan)

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
def health():
    """Health check endpoint."""
    try:
        nlp = get_nlp()
        model_name = os.getenv("SPACY_MODEL", "en_core_web_sm")
        
        return {
            "status": "ok",
            "version": "0.1.0",
            "spacy_loaded": _nlp_loaded,
            "model": model_name,
            "cache_size": extract_entities_cached.cache_info().currsize if hasattr(extract_entities_cached, 'cache_info') else 0
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

# ============================================================================
# ENTITY EXTRACTION ENDPOINTS
# ============================================================================

@app.post("/extract", response_model=ExtractEntitiesResponse)
def extract(req: ExtractEntitiesRequest):
    """
    Extract entities from one or more texts.
    
    Supports:
    - Named Entity Recognition (NER)
    - Custom domain patterns (fees, amounts, plans, etc.)
    - Coreference resolution (optional)
    - Caching for performance
    """
    try:
        use_cache = os.getenv("ENABLE_CACHE", "true").lower() == "true"
        enable_coref = req.enable_coreference
        
        all_results = []
        all_chains = []
        
        for text in req.texts:
            if use_cache:
                entities, chains = extract_entities_cached(text, enable_coref)
            else:
                entities, chains = extract_entities(text, enable_coref, req.custom_entities)
            
            # Convert to Entity models
            entity_models = [
                Entity(
                    type=e["type"],
                    value=e["value"],
                    normalized=e["normalized"],
                    span=e["span"],
                    confidence=e["confidence"],
                    coreference_id=e.get("coreference_id")
                )
                for e in entities
            ]
            
            all_results.append(entity_models)
            if chains:
                all_chains.extend(chains)
        
        return ExtractEntitiesResponse(
            results=all_results,
            coreference_chains=all_chains if all_chains else None
        )
    except Exception as e:
        logger.error(f"Entity extraction error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/extract/batch", response_model=BatchExtractResponse)
def extract_batch(req: BatchExtractRequest):
    """
    Batch extract entities from multiple texts (optimized for performance).
    
    Uses batch processing and caching for better throughput.
    """
    start_time = time.time()
    
    try:
        use_cache = os.getenv("ENABLE_CACHE", "true").lower() == "true"
        enable_coref = req.enable_coreference
        
        all_entities = []
        all_chains = []
        
        # Process in batches for better performance
        batch_size = int(os.getenv("BATCH_SIZE", "10"))
        
        for i in range(0, len(req.texts), batch_size):
            batch = req.texts[i:i + batch_size]
            
            for text in batch:
                if use_cache:
                    entities, chains = extract_entities_cached(text, enable_coref)
                else:
                    entities, chains = extract_entities(text, enable_coref)
                
                # Convert to Entity models
                entity_models = [
                    Entity(
                        type=e["type"],
                        value=e["value"],
                        normalized=e["normalized"],
                        span=e["span"],
                        confidence=e["confidence"],
                        coreference_id=e.get("coreference_id")
                    )
                    for e in entities
                ]
                
                all_entities.append(entity_models)
                if chains:
                    all_chains.extend(chains)
        
        elapsed_ms = (time.time() - start_time) * 1000
        
        return BatchExtractResponse(
            entities=all_entities,
            coreference_chains=all_chains if all_chains else None,
            processing_time_ms=round(elapsed_ms, 2)
        )
    except Exception as e:
        logger.error(f"Batch extraction error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/test")
def test():
    """Test endpoint with sample extraction."""
    test_texts = [
        "There may be an early termination fee of $50.",
        "The fee is $50 if you cancel before the end of your promotional period.",
        "It applies to all customers."
    ]
    
    try:
        results = []
        for text in test_texts:
            entities, chains = extract_entities(text, enable_coreference=True)
            results.append({
                "text": text,
                "entities": entities,
                "coreference_chains": chains
            })
        
        return {
            "status": "ok",
            "results": results
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

