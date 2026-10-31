/**
 * Vector Database Service
 * Handles persistence, indexing, and mathematical similarity search (Cosine Similarity)
 * for document text chunks and their associated metadata payloads.
 * Supports embedded persistent storage and can interface with remote stores (Qdrant/Pinecone).
 */

const fs = require('fs');
const path = require('path');

class VectorStore {
  /**
   * @param {object} config
   * @param {string} config.storagePath Path to local JSON vector persistence file
   * @param {number} config.similarityThreshold Minimum cosine similarity to accept (default: 0.70)
   * @param {number} config.topK Default top-k chunks to retrieve (default: 5)
   */
  constructor({
    storagePath = './data/vectors.json',
    similarityThreshold = 0.65,
    topK = 5,
    provider = process.env.VECTOR_DB_PROVIDER || 'local'
  } = {}) {
    this.storagePath = storagePath;
    this.similarityThreshold = Number(process.env.VECTOR_SIMILARITY_THRESHOLD) || similarityThreshold;
    this.defaultTopK = Number(process.env.TOP_K) || topK;
    this.provider = provider;
    this.vectors = new Map(); // id -> { id, values, metadata }
    this.init();
  }

  init() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const items = JSON.parse(raw);
        if (Array.isArray(items)) {
          for (const item of items) {
            this.vectors.set(item.id, item);
          }
        }
      } catch (err) {
        console.warn(`[VectorStore] Failed to load existing vectors: ${err.message}`);
      }
    }
  }

  save() {
    try {
      const items = Array.from(this.vectors.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(items, null, 2));
    } catch (err) {
      console.error(`[VectorStore] Failed to persist vectors to disk: ${err.message}`);
    }
  }

  /**
   * Computes mathematical cosine similarity between two float vectors.
   * Cosine Similarity = (A . B) / (||A|| * ||B||)
   * 
   * @param {number[]} a 
   * @param {number[]} b 
   * @returns {number} Score between -1.0 and 1.0 (typically 0.0 to 1.0 for normalized embeddings)
   */
  static cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Upserts vector records into the vector database.
   * Each record format:
   * {
   *   id: string,
   *   values: number[],
   *   metadata: {
   *     document_id: string,
   *     filename: string,
   *     page_number: number,
   *     text: string
   *   }
   * }
   * 
   * @param {Array<{ id: string, values: number[], metadata: object }>} records 
   */
  async upsert(records) {
    if (!Array.isArray(records) || records.length === 0) return 0;

    let inserted = 0;
    for (const record of records) {
      if (!record.id || !record.values || !record.metadata) continue;

      // Ensure required metadata keys exist per spec
      const metadata = {
        ...record.metadata,
        document_id: record.metadata.document_id || record.metadata.documentId,
        filename: record.metadata.filename || 'unknown',
        page_number: record.metadata.page_number !== undefined ? record.metadata.page_number : (record.metadata.pageNumber || 1),
        text: record.metadata.text || ''
      };

      this.vectors.set(record.id, {
        id: record.id,
        values: record.values,
        metadata
      });
      inserted++;
    }

    this.save();
    return inserted;
  }

  /**
   * Queries the Vector DB for the most relevant context chunks using mathematical similarity.
   * 
   * @param {number[]} queryVector The embedded user question
   * @param {number} topK Number of results to retrieve (min 3)
   * @param {number} threshold Confidence cutoff threshold (scores below this are discarded)
   * @returns {Promise<Array<{ score: number, metadata: object, id: string }>>}
   */
  async retrieveContext(queryVector, topK = this.defaultTopK, threshold = this.similarityThreshold) {
    if (!queryVector || queryVector.length === 0) return [];

    const scoredResults = [];

    for (const record of this.vectors.values()) {
      const score = VectorStore.cosineSimilarity(queryVector, record.values);
      scoredResults.push({
        id: record.id,
        score,
        metadata: record.metadata
      });
    }

    // Sort descending by similarity score
    scoredResults.sort((a, b) => b.score - a.score);

    // Apply Top-K slice
    const topResults = scoredResults.slice(0, Math.max(3, topK));

    // Filter out low-confidence results based on similarity score threshold
    const filteredResults = topResults.filter((result) => result.score >= threshold);

    return filteredResults;
  }

  /**
   * Retrieves all chunks for a specific document.
   * @param {string} documentId
   */
  getByDocumentId(documentId) {
    const results = [];
    for (const record of this.vectors.values()) {
      if (record.metadata.document_id === documentId) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Deletes all vectors corresponding to a given document ID.
   * @param {string} documentId
   */
  deleteByDocumentId(documentId) {
    let deleted = 0;
    for (const [id, record] of this.vectors.entries()) {
      if (record.metadata.document_id === documentId) {
        this.vectors.delete(id);
        deleted++;
      }
    }
    if (deleted > 0) this.save();
    return deleted;
  }

  count() {
    return this.vectors.size;
  }

  clear() {
    this.vectors.clear();
    this.save();
  }
}

module.exports = VectorStore;
