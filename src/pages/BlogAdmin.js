import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';

const TABS = [
  { id: 'draft', label: 'Drafts' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'archived', label: 'Archived' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

function toDate(value) {
  if (value == null || value === '') return null;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatListDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return format(d, 'MMM d, yyyy');
}

function toDatetimeLocal(value) {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoFromLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'Request failed');
  return data;
}

function normalizeStatus(status) {
  const value = String(status || 'draft').toLowerCase();
  if (value === 'draft' || value === 'scheduled' || value === 'published' || value === 'archived') {
    return value;
  }
  return 'draft';
}

function postToDraft(post) {
  return {
    title: post.title || '',
    body: post.body || post.content || '',
    status: normalizeStatus(post.status),
    scheduledAt: toDatetimeLocal(post.scheduledAt),
  };
}

function listDate(post) {
  const status = normalizeStatus(post.status);
  if (status === 'scheduled') return post.scheduledAt || post.updatedAt || post.createdAt;
  return post.updatedAt || post.createdAt;
}

function sourceLabel(source) {
  if (!source) return 'manual';
  const value = String(source);
  if (/massblogger/i.test(value)) return 'MassBlogger';
  return value;
}

export default function BlogAdmin() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('draft');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');

  const loadPosts = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await apiJson('/api/blog/posts');
      const list = Array.isArray(data.posts) ? data.posts : [];
      list.sort((a, b) => {
        const av = toDate(listDate(a))?.getTime() || 0;
        const bv = toDate(listDate(b))?.getTime() || 0;
        return bv - av;
      });
      setPosts(list);
    } catch (err) {
      setError(err?.message || 'Failed to load posts.');
      setPosts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const counts = useMemo(() => {
    const next = { draft: 0, scheduled: 0, published: 0, archived: 0 };
    posts.forEach((p) => {
      next[normalizeStatus(p.status)] += 1;
    });
    return next;
  }, [posts]);

  const filtered = useMemo(
    () => posts.filter((p) => normalizeStatus(p.status) === tab),
    [posts, tab]
  );

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedId) || null,
    [posts, selectedId]
  );

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    if (!selectedPost) {
      setSelectedId(null);
      setDraft(null);
      setDirty(false);
      return;
    }
    if (!dirty) setDraft(postToDraft(selectedPost));
  }, [selectedId, selectedPost, dirty]);

  const updateDraft = (patch) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const selectPost = (post) => {
    setSelectedId(post.id);
    setDraft(postToDraft(post));
    setDirty(false);
    setNotice('');
  };

  const payloadFromDraft = (overrides = {}) => {
    const { clearSchedule, ...rest } = overrides;
    const status = rest.status || draft.status;
    const html = draft.body || '';
    const next = {
      title: draft.title.trim(),
      body: html,
      content: html,
      status,
      ...rest,
    };
    if (status === 'scheduled') {
      next.scheduledAt = isoFromLocal(draft.scheduledAt);
    } else if (status === 'published' || clearSchedule) {
      next.scheduledAt = null;
    }
    return next;
  };

  const runAction = async (key, fn) => {
    if (!selectedId || !draft || busy) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      setDirty(false);
    } catch (err) {
      setError(err?.message || 'Request failed.');
    } finally {
      setBusy('');
    }
  };

  const handleNewPost = async () => {
    setBusy('new');
    setError('');
    setNotice('');
    try {
      const data = await apiJson('/api/blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '',
          content: '',
          status: 'draft',
          source: 'manual',
        }),
      });
      const created = data.post || {};
      await loadPosts({ silent: true });
      setTab('draft');
      setSelectedId(created.id);
      setDraft({ title: '', body: '', status: 'draft', scheduledAt: '' });
      setDirty(false);
      setNotice('Draft created.');
    } catch (err) {
      setError(err?.message || 'Could not create draft.');
    } finally {
      setBusy('');
    }
  };

  const handleSave = () => {
    if (draft.status === 'scheduled' && !draft.scheduledAt) {
      setError('Set a scheduled date and time before saving a scheduled post.');
      return;
    }
    return runAction('save', async () => {
      await apiJson('/api/blog/post/' + encodeURIComponent(selectedId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromDraft()),
      });
      await loadPosts({ silent: true });
      setNotice('Saved.');
    });
  };

  const handlePublish = () =>
    runAction('publish', async () => {
      await apiJson('/api/blog/post/' + encodeURIComponent(selectedId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromDraft({ status: 'published', clearSchedule: true })),
      });
      await loadPosts({ silent: true });
      setDraft((prev) => (prev ? { ...prev, status: 'published', scheduledAt: '' } : prev));
      setTab('published');
      setNotice('Published.');
    });

  const handleArchive = () =>
    runAction('archive', async () => {
      await apiJson('/api/blog/post/' + encodeURIComponent(selectedId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromDraft({ status: 'archived' })),
      });
      await loadPosts({ silent: true });
      setDraft((prev) => (prev ? { ...prev, status: 'archived' } : prev));
      setTab('archived');
      setNotice('Archived.');
    });

  const handleDelete = () => {
    if (!window.confirm('Delete this post permanently? This cannot be undone.')) return;
    return runAction('delete', async () => {
      await apiJson('/api/blog/post/' + encodeURIComponent(selectedId), { method: 'DELETE' });
      setSelectedId(null);
      setDraft(null);
      setDirty(false);
      await loadPosts({ silent: true });
      setNotice('Post deleted.');
    });
  };

  return (
    <div className="page blog-admin-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Blog</h1>
          <p className="page-subtitle">dreamapplab.com posts · dal-website-c9dd8</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadPosts}
            disabled={loading || !!busy}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleNewPost}
            disabled={!!busy}
          >
            {busy === 'new' ? 'Creating…' : 'New Post'}
          </button>
        </div>
      </div>

      <div className="blog-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="tab-count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {error && <div className="quotes-error">{error}</div>}
      {notice && <div className="quotes-success-notice">{notice}</div>}

      <div className="blog-admin-layout">
        <aside className="blog-post-list">
          {loading ? (
            <div className="empty-state">
              <div className="empty-state-text">Loading posts…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <div className="empty-state-text">No {tab} posts.</div>
            </div>
          ) : (
            filtered.map((post) => {
              const source = sourceLabel(post.source);
              const isMass = source === 'MassBlogger';
              return (
                <button
                  key={post.id}
                  type="button"
                  className={`blog-post-item ${selectedId === post.id ? 'active' : ''}`}
                  onClick={() => selectPost(post)}
                >
                  <div className="blog-post-item-title">{post.title || 'Untitled draft'}</div>
                  <div className="blog-post-item-meta">
                    <span className={`blog-source-badge ${isMass ? 'mass' : 'manual'}`}>
                      {source}
                    </span>
                    <span>{formatListDate(listDate(post))}</span>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="blog-editor">
          {!draft ? (
            <div className="empty-state">
              <div className="empty-state-icon">👈</div>
              <div className="empty-state-text">Select a post or create a new one.</div>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  className="form-input"
                  type="text"
                  value={draft.title}
                  onChange={(e) => updateDraft({ title: e.target.value })}
                  placeholder="Post title"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={draft.status}
                    onChange={(e) => updateDraft({ status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {draft.status === 'scheduled' && (
                  <div className="form-group">
                    <label className="form-label">Scheduled at</label>
                    <input
                      className="form-input"
                      type="datetime-local"
                      value={draft.scheduledAt}
                      onChange={(e) => updateDraft({ scheduledAt: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Body / Content</label>
                <textarea
                  className="form-textarea blog-content-editor"
                  value={draft.body}
                  onChange={(e) => updateDraft({ body: e.target.value })}
                  placeholder="<p>Write HTML here…</p>"
                  spellCheck={false}
                />
              </div>

              <div className="blog-editor-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={!!busy}
                >
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePublish}
                  disabled={!!busy}
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleArchive}
                  disabled={!!busy}
                >
                  {busy === 'archive' ? 'Archiving…' : 'Archive'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={!!busy}
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
