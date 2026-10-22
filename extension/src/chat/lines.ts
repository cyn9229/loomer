// Small pure helpers shared by the store and the chat model: one line for a
// chat turn, and an attachment's size. Type imports only, so the store can use
// them in its upgrades.
import type { Attachment, ChatBlock } from '../model/chat';

const LINE_CHARS = 120;

/** One line for a turn: its first text, or what kind of thing it showed. */
export function lineOf(blocks: ChatBlock[]): string | null {
  const text = blocks
    .map((b) =>
      b.kind === 'markdown' ? b.text
      : b.kind === 'draft-check' ? b.summary
      : b.kind === 'practice-result' ? b.line
      : b.kind === 'quiz' ? `Quick check: ${b.quiz.concept}`
      : b.kind === 'visual' ? b.visual.title
      : b.kind === 'attachment' ? `Attached ${b.file.name}`
      : '',
    )
    .find((t) => t.trim());
  const line = (text ?? '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS - 1)}…` : line;
}

/** About how many bytes an attachment takes in the store. */
export function attachmentBytes(a: Attachment): number {
  switch (a.kind) {
    case 'image':
      return a.dataUrl.length + a.thumb.length;
    case 'pdf':
      return a.dataUrl.length;
    case 'text':
      return a.text.length * 2;
  }
}
