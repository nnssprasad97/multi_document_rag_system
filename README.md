# VeriRAG: Multi-Document Question Answering RAG System

A production-grade, enterprise **Retrieval-Augmented Generation (RAG)** system built for multi-document question answering across **PDF** and **Word (DOCX)** documents with strict anti-hallucination guardrails and mathematically traceable, verifiable citations.

---

## 🌟 Key Features

- **Dual-Pipeline Architecture**: Cleanly decoupled **Ingestion Pipeline** (parsing, chunking, vector embedding, metadata indexing) and **Query Pipeline** (query vectorization, Top-K semantic retrieval, confidence filtering, conversational history injection, grounded generation).
- **Page-Level Traceability**: Extracts and preserves explicit `page_number` metadata for PDFs (and sequential block references for DOCX), delivering structured programmatic citations `[{ document_name, page_number }]` alongside `[Filename, Page X]` inline tags.
- **Configurable Sliding Window Chunking**: Boundary-aware text splitter that respects sentence and paragraph boundaries, maintaining an overlapping context window to prevent mid-sentence truncation.
- **Mathematical Cosine Similarity & Vector Search**: High-performance vector database indexing with Top-K semantic retrieval and strict confidence cutoff thresholds.
- **Strict Anti-Hallucination Guardrails**: Evaluates retrieval similarity scores against confidence thresholds. If confidence is below threshold or context is missing, the LLM is bypassed entirely to return a deterministic fallback: `"I could not find an answer in the provided documents."`
- **Multi-Turn Conversational Memory**: Separate relational database tracks chat sessions and chronological dialogue turns, enabling natural conversational follow-ups and pronoun resolution (e.g., *"How much PTO do employees get?"* -> *"Can they roll it over?"*).
- **Dual Vector & Relational Storage**:
  - **Vector DB**: Fast dense vector similarity search with metadata payloads (`text`, `filename`, `page_number`, `document_id`).
  - **Relational DB**: SQLite persistent store managing `documents`, `sessions`, and sequential `messages` with foreign keys and timestamps.
- **Modern Interactive Web Interface**: Sleek dark-mode single-page application with drag-and-drop document upload, real-time chunk indexing status, citation pill badges, and session switching.

---

## 🏛️ System Architecture

```
                                 THE DUAL-PIPELINE ARCHITECTURE

   ============================ INGESTION PIPELINE (Asynchronous) ============================

   [ Uploaded Files ] ---> [ Document Parser ] ---> [ Text Chunker ] ---> [ Embedding Model ]
      (.pdf / .docx)        PDF: Page Extraction     Sliding Window          OpenAI / Local
                            DOCX: Block Mapping      Size: 1000, Overlap: 200    Dense Vectors
                                                           |                      |
                                                           v                      v
                                                    [ Relational DB ]      [ Vector Store ]
                                                    - documents table      - vector + metadata:
                                                    - sessions table         { text, filename,
                                                    - messages table           page_number }

   ============================== QUERY PIPELINE (Synchronous) ===============================

   [ User Question ] + [ Session ID ]
          |
          +---> [ Embedding Model ]  (Identical Model: OpenAI text-embedding-3-small / Local)
                      |
                      v  (Query Vector)
          [ Vector Database Search ]  (Cosine Similarity, Top-K = 5)
                      |
          < Confidence Threshold Filter (Score >= 0.65) >
             /                                      \
    [ Below Threshold ]                    [ Above Threshold ]
            |                                       |
    [ Immediate Bypass ]                   [ Fetch Recent History ] (SQLite last 3-5 turns)
            |                                       |
    "I could not find an answer..."        [ Augmented Grounded Prompt ]
                                                    |
                                           [ LLM Generation (Temp: 0.0) ]
                                                    |
                                           [ Extract Citations & Persist ]
                                                    |
                                           { answer, citations, session_id }
```

---

## 📐 Text Chunking Strategy

Large Language Models operate on finite context windows, and embedding entire 500-page manuals into single vectors dilutes semantic information. VeriRAG implements a configurable sliding-window chunking strategy:

1. **Target Chunk Size**: Defaults to `1000` characters. This provides sufficient semantic density for paragraphs while fitting multiple chunks comfortably inside the LLM prompt.
2. **Chunk Overlap**: Defaults to `200` characters (~20%). Overlapping slices ensure that critical sentences or relational facts spanning chunk boundaries are not arbitrarily severed in half.
3. **Boundary Awareness**: The algorithm searches backward within the last 20% of the chunk window for natural linguistic delimiters (paragraph breaks `\n\n`, sentence terminators `. `, `? `, `! `, or whitespace) before falling back to character slicing.
4. **Metadata Attachment**: Each resulting chunk is tagged with its source `document_id`, `filename`, `page_number`, and sequential `chunk_index`. When a chunk matches a query, the exact source page is immediately available for citation generation without requiring table joins.

---

## 🚀 Quickstart & Single-Command Setup

### Prerequisites
- **Node.js** (v18.x, v20.x, or v22+/v24+)
- **npm** (v9+)
- *(Optional)* **OpenAI API Key** (if you wish to use live OpenAI `text-embedding-3-small` and `gpt-4o-mini`). The system includes a zero-dependency local semantic vectorizer and grounded synthesizer that works out-of-the-box for offline demo and testing!

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd rag_system
npm install
```

### 2. Configure Environment
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Edit `.env` if you have an OpenAI API key:
```env
PORT=3000
OPENAI_API_KEY=sk-your-openai-key-here
LLM_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
VECTOR_SIMILARITY_THRESHOLD=0.65
TOP_K=5
```
*(If `OPENAI_API_KEY` is omitted or left blank, the system automatically uses its local semantic vectorizer and deterministic synthesizer).*

### 3. Start Application
```bash
npm start
```
The server will start on `http://localhost:3000`.

- **Web Interface**: Open your browser at `http://localhost:3000`
- **Health Endpoint**: `http://localhost:3000/api/health`

### 🐳 Docker Single-Command Setup (Optional)
You can also launch the entire system inside an isolated container with Docker:
```bash
docker compose up -d --build
```
Access the application at `http://localhost:3000`. To stop the container:
```bash
docker compose down
```

---

## 🧪 Running Automated Tests

Run the complete suite of 29 unit, integration, error handling, and scenario tests:
```bash
npm test
```

### Test Coverage Highlights:
- **`tests/chunking.test.js`**: Verifies text splitting, sliding-window overlap, sentence boundary retention, and multi-page metadata attachment.
- **`tests/document.test.js`**: Verifies file type validation, multi-page PDF parsing with exact page numbers, and DOCX sequential block parsing.
- **`tests/vector_store.test.js`**: Verifies mathematical cosine similarity calculation, vector upserting, Top-K ordering, and threshold filtering.
- **`tests/relational.test.js`**: Verifies SQLite document logging, session creation, and chronological message history retrieval.
- **`tests/e2e_rag.test.js`**: Deterministic verification of the 4 Phase 6 scenarios:
  1. *Ingestion Verification*: Direct vector search matching unique keywords.
  2. *Context Boundary Testing*: Multi-document synthesis with dual citations.
  3. *Hallucination Prevention*: Graceful fallback on out-of-scope queries (`"What is the capital of France?"`).
  4. *Conversational Follow-up*: Multi-turn dialogue with pronoun resolution (`"they"`).
- **`tests/api.test.js`**: HTTP integration tests for `POST /api/upload`, `POST /api/chat`, and `GET /api/documents`.
- **`tests/error_handling.test.js`**: Rejection of unsupported file formats, empty queries, invalid payloads, and boundary conditions.

---

## 📡 API Reference & Examples

### 1. Upload Documents
**Endpoint**: `POST /api/upload`  
**Content-Type**: `multipart/form-data`  
**Field Name**: `files` (or `file`)

#### cURL Example:
```bash
curl -X POST http://localhost:3000/api/upload \
  -F "files=@./employee_handbook.pdf" \
  -F "files=@./contractor_guidelines.docx"
```

#### Successful Response (`200 OK`):
```json
{
  "message": "Successfully processed 2 document(s).",
  "documents_processed": 2,
  "documents": [
    {
      "document_id": "f48b95e2-63f2-4917-a00e-d7f26d97e283",
      "filename": "employee_handbook.pdf",
      "chunks_created": 6,
      "pages_parsed": 3
    },
    {
      "document_id": "b12e34fa-42f1-419b-8f7a-82e742a981c2",
      "filename": "contractor_guidelines.docx",
      "chunks_created": 4,
      "pages_parsed": 2
    }
  ]
}
```

---

### 2. Chat / Query Documents
**Endpoint**: `POST /api/chat`  
**Content-Type**: `application/json`

#### Request Payload:
```json
{
  "query": "What is the PTO policy for employees versus contractors?",
  "session_id": "optional-session-id-for-conversation-continuity"
}
```

#### cURL Example:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the PTO policy for employees versus contractors?"}'
```

#### Response (`200 OK`):
```json
{
  "answer": "Full-time employees receive 20 days of paid time off (PTO) per year [employee_handbook.pdf, Page 1]. Contractors operate on hourly billing and are strictly not eligible for PTO or corporate benefits [contractor_guidelines.docx, Page 1].",
  "citations": [
    {
      "document_name": "employee_handbook.pdf",
      "page_number": 1
    },
    {
      "document_name": "contractor_guidelines.docx",
      "page_number": 1
    }
  ],
  "session_id": "4b92b678-75b2-4d22-9df7-5da3eb6060c2"
}
```

---

### 3. Conversational Follow-Up with Session ID
To ask follow-up questions referencing past dialogue turns (e.g. using pronouns like *"they"*):

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Can they roll it over into the next year?",
    "session_id": "4b92b678-75b2-4d22-9df7-5da3eb6060c2"
  }'
```

---

### 4. Hallucination Prevention / Graceful Failure
When asking an out-of-scope question that is not present in the indexed documents:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the capital of France?"}'
```

#### Response (`200 OK`):
```json
{
  "answer": "I could not find an answer in the provided documents.",
  "citations": [],
  "session_id": "78201de9-892f-4889-9a74-95cfd9d17d5e"
}
```

---

### 5. List Indexed Documents
```bash
curl http://localhost:3000/api/documents
```

### 6. Health & Diagnostics
```bash
curl http://localhost:3000/api/health
```

---

## 📁 Repository Layout

```
rag_system/
├── src/
│   ├── api/
│   │   └── routes.js          # Express route handlers for upload, chat, health
│   ├── core/
│   │   └── rag.js             # RAG dual-pipeline orchestrator
│   ├── services/
│   │   ├── document.js        # PDF & DOCX extraction with page numbers
│   │   ├── chunking.js        # Sliding window chunking algorithm
│   │   ├── embedding.js       # Vectorization integration (OpenAI & calibrated dense)
│   │   └── llm.js             # Grounded prompt construction & citation extraction
│   ├── database/
│   │   ├── vector_store.js    # Cosine similarity vector store & threshold filtering
│   │   └── relational.js      # SQLite persistent state for documents, sessions, messages
│   └── index.js               # Application entry point & static UI server
├── public/                    # Interactive Web Frontend
│   ├── index.html             # Responsive chat and upload interface
│   ├── style.css              # Dark-mode styling, glassmorphism, citation pills
│   └── app.js                 # Frontend state, drag & drop, citation rendering
├── tests/                     # Automated test suites
│   ├── test_helpers.js        # PDF & DOCX generation utilities for testing
│   ├── chunking.test.js       # Chunking algorithms & overlap unit tests
│   ├── document.test.js       # Document parsing & page number retention tests
│   ├── vector_store.test.js   # Vector store & cosine similarity unit tests
│   ├── relational.test.js     # Relational database & session history unit tests
│   ├── e2e_rag.test.js        # Phase 6 deterministic RAG scenario verification
│   └── api.test.js            # HTTP endpoints integration tests
├── data/                      # Persistent SQLite DB and Vector storage
├── .env.example               # Documented environment variables
├── package.json               # Dependencies & scripts
└── README.md                  # System documentation
```

---

## 🔒 Configuration & Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for the HTTP server |
| `NODE_ENV` | `development` | Node environment (`development`, `production`, `test`) |
| `OPENAI_API_KEY` | *(empty)* | Optional OpenAI API key for live embeddings & LLM |
| `LLM_MODEL` | `gpt-4o-mini` | LLM generation model |
| `EMBEDDING_MODEL` | `text-embedding-3-small`| Embedding model name |
| `VECTOR_DB_PROVIDER` | `local` | Vector store provider (`local`, `qdrant`, `chroma`) |
| `VECTOR_SIMILARITY_THRESHOLD` | `0.65` | Minimum cosine similarity confidence cutoff |
| `TOP_K` | `5` | Top-K context chunks retrieved per query |
| `DATABASE_URL` | `sqlite:///./data/rag_history.db` | Path to persistent relational SQLite database |
| `CHUNK_SIZE` | `1000` | Target character size for text chunks |
| `CHUNK_OVERLAP` | `200` | Overlap character count between consecutive chunks |

---

## 📄 License
MIT License. Built for enterprise RAG and verifiable question answering.
