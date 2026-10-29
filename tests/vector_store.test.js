/**
 * Unit Tests for Vector Store Database Service
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const VectorStore = require('../src/database/vector_store');

describe('Vector Store Service', () => {
  const testStoragePath = './data/test_vectors.json';
  let vectorStore;

  beforeEach(() => {
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }
    vectorStore = new VectorStore({
      storagePath: testStoragePath,
      similarityThreshold: 0.70,
      topK: 3
    });
  });

  test('should compute mathematical cosine similarity accurately', () => {
    // Identical vectors -> similarity 1.0
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    assert.strictEqual(Math.round(VectorStore.cosineSimilarity(v1, v2) * 1000) / 1000, 1.0);

    // Orthogonal vectors -> similarity 0.0
    const v3 = [0, 1, 0];
    assert.strictEqual(VectorStore.cosineSimilarity(v1, v3), 0.0);

    // Opposite vectors -> similarity -1.0
    const v4 = [-1, 0, 0];
    assert.strictEqual(VectorStore.cosineSimilarity(v1, v4), -1.0);
  });

  test('should upsert vectors with required metadata payload', async () => {
    const records = [
      {
        id: 'chunk-1',
        values: [1.0, 0.0, 0.0],
        metadata: {
          document_id: 'doc-1',
          filename: 'handbook.pdf',
          page_number: 14,
          text: 'Employees are entitled to 20 days of paid time off per year.'
        }
      },
      {
        id: 'chunk-2',
        values: [0.9, 0.1, 0.0],
        metadata: {
          document_id: 'doc-1',
          filename: 'handbook.pdf',
          page_number: 15,
          text: 'Unused PTO may roll over up to 5 days.'
        }
      }
    ];

    const inserted = await vectorStore.upsert(records);
    assert.strictEqual(inserted, 2);
    assert.strictEqual(vectorStore.count(), 2);
  });

  test('should perform semantic retrieval and filter by similarity threshold', async () => {
    await vectorStore.upsert([
      {
        id: 'chunk-high',
        values: [1.0, 0.0, 0.0],
        metadata: {
          document_id: 'doc-pto',
          filename: 'handbook.pdf',
          page_number: 14,
          text: 'Employees get 20 days PTO.'
        }
      },
      {
        id: 'chunk-medium',
        values: [0.75, 0.25, 0.0],
        metadata: {
          document_id: 'doc-contractor',
          filename: 'contractor.docx',
          page_number: 2,
          text: 'Contractors are billed hourly.'
        }
      },
      {
        id: 'chunk-low',
        values: [0.0, 1.0, 0.0], // Orthogonal to [1, 0, 0]
        metadata: {
          document_id: 'doc-france',
          filename: 'france.pdf',
          page_number: 1,
          text: 'The capital of France is Paris.'
        }
      }
    ]);

    // Query vector aligned with chunk-high
    const queryVector = [1.0, 0.0, 0.0];

    // With threshold 0.70, only chunk-high and chunk-medium should be retrieved, chunk-low discarded
    const results = await vectorStore.retrieveContext(queryVector, 5, 0.70);

    assert.ok(results.length >= 1);
    assert.strictEqual(results[0].id, 'chunk-high');
    assert.ok(results[0].score >= 0.99);

    // Confirm low confidence chunk was discarded
    const hasLow = results.some((r) => r.id === 'chunk-low');
    assert.strictEqual(hasLow, false, 'Chunks below threshold must be discarded');
  });

  test('should delete all vectors for a specific document ID', async () => {
    await vectorStore.upsert([
      {
        id: 'c1',
        values: [1, 0],
        metadata: { document_id: 'doc-to-delete', filename: 'del.pdf', page_number: 1, text: 'a' }
      },
      {
        id: 'c2',
        values: [0, 1],
        metadata: { document_id: 'doc-to-keep', filename: 'keep.pdf', page_number: 1, text: 'b' }
      }
    ]);

    assert.strictEqual(vectorStore.count(), 2);
    const deleted = vectorStore.deleteByDocumentId('doc-to-delete');
    assert.strictEqual(deleted, 1);
    assert.strictEqual(vectorStore.count(), 1);
  });
});
