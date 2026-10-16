// Helpers for client email replies (clientEmails collection).
// Used by the Mission Control thread views (Contacts, ClientTab). The inbound
// webhook (api/inbound-client-email.js) stores Mailgun's stripped-text as `body`
// and the complete raw email as `bodyFull`; this module cleans up older messages
// and any reply that arrived without stripped-text.

// "On Tue, Oct 13, 2026 at 9:30 PM Aaron <a@b.com> wrote:" (Gmail / Apple Mail),
// allowing the header to wrap onto a second line before "wrote:".
const ON_WROTE = /^[ \t]*On\b[^\n]{0,300}(?:\n[^\n]{0,300})?\bwrote:[ \t]*$/gim;

const OTHER_QUOTE_HEADERS = [
  // Outlook "-----Original Message-----" / forwarded markers
  /^[ \t>]*-{2,}[ \t]*Original Message[ \t]*-{2,}[ \t]*$/im,
  /^[ \t>]*-{2,}[ \t]*Forwarded message[ \t]*-{2,}[ \t]*$/im,
  // Outlook header block: From / Sent|Date / To / (Cc) / Subject
  /^[ \t>]*From:[^\n]+\n[ \t>]*(?:Sent|Date):[^\n]+\n[ \t>]*To:[^\n]+\n(?:[ \t>]*Cc:[^\n]*\n)?[ \t>]*Subject:/im,
];

// Mobile signatures left at the very end of a reply.
const MOBILE_SIGNATURE = /\n[ \t]*Sent from my [^\n]{1,60}[ \t]*$/i;

// Index where a trailing block made only of ">" quoted lines (and blank lines)
// begins, or -1. Inline answers between quoted lines are kept.
function trailingQuoteBlockStart(text) {
  const lines = text.split('\n');
  let i = lines.length;
  let sawQuote = false;
  while (i > 0) {
    const line = lines[i - 1];
    if (/^[ \t]*>/.test(line)) sawQuote = true;
    else if (line.trim() !== '') break;
    i -= 1;
  }
  if (!sawQuote) return -1;
  return lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
}

/**
 * Remove the quoted earlier message(s) from a plain-text email reply, so only
 * what the client actually wrote this time is left.
 * Returns the original text if stripping would leave nothing.
 */
export function stripQuotedReply(text) {
  const original = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (!original.trim()) return '';

  let cut = original.length;

  // "On ... wrote:" only counts when what follows is quoted text or nothing,
  // so a sentence like "On the quote, my accountant wrote:" is kept.
  ON_WROTE.lastIndex = 0;
  let m;
  while ((m = ON_WROTE.exec(original)) !== null) {
    const rest = original.slice(m.index + m[0].length).replace(/^\s+/, '');
    if (rest === '' || rest.startsWith('>')) {
      cut = Math.min(cut, m.index);
      break;
    }
  }

  for (const re of OTHER_QUOTE_HEADERS) {
    const hit = re.exec(original);
    if (hit && hit.index < cut) cut = hit.index;
  }

  const quoteStart = trailingQuoteBlockStart(original.slice(0, cut));
  if (quoteStart >= 0 && quoteStart < cut) cut = quoteStart;

  const stripped = original.slice(0, cut).replace(/\s+$/, '').replace(MOBILE_SIGNATURE, '').replace(/\s+$/, '');
  return stripped.trim() ? stripped : original.trim();
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape plain text and keep its line breaks, for safe display as HTML. */
export function plainTextToHtml(text) {
  return String(text == null ? '' : text)
    .replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>');
}

/** Only emails written in Mission Control are trusted to render as HTML. */
function isOutbound(email) {
  return email && email.direction === 'outbound';
}

/**
 * HTML to show for a message in a thread.
 * Outbound bodies are HTML Eddie wrote in Mission Control, shown as-is.
 * Everything else is client email text: quoted history is stripped and the
 * text is escaped, so a client's email can never inject markup or scripts.
 */
export function emailDisplayHtml(email) {
  if (!email) return '';
  if (isOutbound(email)) return email.body || '';
  return plainTextToHtml(stripQuotedReply(email.body));
}

/** Full original email text (escaped) for the "Show full email" view, or '' if nothing was hidden. */
export function emailFullHtml(email) {
  if (!email || isOutbound(email)) return '';
  const full = String(email.bodyFull || email.body || '').replace(/\r\n?/g, '\n').trim();
  if (!full) return '';
  const shown = stripQuotedReply(email.body).trim();
  if (full === shown) return '';
  return plainTextToHtml(full);
}
