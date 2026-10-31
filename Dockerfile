# Multi-stage or lightweight Node.js runtime for VeriRAG system
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Install dependencies first for Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY src/ ./src/
COPY public/ ./public/
COPY .env.example ./.env.example
COPY README.md ./README.md

# Ensure data directory exists
RUN mkdir -p /app/data

# Expose the application port
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the RAG server
CMD ["node", "src/index.js"]
