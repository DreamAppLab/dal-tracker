// Parses a Mailgun forward() POST. Mailgun sends application/x-www-form-urlencoded
// without attachments and multipart/form-data with them; Vercel's default body
// parser only handles the former, so the endpoint disables it and uses this.

const fs = require('fs');
const formidableModule = require('formidable');

const formidable = formidableModule.default || formidableModule.formidable || formidableModule;

const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024;

/** @returns {Promise<{ body: Record<string,string>, attachments: Array<{filename,contentType,buffer}> }>} */
async function parseInboundForm(req) {
  const form = formidable({
    multiples: true,
    maxFileSize: MAX_TOTAL_FILE_BYTES,
    maxTotalFileSize: MAX_TOTAL_FILE_BYTES,
    maxFieldsSize: 8 * 1024 * 1024,
    maxFields: 1000,
    allowEmptyFiles: true,
    minFileSize: 0,
  });
  const [fields, files] = await form.parse(req);
  const body = {};
  for (const [k, v] of Object.entries(fields || {})) body[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  const attachments = [];
  for (const list of Object.values(files || {})) {
    for (const f of Array.isArray(list) ? list : [list]) {
      if (!f || !f.filepath) continue;
      try {
        const buffer = fs.readFileSync(f.filepath);
        if (buffer.length) attachments.push({ filename: f.originalFilename || 'attachment', contentType: f.mimetype || 'application/octet-stream', buffer });
      } finally {
        try { fs.unlinkSync(f.filepath); } catch (_) { /* ignore */ }
      }
    }
  }
  return { body, attachments };
}

module.exports = { parseInboundForm };
