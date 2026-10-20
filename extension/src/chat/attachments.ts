// Files and screenshots the student attaches to a chat message. Everything is
// read on this computer: images are shrunk, .docx text is pulled out of the
// zip, and text files are read as text. PDFs go to the model as they are (it
// reads them natively). Works in the side panel and the service worker.
import { strFromU8, unzipSync } from 'fflate';
import type { Attachment } from '../model/chat';

export const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_SIDE = 1_600;
const THUMB_SIDE = 320;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 100_000;
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'yaml', 'yml', 'log', 'tex', 'rtf'];

export type AttachResult = { ok: true; attachment: Attachment } | { ok: false; error: string };

const extensionOf = (name: string) => name.toLowerCase().split('.').at(-1) ?? '';

/** Reads one file the student picked, dropped, or pasted. */
export async function readAttachment(file: File): Promise<AttachResult> {
  const ext = extensionOf(file.name);
  try {
    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: `${file.name} is too big, so try an image under 20 MB.` };
      return { ok: true, attachment: await imageAttachment(file, file.name) };
    }
    if (file.type === 'application/pdf' || ext === 'pdf') {
      if (file.size > MAX_PDF_BYTES) return { ok: false, error: `${file.name} is over 10 MB, so Loomer can't send it.` };
      return { ok: true, attachment: { kind: 'pdf', name: file.name, dataUrl: await dataUrlOf(file, 'application/pdf'), bytes: file.size } };
    }
    if (ext === 'docx') return { ok: true, attachment: textAttachment(file.name, docxText(new Uint8Array(await file.arrayBuffer()))) };
    if (file.type.startsWith('text/') || TEXT_EXTENSIONS.includes(ext)) return { ok: true, attachment: textAttachment(file.name, await file.text()) };
  } catch (error) {
    console.warn('loomer: attachment unreadable', error);
    return { ok: false, error: `Loomer couldn't read ${file.name}, so try saving it again or as a PDF.` };
  }
  return { ok: false, error: `Loomer can read images, PDFs, Word files, and text files, but not ${file.name}.` };
}

function textAttachment(name: string, text: string): Attachment {
  const clean = text.replace(/\r\n/g, '\n').trim();
  return { kind: 'text', name, text: clean.slice(0, MAX_TEXT_CHARS), truncated: clean.length > MAX_TEXT_CHARS };
}

/** The paragraphs of a .docx file as plain text (tables and comments flatten to text). */
export function docxText(bytes: Uint8Array): string {
  const xml = strFromU8(unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'] ?? new Uint8Array());
  if (!xml) throw new Error('No word/document.xml in this file.');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n');
}

/** A shrunk JPEG copy of an image, plus a small thumbnail for the chat. */
export async function imageAttachment(source: Blob, name: string): Promise<Attachment> {
  const bitmap = await createImageBitmap(source);
  const full = await jpeg(bitmap, MAX_IMAGE_SIDE, 0.85);
  const thumb = await jpeg(bitmap, THUMB_SIDE, 0.7);
  bitmap.close();
  return { kind: 'image', name, dataUrl: await dataUrlOf(full.blob, 'image/jpeg'), width: full.width, height: full.height, thumb: await dataUrlOf(thumb.blob, 'image/jpeg') };
}

async function jpeg(bitmap: ImageBitmap, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  // White under transparent PNGs, so JPEG doesn't turn them black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality }), width, height };
}

async function dataUrlOf(blob: Blob, type: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/**
 * A screenshot from the side panel. Chrome only lets an extension capture a
 * tab directly after a right-click or a shortcut, so the panel asks Chrome's
 * own share picker for one frame of the tab, window, or screen the student
 * picks, then stops sharing at once. Call it inside the click.
 */
export async function captureScreen(): Promise<AttachResult> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    // Closing the picker is a choice, not an error.
    if (error instanceof DOMException && error.name === 'NotAllowedError') return { ok: false, error: '' };
    return { ok: false, error: "Chrome didn't allow a screenshot here, so right-click the page and choose Send screenshot to Ask Loomer." };
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const frame = await createImageBitmap(video);
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    canvas.getContext('2d')!.drawImage(frame, 0, 0);
    frame.close();
    return { ok: true, attachment: await imageAttachment(await canvas.convertToBlob({ type: 'image/png' }), 'Screenshot.jpg') };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
