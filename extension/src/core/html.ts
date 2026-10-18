// HTML to readable text plus links, for school-provided HTML such as assignment
// descriptions. Runs in the service worker, which has no DOMParser.
import { Parser } from 'htmlparser2';
import { canonicalLink } from './url';

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'br', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote']);
const SKIP_TAGS = new Set(['script', 'style', 'iframe', 'noscript']);

/** `embeds`: addresses of embedded frames (for example a Google Doc preview). Their content is not read here. */
export type ExtractedHtml = { text: string; links: string[]; embeds: string[] };

/** Extracts text with paragraph breaks, absolute cleaned links, and embedded frame addresses. Bounded by maxChars. */
export function extractHtml(html: string, baseUrl: string, maxChars = 20_000): ExtractedHtml {
  let text = '';
  const links = new Set<string>();
  const embeds = new Set<string>();
  let skipDepth = 0;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (SKIP_TAGS.has(name)) skipDepth += 1;
        if (name === 'a' && attribs.href) {
          const link = canonicalLink(attribs.href, baseUrl);
          if (link) links.add(link);
        }
        if (name === 'iframe' && attribs.src) {
          const embed = canonicalLink(attribs.src, baseUrl);
          if (embed) embeds.add(embed);
        }
        if (name === 'li') text += '\n- ';
        else if (BLOCK_TAGS.has(name)) text += '\n';
      },
      ontext(data) {
        if (skipDepth === 0) text += data;
      },
      onclosetag(name) {
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
  return { text: normalized.slice(0, maxChars), links: [...links], embeds: [...embeds] };
}
