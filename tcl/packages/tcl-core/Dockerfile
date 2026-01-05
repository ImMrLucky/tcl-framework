FROM node:18-alpine

WORKDIR /app

# Set environment variables to force WASM-only mode for transformers.js
# This prevents onnxruntime-node from trying to load native bindings
# Required for Alpine Linux and other minimal container environments
ENV USE_WASM=1
ENV ONNXRUNTIME_EXECUTION_PROVIDERS=""
ENV ONNXRUNTIME_DISABLE_NATIVE=1
ENV TRANSFORMERS_USE_WASM=1
ENV USE_BROWSER=0
ENV USE_WASM_ONLY=1

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

# Start server using startup script (sets WASM env vars)
CMD ["./start.sh"]

