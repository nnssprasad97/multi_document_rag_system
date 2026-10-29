/**
 * Text Chunking Service
 * Implements configurable sliding window and overlapping text splitting algorithms.
 * Preserves page_number, filename, and document_id metadata for verifiable citations.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Splits raw text into manageable chunks with overlap while preserving metadata.
 * Prefers breaking at natural sentence or paragraph boundaries.
 * 
 * @param {string} documentText The raw extracted text for a page/document
 * @param {object} metadata { documentId, filename, pageNumber }
 * @param {number} chunkSize Target character length for a chunk (default: 1000)
 * @param {number} overlap Number of characters to overlap with previous chunk (default: 200)
 * @returns {Array<{ id: string, text: string, metadata: object }>}
 */
function chunkDocument(documentText, metadata = {}, chunkSize = 1000, overlap = 200) {
  if (!documentText || typeof documentText !== 'string') {
    return [];
  }

  const cleanText = documentText.trim();
  if (cleanText.length === 0) {
    return [];
  }

  // If text is shorter than chunkSize, return as single chunk
  if (cleanText.length <= chunkSize) {
    const docId = metadata.documentId || metadata.document_id || uuidv4();
    const pageNum = metadata.pageNumber !== undefined ? metadata.pageNumber : (metadata.page_number || 1);
    const filename = metadata.filename || 'unknown';

    return [
      {
        id: `${docId}-p${pageNum}-c0`,
        text: cleanText,
        metadata: {
          document_id: docId,
          documentId: docId,
          filename: filename,
          page_number: pageNum,
          pageNumber: pageNum,
          chunk_index: 0,
          char_start: 0,
          char_end: cleanText.length
        }
      }
    ];
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;
  const docId = metadata.documentId || metadata.document_id || uuidv4();
  const pageNum = metadata.pageNumber !== undefined ? metadata.pageNumber : (metadata.page_number || 1);
  const filename = metadata.filename || 'unknown';

  while (start < cleanText.length) {
    let end = start + chunkSize;

    // If this is the last chunk, take all remaining text
    if (end >= cleanText.length) {
      end = cleanText.length;
    } else {
      // Look for natural boundary (newline, period, question mark, exclamation)
      // in the last 20% of the chunk window to avoid slicing words or sentences
      const lookbackWindow = Math.floor(chunkSize * 0.2);
      const searchRegion = cleanText.substring(end - lookbackWindow, end);
      
      const lastParagraph = searchRegion.lastIndexOf('\n');
      const lastSentence = Math.max(
        searchRegion.lastIndexOf('. '),
        searchRegion.lastIndexOf('.\n'),
        searchRegion.lastIndexOf('? '),
        searchRegion.lastIndexOf('! ')
      );

      if (lastParagraph !== -1 && lastParagraph >= lookbackWindow / 2) {
        end = end - lookbackWindow + lastParagraph + 1;
      } else if (lastSentence !== -1) {
        end = end - lookbackWindow + lastSentence + 2;
      } else {
        const lastSpace = searchRegion.lastIndexOf(' ');
        if (lastSpace !== -1) {
          end = end - lookbackWindow + lastSpace + 1;
        }
      }
    }

    const chunkText = cleanText.substring(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push({
        id: `${docId}-p${pageNum}-c${chunkIndex}`,
        text: chunkText,
        metadata: {
          document_id: docId,
          documentId: docId,
          filename: filename,
          page_number: pageNum,
          pageNumber: pageNum,
          chunk_index: chunkIndex,
          char_start: start,
          char_end: end
        }
      });
      chunkIndex++;
    }

    if (end >= cleanText.length) {
      break;
    }

    // Step forward by chunkSize - overlap
    const step = Math.max(1, (end - start) - overlap);
    start += step;
  }

  return chunks;
}

/**
 * Chunks a collection of parsed document pages while preserving exact per-page metadata.
 * 
 * @param {Array<{ pageNumber: number, text: string }>} pages 
 * @param {object} baseMetadata { documentId, filename }
 * @param {number} chunkSize 
 * @param {number} overlap 
 * @returns {Array<{ id: string, text: string, metadata: object }>}
 */
function chunkPages(pages, baseMetadata = {}, chunkSize = 1000, overlap = 200) {
  const allChunks = [];
  const docId = baseMetadata.documentId || baseMetadata.document_id || uuidv4();
  const filename = baseMetadata.filename || 'unknown';

  for (const page of pages) {
    if (!page.text || page.text.trim().length === 0) continue;

    const pageMetadata = {
      documentId: docId,
      document_id: docId,
      filename: filename,
      pageNumber: page.pageNumber,
      page_number: page.pageNumber
    };

    const pageChunks = chunkDocument(page.text, pageMetadata, chunkSize, overlap);
    allChunks.push(...pageChunks);
  }

  return allChunks;
}

module.exports = {
  chunkDocument,
  chunkPages
};
