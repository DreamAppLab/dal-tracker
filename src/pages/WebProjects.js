import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';

const BRAND = '#4CC1F3';

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

const badgeStyle = (color, bg) => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
  color,
  background: bg,
});

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
};

// ── Firestore helpers ────────────────────────────────────────────────────────
function serializeSnap(snap) {
  const data = snap.data() || {};
  const out = { id: snap.id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === 'function') out[k] = v.toDate().toISOString();
    else out[k] = v;
  }
  return out;
}

async function fetchProjects() {
  const snap = await getDocs(
    query(collection(db, 'webProjects'), orderBy('created_at', 'desc'))
  );
  return snap.docs.map(serializeSnap);
}

async function fetchProject(projectId) {
  const snap = await getDoc(doc(db, 'webProjects', projectId));
  if (!snap.exists()) return null;
  return serializeSnap(snap);
}

async function fetchPins(projectId) {
  // Single-field query — no composite index needed; sort in-memory
  const snap = await getDocs(
    query(collection(db, 'feedbackPins'), where('project_id', '==', projectId))
  );
  return snap.docs
    .map(serializeSnap)
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

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
        created_at: serverTimestamp(),
      };
      await setDoc(doc(db, 'webProjects', project_id), payload);
      onCreated({ ...payload, id: project_id });
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coastal Brew Demo" style={inputStyle} />

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
                <button key={c.id}
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
        <input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} placeholder="https://preview.example.com" style={inputStyle} />

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
      const data = await fetchProjects();
      setProjects(data);
      // Load open feedback counts
      const counts = {};
      await Promise.all(data.map(async (p) => {
        try {
          const snap = await getDocs(
            query(collection(db, 'feedbackPins'),
              where('project_id', '==', p.project_id),
              where('resolved', '==', false))
          );
          counts[p.project_id] = snap.size;
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
        <button onClick={() => setShowModal(true)}
          style={{ background: BRAND, border: 'none', color: '#000', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          + New Project
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'active', 'archived'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ background: filter === f ? BRAND : '#1e293b', color: filter === f ? '#000' : '#94a3b8', border: 'none', borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
            {f}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#94a3b8' }}>Loading projects…</p>}
      {error && <p style={{ color: '#f87171' }}>{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8' }}>
          <p>No projects yet. Click "+ New Project" to get started.</p>
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
                onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                <td style={{ padding: '12px 12px' }}>
                  <button onClick={() => onSelectProject(p)}
                    style={{ background: 'none', border: 'none', color: BRAND, cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: 0 }}>
                    {p.project_name}
                  </button>
                </td>
                <td style={{ padding: '12px 12px', fontSize: 13, color: '#cbd5e1' }}>{p.contact_name || '—'}</td>
                <td style={{ padding: '12px 12px', fontSize: 13 }}>
                  {p.preview_url ? <a href={p.preview_url} target="_blank" rel="noreferrer" style={{ color: '#94a3b8' }}>{p.preview_url}</a> : '—'}
                </td>
                <td style={{ padding: '12px 12px' }}>
                  {pinCounts[p.project_id] > 0
                    ? <span style={badgeStyle('#000', BRAND)}>{pinCounts[p.project_id]}</span>
                    : <span style={{ color: '#475569', fontSize: 13 }}>0</span>}
                </td>
                <td style={{ padding: '12px 12px' }}>
                  <span style={badgeStyle(p.status === 'active' ? '#22c55e' : '#94a3b8', p.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)')}>
                    {p.status}
                  </span>
                </td>
                <td style={{ padding: '12px 12px', fontSize: 12, color: '#64748b' }}>
                  {p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}
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
function ProjectDetailView({ project, onBack }) {
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [archiving, setArchiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentProject, setCurrentProject] = useState(project);

  const scriptTag = `<script src="https://dal-tracker.vercel.app/widget/feedback-widget.js" data-project-id="${currentProject.project_id}" data-project-name="${currentProject.project_name}"></script>`;

  const loadPins = useCallback(async () => {
    try {
      const data = await fetchPins(currentProject.project_id);
      setPins(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [currentProject.project_id]);

  useEffect(() => { loadPins(); }, [loadPins]);

  const toggleStatus = async () => {
    setArchiving(true);
    const newStatus = currentProject.status === 'active' ? 'archived' : 'active';
    try {
      await updateDoc(doc(db, 'webProjects', currentProject.project_id), { status: newStatus });
      setCurrentProject((p) => ({ ...p, status: newStatus }));
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
      setPins((prev) => prev.map((p) => p.id === pin.id
        ? { ...p, resolved, resolved_at: resolved ? new Date().toISOString() : null }
        : p));
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

  const openCount = pins.filter((p) => !p.resolved).length;

  return (
    <div style={{ padding: '28px 32px', color: '#e2e8f0', maxWidth: 900, margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, marginBottom: 20, padding: 0 }}>
        ← Web Projects
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>{currentProject.project_name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {currentProject.contact_name && <span style={{ fontSize: 13, color: '#94a3b8' }}>👤 {currentProject.contact_name}</span>}
            {currentProject.preview_url && (
              <a href={currentProject.preview_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: BRAND }}>
                🔗 {currentProject.preview_url}
              </a>
            )}
            <span style={badgeStyle(currentProject.status === 'active' ? '#22c55e' : '#94a3b8', currentProject.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)')}>
              {currentProject.status}
            </span>
          </div>
        </div>
        <button onClick={toggleStatus} disabled={archiving}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
          {archiving ? '…' : currentProject.status === 'active' ? '📦 Archive' : '✅ Activate'}
        </button>
      </div>

      {/* Script Tag */}
      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>📋 Embed Script Tag</h3>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <code style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#a5f3fc', overflowX: 'auto', display: 'block', whiteSpace: 'pre', fontFamily: 'monospace' }}>
            {scriptTag}
          </code>
          <button onClick={copyScript}
            style={{ background: copied ? '#22c55e' : BRAND, border: 'none', color: '#000', padding: '0 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Feedback section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>
          Feedback {openCount > 0 && <span style={badgeStyle('#000', BRAND)}>{openCount} open</span>}
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'open', 'resolved'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ background: filter === f ? BRAND : '#1e293b', color: filter === f ? '#000' : '#94a3b8', border: 'none', borderRadius: 16, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
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
        <PinCard key={pin.id} pin={pin} index={index} previewUrl={currentProject.preview_url} onResolve={handleResolve} />
      ))}
    </div>
  );
}

function PinCard({ pin, index, previewUrl, onResolve }) {
  const viewLink = previewUrl ? `${previewUrl}#dal-pin-${pin.id}` : null;
  const resolved = pin.resolved;

  return (
    <div style={{ ...card, opacity: resolved ? 0.7 : 1, borderColor: resolved ? '#1e3a2e' : '#1e293b' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: resolved ? '#22c55e' : BRAND, color: resolved ? '#fff' : '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
          {resolved ? '✓' : index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{pin.client_name || 'Anonymous'}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>{pin.created_at ? new Date(pin.created_at).toLocaleString() : ''}</span>
            {resolved
              ? <span style={badgeStyle('#22c55e', 'rgba(34,197,94,0.12)')}>✓ Resolved</span>
              : <span style={badgeStyle(BRAND, 'rgba(76,193,243,0.12)')}>● Open</span>}
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>{pin.note}</p>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>{pin.page_url}</p>
          {pin.screenshotDataUrl && (
            <img src={pin.screenshotDataUrl} alt="Screenshot" style={{ maxWidth: 280, borderRadius: 8, marginBottom: 10, display: 'block' }} />
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {viewLink && (
              <a href={viewLink} target="_blank" rel="noreferrer"
                style={{ background: '#1e293b', color: BRAND, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                View on page →
              </a>
            )}
            <button onClick={() => onResolve(pin, !resolved)}
              style={{ background: resolved ? '#1e293b' : 'rgba(34,197,94,0.15)', color: resolved ? '#94a3b8' : '#22c55e', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
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

  if (selectedProject) {
    return <ProjectDetailView project={selectedProject} onBack={() => setSelectedProject(null)} />;
  }
  return <AllProjectsView onSelectProject={setSelectedProject} />;
}
