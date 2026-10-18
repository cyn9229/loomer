// HTML to readable text plus links, for school-provided HTML such as assignment
// descriptions. Runs in the service worker, which has no DOMParser.
import { Parser } from 'htmlparser2';
import { canonicalLink } from './url';

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'br', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote']);
const SKIP_TAGS = new Set(['script', 'style', 'iframe', 'noscript']);

/**
 * `labels`: each link's visible text, by link address (the teacher's own name
 * for it). `embeds`: embedded frames (for example a Google Doc preview), with
 * the frame's title when the page gave one. Frame content is not read here.
 */
export type ExtractedHtml = { text: string; links: string[]; labels: Record<string, string>; embeds: { url: string; title: string | null }[] };

/** Extracts text with paragraph breaks, absolute cleaned links, and embedded frame addresses. Bounded by maxChars. */
export function extractHtml(html: string, baseUrl: string, maxChars = 20_000): ExtractedHtml {
  let text = '';
  const links = new Set<string>();
  const labels: Record<string, string> = {};
  const embeds = new Map<string, string | null>();
  let skipDepth = 0;
  // The link being read, to collect its visible text.
  let open: { url: string; text: string } | null = null;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (SKIP_TAGS.has(name)) skipDepth += 1;
        if (name === 'a' && attribs.href) {
          const link = canonicalLink(attribs.href, baseUrl);
          if (link) {
            links.add(link);
            open = { url: link, text: '' };
          }
        }
        if (name === 'iframe' && attribs.src) {
          const embed = canonicalLink(attribs.src, baseUrl);
          if (embed && !embeds.has(embed)) embeds.set(embed, attribs.title?.trim() || null);
        }
        if (name === 'li') text += '\n- ';
        else if (BLOCK_TAGS.has(name)) text += '\n';
      },
      ontext(data) {
        if (skipDepth === 0) text += data;
        if (open) open.text += data;
      },
      onclosetag(name) {
        if (name === 'a' && open) {
          const label = open.text.replace(/\s+/g, ' ').trim().slice(0, 80);
          if (label && !labels[open.url]) labels[open.url] = label;
          open = null;
        }
        if (SKIP_TAGS.has(name)) skipDepth -= 1;
        else if (BLOCK_TAGS.has(name)) text += '\n';
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  const normalized = text
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: normalized.slice(0, maxChars), links: [...links], labels, embeds: [...embeds].map(([url, title]) => ({ url, title })) };
}
