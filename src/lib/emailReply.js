// Helpers for client email replies (clientEmails collection).
// Shared by the Mailgun inbound webhook (api/inbound-client-email.js) and the
// Mission Control thread views (Contacts, ClientTab).

// Lines that mark the start of the quoted earlier message in a reply.
const QUOTE_HEADER_PATTERNS = [
  // Gmail / Apple Mail: "On Tue, Oct 13, 2026 at 9:30 PM Aaron <a@b.com> wrote:"
  // (often wrapped onto two lines, so allow one line break before "wrote:")
  /^[ \t>]*On\b[^\n]{0,300}(?:\n[^\n]{0,300})?\bwrote:[ \t]*$/im,
  // Outlook / Hotmail
  /^[ \t>]*-{2,}[ \t]*Original Message[ \t]*-{2,}/im,
  /^[ \t>]*_{10,}[ \t]*\n[ \t>]*From:[^\n]*\n[ \t>]*(?:Sent|Date):/im,
  /^[ \t>]*From:[^\n]+\n[ \t>]*(?:Sent|Date):[^\n]+\n[ \t>]*To:/im,
  // Generic forwarded/quoted marker
  /^[ \t>]*-{2,}[ \t]*Forwarded message[ \t]*-{2,}/im,
];

/**
 * Remove the quoted earlier message(s) from a plain-text email reply, so only
 * what the client actually wrote this time is left.
 * Returns the original text if stripping would leave nothing.
 */
export function stripQuotedReply(text) {
  const original = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (!original.trim()) return '';

  let cut = original.length;
  for (const re of QUOTE_HEADER_PATTERNS) {
    const m = re.exec(original);
    if (m && m.index < cut) cut = m.index;
  }

  // Any line starting with ">" begins a quoted block.
  const quoteLine = /^[ \t]*>/m.exec(original);
  if (quoteLine && quoteLine.index < cut) cut = quoteLine.index;

  const stripped = original.slice(0, cut).replace(/\s+$/, '');
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

/**
 * HTML to show for a message in a thread.
 * Outbound bodies are HTML Eddie wrote in Mission Control, shown as-is.
 * Inbound bodies are raw client email text: quoted history is stripped and the
 * text is escaped, so a client's email can never inject markup or scripts.
 */
export function emailDisplayHtml(email) {
  if (!email) return '';
  if (email.direction === 'inbound') {
    return plainTextToHtml(stripQuotedReply(email.body));
  }
  return email.body || '';
}
