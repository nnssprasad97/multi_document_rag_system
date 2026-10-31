/**
 * RAG Orchestrator
 * Implements the dual-pipeline architecture:
 * 1. Ingestion Pipeline: Document Parsing -> Chunking -> Vector Embeddings -> Vector DB & Relational DB Logging
 * 2. Query Pipeline: Query Vectorization -> Semantic Search -> Similarity Threshold Filter ->
 *    History Retrieval -> Prompt Assembly -> LLM Generation -> Citation Formatting & Persistence
 */

const { v4: uuidv4 } = require('uuid');
const DocumentService = require('../services/document');
const { chunkPages } = require('../services/chunking');
const EmbeddingService = require('../services/embedding');
const { LLMService, FALLBACK_MESSAGE } = require('../services/llm');
const VectorStore = require('../database/vector_store');
const RelationalDatabase = require('../database/relational');

class RagOrchestrator {
  constructor({
    vectorStore = new VectorStore(),
    relationalDb = new RelationalDatabase(),
    embeddingService = new EmbeddingService(),
    llmService = new LLMService(),
    chunkSize = Number(process.env.CHUNK_SIZE) || 1000,
    chunkOverlap = Number(process.env.CHUNK_OVERLAP) || 200,
    similarityThreshold = Number(process.env.VECTOR_SIMILARITY_THRESHOLD) || 0.65,
    topK = Number(process.env.TOP_K) || 5
  } = {}) {
    this.vectorStore = vectorStore;
    this.relationalDb = relationalDb;
    this.embeddingService = embeddingService;
    this.llmService = llmService;
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.similarityThreshold = similarityThreshold;
    this.topK = Math.max(3, topK);
  }

  // =========================================================================
  // INGESTION PIPELINE (Asynchronous / Modular Document Processing)
  // =========================================================================

  /**
   * Ingests a single uploaded file buffer.
   * 
   * @param {object} file
   * @param {Buffer} file.buffer
   * @param {string} file.originalname
   * @param {string} file.mimetype
   * @param {number} file.size
   * @returns {Promise<object>} Ingestion summary
   */
  async ingestFile({ buffer, originalname, mimetype, size = 0 }) {
    const documentId = uuidv4();

    // 1. Parse text and extract explicit page numbers (PDF) or sequential blocks (DOCX)
    const parsedDoc = await DocumentService.parseDocument(buffer, originalname, mimetype);

    // 2. Break parsed text into manageable chunks with overlap while preserving metadata
    const chunks = chunkPages(
      parsedDoc.pages,
      {
        documentId,
        filename: originalname
      },
      this.chunkSize,
      this.chunkOverlap
    );

    if (chunks.length === 0) {
      throw new Error(`No text content could be extracted from document: ${originalname}`);
    }

    // 3. Generate vector embeddings for all text chunks in batches using identical embedding model
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await this.embeddingService.generateEmbeddings(chunkTexts, 50);

    // 4. Prepare vector records with required metadata payload
    const vectorRecords = chunks.map((chunk, index) => ({
      id: chunk.id,
      values: embeddings[index],
      metadata: {
        document_id: documentId,
        filename: originalname,
        page_number: chunk.metadata.page_number,
        text: chunk.text
      }
    }));

    // 5. Upsert to Vector Database
    await this.vectorStore.upsert(vectorRecords);

    // 6. Log document record to Relational Database
    const docRecord = this.relationalDb.createDocument({
      id: documentId,
      filename: originalname,
      fileSize: size || buffer.length,
      mimeType: parsedDoc.mimeType,
      chunkCount: chunks.length,
      pageCount: parsedDoc.pageCount
    });

    return {
      document_id: documentId,
      filename: originalname,
      chunks_created: chunks.length,
      pages_parsed: parsedDoc.pageCount,
      document_record: docRecord
    };
  }

  /**
   * Ingests multiple files uploaded in a single batch.
   * 
   * @param {Array<object>} files Multer file objects
   * @returns {Promise<object>} Batch ingestion summary
   */
  async ingestFiles(files) {
    if (!files || files.length === 0) {
      throw new Error('No files provided for ingestion.');
    }

    const results = [];
    for (const file of files) {
      const summary = await this.ingestFile(file);
      results.push(summary);
    }

    return {
      message: `Successfully processed ${files.length} document(s).`,
      documents_processed: files.length,
      documents: results
    };
  }

  // =========================================================================
  // QUERY PIPELINE (Synchronous Semantic Retrieval & LLM Generation)
  // =========================================================================

  /**
   * Executes the synchronous question-answering query pipeline.
   * 
   * @param {object} params
   * @param {string} params.query User question
   * @param {string} [params.session_id] Optional session ID for conversation continuity
   * @returns {Promise<{ answer: string, citations: Array<{ document_name: string, page_number: number }>, session_id: string }>}
   */
  async query({ query, session_id }) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Query string is required.');
    }

    const cleanQuery = query.trim();

    // 1. Establish or retrieve session in Relational Database
    const session = this.relationalDb.getOrCreateSession(session_id);
    const activeSessionId = session.id;

    // 2. Retrieve prior conversation history from Relational Database (last 6 messages = 3 turns)
    const history = this.relationalDb.getSessionHistory(activeSessionId, 6);

    // 3. Conversational context expansion for pronoun follow-ups
    let retrievalQuery = cleanQuery;
    const isFollowUp = /\b(they|them|their|theirs|it|its|these|those|this|rollover|carryover)\b/i.test(cleanQuery);
    if (isFollowUp && history.length > 0) {
      const priorUserMsgs = history.filter((m) => m.role === 'user').map((m) => m.content);
      if (priorUserMsgs.length > 0) {
        retrievalQuery = `${cleanQuery} ${priorUserMsgs.slice(-2).join(' ')}`;
      }
    }

    // 4. Vectorize the user query using the IDENTICAL embedding model
    const queryVector = await this.embeddingService.generateQueryEmbedding(retrievalQuery);

    // 5. Dynamic semantic retrieval against the Vector DB (Top-K with confidence thresholding)
    const contextChunks = await this.vectorStore.retrieveContext(
      queryVector,
      this.topK,
      this.similarityThreshold
    );

    // 6. Graceful failure / Hallucination Prevention:
    // If semantic search returns zero chunks meeting confidence threshold, bypass LLM entirely!
    if (contextChunks.length === 0) {
      // Record turn in relational database
      this.relationalDb.addMessage(activeSessionId, 'user', cleanQuery);
      this.relationalDb.addMessage(activeSessionId, 'assistant', FALLBACK_MESSAGE, []);

      return {
        answer: FALLBACK_MESSAGE,
        citations: [],
        session_id: activeSessionId
      };
    }

    // 7. Generate grounded answer via LLM with strict instructions and citations
    const { answer, citations } = await this.llmService.generateResponse({
      query: cleanQuery,
      contextChunks,
      history
    });

    // 8. Persist conversation turn into Relational Database Messages table
    this.relationalDb.addMessage(activeSessionId, 'user', cleanQuery);
    this.relationalDb.addMessage(activeSessionId, 'assistant', answer, citations);

    return {
      answer,
      citations,
      session_id: activeSessionId
    };
  }

  /**
   * Returns list of all indexed documents and vector count.
   */
  getStatus() {
    return {
      vector_count: this.vectorStore.count(),
      documents: this.relationalDb.listDocuments(),
      sessions: this.relationalDb.listSessions(),
      config: {
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
        similarityThreshold: this.similarityThreshold,
        topK: this.topK,
        embeddingInfo: this.embeddingService.getModelInfo()
      }
    };
  }
}

module.exports = RagOrchestrator;
