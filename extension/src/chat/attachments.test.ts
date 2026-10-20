import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxText, MAX_PDF_BYTES, MAX_TEXT_CHARS, readAttachment } from './attachments';

const docx = (body: string) =>
  zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`), '[Content_Types].xml': strToU8('<Types/>') });

describe('readAttachment', () => {
  it('pulls paragraphs, tabs, and characters out of a .docx', async () => {
    const bytes = docx('<w:p><w:r><w:t>Victor &amp; the Creature</w:t></w:r></w:p><w:p><w:r><w:t>Ch.</w:t><w:tab/><w:t>10</w:t></w:r></w:p>');
    expect(docxText(bytes).trim()).toBe('Victor & the Creature\nCh.\t10');
    const r = await readAttachment(new File([bytes], 'Essay.docx'));
    expect(r).toEqual({ ok: true, attachment: { kind: 'text', name: 'Essay.docx', text: 'Victor & the Creature\nCh.\t10', truncated: false } });
  });

  it('reads text files up to the limit and says when it cut one', async () => {
    const r = await readAttachment(new File(['a'.repeat(MAX_TEXT_CHARS + 5)], 'notes.md'));
    expect(r.ok && r.attachment.kind === 'text' && [r.attachment.text.length, r.attachment.truncated]).toEqual([MAX_TEXT_CHARS, true]);
  });

  it('refuses a PDF over 10 MB and a file type it can\'t read, in one sentence each', async () => {
    const big = new File([new Uint8Array(MAX_PDF_BYTES + 1)], 'scan.pdf', { type: 'application/pdf' });
    expect(await readAttachment(big)).toEqual({ ok: false, error: "scan.pdf is over 10 MB, so Loomer can't send it." });
    expect(await readAttachment(new File(['x'], 'slides.key'))).toEqual({ ok: false, error: 'Loomer can read images, PDFs, Word files, and text files, but not slides.key.' });
  });
});
