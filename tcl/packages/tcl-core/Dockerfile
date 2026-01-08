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

# Build whisper.cpp from source
RUN cd /tmp && \
    echo "Cloning whisper.cpp..." && \
    git clone --depth 1 --branch master https://github.com/ggerganov/whisper.cpp.git && \
    cd whisper.cpp && \
    echo "Building whisper.cpp (this may take a few minutes)..." && \
    make || (echo "Build failed, trying single-threaded..." && make -j1) && \
    if [ ! -f main ]; then \
        echo "ERROR: main binary not found" && \
        ls -la && \
        exit 1; \
    fi && \
    cp main /app/vendor/whispercpp/main && \
    chmod +x /app/vendor/whispercpp/main && \
    echo "whisper.cpp built successfully" && \
    cd / && \
    rm -rf /tmp/whisper.cpp

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

