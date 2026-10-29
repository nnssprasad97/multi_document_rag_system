/**
 * Relational Database Service
 * Manages persistent conversational state, session tracking, and document logging.
 * Uses SQLite (via built-in node:sqlite) with automatic schema creation and queries.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class RelationalDatabase {
  constructor(dbPath = './data/rag_history.db') {
    this.dbPath = dbPath;
    this.isSqlite = false;
    this.db = null;
    this.init();
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      // Try using Node.js built-in node:sqlite
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(this.dbPath);
      this.isSqlite = true;
      this.initSqliteSchema();
    } catch (err) {
      console.warn(`[RelationalDB] node:sqlite fallback to JSON file store: ${err.message}`);
      this.isSqlite = false;
      this.jsonPath = this.dbPath.endsWith('.db')
        ? this.dbPath.replace(/\.db$/, '.json')
        : `${this.dbPath}.json`;
      this.initJsonStore();
    }
  }

  initSqliteSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        mime_type TEXT,
        chunk_count INTEGER DEFAULT 0,
        page_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT 'New Conversation',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    `);
  }

  initJsonStore() {
    if (!fs.existsSync(this.jsonPath)) {
      fs.writeFileSync(
        this.jsonPath,
        JSON.stringify({ documents: [], sessions: [], messages: [] }, null, 2)
      );
    }
  }

  readJson() {
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { documents: [], sessions: [], messages: [] };
    }
  }

  writeJson(data) {
    fs.writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
  }

  // --- Document Operations ---
  createDocument({ id = uuidv4(), filename, fileSize = 0, mimeType = '', chunkCount = 0, pageCount = 1 }) {
    if (this.isSqlite) {
      const stmt = this.db.prepare(`
        INSERT INTO documents (id, filename, file_size, mime_type, chunk_count, page_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, filename, fileSize, mimeType, chunkCount, pageCount);
      return this.getDocument(id);
    } else {
      const data = this.readJson();
      const doc = {
        id,
        filename,
        file_size: fileSize,
        mime_type: mimeType,
        chunk_count: chunkCount,
        page_count: pageCount,
        created_at: new Date().toISOString()
      };
      data.documents.unshift(doc);
      this.writeJson(data);
      return doc;
    }
  }

  getDocument(id) {
    if (this.isSqlite) {
      const stmt = this.db.prepare('SELECT * FROM documents WHERE id = ?');
      return stmt.get(id) || null;
    } else {
      const data = this.readJson();
      return data.documents.find((d) => d.id === id) || null;
    }
  }

  listDocuments() {
    if (this.isSqlite) {
      const stmt = this.db.prepare('SELECT * FROM documents ORDER BY created_at DESC');
      return stmt.all();
    } else {
      const data = this.readJson();
      return data.documents;
    }
  }

  // --- Session Operations ---
  createSession(id = uuidv4(), title = 'New Conversation') {
    if (this.isSqlite) {
      const stmt = this.db.prepare('INSERT INTO sessions (id, title) VALUES (?, ?)');
      stmt.run(id, title);
      return this.getSession(id);
    } else {
      const data = this.readJson();
      const session = {
        id,
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      data.sessions.unshift(session);
      this.writeJson(data);
      return session;
    }
  }

  getSession(id) {
    if (this.isSqlite) {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
      return stmt.get(id) || null;
    } else {
      const data = this.readJson();
      return data.sessions.find((s) => s.id === id) || null;
    }
  }

  getOrCreateSession(id) {
    if (!id) {
      return this.createSession();
    }
    const existing = this.getSession(id);
    if (existing) {
      return existing;
    }
    return this.createSession(id);
  }

  listSessions() {
    if (this.isSqlite) {
      const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
      return stmt.all();
    } else {
      const data = this.readJson();
      return data.sessions;
    }
  }

  // --- Message Operations ---
  addMessage(sessionId, role, content, citations = null) {
    const id = uuidv4();
    const citationsStr = citations ? JSON.stringify(citations) : null;
    const now = new Date().toISOString();

    if (this.isSqlite) {
      const stmt = this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, citations)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, sessionId, role, content, citationsStr);

      // Update session timestamp
      const updateStmt = this.db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      updateStmt.run(sessionId);

      return {
        id,
        session_id: sessionId,
        role,
        content,
        citations,
        created_at: now
      };
    } else {
      const data = this.readJson();
      const msg = {
        id,
        session_id: sessionId,
        role,
        content,
        citations,
        created_at: now
      };
      data.messages.push(msg);
      const session = data.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.updated_at = now;
      }
      this.writeJson(data);
      return msg;
    }
  }

  /**
   * Retrieves the recent chronological conversation history for a session.
   * Returns in ascending order (oldest to newest) for proper prompt injection.
   * @param {string} sessionId
   * @param {number} limit Number of recent message pairs (e.g. 6 messages = 3 pairs)
   */
  getSessionHistory(sessionId, limit = 6) {
    if (this.isSqlite) {
      const stmt = this.db.prepare(`
        SELECT * FROM (
          SELECT id, session_id, role, content, citations, created_at, rowid
          FROM messages
          WHERE session_id = ?
          ORDER BY rowid DESC
          LIMIT ?
        ) ORDER BY rowid ASC
      `);
      const rows = stmt.all(sessionId, limit);
      return rows.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        role: r.role,
        content: r.content,
        citations: r.citations ? JSON.parse(r.citations) : null,
        created_at: r.created_at
      }));
    } else {
      const data = this.readJson();
      const msgs = data.messages
        .filter((m) => m.session_id === sessionId)
        .slice(-limit);
      return msgs;
    }
  }

  close() {
    if (this.isSqlite && this.db) {
      this.db.close();
    }
  }
}

module.exports = RelationalDatabase;
