/**
 * Unit Tests for Text Chunking Service
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { chunkDocument, chunkPages } = require('../src/services/chunking');

describe('Chunking Service', () => {
  test('should return a single chunk if text is smaller than chunkSize', () => {
    const text = 'This is a short document that fits within a single chunk easily.';
    const metadata = {
      documentId: 'doc-001',
      filename: 'sample.pdf',
      pageNumber: 1
    };

    const chunks = chunkDocument(text, metadata, 1000, 200);

    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].text, text);
    assert.strictEqual(chunks[0].metadata.filename, 'sample.pdf');
    assert.strictEqual(chunks[0].metadata.page_number, 1);
    assert.strictEqual(chunks[0].metadata.document_id, 'doc-001');
    assert.strictEqual(chunks[0].metadata.chunk_index, 0);
  });

  test('should split long text into multiple overlapping chunks', () => {
    // Generate text of ~2500 characters
    const sentences = [
      'Employees are entitled to 20 days of paid time off per calendar year.',
      'All PTO requests must be submitted through the internal portal at least 2 weeks in advance.',
      'Contractors are not eligible for corporate PTO benefits or paid holidays.',
      'Unused PTO may be rolled over up to a maximum limit of 5 days into the following year.',
      'Excess unused PTO days beyond the rollover limit will be forfeited without financial compensation.',
      'Standard office working hours are from 9:00 AM to 5:00 PM Monday through Friday.',
      'Remote employees must maintain active communication during core business hours of 10:00 AM to 3:00 PM.'
    ];
    const longText = sentences.join(' ').repeat(5);

    const chunkSize = 500;
    const overlap = 100;
    const metadata = {
      documentId: 'doc-pto-123',
      filename: 'pto_policy.pdf',
      pageNumber: 4
    };

    const chunks = chunkDocument(longText, metadata, chunkSize, overlap);

    assert.ok(chunks.length > 2, `Expected at least 3 chunks, got ${chunks.length}`);

    // Verify each chunk retains metadata
    for (const chunk of chunks) {
      assert.strictEqual(chunk.metadata.filename, 'pto_policy.pdf');
      assert.strictEqual(chunk.metadata.page_number, 4);
      assert.strictEqual(chunk.metadata.document_id, 'doc-pto-123');
      assert.ok(chunk.text.length > 0);
      assert.ok(chunk.id.includes('doc-pto-123-p4'));
    }

    // Verify sliding window overlap: chunk 1 and chunk 2 should share words
    const chunk0Words = chunks[0].text.split(/\s+/).slice(-5);
    const chunk1Starts = chunks[1].text;
    const hasOverlap = chunk0Words.some((w) => w.length > 3 && chunk1Starts.includes(w));
    assert.ok(hasOverlap, 'Consecutive chunks must share overlapping text');
  });

  test('should chunk multiple pages while preserving exact per-page metadata', () => {
    const pages = [
      {
        pageNumber: 1,
        text: 'Page 1 text: Introduction to company governance and executive leadership.'
      },
      {
        pageNumber: 2,
        text: 'Page 2 text: Detailed health benefits, dental insurance, and 401k match.'
      },
      {
        pageNumber: 3,
        text: 'Page 3 text: Code of conduct, dispute resolution, and arbitration guidelines.'
      }
    ];

    const baseMetadata = {
      documentId: 'doc-handbook',
      filename: 'handbook.pdf'
    };

    const chunks = chunkPages(pages, baseMetadata, 1000, 200);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].metadata.page_number, 1);
    assert.strictEqual(chunks[1].metadata.page_number, 2);
    assert.strictEqual(chunks[2].metadata.page_number, 3);
    assert.strictEqual(chunks[0].metadata.filename, 'handbook.pdf');
    assert.strictEqual(chunks[1].metadata.filename, 'handbook.pdf');
    assert.strictEqual(chunks[2].metadata.filename, 'handbook.pdf');
  });

  test('should return empty array for empty or whitespace-only text', () => {
    const chunks = chunkDocument('   \n\t  ', { filename: 'empty.pdf' });
    assert.strictEqual(chunks.length, 0);
  });
});
