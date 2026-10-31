/**
 * Application Entry Point
 * Multi-Document Question Answering RAG System with a Vector Database
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const VectorStore = require('./database/vector_store');
const RelationalDatabase = require('./database/relational');
const EmbeddingService = require('./services/embedding');
const { LLMService } = require('./services/llm');
const RagOrchestrator = require('./core/rag');
const createRouter = require('./api/routes');

// Initialize database & service components
const vectorStore = new VectorStore({
  storagePath: process.env.VECTOR_STORE_PATH || './data/vectors.json',
  similarityThreshold: Number(process.env.VECTOR_SIMILARITY_THRESHOLD) || 0.65,
  topK: Number(process.env.TOP_K) || 5
});

const relationalDb = new RelationalDatabase(
  process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace('sqlite:///', '')
    : './data/rag_history.db'
);

const embeddingService = new EmbeddingService();
const llmService = new LLMService();

const ragOrchestrator = new RagOrchestrator({
  vectorStore,
  relationalDb,
  embeddingService,
  llmService,
  chunkSize: Number(process.env.CHUNK_SIZE) || 1000,
  chunkOverlap: Number(process.env.CHUNK_OVERLAP) || 200,
  similarityThreshold: Number(process.env.VECTOR_SIMILARITY_THRESHOLD) || 0.65,
  topK: Number(process.env.TOP_K) || 5
});

// Configure Express application
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Mount API routes
app.use('/api', createRouter(ragOrchestrator));

// Serve Frontend client
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  VeriRAG System Server Active on port ${PORT}`);
    console.log(`  Web Interface:    http://localhost:${PORT}`);
    console.log(`  API Upload:       http://localhost:${PORT}/api/upload`);
    console.log(`  API Chat:         http://localhost:${PORT}/api/chat`);
    console.log(`  API Health:       http://localhost:${PORT}/api/health`);
    console.log(`=======================================================`);
  });
}

module.exports = {
  app,
  server,
  ragOrchestrator,
  vectorStore,
  relationalDb,
  embeddingService,
  llmService
};
