// POST /api/audit/event — lets Mission Control record client-side actions
// (Firestore deletes, statement imports, edits to sensitive records) in the
// server-only auditLog. Sign-ins and vault reveals are recorded by their own
// server functions and cannot be submitted here.

const { z } = require('zod');
const { withSecurity, parseJsonBody, validate } = require('../_lib/security');
const { writeAudit } = require('../_lib/audit');

const EventSchema = z.object({
  type: z.enum(['delete', 'import', 'sensitive_update']),
  target: z.string().trim().min(1).max(300).regex(/^[A-Za-z0-9_\-/.: ]+$/),
  meta: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
});

module.exports = withSecurity(
  { name: 'audit-event', methods: ['POST'], auth: 'admin', rateLimit: { limit: 120, windowMs: 60_000 } },
  async (req, res) => {
    const { type, target, meta } = validate(EventSchema, parseJsonBody(req, { maxBytes: 16 * 1024 }));
    await writeAudit({ type, actor: req.auth, target, meta: { ...(meta || {}), source: 'client' } }, req);
    return res.status(200).json({ ok: true });
  }
);
