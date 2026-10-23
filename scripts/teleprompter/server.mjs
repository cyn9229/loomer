// Local teleprompter for recording the demo narration.
// Serves the page, hands it docs/demo-voiceover.md, and streams each recorded
// take to takes/ (git-ignored) with an index of section, take number, and length.
//
//   npm run teleprompter    then open http://127.0.0.1:8790
//
// Binds to 127.0.0.1 only: localhost counts as a secure origin, so Chrome
// allows camera and mic access without HTTPS.
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

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(join(here, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/script') {
      return send(res, 200, readFileSync(SCRIPT, 'utf8'), 'text/markdown; charset=utf-8');
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
