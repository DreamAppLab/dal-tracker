import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';

const TOOLS = [
  {
    id: 'revenuecat',
    name: 'RevenueCat',
    icon: '💵',
    url: 'https://app.revenuecat.com',
    live: true,
  },
  {
    id: 'sentry',
    name: 'Sentry',
    icon: '🪲',
    url: 'https://dream-app-lab.sentry.io',
    live: true,
  },
  {
    id: 'posthog',
    name: 'PostHog',
    icon: '🦔',
    url: 'https://us.posthog.com',
    live: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    url: 'https://github.com/DreamAppLab',
    live: true,
  },
  {
    id: 'vercel',
    name: 'Vercel',
    icon: '▲',
    url: 'https://vercel.com/dream-app-lab',
    live: true,
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    icon: '✉️',
    url: 'https://app.mailgun.com',
    live: true,
  },
  {
    id: 'expo',
    name: 'Expo / EAS',
    icon: '📦',
    url: 'https://expo.dev/accounts/dreamapplab',
    live: true,
  },
  {
    id: 'crisp',
    name: 'Crisp',
    icon: '💬',
    url: 'https://app.crisp.chat',
    live: true,
  },
  {
    id: 'app-store',
    name: 'App Store Connect',
    icon: '',
    url: 'https://appstoreconnect.apple.com',
    live: false,
  },
  {
    id: 'play-console',
    name: 'Google Play Console',
    icon: '▶️',
    url: 'https://play.google.com/console',
    live: false,
  },
  {
    id: 'firebase',
    name: 'Firebase Console',
    icon: '🔥',
    url: 'https://console.firebase.google.com',
    live: false,
  },
];

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return format(new Date(iso), 'MMM d, yyyy h:mm a');
  } catch {
    return iso;
  }
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });
}

function ExpandedDetails({ tool, data }) {
  if (!data) return null;
  switch (tool.id) {
    case 'revenuecat':
      return (
        <>
          <div className="tools-kv"><span>MRR</span><strong>{money(data.mrr)}</strong></div>
          <div className="tools-kv"><span>Active subscribers</span><strong>{Number(data.subscribers || 0).toLocaleString()}</strong></div>
          {(data.projects || []).map((p) => (
            <div key={p.id} className="tools-kv tools-kv-sub">
              <span>{p.name}</span>
              <strong>{money(p.mrr)} · {Number(p.subscribers || 0).toLocaleString()} subs</strong>
            </div>
          ))}
        </>
      );
    case 'sentry':
      return (
        <>
          <div className="tools-kv"><span>Open issues</span><strong>{data.openIssues}</strong></div>
          {(data.sample || []).map((issue) => (
            <div key={issue.id} className="tools-kv tools-kv-sub">
              <span>{issue.project}</span>
              <strong>{issue.title}</strong>
            </div>
          ))}
        </>
      );
    case 'posthog':
      return (
        <>
          <div className="tools-kv"><span>Active users (7d)</span><strong>{Number(data.activeUsers7d || 0).toLocaleString()}</strong></div>
          <div className="tools-kv"><span>Project</span><strong>{data.projectName || data.projectId}</strong></div>
        </>
      );
    case 'github':
      return (
        <>
          <div className="tools-kv"><span>Open PRs</span><strong>{data.openPrs}</strong></div>
          <div className="tools-kv"><span>Repos</span><strong>{data.repoCount}</strong></div>
          {(data.repos || []).filter((r) => r.openPrs > 0).map((r) => (
            <div key={r.name} className="tools-kv tools-kv-sub">
              <span>{r.name}</span>
              <strong>{r.openPrs} open</strong>
            </div>
          ))}
        </>
      );
    case 'vercel':
      return (
        <>
          <div className="tools-kv"><span>Latest status</span><strong>{data.latestState}</strong></div>
          {(data.deployments || []).map((d, i) => (
            <div key={d.url || i} className="tools-kv tools-kv-sub">
              <span>{d.name}{d.target ? ` · ${d.target}` : ''}</span>
              <strong>{d.state}</strong>
            </div>
          ))}
        </>
      );
    case 'mailgun':
      return (
        <>
          <div className="tools-kv"><span>Accepted (7d)</span><strong>{Number(data.accepted7d || 0).toLocaleString()}</strong></div>
          <div className="tools-kv"><span>Domain</span><strong>{data.domain}</strong></div>
        </>
      );
    case 'expo':
      return (
        <>
          <div className="tools-kv"><span>Latest status</span><strong>{data.latestStatus}</strong></div>
          {(data.builds || []).map((b) => (
            <div key={b.id} className="tools-kv tools-kv-sub">
              <span>{b.project || b.platform || b.id}</span>
              <strong>{b.status}{b.platform ? ` · ${b.platform}` : ''}</strong>
            </div>
          ))}
        </>
      );
    case 'crisp':
      return (
        <>
          <div className="tools-kv"><span>Open conversations</span><strong>{data.openConversations}</strong></div>
          {(data.workspaces || []).map((w) => (
            <div key={w.websiteId} className="tools-kv tools-kv-sub">
              <span>{w.websiteId}</span>
              <strong>{w.conversations}</strong>
            </div>
          ))}
        </>
      );
    default:
      return null;
  }
}

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(!!tool.live);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tool.live) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tools/' + encodeURIComponent(tool.id));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || json.error || 'Request failed');
      setData(json);
    } catch (err) {
      setError(err.message || 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tool.id, tool.live]);

  useEffect(() => {
    load();
  }, [load]);

  const headline = loading
    ? 'Loading…'
    : error
      ? 'Unavailable'
      : data?.headline || (tool.live ? '—' : 'Open →');

  return (
    <article className={`tools-card ${open ? 'open' : ''}`}>
      <button type="button" className="tools-card-header" onClick={() => setOpen((v) => !v)}>
        <span className="tools-card-icon">{tool.icon}</span>
        <span className="tools-card-name">{tool.name}</span>
        <span className="tools-card-stat">{headline}</span>
        <span className="tools-card-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tools-card-body">
          {tool.live && loading && <p className="tools-muted">Fetching live data…</p>}
          {tool.live && error && <p className="tools-error">{error}</p>}
          {tool.live && data && <ExpandedDetails tool={tool} data={data} />}
          {!tool.live && (
            <p className="tools-muted">No live API in Mission Control — open the console directly.</p>
          )}
          {data?.fetchedAt && (
            <p className="tools-updated">Updated {formatWhen(data.fetchedAt)}</p>
          )}
          <div className="tools-card-actions">
            {tool.live && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
            <a className="btn btn-primary btn-sm" href={tool.url} target="_blank" rel="noreferrer">
              Open in {tool.name}
            </a>
          </div>
        </div>
      )}
    </article>
  );
}

export default function ToolsHub() {
  return (
    <div className="page tools-hub-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tools</h1>
          <p className="page-subtitle">Live status for DAL accounts — keys stay on the server</p>
        </div>
      </div>
      <div className="tools-grid">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
