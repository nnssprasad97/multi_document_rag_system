/**
 * Comprehensive Error Handling & Edge Cases Test Suite
 * Tests system resilience against invalid inputs, malformed files, boundary conditions,
 * and unsupported formats.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

const VectorStore = require('../src/database/vector_store');
const RelationalDatabase = require('../src/database/relational');
const EmbeddingService = require('../src/services/embedding');
const { LLMService, FALLBACK_MESSAGE } = require('../src/services/llm');
const DocumentService = require('../src/services/document');
const { chunkDocument } = require('../src/services/chunking');
const RagOrchestrator = require('../src/core/rag');
const createRouter = require('../src/api/routes');

describe('Error Handling and Edge Cases', () => {
  let server;
  let baseUrl;

  before(async () => {
    const testVectorPath = './data/err_test_vectors.json';
    const testDbPath = './data/err_test_history.db';

    const vectorStore = new VectorStore({
      storagePath: testVectorPath,
      similarityThreshold: 0.65,
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
      similarityThreshold: 0.65,
      topK: 5
    });

    const app = express();
    app.use(express.json());
    app.use('/api', createRouter(orchestrator));

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('POST /api/upload returns 400 when no files are provided in multipart form', async () => {
    const formData = new FormData();
    const res = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: formData
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('No files uploaded'));
  });

  test('POST /api/upload rejects unsupported file formats (.txt, .exe, .zip) with 400', async () => {
    const formData = new FormData();
    const textBlob = new Blob(['Plain text file content'], { type: 'text/plain' });
    formData.append('files', textBlob, 'notes.txt');

    const res = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: formData
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('Only .pdf and .docx files are permitted'));
  });

  test('POST /api/chat returns 400 when query is missing or empty', async () => {
    // Missing query field
    const res1 = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res1.status, 400);
    const data1 = await res1.json();
    assert.ok(data1.error.includes('query'));

    // Empty whitespace-only query
    const res2 = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '   \n  \t  ' })
    });
    assert.strictEqual(res2.status, 400);
  });

  test('DocumentService strictly rejects unsupported MIME types and file extensions', () => {
    assert.throws(
      () => DocumentService.validateFileType('spreadsheet.xlsx', 'application/vnd.ms-excel'),
      /Unsupported file format/
    );
    assert.throws(
      () => DocumentService.validateFileType('binary.exe', 'application/octet-stream'),
      /Unsupported file format/
    );
  });

  test('chunkDocument gracefully handles null, undefined, or empty inputs', () => {
    assert.deepStrictEqual(chunkDocument(null), []);
    assert.deepStrictEqual(chunkDocument(undefined), []);
    assert.deepStrictEqual(chunkDocument(''), []);
    assert.deepStrictEqual(chunkDocument('    \t\n  '), []);
  });

  test('VectorStore safely handles empty or mismatched query vectors', async () => {
    const vs = new VectorStore({ storagePath: './data/err_vs.json' });
    const emptyResults = await vs.retrieveContext([]);
    assert.deepStrictEqual(emptyResults, []);

    const nullResults = await vs.retrieveContext(null);
    assert.deepStrictEqual(nullResults, []);
  });

  test('LLMService returns deterministic fallback message on empty context chunks', async () => {
    const llm = new LLMService();
    const result = await llm.generateResponse({
      query: 'What are the company guidelines?',
      contextChunks: []
    });

    assert.strictEqual(result.answer, FALLBACK_MESSAGE);
    assert.deepStrictEqual(result.citations, []);
  });
});
