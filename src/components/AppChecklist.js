// src/components/AppChecklist.js
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

const FIREBASE_APPS = [
  'familythread', 'familythread-1785694508315',
  'familylens', 'familywatch',
  'flarepad', 'logabode',
  'dal-website', 'shady-duck',
];

const PUB_PIPELINE_ITEMS = [
  { key: 'expo_doctor', label: 'Run npx expo-doctor', description: 'Must show 0 warnings before every EAS build' },
  { key: 'emulator_flag', label: 'Set emulator flag to false', description: 'EXPO_PUBLIC_USE_FIREBASE_EMULATOR=false in .env before EAS build' },
  { key: 'git_status', label: 'Check git status', description: 'Never git add . blindly — review and stage specific files only' },
  { key: 'commit_before_prebuild', label: 'Commit before prebuild', description: 'Always commit current work before running npx expo prebuild --clean' },
  { key: 'firestore_rules_diff', label: 'Review Firestore rules diff', description: 'Always diff review before firebase deploy --only firestore:rules' },
  { key: 'branch_created', label: 'Feature branch created', description: 'Never push directly to main/master — always work on a feature branch' },
  { key: 'pr_reviewed', label: 'PR diff reviewed', description: 'Review Files Changed on GitHub before merging — confirm only expected files changed' },
  { key: 'screenshots_ready', label: 'Screenshots ready', description: 'All required App Store and Play Store screenshots prepared' },
  { key: 'metadata_updated', label: 'Metadata updated', description: 'App name, subtitle, description, keywords updated in App Store Connect / Play Console' },
  { key: 'version_bumped', label: 'Version number bumped', description: 'app.json version and buildNumber/versionCode incremented correctly' },
  { key: 'privacy_policy_live', label: 'Privacy policy URL live', description: 'Privacy policy accessible at public URL before submission' },
  { key: 'tos_live', label: 'Terms of Service URL live', description: 'Terms of Service accessible at public URL before submission' },
  { key: 'legal_consent_flow', label: 'Legal consent flow tested', description: 'ToS + Privacy Policy scroll-gate works on first launch in production build' },
  { key: 'revenue_cat_tested', label: 'RevenueCat purchases tested', description: 'Subscription and IAP purchases tested in sandbox environment' },
  { key: 'restore_purchases', label: 'Restore Purchases tested', description: 'Restore Purchases button tested and working — required by Apple' },
  { key: 'in_app_review', label: 'In-app review prompt included', description: 'App Store review prompt wired and triggering at correct milestone' },
  { key: 'share_app_button', label: 'Share App button included', description: 'Share App button present in settings or appropriate screen' },
  { key: 'push_notifications_tested', label: 'Push notifications tested', description: 'All notification types tested on physical device in production build' },
  { key: 'reviewer_notes', label: 'App reviewer notes written', description: 'Clear notes for App Store reviewer including test account credentials' },
  { key: 'test_account_ready', label: 'Reviewer test account ready', description: 'Working test account created for App Store reviewer access' },
  { key: 'app_check', label: 'App Check enabled', description: 'Firebase App Check configured before public launch' },
  { key: 'black_box_updated', label: 'Black Box updated', description: 'All new credentials and IDs from this build saved to Black Box in Mission Control' },
];

const SECURITY_OPS_ITEMS = [
  { key: 'pitr_enabled', label: 'Step 1 — Enable Firestore PITR', description: 'Firebase Console → Firestore → Disaster Recovery → Enable Point-in-Time Recovery + scheduled backups (daily + weekly)' },
  { key: 'auth_settings', label: 'Step 2 — Auth settings', description: 'Firebase Console → Authentication → Settings → Verify authorized domains, enable Email enumeration protection, set sign-up quota to 100/hour' },
  { key: 'storage_rules', label: 'Step 3 — Tighten Storage rules', description: 'Firebase Console → Storage → Rules → Tighten to family/user membership checks, add all storage paths, click Attach permissions when prompted' },
  { key: 'firestore_rules', label: 'Step 4 — Audit Firestore rules', description: 'Firebase Console → Firestore → Rules → Audit all collections, fix overly permissive rules, publish' },
  { key: 'budget_alert', label: 'Step 5 — Set $10 budget alert', description: 'Google Cloud Console → Billing → Budgets & Alerts → Set $10 budget with alerts at 50%, 90%, 100% — turn off auto-reload' },
  { key: 'app_check_security', label: 'Step 6 — Add App Check', description: 'Requires Cursor prompt — do before public launch. Prevents unauthorized API access to Firebase.' },
  { key: 'gemini_billing', label: 'Enable Gemini paid tier', description: 'Google Cloud → enable billing on Gemini API to remove data-training concern. Switch to gemini-2.5-flash-lite. Cost under $1/month at current scale.' },
  { key: 'google_consolidation', label: 'Consolidate Google accounts', description: 'Move Firebase/Google Cloud project from eddieskehan@gmail.com to lab@dreamapplab.com. Do in a dedicated session with no active builds.' },
];

const ACCENT = '#4cc1f3';

function projectHasFirebase(project) {
  const id = project?.id || '';
  return FIREBASE_APPS.some(
    (fid) =>
      id === fid ||
      id.includes('familythread') ||
      id.includes('familylens') ||
      id.includes('familywatch')
  );
}

function formatCompletedAt(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `Completed ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function isItemDone(items, key) {
  return !!(items?.[key]?.completed);
}

function filterItems(list, items, filter) {
  if (filter === 'open') return list.filter((i) => !isItemDone(items, i.key));
  if (filter === 'completed') return list.filter((i) => isItemDone(items, i.key));
  return list;
}

export function ChecklistFilterBar({ filter, onChange }) {
  const options = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'completed', label: 'Completed' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
      {options.map((opt) => {
        const on = filter === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              border: `1px solid ${on ? ACCENT : 'var(--border)'}`,
              background: on ? ACCENT : 'transparent',
              color: on ? '#fff' : 'var(--text-secondary)',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChecklistProgress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-section" style={{ marginTop: 8, marginBottom: 14 }}>
      <div className="progress-header">
        <span>{done} of {total} complete</span>
        <span>{pct}%</span>
      </div>
      <div className="progress-track" style={{ height: 8 }}>
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: ACCENT, transition: 'width 0.3s' }}
        />
      </div>
    </div>
  );
}

export function ChecklistItemRow({ item, state, onToggle }) {
  const completed = !!state?.completed;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        background: completed ? 'rgba(76,193,243,0.04)' : 'transparent',
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          border: `2px solid ${completed ? ACCENT : 'var(--border)'}`,
          background: completed ? ACCENT : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: '#fff',
          fontWeight: 700,
        }}
      >
        {completed ? '✓' : ''}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: completed ? 'var(--text-muted)' : 'var(--text-primary)',
            textDecoration: completed ? 'line-through' : 'none',
            lineHeight: 1.35,
          }}
        >
          {item.label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>
          {item.description}
        </div>
      </div>
      {completed && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {formatCompletedAt(state.completedAt)}
        </div>
      )}
    </div>
  );
}

export default function AppChecklist({ project }) {
  const projectId = project?.id;
  const hasFirebase = projectHasFirebase(project);

  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [pubItems, setPubItems] = useState({});
  const [secItems, setSecItems] = useState({});
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const refs = [
        getDoc(doc(db, 'projects', projectId, 'checklists', 'pub_pipeline')),
      ];
      if (hasFirebase) {
        refs.push(getDoc(doc(db, 'projects', projectId, 'checklists', 'security_ops')));
      }
      const snaps = await Promise.all(refs);
      setPubItems(snaps[0].exists() ? snaps[0].data().items || {} : {});
      if (hasFirebase && snaps[1]) {
        setSecItems(snaps[1].exists() ? snaps[1].data().items || {} : {});
      } else {
        setSecItems({});
      }
    } catch (err) {
      console.error('Checklist load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, hasFirebase]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleItem = async (docId, itemKey, currentItems, setItems) => {
    if (!projectId || toggling) return;
    const prev = currentItems[itemKey] || {};
    const nextCompleted = !prev.completed;
    const nextState = {
      completed: nextCompleted,
      completedAt: nextCompleted ? Timestamp.now() : null,
    };

    setToggling(`${docId}:${itemKey}`);
    setItems((items) => ({ ...items, [itemKey]: nextState }));

    try {
      const ref = doc(db, 'projects', projectId, 'checklists', docId);
      // Read-merge so other item keys are never wiped (nested maps replace on shallow merge)
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data().items || {}) : {};
      await setDoc(ref, { items: { ...existing, [itemKey]: nextState } }, { merge: true });
    } catch (err) {
      console.error('Checklist save failed:', err);
      setItems((items) => ({ ...items, [itemKey]: prev }));
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div className="data-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '3px solid var(--border)',
            borderTopColor: ACCENT,
            borderRadius: '50%',
            margin: '0 auto 12px',
            animation: 'cl-spin 0.8s linear infinite',
          }}
        />
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading checklists…</div>
        <style>{`@keyframes cl-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const pubVisible = filterItems(PUB_PIPELINE_ITEMS, pubItems, filter);
  const secVisible = hasFirebase ? filterItems(SECURITY_OPS_ITEMS, secItems, filter) : [];
  const pubDone = PUB_PIPELINE_ITEMS.filter((i) => isItemDone(pubItems, i.key)).length;
  const secDone = SECURITY_OPS_ITEMS.filter((i) => isItemDone(secItems, i.key)).length;

  return (
    <div className="data-section">
      <ChecklistFilterBar filter={filter} onChange={setFilter} />

      {pubVisible.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 2,
            }}
          >
            📋 Pre-Publish Pipeline
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            Complete these steps before every App Store submission
          </div>
          <ChecklistProgress done={pubDone} total={PUB_PIPELINE_ITEMS.length} />
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--bg-card)',
            }}
          >
            {pubVisible.map((item) => (
              <ChecklistItemRow
                key={item.key}
                item={item}
                state={pubItems[item.key]}
                onToggle={() => toggleItem('pub_pipeline', item.key, pubItems, setPubItems)}
              />
            ))}
          </div>
        </div>
      )}

      {hasFirebase && secVisible.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 2,
            }}
          >
            🔒 Security & Ops
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            Complete these steps for every Firebase app before public launch
          </div>
          <ChecklistProgress done={secDone} total={SECURITY_OPS_ITEMS.length} />
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--bg-card)',
            }}
          >
            {secVisible.map((item) => (
              <ChecklistItemRow
                key={item.key}
                item={item}
                state={secItems[item.key]}
                onToggle={() => toggleItem('security_ops', item.key, secItems, setSecItems)}
              />
            ))}
          </div>
        </div>
      )}

      {pubVisible.length === 0 && secVisible.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem 1rem',
            color: 'var(--text-muted)',
            fontSize: 13,
            border: '1px dashed var(--border)',
            borderRadius: 12,
          }}
        >
          No checklist items match this filter
        </div>
      )}
    </div>
  );
}
