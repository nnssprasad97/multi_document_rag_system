/**
 * Test Utilities
 * Generates valid in-memory PDF and DOCX files for automated integration testing.
 */

const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

/**
 * Creates a valid PDF Buffer with text across one or more pages.
 * @param {string[]} pageTexts Array of text strings, one per page
 * @returns {Promise<Buffer>}
 */
function createTestPdf(pageTexts = ['Sample PDF page content']) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const text of pageTexts) {
      doc.addPage();
      doc.fontSize(12).text(text, 50, 50);
    }

    doc.end();
  });
}

/**
 * Creates a valid DOCX Buffer with paragraphs and headings.
 * @param {Array<{ title?: string, text: string }>} sections
 * @returns {Promise<Buffer>}
 */
async function createTestDocx(sections = [{ text: 'Sample DOCX content' }]) {
  const children = [];

  for (const s of sections) {
    if (s.title) {
      children.push(
        new Paragraph({
          text: s.title,
          heading: HeadingLevel.HEADING_1
        })
      );
    }
    children.push(
      new Paragraph({
        children: [new TextRun(s.text)]
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

module.exports = {
  createTestPdf,
  createTestDocx
};
