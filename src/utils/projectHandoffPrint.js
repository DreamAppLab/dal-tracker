import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { APP_PIPELINE } from '../data/appPipeline';
import { WEBSITE_PIPELINE } from '../data/websitePipeline';
import { PWA_PIPELINE } from '../data/pwaPipeline';
import { pipelineKindForProjectType } from '../data/projectTypes';
import BLACK_BOX_SERVICES from '../data/blackBoxServices';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '—';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pipelineDataForKind(kind) {
  if (kind === 'app') return APP_PIPELINE;
  if (kind === 'website') return WEBSITE_PIPELINE;
  if (kind === 'pwa') return PWA_PIPELINE;
  return null;
}

function blackBoxRows(services, dataMap) {
  const rows = [];
  services.forEach((svc) => {
    const data = dataMap[svc.key];
    if (!data) return;
    const fields = { ...(data.fields || {}) };
    (data.customFields || []).forEach((f) => {
      if (f.fieldName) fields[f.fieldName] = f.value ?? fields[f.fieldName] ?? '';
    });
    Object.keys(fields).forEach((label) => {
      const val = fields[label];
      if (val == null || String(val).trim() === '') return;
      rows.push({
        service: svc.label || svc.key,
        label,
        value: String(val),
      });
    });
    if (data.notes && String(data.notes).trim()) {
      rows.push({ service: svc.label || svc.key, label: 'Notes', value: String(data.notes) });
    }
  });
  return rows;
}

export async function openProjectHandoffPrint(project) {
  const projectId = project?.id;
  if (!projectId) return;

  const kind = pipelineKindForProjectType(project.projectType);
  const pipelineDef = pipelineDataForKind(kind);

  const [pipelineSnap, blackboxSnap] = await Promise.all([
    kind
      ? getDoc(doc(db, 'projects', projectId, 'pipeline', kind))
      : Promise.resolve(null),
    getDocs(collection(db, 'projects', projectId, 'blackbox')),
  ]);

  const completed = pipelineSnap?.exists() ? pipelineSnap.data().completed || {} : {};
  const serviceByKey = Object.fromEntries(BLACK_BOX_SERVICES.map((s) => [s.key, s]));
  const dataMap = {};
  const extraServices = [];
  blackboxSnap.forEach((d) => {
    if (d.id === 'services_config') return;
    dataMap[d.id] = d.data();
    if (!serviceByKey[d.id]) {
      extraServices.push({ key: d.id, label: d.data().label || d.id });
    }
  });
  const rows = blackBoxRows([...BLACK_BOX_SERVICES, ...extraServices], dataMap);

  const notes = project.notes || project.tagline || '';
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const bbTable = rows.length
    ? `<table>
        <thead><tr><th>Credential</th><th>Value</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr><td>${escapeHtml(r.service)} — ${escapeHtml(r.label)}</td><td>${escapeHtml(r.value)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : '<p class="muted">No Black Box credentials saved yet.</p>';

  const pipelineHtml = pipelineDef
    ? pipelineDef.phases
        .map((ph) => {
          const items = ph.tasks
            .map((t) => {
              const done = completed[t.id] === true;
              return `<li class="${done ? 'done' : ''}"><span class="mark">${done ? '✓' : '○'}</span> ${t.num}. ${escapeHtml(t.text)}</li>`;
            })
            .join('');
          return `<h3>${escapeHtml(ph.title)}</h3>${ph.note ? `<p class="muted">${escapeHtml(ph.note)}</p>` : ''}<ul class="tasks">${items}</ul>`;
        })
        .join('')
    : '<p class="muted">No pipeline checklist for this project type.</p>';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(project.name)} — Client Handoff</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 11pt;
      color: #111;
      background: #fff;
      margin: 0;
      padding: 28px 32px 64px;
    }
    .logo { font-weight: 800; letter-spacing: 0.08em; font-size: 11pt; color: #111; margin-bottom: 4px; }
    h1 { font-size: 20pt; margin: 0 0 8px; }
    h2 { font-size: 13pt; margin: 28px 0 10px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    h3 { font-size: 11pt; margin: 16px 0 6px; }
    .meta { color: #444; margin-bottom: 18px; }
    .badge { display: inline-block; border: 1px solid #111; padding: 1px 8px; border-radius: 4px; font-size: 9pt; margin-right: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; font-size: 10pt; }
    th { background: #f4f4f4; width: auto; }
    td:first-child, th:first-child { width: 38%; }
    .muted { color: #555; font-size: 10pt; }
    ul.tasks { list-style: none; padding: 0; margin: 0 0 8px; }
    ul.tasks li { padding: 3px 0; page-break-inside: avoid; }
    ul.tasks li.done { color: #333; }
    .mark { display: inline-block; width: 1.2em; }
    .notes { white-space: pre-wrap; }
    @page { margin: 16mm; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
    footer.print-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      font-size: 8pt;
      color: #333;
      border-top: 1px solid #ccc;
      padding: 6px 0 0;
      background: #fff;
    }
  </style>
</head>
<body>
  <div class="logo">DREAM APP LAB</div>
  <h1>${escapeHtml(project.name)}</h1>
  <div class="meta">
    ${project.projectType ? `<span class="badge">${escapeHtml(project.projectType)}</span>` : ''}
    Status: ${escapeHtml(project.status || '—')}
    &nbsp;|&nbsp; Generated ${escapeHtml(dateStr)}
    ${project.createdAt ? `&nbsp;|&nbsp; Created ${escapeHtml(formatDate(project.createdAt))}` : ''}
    ${project.updatedAt ? `&nbsp;|&nbsp; Updated ${escapeHtml(formatDate(project.updatedAt))}` : ''}
    ${project.launchDate ? `&nbsp;|&nbsp; Launch ${escapeHtml(formatDate(project.launchDate))}` : ''}
  </div>
  <p class="no-print muted">This window is the client handoff document. Use Print to save as PDF.</p>

  <h2>Black Box</h2>
  ${bbTable}

  <h2>Pipeline checklist</h2>
  ${pipelineHtml}

  <h2>Project notes</h2>
  <div class="notes">${notes ? escapeHtml(notes) : '—'}</div>

  <footer class="print-footer">Confidential — Dream App Lab LLC</footer>
  <script>
    window.addEventListener('load', function () {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
}
