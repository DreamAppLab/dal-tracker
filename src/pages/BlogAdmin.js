import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import BlogQuillEditor from '../components/BlogQuillEditor';
import { slugFromTitle } from '../utils/blogSlug';
import { uploadBlogImage } from '../utils/uploadBlogImage';

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

const META_TITLE_MAX = 60;
const META_DESC_MAX = 160;

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

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string' && tags.trim()) {
    return tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function emptyDraft() {
  return {
    title: '',
    body: '',
    status: 'draft',
    scheduledAt: '',
    slug: '',
    featuredImage: '',
    category: '',
    tags: [],
    metaTitle: '',
    metaDescription: '',
  };
}

function postToDraft(post) {
  return {
    title: post.title || '',
    body: post.body || post.content || '',
    status: normalizeStatus(post.status),
    scheduledAt: toDatetimeLocal(post.scheduledAt),
    slug: post.slug || slugFromTitle(post.title || ''),
    featuredImage: post.featuredImage || '',
    category: post.category || '',
    tags: normalizeTags(post.tags),
    metaTitle: post.metaTitle || '',
    metaDescription: post.metaDescription || '',
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

function CharCount({ value, max }) {
  const len = String(value || '').length;
  return (
    <span className={`blog-char-count ${len > max ? 'over' : ''}`}>
      {len}/{max}
    </span>
  );
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
  const [tagInput, setTagInput] = useState('');
  const [featuredBusy, setFeaturedBusy] = useState(false);
  const slugManualRef = useRef(false);
  const featuredInputRef = useRef(null);

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
    slugManualRef.current = !!post.slug;
    setSelectedId(post.id);
    setDraft(postToDraft(post));
    setDirty(false);
    setNotice('');
    setTagInput('');
  };

  const handleTitleChange = (title) => {
    const patch = { title };
    if (!slugManualRef.current) patch.slug = slugFromTitle(title);
    updateDraft(patch);
  };

  const handleSlugChange = (slug) => {
    slugManualRef.current = true;
    updateDraft({ slug });
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || !draft) return;
    if (!draft.tags.includes(tag)) updateDraft({ tags: [...draft.tags, tag] });
    setTagInput('');
  };

  const removeTag = (tag) => {
    updateDraft({ tags: draft.tags.filter((t) => t !== tag) });
  };

  const handleFeaturedUpload = async (file) => {
    if (!file) return;
    setFeaturedBusy(true);
    setError('');
    try {
      const url = await uploadBlogImage(file);
      setDraft((prev) => (prev ? { ...prev, featuredImage: url } : prev));
      setDirty(true);
    } catch (err) {
      setError(err?.message || 'Featured image upload failed.');
    } finally {
      setFeaturedBusy(false);
    }
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
      slug: (draft.slug || slugFromTitle(draft.title)).trim(),
      featuredImage: draft.featuredImage || '',
      category: (draft.category || '').trim(),
      tags: Array.isArray(draft.tags) ? draft.tags : [],
      metaTitle: draft.metaTitle || '',
      metaDescription: draft.metaDescription || '',
      ...rest,
    };
    if (status === 'scheduled') {
      next.scheduledAt = isoFromLocal(draft.scheduledAt);
    } else if (status === 'published' || clearSchedule) {
      next.scheduledAt = null;
    }
    if (rest.status === 'published') {
      next.publishedAt = new Date().toISOString();
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
          body: '',
          content: '',
          status: 'draft',
          source: 'manual',
          slug: '',
          featuredImage: '',
          category: '',
          tags: [],
          metaTitle: '',
          metaDescription: '',
        }),
      });
      const created = data.post || {};
      await loadPosts({ silent: true });
      setTab('draft');
      slugManualRef.current = false;
      setSelectedId(created.id);
      setDraft(emptyDraft());
      setDirty(false);
      setTagInput('');
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

  const handleSchedule = () => {
    if (!draft.scheduledAt) {
      setError('Set a scheduled date and time before scheduling.');
      return;
    }
    return runAction('schedule', async () => {
      await apiJson('/api/blog/post/' + encodeURIComponent(selectedId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromDraft({ status: 'scheduled' })),
      });
      await loadPosts({ silent: true });
      setDraft((prev) => (prev ? { ...prev, status: 'scheduled' } : prev));
      setTab('scheduled');
      setNotice('Scheduled.');
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
            <div className="blog-editor-shell">
              <div className="blog-editor-main">
                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input
                    className="form-input"
                    type="text"
                    value={draft.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Post title"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Body</label>
                  <BlogQuillEditor
                    key={selectedId}
                    value={draft.body}
                    onChange={(body) => updateDraft({ body })}
                    onError={setError}
                  />
                </div>

                <div className="blog-editor-actions">
                  <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!!busy}>
                    {busy === 'save' ? 'Saving…' : 'Save'}
                  </button>
                  <div className="blog-schedule-action">
                    <input
                      className="form-input blog-schedule-datetime"
                      type="datetime-local"
                      value={draft.scheduledAt}
                      onChange={(e) => updateDraft({ scheduledAt: e.target.value })}
                      aria-label="Schedule date and time"
                    />
                    <button type="button" className="btn btn-secondary" onClick={handleSchedule} disabled={!!busy}>
                      {busy === 'schedule' ? 'Scheduling…' : 'Schedule'}
                    </button>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={handlePublish} disabled={!!busy}>
                    {busy === 'publish' ? 'Publishing…' : 'Publish'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleArchive} disabled={!!busy}>
                    {busy === 'archive' ? 'Archiving…' : 'Archive'}
                  </button>
                  <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={!!busy}>
                    {busy === 'delete' ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>

              <aside className="blog-meta-sidebar">
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

                <div className="form-group">
                  <label className="form-label">Featured Image</label>
                  {draft.featuredImage ? (
                    <img className="blog-featured-thumb" src={draft.featuredImage} alt="Featured" />
                  ) : (
                    <div className="blog-featured-empty">No featured image</div>
                  )}
                  <input
                    ref={featuredInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0];
                      e.target.value = '';
                      handleFeaturedUpload(file);
                    }}
                  />
                  <div className="blog-featured-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={featuredBusy}
                      onClick={() => featuredInputRef.current && featuredInputRef.current.click()}
                    >
                      {featuredBusy ? 'Uploading…' : 'Upload'}
                    </button>
                    {draft.featuredImage && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateDraft({ featuredImage: '' })}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Slug</label>
                  <input
                    className="form-input"
                    type="text"
                    value={draft.slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="post-url-slug"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Category</label>
                  <input
                    className="form-input"
                    type="text"
                    value={draft.category}
                    onChange={(e) => updateDraft({ category: e.target.value })}
                    placeholder="Category"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tags</label>
                  <div className="blog-tag-pills">
                    {draft.tags.map((tag) => (
                      <span key={tag} className="blog-tag-pill">
                        {tag}
                        <button
                          type="button"
                          className="blog-tag-remove"
                          aria-label={`Remove ${tag}`}
                          onClick={() => removeTag(tag)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    className="form-input"
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Type a tag and press Enter"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label blog-label-with-count">
                    Meta title
                    <CharCount value={draft.metaTitle} max={META_TITLE_MAX} />
                  </label>
                  <input
                    className="form-input"
                    type="text"
                    value={draft.metaTitle}
                    onChange={(e) => updateDraft({ metaTitle: e.target.value })}
                    placeholder="SEO title"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label blog-label-with-count">
                    Meta description
                    <CharCount value={draft.metaDescription} max={META_DESC_MAX} />
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    value={draft.metaDescription}
                    onChange={(e) => updateDraft({ metaDescription: e.target.value })}
                    placeholder="SEO description"
                  />
                </div>
              </aside>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
