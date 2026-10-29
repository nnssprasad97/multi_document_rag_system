/**
 * End-to-End RAG System Integration Tests
 * Validates the dual-pipeline architecture and deterministic scenarios from Phase 6:
 * 1. Ingestion Verification (direct vector query of unique keywords)
 * 2. Context Boundary Testing (multi-document synthesis with dual citations)
 * 3. Hallucination Prevention (graceful fallback on out-of-scope queries)
 * 4. Conversational Follow-up (pronoun resolution via injected history)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const VectorStore = require('../src/database/vector_store');
const RelationalDatabase = require('../src/database/relational');
const EmbeddingService = require('../src/services/embedding');
const { LLMService, FALLBACK_MESSAGE } = require('../src/services/llm');
const RagOrchestrator = require('../src/core/rag');
const { createTestPdf, createTestDocx } = require('./test_helpers');

describe('End-to-End RAG Dual Pipeline', () => {
  const testVectorPath = './data/e2e_test_vectors.json';
  const testDbPath = './data/e2e_test_history.db';

  let orchestrator;
  let vectorStore;
  let relationalDb;

  before(() => {
    // Clean up any existing test files
    [testVectorPath, testDbPath, testDbPath.replace('.db', '.json')].forEach((f) => {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    });

    vectorStore = new VectorStore({
      storagePath: testVectorPath,
      similarityThreshold: 0.60,
      topK: 5
    });

    relationalDb = new RelationalDatabase(testDbPath);
    const embeddingService = new EmbeddingService();
    const llmService = new LLMService();

    orchestrator = new RagOrchestrator({
      vectorStore,
      relationalDb,
      embeddingService,
      llmService,
      chunkSize: 1000,
      chunkOverlap: 200,
      similarityThreshold: 0.60,
      topK: 5
    });
  });

  after(() => {
    relationalDb.close();
    [testVectorPath, testDbPath, testDbPath.replace('.db', '.json')].forEach((f) => {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    });
  });

  test('Scenario 1: Ingestion Verification (Direct Vector DB Query)', async () => {
    // 1. Ingest test PDF with unique keyword
    const uniqueKeyword = 'Xanthophyll_Quantum_77';
    const page1 = `Document Title: Advanced Quantum Biology. Section on chloroplasts.`;
    const page2 = `Key Discovery: The unique metabolic enzyme ${uniqueKeyword} operates at room temperature with 99.8% energy efficiency in deep sea corals.`;

    const pdfBuffer = await createTestPdf([page1, page2]);
    const ingestResult = await orchestrator.ingestFile({
      buffer: pdfBuffer,
      originalname: 'quantum_biology.pdf',
      mimetype: 'application/pdf',
      size: pdfBuffer.length
    });

    assert.ok(ingestResult.document_id);
    assert.strictEqual(ingestResult.pages_parsed, 2);
    assert.ok(ingestResult.chunks_created >= 2);

    // 2. Query Vector DB directly (bypassing LLM) using identical embedding model
    const queryVector = await orchestrator.embeddingService.generateQueryEmbedding(uniqueKeyword);
    const retrieved = await orchestrator.vectorStore.retrieveContext(queryVector, 3, 0.50);

    assert.ok(retrieved.length > 0, 'Vector search must return matching chunk');
    const topChunk = retrieved[0];
    assert.ok(
      topChunk.metadata.text.includes(uniqueKeyword),
      `Top chunk must contain the unique keyword: ${uniqueKeyword}`
    );
    assert.strictEqual(topChunk.metadata.filename, 'quantum_biology.pdf');
    assert.strictEqual(topChunk.metadata.page_number, 2);
  });

  test('Scenario 2: Context Boundary Testing (Multi-Document Synthesis with Dual Citations)', async () => {
    // Document 1 (PDF): Employee PTO
    const ptoPdf = await createTestPdf([
      'Standard Employee Handbook: Full-time employees receive 20 days of paid time off (PTO) per year.'
    ]);
    await orchestrator.ingestFile({
      buffer: ptoPdf,
      originalname: 'employee_handbook.pdf',
      mimetype: 'application/pdf',
      size: ptoPdf.length
    });

    // Document 2 (DOCX): Contractor Rules
    const contractorDocx = await createTestDocx([
      {
        title: 'Contractor Guidelines',
        text: 'Contractors operate on hourly billing and are strictly not eligible for PTO or corporate benefits.'
      }
    ]);
    await orchestrator.ingestFile({
      buffer: contractorDocx,
      originalname: 'contractor_guidelines.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: contractorDocx.length
    });

    // Ask a synthesis question spanning both documents
    const query = 'What is the PTO policy for employees versus contractors?';
    const result = await orchestrator.query({ query });

    assert.ok(result.answer);
    assert.notStrictEqual(result.answer, FALLBACK_MESSAGE);
    assert.ok(Array.isArray(result.citations));
    assert.ok(result.citations.length >= 2, 'Must return citations from both documents');

    const citedFiles = result.citations.map((c) => c.document_name);
    assert.ok(citedFiles.includes('employee_handbook.pdf'), 'Must cite employee_handbook.pdf');
    assert.ok(citedFiles.includes('contractor_guidelines.docx'), 'Must cite contractor_guidelines.docx');
  });

  test('Scenario 3: Hallucination Prevention & Graceful Failure', async () => {
    // Ask an out-of-scope question that is not in any uploaded document
    const query = 'What is the capital of France?';
    const result = await orchestrator.query({ query });

    assert.strictEqual(
      result.answer,
      FALLBACK_MESSAGE,
      'System must trigger graceful failure and return exact fallback message'
    );
    assert.strictEqual(result.citations.length, 0, 'No citations should be returned on fallback');
  });

  test('Scenario 4: Conversational Follow-up Testing with History & Pronouns', async () => {
    const sessionId = 'test-conversation-session-42';

    // Turn 1: Initial Question
    const q1 = 'How much PTO do employees get?';
    const r1 = await orchestrator.query({ query: q1, session_id: sessionId });

    assert.strictEqual(r1.session_id, sessionId);
    assert.notStrictEqual(r1.answer, FALLBACK_MESSAGE);
    assert.ok(r1.citations.length > 0);

    // Ingest a document mentioning rollover for employees
    const rolloverPdf = await createTestPdf([
      'Rollover Addendum: Employees can roll over up to 5 unused PTO days into the next calendar year.'
    ]);
    await orchestrator.ingestFile({
      buffer: rolloverPdf,
      originalname: 'pto_rollover.pdf',
      mimetype: 'application/pdf',
      size: rolloverPdf.length
    });

    // Turn 2: Follow-up using pronoun "they"
    const q2 = 'Can they roll it over?';
    const r2 = await orchestrator.query({ query: q2, session_id: sessionId });

    assert.strictEqual(r2.session_id, sessionId);
    assert.notStrictEqual(r2.answer, FALLBACK_MESSAGE);

    // Verify history was saved in relational database
    const history = orchestrator.relationalDb.getSessionHistory(sessionId, 10);
    assert.ok(history.length >= 4, 'Must retain user and assistant message pairs');
  });
});
