import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import {
  ChecklistFilterBar,
  ChecklistProgress,
  ChecklistItemRow,
} from './AppChecklist';
import {
  getProjectTypesSeedStatus,
  runSeedProjectTypes,
} from '../scripts/seedProjectTypes';
import {
  getPipelineProgressSeedStatus,
  runSeedPipelineProgress,
} from '../scripts/seedPipelineProgress';

const COLLECTION = 'blackbox';
const DOCUMENT = 'dal_wide';

const DAL_OPS_ITEMS = [
  { key: 'brevo_mailgun', label: 'Migrate Brevo → Mailgun', description: 'dal-site (3 intake forms), Mission Control login notification, Shady Duck Cloud Functions' },
  { key: 'google_consolidation', label: 'Consolidate Google/Firebase accounts', description: 'Move all projects from eddieskehan@gmail.com to lab@dreamapplab.com. Order: FamilyThread → Shady Duck → dal-mission-control → dal-website → FamilyLens → Flarepad → Logabode' },
  { key: 'budget_alerts', label: 'Set $10 budget alerts on all Google Cloud projects', description: 'familywatch-8b302, the-shady-duck, dal-mission-control, dal-website-c9dd8 — follow same steps as FamilyThread' },
  { key: 'twilio_approval', label: 'Twilio toll-free approval', description: 'Toll-free +18447136818 pending A2P carrier approval. Once approved: update TWILIO_PHONE_NUMBER secret in Shady Duck and FamilyThread Cloud Functions, redeploy, test SMS.' },
  { key: 'android_builds', label: 'Android builds — all iOS apps first', description: 'Hold Android builds until iOS versions are at or near App Store submission for each app' },
  { key: 'aso_dev_google_play', label: 'ASO.dev Google Play integration', description: 'Requires service account setup in Google Play Console' },
  { key: 'revenuecat_dev_apps', label: 'RevenueCat for developer apps', description: 'MyClassLog, Ten Miles Ahead, RV Vault — blocked on developer providing bundle IDs' },
  { key: 'dal_website_blog', label: 'DAL website blog admin page', description: 'Build /admin/blog.html with Quill editor, Firestore posts collection, MassBlogger webhook at /api/receive-post' },
  { key: 'mission_control_subscriptions', label: 'Mission Control Subscriptions tab', description: 'Add/edit/delete UI for Subscriptions tab' },
  { key: 'mission_control_revenue', label: 'Mission Control revenue net sales', description: 'Add net sales calculation showing post-store-cut revenue (Apple 15-30%, Google 15-30%)' },
  { key: 'mission_control_mobile', label: 'Mission Control mobile revenue refresh', description: 'Add pull-to-refresh or visible refresh button on Revenue tab for mobile browsers' },
  { key: 'bugbot', label: 'Enable Cursor Bugbot', description: 'When enabled on DreamAppLab GitHub org, save GitHub App installation details to Black Box in Mission Control' },
];

function isOpsDone(items, key) {
  return !!(items?.[key]?.completed);
}

function filterOpsItems(list, items, filter) {
  if (filter === 'open') return list.filter((i) => !isOpsDone(items, i.key));
  if (filter === 'completed') return list.filter((i) => isOpsDone(items, i.key));
  return list;
}

const DEFAULTS = {
  teamId: 'CAT6U7K4K5',
  appleIdEmail: 'lab@dreamapplab.com',
  ascApiKeyId: 'CW6SNUM9L2',
  iapKeyId: '59AT49658X',
  issuerId: '1f65c000-4aff-4152-a635-65121626d216',
  distCertId: 'FQ78WWT9V3',
  certExpiry: 'Jul 29, 2027',
  googleServiceAccount: '',
  playOrgPackage: '',
  vercelTeamName: 'dream-app-lab',
  vercelTeamUrl: 'vercel.com/dream-app-lab',
  domains: 'flarepad.click, logabode.click, familylens.click, dreamapplab.com — all registered through Vercel',
  attorneyName: 'Allen',
  attorneyEmail: '',
  attorneyPhone: '',
  asoToolName: 'ASO.dev',
  asoPlan: 'Indie',
  asoMonthlyCost: '$39',
  notes: '',
};

function Field({ label, fieldKey, value, onChange, onBlur, type = 'text', placeholder = '' }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(fieldKey, e.target.value)}
        onBlur={() => onBlur(fieldKey, value)}
      />
    </div>
  );
}

function TextareaField({ label, fieldKey, value, onChange, onBlur, rows = 4, placeholder = '' }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <textarea
        className="form-input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(fieldKey, e.target.value)}
        onBlur={() => onBlur(fieldKey, value)}
        style={{ resize: 'vertical', fontFamily: 'inherit' }}
      />
    </div>
  );
}

export default function DALHeadquarters() {
  const [fields, setFields] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState({});

  useEffect(() => {
    getDoc(doc(db, COLLECTION, DOCUMENT)).then(snapshot => {
      if (snapshot.exists() && Object.keys(snapshot.data()).length > 0) {
        setFields(prev => ({ ...prev, ...snapshot.data() }));
      }
      setLoading(false);
    }).catch(err => {
      console.error('DAL HQ load failed:', err);
      setLoading(false);
    });
  }, []);

  const handleChange = (key, value) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const handleBlur = async (key, value) => {
    setSaveStatus(prev => ({ ...prev, [key]: 'saving' }));
    try {
      await setDoc(doc(db, COLLECTION, DOCUMENT), { [key]: value }, { merge: true });
      setSaveStatus(prev => ({ ...prev, [key]: 'saved' }));
      setTimeout(() => setSaveStatus(prev => ({ ...prev, [key]: null })), 2000);
    } catch (err) {
      console.error('DAL HQ save failed:', err);
      setSaveStatus(prev => ({ ...prev, [key]: 'error' }));
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading DAL HQ...</span>
      </div>
    );
  }

  const fieldProps = { onChange: handleChange, onBlur: handleBlur };

  const SaveIndicator = ({ fieldKey }) => {
    const status = saveStatus[fieldKey];
    if (!status) return null;
    return (
      <span style={{
        fontSize: 11,
        marginLeft: 8,
        color: status === 'saved' ? 'var(--teal, #4CAF50)' : status === 'error' ? 'var(--coral, #f44336)' : 'var(--text-muted)',
      }}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : '✗ Error'}
      </span>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">DAL HQ</h1>
          <p className="page-subtitle">Organisation-wide settings & credentials — auto-saves on blur</p>
        </div>
      </div>

      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 16 }}>Apple Org</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { label: 'Team ID', key: 'teamId' },
            { label: 'Apple ID Email', key: 'appleIdEmail' },
            { label: 'ASC API Key ID', key: 'ascApiKeyId' },
            { label: 'IAP Key ID', key: 'iapKeyId' },
            { label: 'Issuer ID', key: 'issuerId' },
          ].map(({ label, key }) => (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <SaveIndicator fieldKey={key} />
              </div>
              <input
                className="form-input"
                type="text"
                value={fields[key]}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 16 }}>Distribution</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { label: 'Distribution Cert ID', key: 'distCertId' },
            { label: 'Cert Expiry', key: 'certExpiry' },
          ].map(({ label, key }) => (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <SaveIndicator fieldKey={key} />
              </div>
              <input
                className="form-input"
                type="text"
                value={fields[key]}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 16 }}>Google Play Org</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { label: 'Service Account Email', key: 'googleServiceAccount', placeholder: 'e.g. service@project.iam.gserviceaccount.com' },
            { label: 'Play Org Package', key: 'playOrgPackage', placeholder: 'e.g. com.dreamapplab' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <SaveIndicator fieldKey={key} />
              </div>
              <input
                className="form-input"
                type="text"
                value={fields[key]}
                placeholder={placeholder}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 16 }}>Vercel</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { label: 'Team Name', key: 'vercelTeamName' },
            { label: 'Team URL', key: 'vercelTeamUrl' },
          ].map(({ label, key }) => (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <SaveIndicator fieldKey={key} />
              </div>
              <input
                className="form-input"
                type="text"
                value={fields[key]}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="data-section">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Domains</div>
          <SaveIndicator fieldKey="domains" />
        </div>
        <textarea
          className="form-input"
          rows={3}
          value={fields.domains}
          onChange={e => handleChange('domains', e.target.value)}
          onBlur={() => handleBlur('domains', fields.domains)}
          style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
        />
      </div>

      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 16 }}>Attorney</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { label: 'Name', key: 'attorneyName' },
            { label: 'Email', key: 'attorneyEmail', placeholder: 'attorney@example.com' },
            { label: 'Phone', key: 'attorneyPhone', placeholder: '+1 555 000 0000' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <SaveIndicator fieldKey={key} />
              </div>
              <input
                className="form-input"
                type="text"
                value={fields[key]}
                placeholder={placeholder || ''}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 16 }}>ASO Tool</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { label: 'Tool Name', key: 'asoToolName' },
            { label: 'Plan', key: 'asoPlan' },
            { label: 'Monthly Cost', key: 'asoMonthlyCost' },
          ].map(({ label, key }) => (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <SaveIndicator fieldKey={key} />
              </div>
              <input
                className="form-input"
                type="text"
                value={fields[key]}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="data-section">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Notes</div>
          <SaveIndicator fieldKey="notes" />
        </div>
        <textarea
          className="form-input"
          rows={6}
          value={fields.notes}
          placeholder="Any other DAL-wide notes..."
          onChange={e => handleChange('notes', e.target.value)}
          onBlur={() => handleBlur('notes', fields.notes)}
          style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
        />
      </div>

      <SeedProjectTypesPanel />
      <SeedPipelineProgressPanel />
      <DalOpsChecklist />
    </div>
  );
}

function SeedProjectTypesPanel() {
  const [seeded, setSeeded] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getProjectTypesSeedStatus()
      .then((status) => setSeeded(!!status?.seeded))
      .catch(() => setSeeded(false));
  }, []);

  if (seeded && logs.length === 0) return null;

  const handleRun = async () => {
    setRunning(true);
    setError('');
    try {
      const result = await runSeedProjectTypes();
      setLogs(result.logs || []);
      setSeeded(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Seed failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="data-section">
      <div className="section-label" style={{ marginBottom: 8 }}>One-time: seed project types</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Sets <code>projectType</code> on existing DAL app projects that do not have one.
        This button disappears after a successful run.
      </p>
      {!seeded && (
        <button type="button" className="btn btn-secondary" disabled={running} onClick={handleRun}>
          {running ? 'Seeding…' : 'Seed project types'}
        </button>
      )}
      {error ? <div className="quotes-error" style={{ marginTop: 12 }}>{error}</div> : null}
      {logs.length > 0 && (
        <pre style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
          {logs.join('\n')}
        </pre>
      )}
    </div>
  );
}

function SeedPipelineProgressPanel() {
  const [seeded, setSeeded] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getPipelineProgressSeedStatus()
      .then((status) => setSeeded(!!status?.seeded))
      .catch(() => setSeeded(false));
  }, []);

  if (seeded && logs.length === 0) return null;

  const handleRun = async () => {
    setRunning(true);
    setError('');
    try {
      const result = await runSeedPipelineProgress();
      setLogs(result.logs || []);
      setSeeded(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Seed failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="data-section">
      <div className="section-label" style={{ marginBottom: 8 }}>One-time: seed pipeline progress</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Marks completed app-pipeline tasks for FamilyThread, TravelWhirl, FamilyLens, Flarepad, and Logabode
        as of August 19, 2026. This button disappears after a successful run.
      </p>
      {!seeded && (
        <button type="button" className="btn btn-secondary" disabled={running} onClick={handleRun}>
          {running ? 'Seeding…' : 'Seed pipeline progress'}
        </button>
      )}
      {error ? <div className="quotes-error" style={{ marginTop: 12 }}>{error}</div> : null}
      {logs.length > 0 && (
        <pre style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
          {logs.join('\n')}
        </pre>
      )}
    </div>
  );
}

function DalOpsChecklist() {
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState({});
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'blackbox', 'dal_wide_checklist'));
      setItems(snap.exists() ? snap.data().items || {} : {});
    } catch (err) {
      console.error('DAL Ops checklist load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleItem = async (itemKey) => {
    if (toggling) return;
    const prev = items[itemKey] || {};
    const nextCompleted = !prev.completed;
    const nextState = {
      completed: nextCompleted,
      completedAt: nextCompleted ? Timestamp.now() : null,
    };

    setToggling(itemKey);
    setItems((curr) => ({ ...curr, [itemKey]: nextState }));

    try {
      const ref = doc(db, 'blackbox', 'dal_wide_checklist');
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data().items || {}) : {};
      await setDoc(ref, { items: { ...existing, [itemKey]: nextState } }, { merge: true });
    } catch (err) {
      console.error('DAL Ops checklist save failed:', err);
      setItems((curr) => ({ ...curr, [itemKey]: prev }));
    } finally {
      setToggling(null);
    }
  };

  const visible = filterOpsItems(DAL_OPS_ITEMS, items, filter);
  const done = DAL_OPS_ITEMS.filter((i) => isOpsDone(items, i.key)).length;

  return (
    <div className="data-section">
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 2,
        }}
      >
        🗂 DAL Ops Checklist
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        Organisation-wide ops — saved to Firestore, shared across devices
      </div>

      <ChecklistFilterBar filter={filter} onChange={setFilter} />

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '1.5rem 0' }}>
          Loading checklist…
        </div>
      ) : (
        <>
          <ChecklistProgress done={done} total={DAL_OPS_ITEMS.length} />
          {visible.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem 1rem',
                color: 'var(--text-muted)',
                fontSize: 13,
                border: '1px dashed var(--border)',
                borderRadius: 12,
              }}
            >
              No checklist items match this filter
            </div>
          ) : (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--bg-card)',
              }}
            >
              {visible.map((item) => (
                <ChecklistItemRow
                  key={item.key}
                  item={item}
                  state={items[item.key]}
                  onToggle={() => toggleItem(item.key)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
