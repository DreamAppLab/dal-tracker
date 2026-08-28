import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  getMissingBlackBoxAppsStatus,
  runSeedMissingBlackBoxApps,
} from '../scripts/seedMissingBlackBoxApps';

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

const SERVICES_DOCUMENT = 'dal_hq_services';

const hqPillBase = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  fontFamily: 'inherit',
};

function slugifyServiceName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `custom_${Date.now()}`;
}

function emptyFields(names) {
  return Object.fromEntries(names.map((name) => [name, '']));
}

function makeHqService({ key, label, category, fields, helper }) {
  return {
    key,
    label,
    category,
    enabled: true,
    fields: emptyFields(fields),
    customFields: [],
    notes: '',
    ...(helper ? { helper } : {}),
  };
}

function isTelnyxService(svc) {
  const key = String(svc?.key || '').toLowerCase();
  const label = String(svc?.label || '').toLowerCase().trim();
  return key === 'telnyx' || key.startsWith('telnyx_') || label === 'telnyx';
}

function asHqStringValue(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object') {
    if (raw.value == null) return '';
    if (typeof raw.value === 'string' || typeof raw.value === 'number' || typeof raw.value === 'boolean') {
      return String(raw.value);
    }
  }
  return '';
}

/** Coerce Telnyx `fields` to the same string map Mailgun uses: { [fieldName]: string }. */
function telnyxFieldsAsMailgunMap(fields) {
  if (Array.isArray(fields)) {
    const map = {};
    fields.forEach((f, i) => {
      if (typeof f === 'string') {
        if (map[f] === undefined) map[f] = '';
        return;
      }
      const name = f?.fieldName || f?.label || f?.name || `Field ${i + 1}`;
      map[name] = asHqStringValue(f?.value !== undefined ? f.value : f);
    });
    return map;
  }
  if (!fields || typeof fields !== 'object') return {};
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, asHqStringValue(v)])
  );
}

function normalizeTelnyxService(svc) {
  if (!isTelnyxService(svc)) return svc;
  return {
    ...svc,
    fields: telnyxFieldsAsMailgunMap(svc.fields),
    customFields: (svc.customFields || []).map((cf) => ({
      ...cf,
      value: asHqStringValue(cf.value),
    })),
  };
}

const DAL_HQ_SEED_SERVICES = [
  makeHqService({
    key: 'expo_eas',
    label: 'Expo / EAS',
    category: 'App Store / Distribution',
    fields: ['Account Username', 'Account Email'],
  }),
  makeHqService({
    key: 'revenuecat',
    label: 'RevenueCat',
    category: 'Subscriptions & Payments',
    fields: ['Account Email', 'Project Name'],
    helper: "Per-app API keys are in each app's Black Box entry",
  }),
  makeHqService({
    key: 'stripe',
    label: 'Stripe',
    category: 'Subscriptions & Payments',
    fields: ['Public Key', 'Secret Key', 'Webhook Secret'],
  }),
  makeHqService({
    key: 'google_oauth_dal',
    label: 'Google OAuth (DAL)',
    category: 'Authentication & Identity',
    fields: ['Client ID', 'Client Secret'],
    helper: 'Used for Mission Control Google Calendar integration',
  }),
  makeHqService({
    key: 'mailgun',
    label: 'Mailgun',
    category: 'Email & Messaging',
    fields: ['API Key', 'Domain', 'From Email'],
  }),
  makeHqService({
    key: 'telnyx',
    label: 'Telnyx',
    category: 'Email & Messaging',
    fields: ['API Key', 'Public Key', 'Messaging Profile ID', 'Phone Number'],
  }),
  makeHqService({
    key: 'twilio',
    label: 'Twilio',
    category: 'Email & Messaging',
    fields: ['Account SID', 'Auth Token', 'Phone Number'],
    helper: 'Toll-free +18443522180 — registration in review',
  }),
  makeHqService({
    key: 'sentry',
    label: 'Sentry',
    category: 'Analytics & Monitoring',
    fields: ['Org Slug', 'Auth Token'],
    helper: "Per-app DSNs are in each app's Black Box entry",
  }),
  makeHqService({
    key: 'vercel_dal',
    label: 'Vercel',
    category: 'Hosting & Deployment',
    fields: ['Account Email', 'Team Name', 'Team URL'],
  }),
  makeHqService({
    key: 'aso_dev',
    label: 'ASO.dev',
    category: 'ASO & Marketing',
    fields: ['Account Email', 'Plan', 'Monthly Cost'],
  }),
  makeHqService({
    key: 'massblogger',
    label: 'MassBlogger',
    category: 'ASO & Marketing',
    fields: ['Account Email', 'Webhook URL'],
  }),
  makeHqService({
    key: 'crisp_dal',
    label: 'Crisp',
    category: 'Custom',
    fields: ['Account Email', 'DAL Website ID'],
    helper: "Per-app Website IDs are in each app's Black Box entry",
  }),
];

const HQ_CATEGORY_FALLBACK = [
  'App Store / Distribution',
  'Subscriptions & Payments',
  'Authentication & Identity',
  'Email & Messaging',
  'Analytics & Monitoring',
  'Hosting & Deployment',
  'ASO & Marketing',
  'Custom',
];

function groupHqServicesByCategory(services) {
  const order = [];
  const map = {};
  services.forEach((svc) => {
    const cat = svc.category || 'Custom';
    if (!map[cat]) {
      map[cat] = [];
      order.push(cat);
    }
    map[cat].push(svc);
  });
  return order.map((category) => ({
    category,
    services: map[category].slice().sort((a, b) =>
      String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' })
    ),
  }));
}

function HqSaveIndicator({ status }) {
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
}

function HqCopyableInput({ fieldId, value, onChange, onBlur, placeholder = '', type = 'text', copied, setCopied }) {
  const fieldValue = value ?? '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        className="form-input"
        type={type}
        value={fieldValue}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={onBlur}
        onClick={(e) => e.target.select()}
        style={{ flex: 1, minWidth: 0, cursor: 'text' }}
      />
      <button onClick={() => navigator.clipboard.writeText(fieldValue).then(() => { setCopied(fieldId); setTimeout(() => setCopied(null), 2000); })}>
        {copied === fieldId ? 'Copied!' : '📋'}
      </button>
    </div>
  );
}

function HqCopyableTextarea({ fieldId, value, onChange, onBlur, placeholder = '', rows, copied, setCopied, style }) {
  const fieldValue = value ?? '';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <textarea
        className="form-input"
        rows={rows}
        value={fieldValue}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={onBlur}
        onClick={(e) => e.target.select()}
        style={{ flex: 1, minWidth: 0, ...style }}
      />
      <button onClick={() => navigator.clipboard.writeText(fieldValue).then(() => { setCopied(fieldId); setTimeout(() => setCopied(null), 2000); })}>
        {copied === fieldId ? 'Copied!' : '📋'}
      </button>
    </div>
  );
}

function DALHQServices() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState({});
  const [expanded, setExpanded] = useState({});
  const [addingFieldFor, setAddingFieldFor] = useState(null);
  const [newFieldDraft, setNewFieldDraft] = useState({ fieldName: '', fieldDescription: '' });
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceCategory, setNewServiceCategory] = useState('Custom');
  const [copied, setCopied] = useState(null);
  const servicesRef = useRef([]);

  const persistServices = useCallback(async (next, fieldId) => {
    servicesRef.current = next;
    setServices(next);
    if (fieldId) {
      setSaveStatus((prev) => ({ ...prev, [fieldId]: 'saving' }));
    }
    try {
      await setDoc(doc(db, COLLECTION, SERVICES_DOCUMENT), { services: next }, { merge: true });
      if (fieldId) {
        setSaveStatus((prev) => ({ ...prev, [fieldId]: 'saved' }));
        setTimeout(() => {
          setSaveStatus((prev) => ({ ...prev, [fieldId]: null }));
        }, 2000);
      }
    } catch (err) {
      console.error('DAL HQ services save failed:', err);
      if (fieldId) {
        setSaveStatus((prev) => ({ ...prev, [fieldId]: 'error' }));
      }
    }
  }, []);

  useEffect(() => {
    const ref = doc(db, COLLECTION, SERVICES_DOCUMENT);
    getDoc(ref).then(async (snapshot) => {
      if (!snapshot.exists()) {
        await setDoc(ref, { services: DAL_HQ_SEED_SERVICES }, { merge: true });
        servicesRef.current = DAL_HQ_SEED_SERVICES;
        setServices(DAL_HQ_SEED_SERVICES);
        setExpanded(
          Object.fromEntries(DAL_HQ_SEED_SERVICES.filter((s) => s.enabled).map((s) => [s.key, true]))
        );
      } else {
        const loaded = (snapshot.data().services || []).map(normalizeTelnyxService);
        servicesRef.current = loaded;
        setServices(loaded);
        setExpanded(
          Object.fromEntries(loaded.filter((s) => s.enabled).map((s) => [s.key, true]))
        );
      }
      setLoading(false);
    }).catch((err) => {
      console.error('DAL HQ services load failed:', err);
      setLoading(false);
    });
  }, []);

  const patchService = (key, updater) => {
    const next = servicesRef.current.map((svc) =>
      svc.key === key ? updater(svc) : svc
    );
    return next;
  };

  const toggleService = (key) => {
    const next = patchService(key, (svc) => ({ ...svc, enabled: !svc.enabled }));
    const toggled = next.find((s) => s.key === key);
    if (toggled?.enabled) {
      setExpanded((prev) => ({ ...prev, [key]: true }));
    }
    void persistServices(next, `${key}:enabled`);
  };

  const handleFieldChange = (key, fieldName, value) => {
    const next = patchService(key, (svc) => {
      const baseFields = isTelnyxService(svc)
        ? telnyxFieldsAsMailgunMap(svc.fields)
        : { ...(svc.fields || {}) };
      return {
        ...svc,
        fields: { ...baseFields, [fieldName]: value },
      };
    });
    servicesRef.current = next;
    setServices(next);
  };

  const handleCustomFieldChange = (key, idx, value) => {
    const next = patchService(key, (svc) => ({
      ...svc,
      customFields: (svc.customFields || []).map((cf, i) =>
        i === idx ? { ...cf, value } : cf
      ),
    }));
    servicesRef.current = next;
    setServices(next);
  };

  const handleNotesChange = (key, value) => {
    const next = patchService(key, (svc) => ({ ...svc, notes: value }));
    servicesRef.current = next;
    setServices(next);
  };

  const handleFieldBlur = (fieldId) => {
    void persistServices(servicesRef.current, fieldId);
  };

  const confirmAddField = (key) => {
    const fieldName = newFieldDraft.fieldName.trim();
    if (!fieldName) return;
    const entry = {
      fieldName,
      fieldDescription: newFieldDraft.fieldDescription.trim(),
      value: '',
    };
    const next = patchService(key, (svc) => ({
      ...svc,
      customFields: [...(svc.customFields || []), entry],
    }));
    setAddingFieldFor(null);
    setNewFieldDraft({ fieldName: '', fieldDescription: '' });
    void persistServices(next, `${key}:custom:${entry.fieldName}`);
  };

  const deleteCustomField = (key, idx) => {
    const next = patchService(key, (svc) => ({
      ...svc,
      customFields: (svc.customFields || []).filter((_, i) => i !== idx),
    }));
    void persistServices(next, `${key}:custom-delete`);
  };

  const addCustomService = () => {
    const label = newServiceName.trim();
    if (!label) return;
    let key = slugifyServiceName(label);
    const existing = new Set(servicesRef.current.map((s) => s.key));
    if (existing.has(key)) {
      key = `${key}_${Date.now()}`;
    }
    const entry = {
      key,
      label,
      category: newServiceCategory || 'Custom',
      enabled: true,
      fields: {},
      customFields: [],
      notes: '',
    };
    const next = [...servicesRef.current, entry];
    setShowAddService(false);
    setNewServiceName('');
    setNewServiceCategory('Custom');
    setExpanded((prev) => ({ ...prev, [key]: true }));
    void persistServices(next, `${key}:create`);
  };

  const categoryOptions = Array.from(new Set([
    ...HQ_CATEGORY_FALLBACK,
    ...services.map((s) => s.category).filter(Boolean),
    'Custom',
  ]));

  const categories = groupHqServicesByCategory(services);
  const enabledServices = services.filter((s) => s.enabled);

  if (loading) {
    return (
      <div className="data-section">
        <div className="section-label" style={{ marginBottom: 8 }}>Services & Platforms</div>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading services…</span>
      </div>
    );
  }

  return (
    <div className="data-section">
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        Services & Platforms
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-muted)',
            marginLeft: 8,
          }}
        >
          ({enabledServices.length} enabled)
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
        Organization-wide accounts and credentials. Toggle a service on or off. Values auto-save on blur.
      </div>

      {categories.map(({ category, services: list }) => (
        <div key={category} style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            {category}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {list.map((svc) => {
              const on = !!svc.enabled;
              return (
                <button
                  key={svc.key}
                  type="button"
                  onClick={() => toggleService(svc.key)}
                  style={{
                    ...hqPillBase,
                    background: on ? '#4F8EF7' : 'transparent',
                    color: on ? '#fff' : 'var(--text-secondary)',
                    borderColor: on ? '#4F8EF7' : 'var(--border)',
                  }}
                >
                  {svc.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        style={{ marginTop: 8, marginBottom: 20 }}
        onClick={() => setShowAddService(true)}
      >
        + Add Custom Service
      </button>

      {showAddService && (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            background: 'var(--bg-elevated, var(--bg-card))',
            borderRadius: 8,
            border: '1px dashed var(--border)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Service Name
              </label>
              <HqCopyableInput
                fieldId="new-service-name"
                value={newServiceName}
                copied={copied}
                setCopied={setCopied}
                onChange={(e) => setNewServiceName(e.target.value)}
                placeholder="e.g. Cloudflare"
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Category
              </label>
              <select
                className="form-input"
                value={newServiceCategory}
                onChange={(e) => setNewServiceCategory(e.target.value)}
              >
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ background: '#4F8EF7', borderColor: '#4F8EF7', color: '#fff' }}
              onClick={addCustomService}
            >
              Confirm
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowAddService(false);
                setNewServiceName('');
                setNewServiceCategory('Custom');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {enabledServices.map((svc) => {
        const isExpanded = expanded[svc.key] !== false;
        const fields = isTelnyxService(svc)
          ? telnyxFieldsAsMailgunMap(svc.fields)
          : (svc.fields || {});
        const customFields = svc.customFields || [];
        return (
          <div
            key={svc.key}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              marginBottom: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => setExpanded((prev) => ({ ...prev, [svc.key]: !isExpanded }))}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 650, fontSize: 14, color: 'var(--text-primary)' }}>
                  {svc.label}
                </div>
                {svc.helper ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {svc.helper}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setAddingFieldFor(svc.key);
                  setNewFieldDraft({ fieldName: '', fieldDescription: '' });
                  setExpanded((prev) => ({ ...prev, [svc.key]: true }));
                }}
              >
                ＋ Add Field
              </button>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {isExpanded ? '▾' : '▸'}
              </span>
            </div>

            {isExpanded && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                {addingFieldFor === svc.key && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      background: 'var(--bg-elevated)',
                      borderRadius: 8,
                      border: '1px dashed var(--border)',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, color: '#4cc1f3', display: 'block', marginBottom: 4 }}>
                          Field Name
                        </label>
                        <HqCopyableInput
                          fieldId={`${svc.key}:new-field-name`}
                          value={newFieldDraft.fieldName}
                          copied={copied}
                          setCopied={setCopied}
                          onChange={(e) => setNewFieldDraft({ ...newFieldDraft, fieldName: e.target.value })}
                          placeholder="e.g. Staging URL"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: '#4cc1f3', display: 'block', marginBottom: 4 }}>
                          Description
                        </label>
                        <HqCopyableInput
                          fieldId={`${svc.key}:new-field-desc`}
                          value={newFieldDraft.fieldDescription}
                          copied={copied}
                          setCopied={setCopied}
                          onChange={(e) =>
                            setNewFieldDraft({ ...newFieldDraft, fieldDescription: e.target.value })
                          }
                          placeholder="Hint text for this field"
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ background: '#4F8EF7', borderColor: '#4F8EF7', color: '#fff' }}
                        onClick={() => confirmAddField(svc.key)}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setAddingFieldFor(null);
                          setNewFieldDraft({ fieldName: '', fieldDescription: '' });
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {Object.keys(fields).map((fieldName) => {
                  const fieldId = `${svc.key}:field:${fieldName}`;
                  return (
                    <div key={fieldName} style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#4cc1f3',
                            letterSpacing: '0.03em',
                          }}
                        >
                          {fieldName}
                        </label>
                        <HqSaveIndicator status={saveStatus[fieldId]} />
                      </div>
                      <HqCopyableInput
                        fieldId={fieldId}
                        value={fields[fieldName] ?? ''}
                        copied={copied}
                        setCopied={setCopied}
                        onChange={(e) => handleFieldChange(svc.key, fieldName, e.target.value)}
                        onBlur={() => handleFieldBlur(fieldId)}
                      />
                    </div>
                  );
                })}

                {customFields.map((cf, idx) => {
                  const fieldId = `${svc.key}:custom:${idx}`;
                  return (
                    <div key={`custom-${cf.fieldName}-${idx}`} style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#4cc1f3',
                            flex: 1,
                          }}
                        >
                          {cf.fieldName}
                        </label>
                        <HqSaveIndicator status={saveStatus[fieldId]} />
                        <button
                          type="button"
                          aria-label={`Remove ${cf.fieldName}`}
                          onClick={() => deleteCustomField(svc.key, idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: 16,
                            lineHeight: 1,
                            padding: '0 4px',
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <HqCopyableInput
                        fieldId={fieldId}
                        value={cf.value ?? ''}
                        copied={copied}
                        setCopied={setCopied}
                        placeholder={cf.fieldDescription || ''}
                        onChange={(e) => handleCustomFieldChange(svc.key, idx, e.target.value)}
                        onBlur={() => handleFieldBlur(fieldId)}
                      />
                    </div>
                  );
                })}

                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <label
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#4cc1f3',
                      }}
                    >
                      Notes
                    </label>
                    <HqSaveIndicator status={saveStatus[`${svc.key}:notes`]} />
                  </div>
                  <HqCopyableTextarea
                    fieldId={`${svc.key}:notes`}
                    value={svc.notes ?? ''}
                    copied={copied}
                    setCopied={setCopied}
                    placeholder="Additional notes for this service..."
                    onChange={(e) => handleNotesChange(svc.key, e.target.value)}
                    onBlur={() => handleFieldBlur(`${svc.key}:notes`)}
                    style={{ minHeight: 72, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, fieldKey, value, onChange, onBlur, type = 'text', placeholder = '' }) {
  const [copied, setCopied] = useState(null);
  const fieldId = fieldKey;
  const fieldValue = value ?? '';
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        className="form-input"
        type={type}
        value={fieldValue}
        placeholder={placeholder}
        onChange={e => onChange(fieldKey, e.target.value)}
        onBlur={() => onBlur(fieldKey, value)}
        onClick={(e) => e.target.select()}
      />
      <button onClick={() => navigator.clipboard.writeText(fieldValue).then(() => { setCopied(fieldId); setTimeout(() => setCopied(null), 2000); })}>
        {copied === fieldId ? 'Copied!' : '📋'}
      </button>
      </div>
    </div>
  );
}

function TextareaField({ label, fieldKey, value, onChange, onBlur, rows = 4, placeholder = '' }) {
  const [copied, setCopied] = useState(null);
  const fieldId = fieldKey;
  const fieldValue = value ?? '';
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <textarea
        className="form-input"
        rows={rows}
        value={fieldValue}
        placeholder={placeholder}
        onChange={e => onChange(fieldKey, e.target.value)}
        onBlur={() => onBlur(fieldKey, value)}
        onClick={(e) => e.target.select()}
        style={{ resize: 'vertical', fontFamily: 'inherit', flex: 1 }}
      />
      <button onClick={() => navigator.clipboard.writeText(fieldValue).then(() => { setCopied(fieldId); setTimeout(() => setCopied(null), 2000); })}>
        {copied === fieldId ? 'Copied!' : '📋'}
      </button>
      </div>
    </div>
  );
}

export default function DALHeadquarters() {
  const [fields, setFields] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState({});
  const [copied, setCopied] = useState(null);

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
          <p className="page-subtitle">Organization-wide settings & credentials — auto-saves on blur</p>
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
              <HqCopyableInput
                fieldId={key}
                value={fields[key]}
                copied={copied}
                setCopied={setCopied}
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
              <HqCopyableInput
                fieldId={key}
                value={fields[key]}
                copied={copied}
                setCopied={setCopied}
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
              <HqCopyableInput
                fieldId={key}
                value={fields[key]}
                copied={copied}
                setCopied={setCopied}
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
              <HqCopyableInput
                fieldId={key}
                value={fields[key]}
                copied={copied}
                setCopied={setCopied}
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
        <HqCopyableTextarea
          fieldId="domains"
          value={fields.domains}
          copied={copied}
          setCopied={setCopied}
          rows={3}
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
              <HqCopyableInput
                fieldId={key}
                value={fields[key]}
                copied={copied}
                setCopied={setCopied}
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
              <HqCopyableInput
                fieldId={key}
                value={fields[key]}
                copied={copied}
                setCopied={setCopied}
                onChange={e => handleChange(key, e.target.value)}
                onBlur={() => handleBlur(key, fields[key])}
              />
            </div>
          ))}
        </div>
      </div>

      <DALHQServices />

      <div className="data-section">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Notes</div>
          <SaveIndicator fieldKey="notes" />
        </div>
        <HqCopyableTextarea
          fieldId="notes"
          value={fields.notes}
          copied={copied}
          setCopied={setCopied}
          rows={6}
          placeholder="Any other DAL-wide notes..."
          onChange={e => handleChange('notes', e.target.value)}
          onBlur={() => handleBlur('notes', fields.notes)}
          style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
        />
      </div>

      <SeedProjectTypesPanel />
      <SeedMissingBlackBoxAppsPanel />
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
    if (running) return;
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
        <button type="button" className="btn btn-secondary" onClick={handleRun}>
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

function SeedMissingBlackBoxAppsPanel() {
  const [seeded, setSeeded] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getMissingBlackBoxAppsStatus()
      .then((status) => setSeeded(!!status?.seeded))
      .catch(() => setSeeded(false));
  }, []);

  if (seeded && logs.length === 0) return null;

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      const result = await runSeedMissingBlackBoxApps();
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
      <div className="section-label" style={{ marginBottom: 8 }}>One-time: seed missing Black Box apps</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Writes Black Box credentials for FamilyThread, TravelWhirl, and The Shady Duck
        when those <code>projects/*/blackbox</code> docs are missing.
        This button disappears after a successful run.
      </p>
      {!seeded && (
        <button type="button" className="btn btn-secondary" onClick={handleRun}>
          {running ? 'Seeding…' : 'Seed missing Black Box apps'}
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
    if (running) return;
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
        <button type="button" className="btn btn-secondary" onClick={handleRun}>
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
