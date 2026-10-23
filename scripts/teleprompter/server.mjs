// Local teleprompter for recording the demo narration.
// Serves the page, hands it docs/demo-voiceover.md, saves edits to one section's
// narration back into that file, and streams each recorded take to takes/
// (git-ignored) with an index of section, take number, and length.
//
//   npm run teleprompter    then open http://127.0.0.1:8790
//
// Binds to 127.0.0.1 only: localhost counts as a secure origin, so Chrome
// allows camera and mic access without HTTPS.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SCRIPT = join(root, 'docs', 'demo-voiceover.md');
const TAKES = join(root, 'takes');
const INDEX = join(TAKES, 'index.json');
const PORT = 8790;

const TYPES = { mp4: 'video/mp4', webm: 'video/webm', m4a: 'audio/mp4', weba: 'audio/webm' };

mkdirSync(TAKES, { recursive: true });

const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : []);

// Next free take number for a section, counted from the files on disk so a
// deleted index never causes an overwrite.
const nextTake = (section) => {
  const pattern = new RegExp(`^${section}-take(\\d+)\\.`);
  const used = readdirSync(TAKES).map((f) => Number(f.match(pattern)?.[1] ?? 0));
  return Math.max(0, ...used) + 1;
};

const send = (res, status, body, type = 'application/json', headers = {}) => {
  res.writeHead(status, { 'content-type': type, ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

// Fingerprint of the script the page loaded. A save is refused when the file
// changed since then, so edits made elsewhere are never overwritten.
const version = (md) => createHash('sha256').update(md).digest('hex').slice(0, 16);

// Replaces the narration paragraphs of the index-th "### " section (counted the
// same way as the page) and keeps its heading, "On screen" line, and any "---"
// separator. Everything from "## Fit" on is left untouched.
function replaceSection(md, index, paras) {
  const fit = md.search(/^## Fit/m);
  const body = fit < 0 ? md : md.slice(0, fit);
  const [pre, ...blocks] = body.split(/^### /m);
  const block = blocks[index];
  if (block === undefined) throw new Error(`no section ${index}`);
  const [heading, ...lines] = block.split('\n');
  const cue = lines.find((l) => l.startsWith('**On screen:**'));
  const separator = block.trimEnd().endsWith('\n---') ? '---\n\n' : '';
  blocks[index] = `${heading}\n${cue ? `${cue}\n` : ''}\n${paras.join('\n\n')}\n\n${separator}`;
  return pre + blocks.map((b) => `### ${b}`).join('') + (fit < 0 ? '' : md.slice(fit));
}

const readJson = async (req) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  return JSON.parse(text);
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(join(here, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/script') {
      const md = readFileSync(SCRIPT, 'utf8');
      return send(res, 200, md, 'text/markdown; charset=utf-8', { 'x-version': version(md) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/section') {
      const { index, base, paras } = await readJson(req);
      // One paragraph per line in the file; drop blanks and anything that would
      // read as a heading or cue and shift the sections.
      const clean = Array.isArray(paras)
        ? paras.map((p) => String(p).replace(/\s+/g, ' ').trim()).filter((p) => p && !/^(#|\*\*On screen|---)/.test(p))
        : [];
      if (!Number.isInteger(index) || typeof base !== 'string' || !clean.length) {
        return send(res, 400, { error: 'bad edit' });
      }
      const md = readFileSync(SCRIPT, 'utf8');
      if (version(md) !== base) return send(res, 409, { error: 'script changed on disk' });
      const next = replaceSection(md, index, clean);
      writeFileSync(SCRIPT, next);
      console.log(`saved section ${index + 1} to docs/demo-voiceover.md`);
      return send(res, 200, { md: next, version: version(next) });
    }
    if (req.method === 'GET' && url.pathname === '/api/takes') {
      return send(res, 200, readIndex());
    }
    if (req.method === 'POST' && url.pathname === '/api/takes') {
      const section = url.searchParams.get('section') ?? '';
      const ext = url.searchParams.get('ext') ?? '';
      const ms = Number(url.searchParams.get('ms'));
      if (!/^[a-z0-9-]+$/.test(section) || !(ext in TYPES) || !Number.isFinite(ms)) {
        return send(res, 400, { error: 'bad take' });
      }
      const take = nextTake(section);
      const file = `${section}-take${take}.${ext}`;
      await pipeline(req, createWriteStream(join(TAKES, file)));
      const entry = { file, section, take, ms, at: new Date().toISOString() };
      writeFileSync(INDEX, JSON.stringify([...readIndex(), entry], null, 2));
      console.log(`saved takes/${file} (${(ms / 1000).toFixed(1)} s)`);
      return send(res, 200, entry);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/takes/')) {
      const file = basename(url.pathname);
      const path = join(TAKES, file);
      if (!existsSync(path)) return send(res, 404, { error: 'no such take' });
      res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()] ?? 'application/octet-stream' });
      return createReadStream(path).pipe(res);
    }
    send(res, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: String(error) });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Teleprompter on http://127.0.0.1:${PORT}  (takes save to ${TAKES})`);
});
