// Mission Control — live tool stats (secrets stay server-side)
// GET /api/tools/[tool]

function env(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail =
      (data && (data.error || data.message || data.detail)) ||
      text.slice(0, 240) ||
      res.statusText;
    const err = new Error(String(detail));
    err.status = res.status;
    throw err;
  }
  return data;
}

function metricValue(metrics, ...ids) {
  const list = metrics?.metrics || metrics || [];
  if (!Array.isArray(list)) return 0;
  for (const id of ids) {
    const match = list.find((m) => m.id === id);
    if (match && match.value != null) return Number(match.value) || 0;
  }
  return 0;
}

async function revenuecat() {
  const key = env('REACT_APP_REVENUECAT_SECRET_KEY', 'REVENUECAT_SECRET_KEY');
  if (!key) throw new Error('Missing REACT_APP_REVENUECAT_SECRET_KEY');

  const projectsData = await fetchJson('https://api.revenuecat.com/v2/projects?limit=50', {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  const projects = projectsData.items || projectsData.data || [];
  const overviews = [];
  let mrr = 0;
  let subscribers = 0;

  for (const project of projects) {
    const id = project.id;
    if (!id) continue;
    const overview = await fetchJson(
      `https://api.revenuecat.com/v2/projects/${id}/metrics/overview`,
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    const projectMrr = metricValue(overview, 'mrr');
    const projectSubs = metricValue(overview, 'active_subscriptions', 'actives');
    mrr += projectMrr;
    subscribers += projectSubs;
    overviews.push({
      id,
      name: project.name || id,
      mrr: projectMrr,
      subscribers: projectSubs,
    });
  }

  return {
    headline: `$${Math.round(mrr).toLocaleString()} MRR · ${subscribers.toLocaleString()} subs`,
    mrr,
    subscribers,
    projects: overviews,
  };
}

async function sentry() {
  const token = env('REACT_APP_SENTRY_AUTH_TOKEN', 'SENTRY_AUTH_TOKEN');
  if (!token) throw new Error('Missing REACT_APP_SENTRY_AUTH_TOKEN');
  const org = env('REACT_APP_SENTRY_ORG', 'SENTRY_ORG') || 'dream-app-lab';

  const url =
    `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/issues/` +
    `?query=${encodeURIComponent('is:unresolved')}&limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error((data && (data.detail || data.error)) || `Sentry ${res.status}`);
  }
  const issues = Array.isArray(data) ? data : [];
  const openCount = issues.length;
  return {
    headline: `${openCount}${openCount >= 100 ? '+' : ''} open issues`,
    openIssues: openCount,
    sample: issues.slice(0, 8).map((issue) => ({
      id: issue.id,
      title: issue.title || issue.culprit || 'Issue',
      project: issue.project?.slug || issue.project?.name || '',
      count: issue.count,
    })),
    org,
  };
}

async function posthog() {
  const key = env('REACT_APP_POSTHOG_API_KEY', 'POSTHOG_API_KEY', 'POSTHOG_PERSONAL_API_KEY');
  if (!key) throw new Error('Missing REACT_APP_POSTHOG_API_KEY');
  const host = (env('REACT_APP_POSTHOG_HOST', 'POSTHOG_HOST') || 'https://us.posthog.com').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const projectsData = await fetchJson(`${host}/api/projects/`, { headers });
  const projects = projectsData.results || projectsData.items || [];
  const project = projects[0];
  if (!project?.id) throw new Error('No PostHog project found');

  const query = await fetchJson(`${host}/api/projects/${project.id}/query/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query:
          'SELECT count(DISTINCT person_id) AS users FROM events WHERE timestamp > now() - INTERVAL 7 DAY',
      },
    }),
  });

  const rows = query.results || query.result || [];
  const users = Number((Array.isArray(rows[0]) ? rows[0][0] : rows[0]?.users) || 0);

  return {
    headline: `${users.toLocaleString()} active users (7d)`,
    activeUsers7d: users,
    projectId: project.id,
    projectName: project.name || '',
  };
}

async function github() {
  const token = env('REACT_APP_GITHUB_TOKEN', 'GITHUB_TOKEN');
  if (!token) throw new Error('Missing REACT_APP_GITHUB_TOKEN');
  const org = 'DreamAppLab';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dal-mission-control',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const reposData = await fetchJson(
    `https://api.github.com/orgs/${org}/repos?per_page=100&sort=updated`,
    { headers }
  );
  const repos = Array.isArray(reposData) ? reposData : [];

  const search = await fetchJson(
    `https://api.github.com/search/issues?q=${encodeURIComponent(`org:${org} type:pr state:open`)}&per_page=100`,
    { headers }
  );
  const openPrs = Number(search.total_count) || (search.items || []).length;
  const byRepo = {};
  (search.items || []).forEach((item) => {
    const name = (item.repository_url || '').split('/').pop() || 'unknown';
    byRepo[name] = (byRepo[name] || 0) + 1;
  });

  return {
    headline: `${openPrs} open PRs`,
    openPrs,
    repoCount: repos.length,
    repos: repos.slice(0, 12).map((r) => ({
      name: r.name,
      openPrs: byRepo[r.name] || 0,
      pushedAt: r.pushed_at,
    })),
  };
}

async function vercel() {
  const token = env('REACT_APP_VERCEL_TOKEN', 'VERCEL_TOKEN');
  if (!token) throw new Error('Missing REACT_APP_VERCEL_TOKEN');
  const teamId = env('REACT_APP_VERCEL_TEAM_ID', 'VERCEL_TEAM_ID');
  const qs = new URLSearchParams({ limit: '5' });
  if (teamId) qs.set('teamId', teamId);

  const data = await fetchJson(`https://api.vercel.com/v6/deployments?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const deployments = data.deployments || [];
  const latest = deployments[0];
  const state = latest?.readyState || latest?.state || 'unknown';

  return {
    headline: latest ? `${state} · ${latest.name || latest.url || 'deployment'}` : 'No deployments',
    latestState: state,
    deployments: deployments.map((d) => ({
      name: d.name,
      url: d.url,
      state: d.readyState || d.state,
      createdAt: d.createdAt,
      target: d.target,
    })),
  };
}

async function mailgun() {
  const key = env('REACT_APP_MAILGUN_API_KEY', 'MAILGUN_API_KEY');
  if (!key) throw new Error('Missing REACT_APP_MAILGUN_API_KEY');
  const domain = env('MAILGUN_DOMAIN') || 'inbound.dreamapplab.com';
  const auth = Buffer.from(`api:${key}`).toString('base64');
  const data = await fetchJson(
    `https://api.mailgun.net/v3/${encodeURIComponent(domain)}/stats/total?event=accepted&duration=7d`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const stats = data.stats || [];
  let sent = 0;
  stats.forEach((row) => {
    const accepted = row.accepted;
    if (typeof accepted === 'number') sent += accepted;
    else if (accepted && typeof accepted === 'object') {
      sent += Number(accepted.total || accepted.outgoing || 0);
    }
  });

  return {
    headline: `${sent.toLocaleString()} emails accepted (7d)`,
    accepted7d: sent,
    domain,
    days: stats.length,
  };
}

async function expo() {
  const token = env('REACT_APP_EXPO_TOKEN', 'EXPO_TOKEN', 'EXPO_ACCESS_TOKEN');
  if (!token) throw new Error('Missing REACT_APP_EXPO_TOKEN');
  const account = env('REACT_APP_EXPO_ACCOUNT', 'EXPO_ACCOUNT') || 'dreamapplab';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  let data;
  const urls = [
    `https://api.expo.dev/v2/accounts/${encodeURIComponent(account)}/builds?limit=5`,
    'https://api.expo.dev/v2/builds?limit=5',
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      data = await fetchJson(url, { headers });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError && !data) throw lastError;

  const builds = data.data || data.builds || data.items || [];
  const latest = builds[0];
  const status = latest?.status || latest?.buildStatus || 'none';

  return {
    headline: latest ? `${status} · ${latest.platform || latest.appName || 'build'}` : 'No recent builds',
    latestStatus: status,
    builds: builds.slice(0, 5).map((b) => ({
      id: b.id,
      status: b.status || b.buildStatus,
      platform: b.platform,
      createdAt: b.createdAt || b.created_at,
      project: b.appName || b.projectName || b.fullName,
    })),
    account,
  };
}

async function crisp() {
  const id = env('REACT_APP_CRISP_API_ID', 'CRISP_API_IDENTIFIER', 'CRISP_TOKEN_IDENTIFIER');
  const key = env('REACT_APP_CRISP_API_KEY', 'CRISP_API_KEY', 'CRISP_TOKEN_KEY');
  if (!id || !key) throw new Error('Missing REACT_APP_CRISP_API_ID / REACT_APP_CRISP_API_KEY');

  const auth = Buffer.from(`${id}:${key}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    'X-Crisp-Tier': 'plugin',
    'Content-Type': 'application/json',
  };

  let websiteIds = (env('REACT_APP_CRISP_WEBSITE_ID', 'CRISP_WEBSITE_ID') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!websiteIds.length) {
    try {
      const listed = await fetchJson('https://api.crisp.chat/v1/user/account/websites', { headers });
      const items = listed.data || listed;
      if (Array.isArray(items)) {
        websiteIds = items.map((w) => w.website_id || w.id).filter(Boolean);
      }
    } catch {
      websiteIds = [];
    }
  }

  if (!websiteIds.length) {
    throw new Error('No Crisp website IDs. Set REACT_APP_CRISP_WEBSITE_ID.');
  }

  const workspaces = [];
  let open = 0;
  for (const websiteId of websiteIds) {
    const conv = await fetchJson(
      `https://api.crisp.chat/v1/website/${encodeURIComponent(websiteId)}/conversations/1`,
      { headers }
    );
    const items = (conv.data || conv).items || conv.data || [];
    const list = Array.isArray(items) ? items : [];
    const unresolved = list.filter((c) => {
      const state = String(c.state || c.status || '').toLowerCase();
      return state === 'unresolved' || state === 'pending' || state === 'open' || !c.resolved;
    });
    const count = unresolved.length || list.length;
    open += count;
    workspaces.push({ websiteId, conversations: count });
  }

  return {
    headline: `${open} open conversations`,
    openConversations: open,
    workspaces,
  };
}

const HANDLERS = {
  revenuecat,
  sentry,
  posthog,
  github,
  vercel,
  mailgun,
  expo,
  crisp,
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tool = String((req.query && req.query.tool) || '').toLowerCase();
  const handler = HANDLERS[tool];
  if (!handler) return res.status(404).json({ error: `Unknown tool: ${tool}` });

  try {
    const data = await handler();
    return res.status(200).json({ ok: true, fetchedAt: new Date().toISOString(), ...data });
  } catch (e) {
    console.error(`tools ${tool} error`, e);
    return res.status(500).json({
      error: `${tool} request failed`,
      detail: String((e && e.message) || e),
    });
  }
};
