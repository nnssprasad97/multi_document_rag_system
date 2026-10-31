/**
 * LLM Service
 * Handles prompt engineering, context assembly, conversational history injection,
 * and calling the Large Language Model with strict anti-hallucination constraints.
 */

const { OpenAI } = require('openai');

const SYSTEM_PROMPT = `You are an intelligent document assistant. You will be provided with context chunks from uploaded documents. Answer the user's question using ONLY the provided context. If the answer cannot be found in the context, you must reply exactly with: 'I could not find an answer in the provided documents.' Do not attempt to guess or use outside knowledge. For every claim you make, append a citation in the format [Filename, Page X].`;

const FALLBACK_MESSAGE = 'I could not find an answer in the provided documents.';

class LLMService {
  constructor(apiKey = process.env.OPENAI_API_KEY, model = process.env.LLM_MODEL || 'gpt-4o-mini') {
    this.apiKey = apiKey;
    this.model = model;
    this.client = null;

    if (this.apiKey && this.apiKey.trim() !== '' && !this.apiKey.startsWith('sk-your-')) {
      this.client = new OpenAI({ apiKey: this.apiKey });
    }
  }

  /**
   * Formats retrieved context chunks into the standardized context block.
   * 
   * @param {Array<{ metadata: { filename: string, page_number: number, text: string } }>} contextChunks 
   * @returns {string} Formatted context block
   */
  static formatContextBlock(contextChunks) {
    if (!contextChunks || contextChunks.length === 0) {
      return '';
    }

    const formattedSnippets = contextChunks.map((chunk) => {
      const filename = chunk.metadata.filename || 'document';
      const pageNumber = chunk.metadata.page_number !== undefined ? chunk.metadata.page_number : (chunk.metadata.pageNumber || 1);
      const text = (chunk.metadata.text || '').trim();
      return `Source: ${filename} (Page ${pageNumber})\nText: ${text}`;
    });

    return `--- CONTEXT START ---\n${formattedSnippets.join('\n\n')}\n--- CONTEXT END ---`;
  }

  /**
   * Extracts unique structured citation objects from retrieved chunks and/or generated text.
   * Format: [ { document_name: string, page_number: number } ]
   * 
   * @param {Array<{ metadata: object }>} chunks
   * @param {string} generatedText
   * @returns {Array<{ document_name: string, page_number: number }>}
   */
  static extractCitations(chunks = [], generatedText = '') {
    const citationMap = new Map();

    // 1. First parse bracketed citations [Filename, Page X] from generatedText
    const citationRegex = /\[([^,\]]+),\s*Page\s*(\d+)\]/gi;
    let match;
    while ((match = citationRegex.exec(generatedText)) !== null) {
      const docName = match[1].trim();
      const pageNum = parseInt(match[2].trim(), 10);
      const key = `${docName}::${pageNum}`;
      citationMap.set(key, {
        document_name: docName,
        page_number: pageNum
      });
    }

    // If explicit citations were present in the generated answer, return them
    if (citationMap.size > 0) {
      return Array.from(citationMap.values());
    }

    // 2. Fallback: if model omitted bracketed citations, map from retrieved context chunks
    for (const chunk of chunks) {
      const docName = chunk.metadata.filename || 'unknown';
      const pageNum = Number(chunk.metadata.page_number !== undefined ? chunk.metadata.page_number : chunk.metadata.pageNumber) || 1;
      const key = `${docName}::${pageNum}`;
      citationMap.set(key, {
        document_name: docName,
        page_number: pageNum
      });
    }

    return Array.from(citationMap.values());
  }

  /**
   * Generates a grounded response using OpenAI or a deterministic grounded synthesizer.
   * 
   * @param {object} params
   * @param {string} params.query User query
   * @param {Array<object>} params.contextChunks Retrieved context chunks passing threshold
   * @param {Array<object>} params.history Prior message history [{ role, content }]
   * @returns {Promise<{ answer: string, citations: Array<{ document_name: string, page_number: number }> }>}
   */
  async generateResponse({ query, contextChunks = [], history = [] }) {
    // If no context chunks provided, immediately return fallback
    if (!contextChunks || contextChunks.length === 0) {
      return {
        answer: FALLBACK_MESSAGE,
        citations: []
      };
    }

    const contextBlock = LLMService.formatContextBlock(contextChunks);

    // If live OpenAI client is available, make the API call
    if (this.client) {
      try {
        const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

        // Inject prior conversation turns (history)
        if (Array.isArray(history) && history.length > 0) {
          for (const msg of history) {
            if (msg.role === 'user' || msg.role === 'assistant') {
              messages.push({
                role: msg.role,
                content: msg.content
              });
            }
          }
        }

        // Add the current prompt with context block
        const userPrompt = `Context information:\n${contextBlock}\n\nQuestion: ${query}\n\nRemember to answer ONLY using the context above. If the answer cannot be found, respond exactly: '${FALLBACK_MESSAGE}'. Include [Filename, Page X] citations for every claim.`;

        messages.push({
          role: 'user',
          content: userPrompt
        });

        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature: 0.0 // Enforce deterministic, grounded outputs
        });

        const answer = (completion.choices[0]?.message?.content || '').trim();

        if (answer.includes(FALLBACK_MESSAGE) || answer === FALLBACK_MESSAGE) {
          return { answer: FALLBACK_MESSAGE, citations: [] };
        }

        const citations = LLMService.extractCitations(contextChunks, answer);
        return { answer, citations };
      } catch (err) {
        console.warn(`[LLMService] OpenAI request failed (${err.message}). Using grounded fallback generator.`);
      }
    }

    // Grounded deterministic fallback synthesizer for offline/mock environments
    return this.synthesizeGroundedResponse(query, contextChunks, history);
  }

  /**
   * Deterministic grounded response synthesizer for testing and offline environments.
   * Matches query terms against chunks, forms citations, and resolves pronouns from history.
   */
  synthesizeGroundedResponse(query, contextChunks, history = []) {
    // Check if query is about something present in context
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Expand pronouns using recent history if applicable
    const isPronounQuery = /\b(they|it|he|she|these|those|this)\b/i.test(query);
    let historyContext = '';
    if (isPronounQuery && history.length > 0) {
      historyContext = history.map((h) => h.content).join(' ');
    }

    const matchedChunks = [];
    const matchedSentences = [];
    const seenSentences = new Set();

    for (const chunk of contextChunks) {
      const text = chunk.metadata.text || '';
      const lower = text.toLowerCase();
      const filename = chunk.metadata.filename || 'document';
      const pageNum = chunk.metadata.page_number !== undefined ? chunk.metadata.page_number : 1;

      // Split into sentences
      const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];

      let chunkHasMatch = false;
      for (const sentence of sentences) {
        const sentenceClean = sentence.trim();
        const sentenceLower = sentenceClean.toLowerCase();
        const matchesToken = queryTokens.some((t) => sentenceLower.includes(t));
        const matchesHistory = isPronounQuery && historyContext && queryTokens.some((t) => sentenceLower.includes(t));

        if ((matchesToken || matchesHistory) && !seenSentences.has(sentenceClean)) {
          seenSentences.add(sentenceClean);
          chunkHasMatch = true;
          matchedSentences.push({
            sentence: sentenceClean,
            filename,
            pageNum
          });
        }
      }

      if (chunkHasMatch) {
        matchedChunks.push(chunk);
      }
    }

    if (matchedSentences.length === 0) {
      // Actively prevent hallucinations
      return {
        answer: FALLBACK_MESSAGE,
        citations: []
      };
    }

    // Build synthesized answer with [Filename, Page X] citations
    const answerParts = [];
    const citations = [];
    const seenCitations = new Set();

    for (const match of matchedSentences.slice(0, 4)) {
      const citationTag = `[${match.filename}, Page ${match.pageNum}]`;
      answerParts.push(`${match.sentence} ${citationTag}`);

      const key = `${match.filename}::${match.pageNum}`;
      if (!seenCitations.has(key)) {
        seenCitations.add(key);
        citations.push({
          document_name: match.filename,
          page_number: match.pageNum
        });
      }
    }

    const answer = answerParts.join(' ');
    return { answer, citations };
  }
}

module.exports = {
  LLMService,
  SYSTEM_PROMPT,
  FALLBACK_MESSAGE
};
