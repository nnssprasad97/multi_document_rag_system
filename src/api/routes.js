/**
 * API Routes
 * Defines HTTP endpoints for Document Upload and Chat Retrieval pipelines.
 */

const express = require('express');
const multer = require('multer');

// Configure multer for in-memory file handling
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max file size
  },
  fileFilter: (req, file, cb) => {
    const isPdf = file.originalname.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf';
    const isDocx =
      file.originalname.toLowerCase().endsWith('.docx') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isPdf || isDocx) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type for '${file.originalname}'. Only .pdf and .docx files are permitted.`));
    }
  }
});

function createRouter(ragOrchestrator) {
  const router = express.Router();

  /**
   * POST /api/upload
   * Accepts multipart/form-data with one or more files ('files' or 'file').
   */
  router.post(
    '/upload',
    upload.fields([
      { name: 'files', maxCount: 20 },
      { name: 'file', maxCount: 1 }
    ]),
    async (req, res) => {
      try {
        const uploadedFiles = [];
        if (req.files?.files) {
          uploadedFiles.push(...req.files.files);
        }
        if (req.files?.file) {
          uploadedFiles.push(...req.files.file);
        }

        if (uploadedFiles.length === 0) {
          return res.status(400).json({
            error: 'No files uploaded. Provide multipart/form-data with field name "files" or "file".'
          });
        }

        const result = await ragOrchestrator.ingestFiles(uploadedFiles);
        return res.status(200).json(result);
      } catch (err) {
        console.error('[API /upload error]', err);
        return res.status(500).json({
          error: 'Document ingestion failed',
          message: err.message
        });
      }
    }
  );

  /**
   * POST /api/chat
   * Payload: { query: string, session_id?: string }
   * Returns: { answer: string, citations: Array<{ document_name, page_number }>, session_id: string }
   */
  router.post('/chat', async (req, res) => {
    try {
      const { query, session_id } = req.body || {};

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({
          error: "Invalid request payload. 'query' (string) is required."
        });
      }

      const response = await ragOrchestrator.query({
        query: query.trim(),
        session_id
      });

      return res.status(200).json(response);
    } catch (err) {
      console.error('[API /chat error]', err);
      return res.status(500).json({
        error: 'Chat query failed',
        message: err.message
      });
    }
  });

  /**
   * GET /api/documents
   * Lists all uploaded documents and their metadata.
   */
  router.get('/documents', (req, res) => {
    try {
      const docs = ragOrchestrator.relationalDb.listDocuments();
      return res.status(200).json({ documents: docs });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/sessions
   * Lists all chat sessions.
   */
  router.get('/sessions', (req, res) => {
    try {
      const sessions = ragOrchestrator.relationalDb.listSessions();
      return res.status(200).json({ sessions });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/sessions/:id/messages
   * Returns message history for a specific session.
   */
  router.get('/sessions/:id/messages', (req, res) => {
    try {
      const { id } = req.params;
      const messages = ragOrchestrator.relationalDb.getSessionHistory(id, 50);
      return res.status(200).json({ session_id: id, messages });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/health
   * System health and status summary.
   */
  router.get('/health', (req, res) => {
    try {
      const status = ragOrchestrator.getStatus();
      return res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        ...status
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createRouter;
