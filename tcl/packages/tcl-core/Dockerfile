FROM node:18-alpine

WORKDIR /app

# Set environment variable to force WASM-only mode for transformers.js
# This prevents onnxruntime-node from trying to load native bindings
ENV USE_WASM=1
ENV ONNXRUNTIME_EXECUTION_PROVIDERS=""

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

# Start server
CMD ["node", "dist/server/express.js"]

