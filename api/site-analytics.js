// DAL Mission Control — Site Analytics API
// GET /api/site-analytics              → all active monitored sites
// GET /api/site-analytics?siteId=xxx   → one site (bypasses 5-min cache)
//
// Aggregates per site:
//   • UptimeRobot monitor status + uptime %
//   • Vercel Analytics  (page views / visitors 30d)
//   • Vercel last deployment
//   • Vercel runtime errors (7d)
// Caches combined result in Firestore siteAnalyticsCache/{siteId} for 5 min.

const { initializeApp, getApp } = require('firebase-admin/app');
const { cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// ── Firebase Admin (dal-mission-control) ────────────────────────────────────
let _db = null;
function getDb() {
  if (_db) return _db;
  const projectId = process.env.DAL_MC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_MC_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_MC_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) throw new Error('Missing DAL_MC_FIREBASE env vars');
  const name = 'dalMcAnalytics';
  let app;
  try { app = getApp(name); } catch (_) {
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, name);
  }
  _db = getFirestore(app);
  return _db;
}

const UPTIMEROBOT_KEY = process.env.UPTIMEROBOT_API_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_DTdKthT6vqeddH5ND7XmMWHO';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── UptimeRobot ──────────────────────────────────────────────────────────────
async function fetchUptimeRobot(siteDomain) {
  if (!UPTIMEROBOT_KEY) return { status: 'unknown', percent30d: null, responseTimeMs: null };
  try {
    const body = new URLSearchParams({
      api_key: UPTIMEROBOT_KEY,
      format: 'json',
      logs: '0',
      response_times: '1',
      response_times_limit: '1',
      custom_uptime_ratios: '30',
      all_time_uptime_ratio: '0',
    });
    const res = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: body.toString(),
    });
    if (!res.ok) return { status: 'unknown', percent30d: null, responseTimeMs: null };
    const data = await res.json();
    if (!data.monitors) return { status: 'unknown', percent30d: null, responseTimeMs: null };

    // Match monitor by URL containing the domain
    const domain = siteDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const monitor = data.monitors.find((m) =>
      m.url && (m.url.includes(domain) || domain.includes(m.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')))
    );
    if (!monitor) return { status: 'unknown', percent30d: null, responseTimeMs: null };

    const statusMap = { 0: 'paused', 1: 'paused', 2: 'up', 8: 'paused', 9: 'down' };
    const status = statusMap[monitor.status] || 'unknown';
    const percent30d = monitor.custom_uptime_ratio ? parseFloat(monitor.custom_uptime_ratio) : null;
    const responseTimeMs = monitor.average_response_time ? parseInt(monitor.average_response_time, 10) : null;

    return { status, percent30d, responseTimeMs };
  } catch (e) {
    console.error('UptimeRobot error:', e.message);
    return { status: 'unknown', percent30d: null, responseTimeMs: null };
  }
}

// ── Vercel Analytics ─────────────────────────────────────────────────────────
async function fetchVercelAnalytics(vercelProject) {
  if (!VERCEL_TOKEN || !vercelProject) {
    return { last30d: null, pageViews30d: null, analyticsEnabled: false };
  }
  try {
    // First get the project ID from the project slug
    const projRes = await fetch(
      `https://api.vercel.com/v9/projects/${vercelProject}?teamId=${VERCEL_TEAM_ID}`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
    );
    if (!projRes.ok) return { last30d: null, pageViews30d: null, analyticsEnabled: false };
    const proj = await projRes.json();
    const projectId = proj.id;
    if (!projectId) return { last30d: null, pageViews30d: null, analyticsEnabled: false };

    // Try Web Analytics API
    const now = Date.now();
    const from = now - 30 * 24 * 60 * 60 * 1000;
    const analyticsRes = await fetch(
      `https://vercel.com/api/web-analytics/timeseries?projectId=${projectId}&teamId=${VERCEL_TEAM_ID}&from=${from}&to=${now}&granularity=day&environment=production`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
    );

    if (!analyticsRes.ok) return { last30d: null, pageViews30d: null, analyticsEnabled: false };
    const analyticsData = await analyticsRes.json();

    // Sum up the timeseries
    const series = analyticsData.data || analyticsData.timeseries || [];
    if (!series.length) return { last30d: null, pageViews30d: null, analyticsEnabled: false };

    let totalVisitors = 0;
    let totalPageViews = 0;
    series.forEach((point) => {
      totalVisitors += point.visitors || point.uniques || 0;
      totalPageViews += point.pageviews || point.views || 0;
    });

    return {
      last30d: totalVisitors || null,
      pageViews30d: totalPageViews || null,
      analyticsEnabled: true,
    };
  } catch (e) {
    console.error('Vercel Analytics error:', e.message);
    return { last30d: null, pageViews30d: null, analyticsEnabled: false };
  }
}

// ── Vercel Deployments ────────────────────────────────────────────────────────
async function fetchVercelDeploy(vercelProject) {
  if (!VERCEL_TOKEN || !vercelProject) {
    return { lastDeployDate: null, state: null, deployedBy: null };
  }
  try {
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${vercelProject}&teamId=${VERCEL_TEAM_ID}&limit=1&target=production`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
    );
    if (!res.ok) return { lastDeployDate: null, state: null, deployedBy: null };
    const data = await res.json();
    const dep = (data.deployments || [])[0];
    if (!dep) return { lastDeployDate: null, state: null, deployedBy: null };
    return {
      lastDeployDate: dep.createdAt ? new Date(dep.createdAt).toISOString() : null,
      state: dep.state || dep.readyState || null,
      deployedBy: dep.creator?.username || dep.createdBy || null,
    };
  } catch (e) {
    console.error('Vercel Deploy error:', e.message);
    return { lastDeployDate: null, state: null, deployedBy: null };
  }
}

// ── Vercel Runtime Errors ─────────────────────────────────────────────────────
async function fetchVercelErrors(vercelProject) {
  if (!VERCEL_TOKEN || !vercelProject) return { last7d: null };
  try {
    const res = await fetch(
      `https://api.vercel.com/v3/projects/${vercelProject}/analytics/errors?teamId=${VERCEL_TEAM_ID}&period=7d`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
    );
    if (!res.ok) return { last7d: null };
    const data = await res.json();
    const total = (data.errors || data.items || []).reduce((s, e) => s + (e.count || 1), 0);
    return { last7d: total };
  } catch (e) {
    return { last7d: null };
  }
}

// ── Build one site record ─────────────────────────────────────────────────────
async function buildSiteData(site) {
  const db = getDb();
  const cacheRef = db.collection('siteAnalyticsCache').doc(site.id);

  // Check cache
  try {
    const cached = await cacheRef.get();
    if (cached.exists) {
      const d = cached.data();
      const age = Date.now() - (d.cachedAt?.toMillis ? d.cachedAt.toMillis() : 0);
      if (age < CACHE_TTL_MS) {
        const { cachedAt, ...rest } = d;
        return rest;
      }
    }
  } catch (_) {}

  // Fetch all in parallel
  const [uptime, analytics, deploy, errors] = await Promise.all([
    fetchUptimeRobot(site.url),
    fetchVercelAnalytics(site.vercelProject),
    fetchVercelDeploy(site.vercelProject),
    fetchVercelErrors(site.vercelProject),
  ]);

  const result = {
    id: site.id,
    name: site.name,
    url: site.url,
    type: site.type || 'DAL',
    vercelProject: site.vercelProject || null,
    uptime,
    visitors: analytics,
    deploy,
    errors,
  };

  // Write cache
  try {
    await cacheRef.set({ ...result, cachedAt: FieldValue.serverTimestamp() });
  } catch (_) {}

  return result;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getDb();
    const { siteId, refresh } = req.query;

    let sites;
    if (siteId) {
      const snap = await db.collection('monitoredSites').doc(siteId).get();
      if (!snap.exists) return res.status(404).json({ error: 'Site not found' });
      sites = [{ id: snap.id, ...snap.data() }];
      // On explicit siteId request with refresh=true, bust cache
      if (refresh === 'true') {
        try { await db.collection('siteAnalyticsCache').doc(siteId).delete(); } catch (_) {}
      }
    } else {
      const snap = await db.collection('monitoredSites').where('active', '==', true).get();
      sites = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    if (!sites.length) return res.status(200).json({ ok: true, sites: [] });

    const results = await Promise.all(sites.map(buildSiteData));
    return res.status(200).json({ ok: true, sites: results });
  } catch (e) {
    console.error('site-analytics error:', e);
    return res.status(500).json({ error: e.message });
  }
};
