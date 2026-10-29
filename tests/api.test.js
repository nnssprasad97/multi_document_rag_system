/**
 * API Integration Tests
 * Validates HTTP endpoints:
 * - POST /api/upload (multipart form data)
 * - POST /api/chat
 * - GET /api/documents
 * - GET /api/health
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const cors = require('cors');

const VectorStore = require('../src/database/vector_store');
const RelationalDatabase = require('../src/database/relational');
const EmbeddingService = require('../src/services/embedding');
const { LLMService, FALLBACK_MESSAGE } = require('../src/services/llm');
const RagOrchestrator = require('../src/core/rag');
const createRouter = require('../src/api/routes');
const { createTestPdf } = require('./test_helpers');

describe('API Endpoints Integration', () => {
  let server;
  let port;
  let baseUrl;

  before(async () => {
    const testVectorPath = './data/api_test_vectors.json';
    const testDbPath = './data/api_test_history.db';

    const vectorStore = new VectorStore({
      storagePath: testVectorPath,
      similarityThreshold: 0.60,
      topK: 5
    });
    const relationalDb = new RelationalDatabase(testDbPath);
    const embeddingService = new EmbeddingService();
    const llmService = new LLMService();

    const orchestrator = new RagOrchestrator({
      vectorStore,
      relationalDb,
      embeddingService,
      llmService,
      chunkSize: 1000,
      chunkOverlap: 200,
      similarityThreshold: 0.60,
      topK: 5
    });

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api', createRouter(orchestrator));

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('GET /api/health returns healthy status and system config', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.status, 'healthy');
    assert.ok(data.config);
    assert.strictEqual(typeof data.vector_count, 'number');
  });

  test('POST /api/upload handles multipart PDF upload successfully', async () => {
    const pdfBuf = await createTestPdf([
      'Remote Work Policy: Employees may work from home up to 2 days per week.'
    ]);

    const formData = new FormData();
    const blob = new Blob([pdfBuf], { type: 'application/pdf' });
    formData.append('files', blob, 'remote_policy.pdf');

    const res = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: formData
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.documents_processed, 1);
    assert.ok(data.documents[0].document_id);
    assert.strictEqual(data.documents[0].filename, 'remote_policy.pdf');
  });

  test('GET /api/documents returns the list of uploaded documents', async () => {
    const res = await fetch(`${baseUrl}/documents`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.documents));
    assert.ok(data.documents.length >= 1);
    assert.strictEqual(data.documents[0].filename, 'remote_policy.pdf');
  });

  test('POST /api/chat answers questions based on uploaded documents with citations', async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'How many days per week can employees work from home?'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.ok(data.answer);
    assert.notStrictEqual(data.answer, FALLBACK_MESSAGE);
    assert.ok(Array.isArray(data.citations));
    assert.ok(data.citations.length >= 1);
    assert.strictEqual(data.citations[0].document_name, 'remote_policy.pdf');
    assert.strictEqual(data.citations[0].page_number, 1);
    assert.ok(data.session_id);
  });

  test('POST /api/chat fails gracefully on out of scope query', async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'What is the speed of light in a vacuum?'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.answer, FALLBACK_MESSAGE);
    assert.strictEqual(data.citations.length, 0);
  });
});
