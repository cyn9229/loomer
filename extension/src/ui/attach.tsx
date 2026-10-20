// Attaching files and screenshots in Ask Loomer (round 41, 2A). The paperclip
// in the composer opens File or Screenshot; files can also be dropped on the
// chat or pasted into the composer. Each one is read on this computer
// (readAttachment, captureScreen) and waits in the composer as a small card
// with an x, up to 5. A problem shows as one line above the composer. The
// first time anything is attached, one line says where files go. After
// sending, the files show above the student's message (SentFiles).
import { useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { MAX_ATTACHMENTS, captureScreen, readAttachment, type AttachResult } from '../chat/attachments';
import type { Attachment, AttachmentView } from '../model/chat';
import { Icon, type IconName } from './Icon';
import { usePopover } from './usePopover';

/** What the file picker offers; anything else gets readAttachment's plain error. */
const ACCEPT = 'image/*,.pdf,.docx,.txt,.md,.csv,.tsv,.json,.html,.rtf,.tex';
/** localStorage: the student has seen where attached files go. A per-browser convenience only. */
const NOTE_KEY = 'loomer.attachNoteSeen';

/** One file in the composer: its name, and the read attachment once it is ready (null while reading). */
type Slot = { key: number; name: string; attachment: Attachment | null };

/**
 * Files waiting in the composer, in the order the student added them, the
 * ones still being read, and the latest problem. Each file keeps its slot
 * while it is read, so a slow image never jumps behind a quick text file.
 */
export function useAttachments() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(0);
  // Counted synchronously, so two quick drops can't pass the limit of 5.
  const taken = useRef(0);

  /** Slots for `names`, as many as fit; says which ones won't fit. */
  const reserve = (names: string[]): Slot[] => {
    const room = Math.max(0, MAX_ATTACHMENTS - taken.current);
    const left = names.slice(room);
    if (left.length > 0)
      setError(`You can attach up to ${MAX_ATTACHMENTS} files to one message, so ${left.length === 1 ? `${left[0]} won’t be sent` : `${left.length} files won’t be sent`}.`);
    const fit = names.slice(0, room).map((name) => ({ key: nextKey.current++, name, attachment: null }));
    taken.current += fit.length;
    return fit;
  };

  const settle = (key: number, result: AttachResult) => {
    if (result.ok) {
      setSlots((all) => all.map((slot) => (slot.key === key ? { ...slot, attachment: result.attachment } : slot)));
      return;
    }
    taken.current -= 1;
    setSlots((all) => all.filter((slot) => slot.key !== key));
    // An empty error means the student closed Chrome's picker: nothing to say.
    if (result.error) setError(result.error);
  };

  /** Files the student picked, dropped, or pasted. */
  const addFiles = (list: File[]) => {
    setError(null);
    const fit = reserve(list.map((f) => f.name));
    setSlots((all) => [...all, ...fit]);
    fit.forEach((slot, i) => void readAttachment(list[i]!).then((result) => settle(slot.key, result)));
  };

  /** Attachments read elsewhere (the right-click screenshot inbox). */
  const addRead = (list: Attachment[]) => {
    const fit = reserve(list.map((a) => a.name));
    setSlots((all) => [...all, ...fit.map((slot, i) => ({ ...slot, attachment: list[i]! }))]);
  };

  /** Chrome's share picker for one frame. Must run inside the click, before any await. */
  const screenshot = () => {
    setError(null);
    const [slot] = reserve(['the screenshot']);
    if (!slot) return;
    setSlots((all) => [...all, { ...slot, name: 'Screenshot' }]);
    void captureScreen().then((result) => settle(slot.key, result));
  };

  const remove = (key: number) => {
    taken.current -= 1;
    setSlots((all) => all.filter((slot) => slot.key !== key));
    setError(null);
  };

  const clear = () => {
    taken.current = 0;
    setSlots([]);
    setError(null);
  };

  const files = slots.flatMap((slot) => (slot.attachment ? [slot.attachment] : []));
  const reading = slots.filter((slot) => !slot.attachment).length;
  return { slots, files, reading, error, setError, addFiles, addRead, screenshot, remove, clear };
}

export type Attachments = ReturnType<typeof useAttachments>;

/** The paperclip in the composer and its menu: File or Screenshot. */
export function AttachButton({ attach, disabled }: { attach: Attachments; disabled: boolean }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="attach" ref={ref}>
      <button type="button" className={open ? 'attach-btn on' : 'attach-btn'} aria-label="Attach a file or screenshot" title="Attach" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <Icon name="clip" />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          attach.addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {open && (
        <div className="attach-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            <span className="subject">
              <Icon name="doc" />
            </span>
            <span className="grow">
              <b>File</b>
              <span>A PDF, image, Word, or text file</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              attach.screenshot();
            }}
          >
            <span className="subject">
              <Icon name="screenshot" />
            </span>
            <span className="grow">
              <b>Screenshot</b>
              <span>Pick the tab or window to capture</span>
            </span>
          </button>
          <p className="attach-menu-n">You can also drop or paste files into the chat.</p>
        </div>
      )}
    </div>
  );
}

const fileIcon: Record<Attachment['kind'], IconName> = { image: 'image', pdf: 'pdf', text: 'doc' };

/** "2.4 MB", "4,210 characters", or "Read the first part": the small line under a waiting file's name. */
function waitingDetail(a: Attachment): string {
  if (a.kind === 'pdf') return `${(a.bytes / 1_048_576).toFixed(1)} MB`;
  if (a.kind === 'text') return a.truncated ? 'Read the first part' : `${a.text.length.toLocaleString()} characters`;
  return 'Image';
}

/** The files waiting in the composer, each with an x; one still being read says so. */
export function AttachChips({ attach }: { attach: Attachments }) {
  if (attach.slots.length === 0) return null;
  return (
    <div className="attach-chips">
      {attach.slots.map(({ key, name, attachment: a }) =>
        a?.kind === 'image' ? (
          <span className="attach-img" key={key} title={a.name}>
            <img src={a.thumb} alt={a.name} />
            <RemoveButton name={a.name} onClick={() => attach.remove(key)} />
          </span>
        ) : (
          <span className={a ? 'attach-file' : 'attach-file reading'} key={key} role={a ? undefined : 'status'}>
            <span className="subject">
              <Icon name={a ? fileIcon[a.kind] : 'clock'} />
            </span>
            <span className="attach-fb">
              <b>{name}</b>
              <span>{a ? waitingDetail(a) : 'Reading…'}</span>
            </span>
            {a && <RemoveButton name={name} onClick={() => attach.remove(key)} />}
          </span>
        ),
      )}
    </div>
  );
}

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="attach-x" aria-label={`Remove ${name}`} title="Remove" onClick={onClick}>
      <Icon name="x" size="xs" />
    </button>
  );
}

/**
 * One line above the composer: the latest problem, or, the first time files
 * wait to be sent, where they go. Got it hides that line for good.
 */
export function AttachNote({ attach }: { attach: Attachments }) {
  const [seen, setSeen] = useState(() => readSeen());
  if (attach.error)
    return (
      <p className="attach-err" role="alert">
        <Icon name="alert" size="sm" />
        <span className="grow">{attach.error}</span>
        <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => attach.setError(null)}>
          <Icon name="x" size="sm" />
        </button>
      </p>
    );
  if (seen || attach.files.length === 0) return null;
  return (
    <p className="attach-note">
      <Icon name="lock" size="sm" />
      <span className="grow">Files and screenshots you attach go to the AI only with that message and stay on this computer.</span>
      <button
        type="button"
        className="link"
        onClick={() => {
          writeSeen();
          setSeen(true);
        }}
      >
        Got it
      </button>
    </p>
  );
}

/** After the first send with files, the privacy line has done its job. */
export function markAttachNoteSeen() {
  writeSeen();
}

function readSeen(): boolean {
  try {
    return localStorage.getItem(NOTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    localStorage.setItem(NOTE_KEY, '1');
  } catch {
    // Private windows can refuse storage; the line just shows again next time.
  }
}

/**
 * Drag files over the chat to attach them. `over` drives the overlay; the
 * counter keeps it steady while the pointer crosses child elements.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => enabled && e.dataTransfer.types.includes('Files');
  return {
    over,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (hasFiles(e)) e.preventDefault();
      },
      onDragLeave: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      },
    },
  };
}

/** The overlay while files are dragged over the chat. In a portal on <body>, like Sheet, so it covers the panel. */
export function DropOverlay() {
  return createPortal(
    <div className="attach-drop" aria-hidden="true">
      <span className="subject lg">
        <Icon name="upload" />
      </span>
      <p className="attach-drop-t">Drop to attach</p>
      <p className="attach-drop-s">PDFs up to 10 MB, images, Word, and text files. Up to {MAX_ATTACHMENTS} at a time.</p>
    </div>,
    document.body,
  );
}

/** Sent files above the student's message: a screenshot or image as a picture, anything else as a card. */
export function SentFiles({ files }: { files: AttachmentView[] }) {
  return (
    <div className="sent-files">
      {files.map((f, i) =>
        f.kind === 'image' && f.thumb ? (
          <img key={i} className="sent-img" src={f.thumb} alt={f.name} title={f.name} />
        ) : (
          <span key={i} className="sent-file">
            <span className="subject">
              <Icon name={fileIcon[f.kind]} />
            </span>
            <span className="attach-fb">
              <b>{f.name}</b>
              <span>{f.detail}</span>
            </span>
          </span>
        ),
      )}
    </div>
  );
}
