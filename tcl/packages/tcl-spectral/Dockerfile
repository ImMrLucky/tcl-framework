FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables to limit HuggingFace cache and reduce memory usage
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface
ENV HF_DATASETS_CACHE=/app/.cache/huggingface
ENV TOKENIZERS_PARALLELISM=false

# Copy requirements
COPY requirements.txt .

# Install PyTorch CPU-only first (smaller, ~200MB vs 2GB)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install other requirements
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model during build to avoid download during runtime
# This reduces memory spikes during first request
RUN python -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('cross-encoder/nli-distilroberta-base')" || echo "Model download failed, will download at runtime"

# Copy app code
COPY app ./app

# Create cache directory for ONNX models (persists during container lifetime)
RUN mkdir -p /app/.cache/nli_onnx

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
