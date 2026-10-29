/**
 * VeriRAG Client-Side Application
 * Handles file ingestion, message bubbling, citation rendering, and conversational sessions.
 */

let currentSessionId = localStorage.getItem('rag_active_session_id') || null;

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');
const btnNewChat = document.getElementById('btn-new-chat');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadProgress = document.getElementById('upload-progress');
const uploadStatusText = document.getElementById('upload-status-text');
const docList = document.getElementById('doc-list');
const docCountBadge = document.getElementById('doc-count');
const vectorCountLabel = document.getElementById('vector-count-label');
const modelLabel = document.getElementById('model-label');
const sessionPill = document.getElementById('pill-active-session');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  updateSessionPill();
  loadDocuments();
  loadHealth();
  setupEventListeners();
});

function updateSessionPill() {
  if (currentSessionId) {
    sessionPill.textContent = `Session: ${currentSessionId.substring(0, 8)}...`;
  } else {
    sessionPill.textContent = 'Session: New';
  }
}

function setupEventListeners() {
  // New conversation button
  btnNewChat.addEventListener('click', () => {
    currentSessionId = null;
    localStorage.removeItem('rag_active_session_id');
    updateSessionPill();
    chatMessages.innerHTML = `
      <div class="welcome-card">
        <div class="welcome-icon">⚡</div>
        <h2>New Conversation Started</h2>
        <p>Your previous context has been reset. Ask questions about your ingested documents below.</p>
        <div class="sample-queries">
          <button class="sample-chip" data-query="What is the employee paid time off policy?">"What is the PTO policy?"</button>
          <button class="sample-chip" data-query="Can contractors receive corporate benefits?">"Can contractors receive benefits?"</button>
          <button class="sample-chip" data-query="What is the capital of France?">"Capital of France?" (Hallucination test)</button>
        </div>
      </div>
    `;
    attachSampleChips();
    chatInput.focus();
  });

  // Dropzone click & drag
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFileUpload(dt.files);
    }
  });

  // Chat submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitChat();
  });

  // Auto-resize textarea & submit on Enter (Shift+Enter for newline)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  });

  attachSampleChips();
}

function attachSampleChips() {
  document.querySelectorAll('.sample-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chatInput.value = chip.dataset.query;
      submitChat();
    });
  });
}

// Upload file handler
async function handleFileUpload(fileList) {
  if (!fileList || fileList.length === 0) return;

  const formData = new FormData();
  let validCount = 0;

  for (const file of fileList) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext === '.pdf' || ext === '.docx') {
      formData.append('files', file);
      validCount++;
    }
  }

  if (validCount === 0) {
    alert('Please select valid .pdf or .docx files.');
    return;
  }

  uploadProgress.classList.remove('hidden');
  uploadStatusText.textContent = `Uploading & chunking ${validCount} file(s)...`;

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Upload failed');
    }

    uploadStatusText.textContent = `Ingested ${data.documents_processed} document(s) successfully!`;
    setTimeout(() => {
      uploadProgress.classList.add('hidden');
    }, 2500);

    loadDocuments();
    loadHealth();
  } catch (err) {
    alert(`Upload Error: ${err.message}`);
    uploadProgress.classList.add('hidden');
  } finally {
    fileInput.value = '';
  }
}

// Load documents list
async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
    const data = await res.json();
    const docs = data.documents || [];

    docCountBadge.textContent = docs.length;

    if (docs.length === 0) {
      docList.innerHTML = '<div class="empty-state">No documents ingested yet</div>';
      return;
    }

    docList.innerHTML = docs
      .map(
        (doc) => `
        <div class="doc-item">
          <div class="doc-item-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span>${escapeHtml(doc.filename)}</span>
          </div>
          <div class="doc-item-meta">
            <span>${doc.page_count} page(s)</span>
            <span>•</span>
            <span>${doc.chunk_count} chunk(s)</span>
          </div>
        </div>
      `
      )
      .join('');
  } catch (err) {
    console.error('Failed to load documents:', err);
  }
}

// Load health & stats
async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.vector_count !== undefined) {
      vectorCountLabel.textContent = `Vectors: ${data.vector_count}`;
    }
    if (data.config?.embeddingInfo) {
      modelLabel.textContent = `Model: ${data.config.embeddingInfo.model}`;
    }
  } catch (err) {
    console.error('Failed to load health:', err);
  }
}

// Send user query
async function submitChat() {
  const query = chatInput.value.trim();
  if (!query) return;

  chatInput.value = '';
  chatInput.disabled = true;
  btnSend.disabled = true;

  // Append user bubble
  appendMessage('user', query);

  // Append typing indicator bubble
  const typingRow = appendTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        session_id: currentSessionId
      })
    });

    const data = await res.json();
    typingRow.remove();

    if (!res.ok) {
      throw new Error(data.message || data.error || 'Query failed');
    }

    if (data.session_id) {
      currentSessionId = data.session_id;
      localStorage.setItem('rag_active_session_id', currentSessionId);
      updateSessionPill();
    }

    // Append assistant bubble with citations
    appendMessage('assistant', data.answer, data.citations);
    loadHealth();
  } catch (err) {
    typingRow.remove();
    appendMessage('assistant', `Error executing query: ${err.message}`);
  } finally {
    chatInput.disabled = false;
    btnSend.disabled = false;
    chatInput.focus();
  }
}

function appendMessage(role, text, citations = []) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role === 'user' ? 'avatar-user' : 'avatar-bot'}`;
  avatar.textContent = role === 'user' ? 'U' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // Format main message text
  bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

  const isFallback = text.includes('I could not find an answer in the provided documents.');
  if (isFallback) {
    const badge = document.createElement('div');
    badge.className = 'fallback-indicator';
    badge.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      Grounded Fallback Triggered (Low Confidence / Out of Scope)
    `;
    bubble.appendChild(badge);
  }

  // Render citations if provided
  if (citations && citations.length > 0) {
    const citationsBox = document.createElement('div');
    citationsBox.className = 'citations-box';

    const header = document.createElement('div');
    header.className = 'citations-header';
    header.textContent = 'Sources & Citations:';
    citationsBox.appendChild(header);

    const chips = document.createElement('div');
    chips.className = 'citations-chips';

    citations.forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'citation-chip';
      chip.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        ${escapeHtml(c.document_name)} (Page ${c.page_number})
      `;
      chips.appendChild(chip);
    });

    citationsBox.appendChild(chips);
    bubble.appendChild(citationsBox);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);

  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return row;
}

function appendTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row assistant';

  const avatar = document.createElement('div');
  avatar.className = 'avatar avatar-bot';
  avatar.textContent = 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted);">
      <div class="spinner"></div>
      Searching vector space & synthesizing answer...
    </div>
  `;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return row;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
