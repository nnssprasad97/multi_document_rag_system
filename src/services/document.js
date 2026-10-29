/**
 * Document Parser Service
 * Extracts text and metadata from PDF and DOCX files.
 * Preserves exact page numbers for PDFs, and sequential section/block numbers for DOCX.
 */

const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

class DocumentService {
  /**
   * Validates file extension and MIME type.
   * @param {string} filename
   * @param {string} mimetype
   * @returns {'pdf'|'docx'}
   */
  static validateFileType(filename, mimetype = '') {
    const ext = path.extname(filename).toLowerCase();
    const isPdf = ext === '.pdf' || mimetype === 'application/pdf';
    const isDocx =
      ext === '.docx' ||
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isPdf) return 'pdf';
    if (isDocx) return 'docx';

    throw new Error(
      `Unsupported file format: '${ext || mimetype}'. Only PDF (.pdf) and Word (.docx) files are supported.`
    );
  }

  /**
   * Parses a PDF buffer and extracts text mapped to each explicit page number.
   * @param {Buffer} buffer
   * @param {string} filename
   * @returns {Promise<{ filename: string, mimeType: string, pageCount: number, pages: Array<{ pageNumber: number, text: string }> }>}
   */
  static async parsePdf(buffer, filename) {
    const pages = [];

    // Custom page render function to capture page numbers and text individually
    const customPageRender = async function (pageData) {
      const pageNumber =
        pageData.pageIndex !== undefined
          ? pageData.pageIndex + 1
          : pageData.pageNumber || pages.length + 1;

      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });

      let lastY,
        text = '';
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }

      const cleanedText = text.trim();
      pages.push({
        pageNumber,
        text: cleanedText
      });

      return text;
    };

    // Convert Buffer to Uint8Array safely for pdf.js stream parser
    const uint8Array = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength || buffer.length
    );

    const parsed = await pdfParse(uint8Array, {
      pagerender: customPageRender
    });

    // Fallback if pages array wasn't populated
    if (pages.length === 0 && parsed.text) {
      pages.push({
        pageNumber: 1,
        text: parsed.text.trim()
      });
    }

    // Sort by page number to guarantee order
    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    return {
      filename,
      mimeType: 'application/pdf',
      pageCount: pages.length || parsed.numpages || 1,
      pages
    };
  }

  /**
   * Parses a DOCX buffer and extracts text mapped to sequential blocks/sections.
   * @param {Buffer} buffer
   * @param {string} filename
   * @returns {Promise<{ filename: string, mimeType: string, pageCount: number, pages: Array<{ pageNumber: number, text: string }> }>}
   */
  static async parseDocx(buffer, filename) {
    const rawResult = await mammoth.extractRawText({ buffer });
    const fullText = (rawResult.value || '').trim();

    if (!fullText) {
      return {
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pageCount: 1,
        pages: [{ pageNumber: 1, text: '' }]
      };
    }

    // Split text into sequential logical blocks (paragraphs/sections)
    const rawParagraphs = fullText
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const pages = [];
    if (rawParagraphs.length === 0) {
      pages.push({ pageNumber: 1, text: fullText });
    } else {
      // Group paragraphs into coherent ~1000-char blocks or treat sections sequentially
      let currentBlock = '';
      let blockIndex = 1;

      for (const p of rawParagraphs) {
        if (currentBlock.length > 0 && currentBlock.length + p.length > 1200) {
          pages.push({
            pageNumber: blockIndex,
            text: currentBlock.trim()
          });
          blockIndex++;
          currentBlock = p;
        } else {
          currentBlock = currentBlock ? `${currentBlock}\n\n${p}` : p;
        }
      }

      if (currentBlock.trim().length > 0) {
        pages.push({
          pageNumber: blockIndex,
          text: currentBlock.trim()
        });
      }
    }

    return {
      filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pageCount: pages.length,
      pages
    };
  }

  /**
   * Main entry point to parse a document buffer.
   * @param {Buffer} buffer
   * @param {string} originalname
   * @param {string} mimetype
   */
  static async parseDocument(buffer, originalname, mimetype = '') {
    const format = this.validateFileType(originalname, mimetype);
    if (format === 'pdf') {
      return await this.parsePdf(buffer, originalname);
    } else {
      return await this.parseDocx(buffer, originalname);
    }
  }
}

module.exports = DocumentService;
