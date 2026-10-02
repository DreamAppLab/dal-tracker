import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_FEEDBACK_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_FEEDBACK_ANON_KEY;
const BRAND = '#4CC1F3';

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...opts.headers,
    },
    ...opts,
  });
  return res;
}

async function listProjects() {
  const res = await sbFetch('web_projects?order=created_at.desc', { method: 'GET' });
  if (!res.ok) throw new Error('Failed to load projects');
  return res.json();
}

async function createProject(data) {
  const res = await sbFetch('web_projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create project');
  }
  return res.json();
}

async function updateProject(projectId, data) {
  const res = await sbFetch(`web_projects?project_id=eq.${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update project');
}

async function getPins(projectId) {
  const res = await sbFetch(
    `feedback_pins?project_id=eq.${encodeURIComponent(projectId)}&order=created_at.asc`,
    { method: 'GET' }
  );
  if (!res.ok) throw new Error('Failed to load pins');
  return res.json();
}

// ── Slug generator ───────────────────────────────────────────────────────────
function generateProjectId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}

// ── Shared styles ────────────────────────────────────────────────────────────
const card = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 12,
  padding: '20px 24px',
  marginBottom: 16,
};

const badge = (color, bg) => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
  color,
  background: bg,
});

// ── New Project Modal ────────────────────────────────────────────────────────
function NewProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState([]);
  const [filteredContacts, setFilteredContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'contacts')).then((snap) => {
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!contactQuery.trim()) { setFilteredContacts([]); return; }
    const q = contactQuery.toLowerCase();
    setFilteredContacts(
      contacts.filter((c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q)
      ).slice(0, 8)
    );
  }, [contactQuery, contacts]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Project name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const project_id = generateProjectId(name.trim());
      const payload = {
        project_id,
        project_name: name.trim(),
        contact_id: selectedContact?.id || null,
        contact_name: selectedContact?.name || null,
        preview_url: previewUrl.trim() || null,
        status: 'active',
      };
      await createProject(payload);
      onCreated(payload);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 14, padding: 28, width: 440, color: '#e2e8f0' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 17 }}>New Web Project</h3>
        {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Project Name *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coastal Brew Demo"
          style={inputStyle}
        />

        <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4, marginTop: 12 }}>Assign to Contact</label>
        <div style={{ position: 'relative' }}>
          <input
            value={selectedContact ? `${selectedContact.name}${selectedContact.company ? ` — ${selectedContact.company}` : ''}` : contactQuery}
            onChange={(e) => { setContactQuery(e.target.value); setSelectedContact(null); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search contacts..."
            style={inputStyle}
          />
          {selectedContact && (
            <button onClick={() => { setSelectedContact(null); setContactQuery(''); }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>×</button>
          )}
          {showDropdown && filteredContacts.length > 0 && !selectedContact && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
              {filteredContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedContact(c); setContactQuery(''); setShowDropdown(false); }}
                  style={{ display: 'block', width: '100%', background: 'none', border: 'none', color: '#e2e8f0', padding: '9px 12px', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={(e) => e.target.style.background = '#334155'}
                  onMouseLeave={(e) => e.target.style.background = 'none'}
                >
                  {c.name}{c.company ? <span style={{ color: '#94a3b8', marginLeft: 6 }}>— {c.company}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4, marginTop: 12 }}>Preview URL</label>
        <input
          value={previewUrl}
          onChange={(e) => setPreviewUrl(e.target.value)}
          placeholder="https://preview.example.com"
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ background: BRAND, border: 'none', color: '#000', padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            {saving ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
  padding: '9px 12px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  marginBottom: 0,
};

// ── All Projects View ────────────────────────────────────────────────────────
function AllProjectsView({ onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [pinCounts, setPinCounts] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data || []);
      // Load open feedback counts for each project
      const counts = {};
      await Promise.all((data || []).map(async (p) => {
        try {
          const res = await sbFetch(
            `feedback_pins?project_id=eq.${encodeURIComponent(p.project_id)}&resolved=eq.false&select=id`,
            { method: 'GET' }
          );
          if (res.ok) {
            const pins = await res.json();
            counts[p.project_id] = pins.length;
          }
        } catch {}
      }));
      setPinCounts(counts);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = projects
    .filter((p) => filter === 'all' || p.status === filter)
    .sort((a, b) => (pinCounts[b.project_id] || 0) - (pinCounts[a.project_id] || 0));

  return (
    <div style={{ padding: '28px 32px', color: '#e2e8f0', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>🌐 Web Projects</h1>
        <button
          onClick={() => setShowModal(true)}
          style={{ background: BRAND, border: 'none', color: '#000', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          + New Project
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'active', 'archived'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? BRAND : '#1e293b',
              color: filter === f ? '#000' : '#94a3b8',
              border: 'none', borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#94a3b8' }}>Loading projects…</p>}
      {error && <p style={{ color: '#f87171' }}>{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>
          <p>No projects yet.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e293b' }}>
              {['Project', 'Contact', 'Preview URL', 'Open Feedback', 'Status', 'Created'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.project_id} style={{ borderBottom: '1px solid #1e293b' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#0d1b2e'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                <td style={{ padding: '12px 12px' }}>
                  <button
                    onClick={() => onSelectProject(p)}
                    style={{ background: 'none', border: 'none', color: BRAND, cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}
                  >
                    {p.project_name}
                  </button>
                </td>
                <td style={{ padding: '12px 12px', fontSize: 13, color: '#cbd5e1' }}>{p.contact_name || '—'}</td>
                <td style={{ padding: '12px 12px', fontSize: 13 }}>
                  {p.preview_url
                    ? <a href={p.preview_url} target="_blank" rel="noreferrer" style={{ color: '#94a3b8' }}>{p.preview_url}</a>
                    : '—'}
                </td>
                <td style={{ padding: '12px 12px' }}>
                  {pinCounts[p.project_id] > 0
                    ? <span style={badge('#000', BRAND)}>{pinCounts[p.project_id]}</span>
                    : <span style={{ color: '#475569', fontSize: 13 }}>0</span>}
                </td>
                <td style={{ padding: '12px 12px' }}>
                  <span style={badge(p.status === 'active' ? '#22c55e' : '#94a3b8', p.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)')}>
                    {p.status}
                  </span>
                </td>
                <td style={{ padding: '12px 12px', fontSize: 12, color: '#64748b' }}>
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={(p) => { setShowModal(false); load(); onSelectProject(p); }}
        />
      )}
    </div>
  );
}

// ── Project Detail View ──────────────────────────────────────────────────────
function ProjectDetailView({ project, onBack, onReload }) {
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [archiving, setArchiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentProject, setCurrentProject] = useState(project);

  const scriptTag = `<script src="https://dal-tracker.vercel.app/widget/feedback-widget.js" data-project-id="${currentProject.project_id}" data-project-name="${currentProject.project_name}"></script>`;

  const loadPins = useCallback(async () => {
    try {
      const data = await getPins(currentProject.project_id);
      setPins(data || []);
    } catch {}
    setLoading(false);
  }, [currentProject.project_id]);

  useEffect(() => { loadPins(); }, [loadPins]);

  const toggleStatus = async () => {
    setArchiving(true);
    const newStatus = currentProject.status === 'active' ? 'archived' : 'active';
    try {
      await updateProject(currentProject.project_id, { status: newStatus });
      setCurrentProject((p) => ({ ...p, status: newStatus }));
      if (onReload) onReload();
    } catch {}
    setArchiving(false);
  };

  const handleResolve = async (pin, resolved) => {
    try {
      await fetch('/api/feedback/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_id: pin.id, resolved }),
      });
      setPins((prev) => prev.map((p) => p.id === pin.id ? { ...p, resolved, resolved_at: resolved ? new Date().toISOString() : null } : p));
    } catch {}
  };

  const copyScript = () => {
    navigator.clipboard.writeText(scriptTag).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const filteredPins = pins.filter((p) => {
    if (filter === 'open') return !p.resolved;
    if (filter === 'resolved') return p.resolved;
    return true;
  });

  return (
    <div style={{ padding: '28px 32px', color: '#e2e8f0', maxWidth: 900, margin: '0 auto' }}>
      {/* Back */}
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, marginBottom: 20, padding: 0 }}>
        ← Web Projects
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700 }}>{currentProject.project_name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {currentProject.contact_name && (
              <span style={{ fontSize: 13, color: '#94a3b8' }}>👤 {currentProject.contact_name}</span>
            )}
            {currentProject.preview_url && (
              <a href={currentProject.preview_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: BRAND }}>
                🔗 {currentProject.preview_url}
              </a>
            )}
            <span style={badge(currentProject.status === 'active' ? '#22c55e' : '#94a3b8', currentProject.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)')}>
              {currentProject.status}
            </span>
          </div>
        </div>
        <button
          onClick={toggleStatus}
          disabled={archiving}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
        >
          {archiving ? '…' : currentProject.status === 'active' ? '📦 Archive' : '✅ Activate'}
        </button>
      </div>

      {/* Script Tag */}
      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>📋 Embed Script Tag</h3>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <code style={{
            flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            padding: '10px 14px', fontSize: 12, color: '#a5f3fc', overflowX: 'auto',
            display: 'block', whiteSpace: 'pre', fontFamily: 'monospace',
          }}>
            {scriptTag}
          </code>
          <button
            onClick={copyScript}
            style={{ background: copied ? '#22c55e' : BRAND, border: 'none', color: '#000', padding: '0 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Feedback pins */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Feedback ({pins.length})</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'open', 'resolved'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{ background: filter === f ? BRAND : '#1e293b', color: filter === f ? '#000' : '#94a3b8', border: 'none', borderRadius: 16, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8' }}>Loading feedback…</p>}

      {!loading && filteredPins.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12 }}>
          <p style={{ margin: 0, fontSize: 15 }}>No feedback yet.</p>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>Add the script tag to your preview site to get started.</p>
        </div>
      )}

      {filteredPins.map((pin, index) => (
        <PinCard
          key={pin.id}
          pin={pin}
          index={index}
          previewUrl={currentProject.preview_url}
          onResolve={handleResolve}
        />
      ))}
    </div>
  );
}

function PinCard({ pin, index, previewUrl, onResolve }) {
  const viewLink = previewUrl ? `${previewUrl}#dal-pin-${pin.id}` : null;
  const resolved = pin.resolved;

  return (
    <div style={{
      ...card,
      opacity: resolved ? 0.7 : 1,
      borderColor: resolved ? '#1e3a2e' : '#1e293b',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        {/* Pin number */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: resolved ? '#22c55e' : BRAND,
          color: resolved ? '#fff' : '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 13,
        }}>
          {resolved ? '✓' : index + 1}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{pin.client_name || 'Anonymous'}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>{new Date(pin.created_at).toLocaleString()}</span>
            {resolved
              ? <span style={badge('#22c55e', 'rgba(34,197,94,0.12)')}>✓ Resolved</span>
              : <span style={badge(BRAND, 'rgba(76,193,243,0.12)')}>● Open</span>}
          </div>

          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>{pin.note}</p>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>{pin.page_url}</p>

          {pin.screenshot_url && (
            <img src={pin.screenshot_url} alt="Screenshot" style={{ maxWidth: 280, borderRadius: 8, marginBottom: 10, display: 'block' }} />
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {viewLink && (
              <a href={viewLink} target="_blank" rel="noreferrer"
                style={{ background: '#1e293b', color: BRAND, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                View on page →
              </a>
            )}
            <button
              onClick={() => onResolve(pin, !resolved)}
              style={{ background: resolved ? '#1e293b' : 'rgba(34,197,94,0.15)', color: resolved ? '#94a3b8' : '#22c55e', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              {resolved ? 'Reopen' : 'Resolve ✓'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function WebProjects() {
  const [selectedProject, setSelectedProject] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  if (selectedProject) {
    return (
      <ProjectDetailView
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
        onReload={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return <AllProjectsView key={reloadKey} onSelectProject={setSelectedProject} />;
}
