/**
 * Unit Tests for Document Parser Service
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const DocumentService = require('../src/services/document');
const { createTestPdf, createTestDocx } = require('./test_helpers');

describe('Document Parser Service', () => {
  test('should validate supported file types (.pdf and .docx)', () => {
    assert.strictEqual(DocumentService.validateFileType('report.pdf', 'application/pdf'), 'pdf');
    assert.strictEqual(
      DocumentService.validateFileType(
        'notes.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ),
      'docx'
    );

    assert.throws(
      () => DocumentService.validateFileType('image.png', 'image/png'),
      /Unsupported file format/
    );
    assert.throws(
      () => DocumentService.validateFileType('archive.zip', 'application/zip'),
      /Unsupported file format/
    );
  });

  test('should parse PDF files and preserve explicit page_number for each page', async () => {
    const page1Text = 'First page: Employee benefits overview and coverage.';
    const page2Text = 'Second page: 401(k) company match up to 5 percent.';
    const page3Text = 'Third page: Maternity and paternity leave allowances.';

    const pdfBuffer = await createTestPdf([page1Text, page2Text, page3Text]);
    const parsed = await DocumentService.parseDocument(pdfBuffer, 'benefits.pdf', 'application/pdf');

    assert.strictEqual(parsed.filename, 'benefits.pdf');
    assert.strictEqual(parsed.mimeType, 'application/pdf');
    assert.strictEqual(parsed.pageCount, 3);
    assert.strictEqual(parsed.pages.length, 3);

    // Verify explicit page numbers are preserved
    assert.strictEqual(parsed.pages[0].pageNumber, 1);
    assert.ok(parsed.pages[0].text.includes('Employee benefits overview'));

    assert.strictEqual(parsed.pages[1].pageNumber, 2);
    assert.ok(parsed.pages[1].text.includes('401(k) company match'));

    assert.strictEqual(parsed.pages[2].pageNumber, 3);
    assert.ok(parsed.pages[2].text.includes('Maternity and paternity leave'));
  });

  test('should parse DOCX files and preserve sequential block numbers', async () => {
    const docxBuffer = await createTestDocx([
      { title: 'Contractor Guidelines', text: 'Contractors must invoice bi-weekly.' },
      { title: 'Equipment Provisioning', text: 'Hardware remains property of the enterprise.' }
    ]);

    const parsed = await DocumentService.parseDocument(docxBuffer, 'contractors.docx');

    assert.strictEqual(parsed.filename, 'contractors.docx');
    assert.ok(parsed.pages.length >= 1);
    assert.strictEqual(parsed.pages[0].pageNumber, 1);
    assert.ok(parsed.pages[0].text.includes('Contractor Guidelines'));
  });
});
