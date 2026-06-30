const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v2';

const REVENUE_APP_CONFIG = [
  { appId: 'logabode', envKey: 'REACT_APP_REVENUECAT_SECRET_LOGABODE' },
  { appId: 'flarepad', envKey: 'REACT_APP_REVENUECAT_SECRET_FLAREPAD' },
  { appId: 'familywatch', envKey: 'REACT_APP_REVENUECAT_SECRET_FAMILYWATCH' },
  { appId: 'myclasslog', envKey: 'REACT_APP_REVENUECAT_SECRET_MYCLASSLOG' },
  { appId: 'tenmilesahead', envKey: 'REACT_APP_REVENUECAT_SECRET_TENMILESAHEAD' },
  { appId: 'rvvault', envKey: 'REACT_APP_REVENUECAT_SECRET_RVVAULT' },
];

function getSecretForApp(appId) {
  const config = REVENUE_APP_CONFIG.find(a => a.appId === appId);
  if (!config) return null;
  return process.env[config.envKey] || null;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getLast30DayRange() {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29);
  return { start_date: formatDate(start), end_date: formatDate(end) };
}

async function revenueCatRequest(path, secretKey, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  const url = `${REVENUECAT_API_BASE}${path}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RevenueCat ${res.status}: ${body || res.statusText}`);
  }

  return res.json();
}

async function getProjectId(secretKey) {
  const data = await revenueCatRequest('/projects', secretKey, { limit: 1 });
  const project = data.items?.[0];
  if (!project?.id) {
    throw new Error('No RevenueCat project found for this API key');
  }
  return project.id;
}

function metricValue(metrics, ...ids) {
  const list = metrics?.metrics || metrics || [];
  if (!Array.isArray(list)) return 0;
  for (const id of ids) {
    const match = list.find(m => m.id === id);
    if (match && match.value != null) return Number(match.value) || 0;
  }
  return 0;
}

function buildEmptyTrend() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (29 - i));
    return { date: formatDate(d), value: 0 };
  });
}

function alignTrendToLast30Days(points) {
  const byDate = {};
  points.forEach(p => {
    byDate[p.date] = p.value;
  });
  return buildEmptyTrend().map(t => ({
    date: t.date,
    value: byDate[t.date] ?? 0,
  }));
}

function parseDailyRevenue(chartData) {
  const emptyTrend = buildEmptyTrend();
  if (!chartData) return emptyTrend;

  const values = chartData.values;
  if (Array.isArray(values) && values.length > 0) {
    const points = [];

    values.forEach((entry, index) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const date = entry.date || entry.period_start || entry.periodStart || entry.timestamp;
        const value = entry.revenue ?? entry.value ?? entry.proceeds ?? entry.total ?? 0;
        if (date) {
          points.push({
            date: String(date).slice(0, 10),
            value: Number(value) || 0,
          });
          return;
        }
      }

      if (Array.isArray(entry)) {
        const [rawDate, rawValue] = entry;
        if (rawDate != null) {
          const date = typeof rawDate === 'number'
            ? formatDate(new Date(rawDate))
            : String(rawDate).slice(0, 10);
          points.push({ date, value: Number(rawValue) || 0 });
          return;
        }
      }

      if (typeof entry === 'number') {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - (values.length - 1 - index));
        points.push({ date: formatDate(d), value: entry });
      }
    });

    if (points.length > 0) {
      return alignTrendToLast30Days(points);
    }
  }

  const summaryTotal = chartData.summary?.total ?? chartData.summary?.revenue;
  if (summaryTotal != null) {
    const perDay = Number(summaryTotal) / 30;
    return emptyTrend.map(t => ({ ...t, value: perDay }));
  }

  return emptyTrend;
}

async function fetchChartMetric(projectId, secretKey, chartName, query) {
  try {
    return await revenueCatRequest(
      `/projects/${projectId}/charts/${chartName}`,
      secretKey,
      query
    );
  } catch {
    return null;
  }
}

async function fetchRevenueCatAppMetrics(secretKey) {
  if (!secretKey) {
    throw new Error('RevenueCat API key is not configured');
  }

  const projectId = await getProjectId(secretKey);
  const range = getLast30DayRange();

  const [overview, totalRevenueData, revenueChart, trialChart, churnChart] = await Promise.all([
    revenueCatRequest(`/projects/${projectId}/metrics/overview`, secretKey),
    revenueCatRequest(`/projects/${projectId}/metrics/revenue`, secretKey, {
      start_date: '2015-01-01',
      end_date: range.end_date,
    }),
    revenueCatRequest(`/projects/${projectId}/charts/revenue`, secretKey, {
      start_date: range.start_date,
      end_date: range.end_date,
      resolution: 0,
    }),
    fetchChartMetric(projectId, secretKey, 'trial_conversion_rate', {
      start_date: range.start_date,
      end_date: range.end_date,
      aggregate: 'total',
    }),
    fetchChartMetric(projectId, secretKey, 'churn', {
      start_date: range.start_date,
      end_date: range.end_date,
      aggregate: 'average',
    }),
  ]);

  const metrics = overview.metrics || [];
  const mrr = metricValue({ metrics }, 'mrr');
  const activeSubscribers = metricValue({ metrics }, 'active_subscriptions', 'actives');
  const totalRevenue = Number(totalRevenueData?.value) || 0;

  let trialConversions = metricValue({ metrics }, 'trial_conversions', 'trial_conversion');
  if (!trialConversions && trialChart?.summary) {
    trialConversions = Number(trialChart.summary.total ?? trialChart.summary.average) || 0;
  }

  let churnRate = metricValue({ metrics }, 'churn', 'churn_rate');
  if (!churnRate && churnChart?.summary) {
    churnRate = Number(churnChart.summary.average ?? churnChart.summary.total) || 0;
  }

  const dailyRevenue = parseDailyRevenue(revenueChart);

  return {
    projectId,
    mrr,
    activeSubscribers,
    totalRevenue,
    trialConversions,
    churnRate,
    dailyRevenue,
    syncedAt: new Date().toISOString(),
  };
}

async function fetchRevenueCatAppById(appId) {
  const secretKey = getSecretForApp(appId);
  if (!secretKey) {
    throw new Error(`RevenueCat API key not configured for ${appId}`);
  }
  const metrics = await fetchRevenueCatAppMetrics(secretKey);
  return { appId, success: true, ...metrics };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const appId = req.query.appId;

  try {
    if (appId) {
      const result = await fetchRevenueCatAppById(appId);
      return res.status(200).json({ apps: [result] });
    }

    const apps = await Promise.all(
      REVENUE_APP_CONFIG.map(async ({ appId: id }) => {
        try {
          return await fetchRevenueCatAppById(id);
        } catch (error) {
          return { appId: id, success: false, error: error.message };
        }
      })
    );

    return res.status(200).json({ apps });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
