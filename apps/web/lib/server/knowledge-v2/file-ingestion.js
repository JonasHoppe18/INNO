import { KnowledgeAuthzError } from './authz.js';

export const MAX_KNOWLEDGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 250_000;
const MAX_PDF_PAGES = 200;

function reject(status, code, message) {
  throw new KnowledgeAuthzError(status, code, message);
}
function canonicalText(value) {
  const text = String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) reject(422, 'file_no_text', 'The file contains no readable text. Upload a text-based PDF or UTF-8 TXT file.');
  if (text.length > MAX_TEXT_CHARACTERS) reject(413, 'file_text_too_large', 'The extracted text exceeds the supported document size.');
  return text;
}

// Decode uploaded bytes only. No URL fetch, OCR, model call or knowledge write.
export async function extractFileSource({ fileName, mimeType, rawBytes }) {
  if (!(rawBytes instanceof Uint8Array) || !rawBytes.byteLength)
    reject(400, 'file_empty', 'Choose a non-empty PDF or TXT file.');
  if (rawBytes.byteLength > MAX_KNOWLEDGE_FILE_BYTES)
    reject(413, 'file_too_large', 'Knowledge files must be at most 10 MB.');
  const name = String(fileName || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').slice(0, 180);
  const extension = name.split('.').pop().toLowerCase();
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!['pdf', 'txt'].includes(extension)) reject(415, 'file_type_unsupported', 'Choose a PDF or TXT file.');
  const expectedMime = extension === 'pdf' ? 'application/pdf' : 'text/plain';
  if (mime && mime !== 'application/octet-stream' && mime !== expectedMime)
    reject(415, 'file_type_mismatch', 'The file type does not match its filename.');
  const isPdf = new TextDecoder('ascii').decode(rawBytes.subarray(0, 5)) === '%PDF-';
  if (isPdf !== (extension === 'pdf')) reject(415, 'file_type_mismatch', 'The file contents do not match the selected file type.');
  let text, pageCount = null;
  if (extension === 'txt') {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes); }
    catch { reject(422, 'file_encoding_unsupported', 'TXT files must use UTF-8 encoding.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
      reject(422, 'file_binary_text', 'The TXT file contains binary data.');
  } else {
    const { PDFParse } = await import('pdf-parse');
    // PDF.js may transfer its input buffer. Preserve original bytes for source hashing/upload.
    const parser = new PDFParse({ data: Uint8Array.from(rawBytes), isEvalSupported: false, verbosity: 0 });
    try {
      const info = await parser.getInfo();
      pageCount = info.total;
      if (!Number.isInteger(pageCount) || pageCount < 1) reject(422, 'file_invalid_pdf', 'The PDF has no readable pages.');
      if (pageCount > MAX_PDF_PAGES) reject(413, 'file_too_many_pages', 'PDF files must contain at most 200 pages.');
      const result = await parser.getText({ pageJoiner: '\n\n' });
      text = result.text;
    } catch (error) {
      if (error instanceof KnowledgeAuthzError) throw error;
      reject(422, 'file_invalid_pdf', 'The PDF could not be read. Upload an unencrypted text-based PDF.');
    } finally { await parser.destroy(); }
  }
  return { fileName: name, title: name.replace(/\.(pdf|txt)$/i, ''), mimeType: expectedMime,
    sizeBytes: rawBytes.byteLength, rawBytes, canonicalText: canonicalText(text),
    kind: extension === 'pdf' ? 'pdf' : 'text', pageCount };
}
