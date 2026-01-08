FROM node:18-slim

WORKDIR /app

# Install system dependencies: ffmpeg and build tools for whisper.cpp
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    build-essential \
    cmake \
    git \
    wget \
    pkg-config \
    file \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for whisper.cpp
ENV WHISPERCPP_BIN=/app/vendor/whispercpp/main
ENV WHISPERCPP_MODEL=/app/models/ggml-small.en.bin
ENV WHISPERCPP_THREADS=2
ENV WHISPERCPP_LANGUAGE=en
ENV FFMPEG_BIN=ffmpeg
ENV ASR_MAX_CONCURRENCY=1

# Create directories for whisper.cpp and models
RUN mkdir -p /app/vendor/whispercpp /app/models

# Download pre-built whisper.cpp binary from GitHub releases
# This avoids build issues and is faster
RUN cd /tmp && \
    echo "Downloading whisper.cpp binary..." && \
    wget -q https://github.com/ggerganov/whisper.cpp/releases/download/v1.6.1/whisper.cpp-v1.6.1-linux-x64.tar.gz -O whisper.tar.gz && \
    tar -xzf whisper.tar.gz && \
    if [ -f whisper.cpp-v1.6.1-linux-x64/main ]; then \
        cp whisper.cpp-v1.6.1-linux-x64/main /app/vendor/whispercpp/main && \
        chmod +x /app/vendor/whispercpp/main && \
        echo "whisper.cpp binary installed successfully"; \
    elif [ -f whisper.cpp-v1.6.1-linux-x64/whisper ]; then \
        cp whisper.cpp-v1.6.1-linux-x64/whisper /app/vendor/whispercpp/main && \
        chmod +x /app/vendor/whispercpp/main && \
        echo "whisper.cpp binary installed successfully"; \
    else \
        echo "ERROR: Could not find binary in release archive" && \
        ls -la whisper.cpp-v1.6.1-linux-x64/ 2>/dev/null || ls -la && \
        echo "Falling back to building from source..." && \
        git clone --depth 1 --branch v1.6.1 https://github.com/ggerganov/whisper.cpp.git whisper_build && \
        cd whisper_build && \
        make && \
        cp main /app/vendor/whispercpp/main && \
        chmod +x /app/vendor/whispercpp/main && \
        cd /tmp && \
        rm -rf whisper_build; \
    fi && \
    rm -rf /tmp/whisper.tar.gz /tmp/whisper.cpp-v1.6.1-linux-x64

# Download Whisper model (ggml-small.en.bin - ~466MB)
# You can change this to other models: tiny, base, small, medium, large
RUN cd /app/models && \
    wget -q https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin && \
    ls -lh /app/models/

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 8787

# Copy startup script
COPY start.sh ./
RUN chmod +x start.sh

# Start server
CMD ["./start.sh"]

