/**
 * Unit Tests for Relational Database Service (Conversational State & Document Logging)
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const RelationalDatabase = require('../src/database/relational');

describe('Relational Database Service', () => {
  const testDbPath = './data/test_relational.db';
  let db;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
    const jsonPath = testDbPath.replace(/\.db$/, '.json');
    if (fs.existsSync(jsonPath)) {
      try {
        fs.unlinkSync(jsonPath);
      } catch {}
    }
    db = new RelationalDatabase(testDbPath);
  });

  test('should log uploaded documents with metadata', () => {
    const doc = db.createDocument({
      id: 'doc-uuid-1',
      filename: 'company_handbook.pdf',
      fileSize: 1048576,
      mimeType: 'application/pdf',
      chunkCount: 18,
      pageCount: 5
    });

    assert.strictEqual(doc.id, 'doc-uuid-1');
    assert.strictEqual(doc.filename, 'company_handbook.pdf');
    assert.strictEqual(doc.chunk_count, 18);
    assert.strictEqual(doc.page_count, 5);

    const docs = db.listDocuments();
    assert.strictEqual(docs.length, 1);
    assert.strictEqual(docs[0].filename, 'company_handbook.pdf');
  });

  test('should track distinct chat sessions and sequential message history', () => {
    const session = db.createSession('session-test-01', 'PTO Inquiry Session');
    assert.strictEqual(session.id, 'session-test-01');

    // Turn 1
    db.addMessage('session-test-01', 'user', 'How much PTO do employees get?');
    db.addMessage(
      'session-test-01',
      'assistant',
      'Employees receive 20 days of PTO per year. [handbook.pdf, Page 14]',
      [{ document_name: 'handbook.pdf', page_number: 14 }]
    );

    // Turn 2
    db.addMessage('session-test-01', 'user', 'Can they roll it over?');
    db.addMessage(
      'session-test-01',
      'assistant',
      'Yes, employees can roll over up to 5 days. [handbook.pdf, Page 15]',
      [{ document_name: 'handbook.pdf', page_number: 15 }]
    );

    // Retrieve history
    const history = db.getSessionHistory('session-test-01', 6);
    assert.strictEqual(history.length, 4);

    // Verify chronological order (oldest to newest)
    assert.strictEqual(history[0].role, 'user');
    assert.strictEqual(history[0].content, 'How much PTO do employees get?');

    assert.strictEqual(history[1].role, 'assistant');
    assert.ok(history[1].citations.length > 0);
    assert.strictEqual(history[1].citations[0].document_name, 'handbook.pdf');

    assert.strictEqual(history[2].role, 'user');
    assert.strictEqual(history[2].content, 'Can they roll it over?');

    assert.strictEqual(history[3].role, 'assistant');
    assert.strictEqual(history[3].citations[0].page_number, 15);
  });
});
