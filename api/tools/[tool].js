// Mission Control — live tool stats (secrets stay server-side)
// GET /api/tools/[tool]

function env(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
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
      (data && data.error === true
        ? data.reason || (data.data && data.data.message)
        : null) ||
      (data && typeof data.error === 'string' && data.error) ||
      (data && (data.message || data.detail)) ||
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
  const key = env('REVENUECAT_SECRET_KEY');
  if (!key) throw new Error('Missing REVENUECAT_SECRET_KEY');

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

async function github() {
  const token = env('GITHUB_TOKEN');
  if (!token) throw new Error('Missing GITHUB_TOKEN');
  const org = 'DreamAppLab';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dal-mission-control',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const reposData = await fetchJson(
    `https://api.github.com/users/DreamAppLab/repos?per_page=100&sort=pushed&type=owner`,
    { headers }
  );
  const repos = (Array.isArray(reposData) ? reposData : [])
    .slice()
    .sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0))
    .slice(0, 10);

  const repoStats = [];
  let openPrs = 0;
  for (const repo of repos) {
    const pulls = await fetchJson(
      `https://api.github.com/repos/${org}/${encodeURIComponent(repo.name)}/pulls?state=open&per_page=100`,
      { headers }
    );
    const count = Array.isArray(pulls) ? pulls.length : 0;
    openPrs += count;
    repoStats.push({
      name: repo.name,
      openPrs: count,
      pushedAt: repo.pushed_at,
    });
  }

  return {
    headline: `${openPrs} open PRs`,
    openPrs,
    repoCount: repos.length,
    repos: repoStats,
  };
}

async function vercel() {
  const token = env('VERCEL_TOKEN');
  if (!token) throw new Error('Missing VERCEL_TOKEN');
  const teamId = env('VERCEL_TEAM_ID');
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
  const key = env('MAILGUN_API_KEY');
  if (!key) throw new Error('Missing MAILGUN_API_KEY');
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

// Only tools with a live card in the Tools page (src/pages/ToolsHub.js).
// Sentry, PostHog, Expo and Crisp are link-only there, so Mission Control
// holds no keys for them.
const HANDLERS = {
  revenuecat,
  github,
  vercel,
  mailgun,
};

const { withSecurity } = require('../_lib/security');

module.exports = withSecurity({ name: 'tools', methods: ['GET'], auth: 'admin' }, async (req, res) => {
  const tool = String((req.query && req.query.tool) || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, tool)) {
    return res.status(404).json({ error: 'Unknown tool' });
  }
  const handler = HANDLERS[tool];

  try {
    const data = await handler();
    return res.status(200).json({ ok: true, fetchedAt: new Date().toISOString(), ...data });
  } catch (e) {
    console.error(`tools ${tool} error`, e && e.message);
    // Message is ours (e.g. "Missing GITHUB_TOKEN") or the provider status — never a secret.
    return res.status(502).json({
      error: `${tool} request failed`,
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }
});
