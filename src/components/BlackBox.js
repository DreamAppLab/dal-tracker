import React, { useState, useEffect, useCallback } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import BLACK_BOX_SERVICES from '../data/blackBoxServices';
import {
  runSeedBlackBox,
  getSeedStatus,
  resolveBlackBoxProjectId,
} from '../scripts/seedBlackBox';

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `custom_${Date.now()}`;
}

function groupByCategory(services) {
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
  return order.map((cat) => ({ category: cat, services: map[cat] }));
}

const pillBase = {
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

function ServiceCard({
  service,
  data,
  expanded,
  onToggleExpand,
  onFieldChange,
  onNotesChange,
  onSave,
  saving,
  saved,
  onStartAddField,
  addingField,
  newFieldDraft,
  onNewFieldDraftChange,
  onConfirmAddField,
  onCancelAddField,
}) {
  const fields = data?.fields || {};
  const customFields = data?.customFields || [];
  const notes = data?.notes ?? '';

  return (
    <div
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
        onClick={onToggleExpand}
      >
        <div style={{ flex: 1, fontWeight: 650, fontSize: 14, color: 'var(--text-primary)' }}>
          {service.label}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, padding: '4px 8px' }}
          onClick={(e) => {
            e.stopPropagation();
            onStartAddField();
            if (!expanded) onToggleExpand();
          }}
        >
          ＋ Add Field
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
          {(service.fields || []).map((f) => (
            <div key={f.fieldName} style={{ marginTop: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                  letterSpacing: '0.03em',
                }}
              >
                {f.fieldName}
              </label>
              <input
                className="form-input"
                value={fields[f.fieldName] ?? ''}
                placeholder={f.fieldDescription}
                onChange={(e) => onFieldChange(f.fieldName, e.target.value)}
              />
            </div>
          ))}

          {customFields.map((cf, idx) => (
            <div key={`custom-${cf.fieldName}-${idx}`} style={{ marginTop: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                }}
              >
                {cf.fieldName}
              </label>
              <input
                className="form-input"
                value={cf.value ?? ''}
                placeholder={cf.fieldDescription || ''}
                onChange={(e) => onFieldChange(`__custom__:${idx}`, e.target.value, true)}
              />
            </div>
          ))}

          {addingField && (
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
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Field Name
                  </label>
                  <input
                    className="form-input"
                    value={newFieldDraft.fieldName}
                    onChange={(e) => onNewFieldDraftChange({ ...newFieldDraft, fieldName: e.target.value })}
                    placeholder="e.g. Staging URL"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Description / placeholder
                  </label>
                  <input
                    className="form-input"
                    value={newFieldDraft.fieldDescription}
                    onChange={(e) =>
                      onNewFieldDraftChange({ ...newFieldDraft, fieldDescription: e.target.value })
                    }
                    placeholder="Hint text for this field"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!newFieldDraft.fieldName.trim()}
                  onClick={onConfirmAddField}
                >
                  Add
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelAddField}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Notes
            </label>
            <textarea
              className="form-input"
              style={{ minHeight: 72, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
              value={notes}
              placeholder="Additional notes for this service..."
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && (
              <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 600 }}>✓ Saved</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BlackBox({ project }) {
  const PROJECT_ID_MAP = {
    familywatch: 'familylens',
    familythread: 'familythread-1785694508315',
  };
  const rawId = project?.id || '';
  const projectId = PROJECT_ID_MAP[rawId] || rawId;
  console.log('BlackBox projectId:', rawId, '->', projectId);

  const [loading, setLoading] = useState(true);
  const [allServices, setAllServices] = useState(BLACK_BOX_SERVICES);
  const [enabledServices, setEnabledServices] = useState([]);
  const [serviceData, setServiceData] = useState({});
  const [expanded, setExpanded] = useState({});
  const [notesDirty, setNotesDirty] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const [addingFieldFor, setAddingFieldFor] = useState(null);
  const [newFieldDraft, setNewFieldDraft] = useState({ fieldName: '', fieldDescription: '' });
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customServiceName, setCustomServiceName] = useState('');
  const [customServiceFields, setCustomServiceFields] = useState([
    { fieldName: '', fieldDescription: '' },
  ]);
  const [seeded, setSeeded] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedJustDone, setSeedJustDone] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [configSnap, customSnap, seedSnap] = await Promise.all([
        getDoc(doc(db, 'projects', projectId, 'blackbox', 'services_config')),
        getDoc(doc(db, 'blackbox_global', 'custom_services')),
        getSeedStatus(),
      ]);

      setSeeded(!!seedSnap?.seeded);

      const customList = customSnap.exists() ? customSnap.data().customServices || [] : [];
      const merged = [
        ...BLACK_BOX_SERVICES,
        ...customList.map((c) => ({
          key: c.key,
          label: c.label,
          category: c.category || 'Custom',
          fields: c.fields || [],
          isCustom: true,
        })),
      ];
      // Dedupe by key (predefined wins)
      const seen = new Set();
      const deduped = merged.filter((s) => {
        if (seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      });
      setAllServices(deduped);

      const enabled = configSnap.exists() ? configSnap.data().enabledServices || [] : [];
      setEnabledServices(enabled);

      const dataMap = {};
      await Promise.all(
        enabled.map(async (key) => {
          const snap = await getDoc(doc(db, 'projects', projectId, 'blackbox', key));
          if (snap.exists()) {
            const d = snap.data();
            dataMap[key] = {
              fields: d.fields || {},
              customFields: d.customFields || [],
              notes: d.notes ?? '',
            };
          } else {
            dataMap[key] = { fields: {}, customFields: [], notes: '' };
          }
        })
      );
      setServiceData(dataMap);
      setNotesDirty({});
    } catch (err) {
      console.error('Black Box load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleService = async (key) => {
    if (!projectId || toggleBusy) return;
    setToggleBusy(key);
    const configRef = doc(db, 'projects', projectId, 'blackbox', 'services_config');
    const isEnabled = enabledServices.includes(key);

    try {
      if (isEnabled) {
        await setDoc(configRef, { enabledServices: arrayRemove(key) }, { merge: true });
        setEnabledServices((prev) => prev.filter((k) => k !== key));
      } else {
        await setDoc(configRef, { enabledServices: arrayUnion(key) }, { merge: true });
        setEnabledServices((prev) => (prev.includes(key) ? prev : [...prev, key]));

        const snap = await getDoc(doc(db, 'projects', projectId, 'blackbox', key));
        if (snap.exists()) {
          const d = snap.data();
          setServiceData((prev) => ({
            ...prev,
            [key]: {
              fields: d.fields || {},
              customFields: d.customFields || [],
              notes: d.notes ?? '',
            },
          }));
        } else {
          setServiceData((prev) => ({
            ...prev,
            [key]: prev[key] || { fields: {}, customFields: [], notes: '' },
          }));
        }
        setExpanded((prev) => ({ ...prev, [key]: true }));
      }
    } catch (err) {
      console.error('Toggle service failed:', err);
    } finally {
      setToggleBusy(null);
    }
  };

  const updateField = (serviceKey, fieldName, value, isCustomIndex = false) => {
    setServiceData((prev) => {
      const current = prev[serviceKey] || { fields: {}, customFields: [], notes: '' };
      if (isCustomIndex || String(fieldName).startsWith('__custom__:')) {
        const idx = parseInt(String(fieldName).replace('__custom__:', ''), 10);
        const customFields = (current.customFields || []).map((cf, i) =>
          i === idx ? { ...cf, value } : cf
        );
        return { ...prev, [serviceKey]: { ...current, customFields } };
      }
      return {
        ...prev,
        [serviceKey]: {
          ...current,
          fields: { ...current.fields, [fieldName]: value },
        },
      };
    });
  };

  const updateNotes = (serviceKey, value) => {
    setNotesDirty((prev) => ({ ...prev, [serviceKey]: true }));
    setServiceData((prev) => {
      const current = prev[serviceKey] || { fields: {}, customFields: [], notes: '' };
      return { ...prev, [serviceKey]: { ...current, notes: value } };
    });
  };

  const saveService = async (serviceKey) => {
    if (!projectId) return;
    setSavingKey(serviceKey);
    try {
      const data = serviceData[serviceKey] || { fields: {}, customFields: [], notes: '' };
      const ref = doc(db, 'projects', projectId, 'blackbox', serviceKey);

      // Read-merge fields so we never drop keys present in Firestore but absent locally
      const existingSnap = await getDoc(ref);
      const existingFields = existingSnap.exists() ? (existingSnap.data().fields || {}) : {};
      const mergedFields = { ...existingFields, ...(data.fields || {}) };

      const payload = { fields: mergedFields };

      // Persist custom field values: replace only with the full in-memory list
      // (schema appends still use arrayUnion in confirmAddField)
      if (Array.isArray(data.customFields)) {
        payload.customFields = data.customFields;
      }

      // CRITICAL: only write notes if user typed in this session
      if (notesDirty[serviceKey]) {
        payload.notes = data.notes ?? '';
      }

      await setDoc(ref, payload, { merge: true });
      setSavedKey(serviceKey);
      setTimeout(() => setSavedKey((k) => (k === serviceKey ? null : k)), 2000);
      if (notesDirty[serviceKey]) {
        setNotesDirty((prev) => ({ ...prev, [serviceKey]: false }));
      }
    } catch (err) {
      console.error('Save service failed:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const confirmAddField = async (serviceKey) => {
    const fieldName = newFieldDraft.fieldName.trim();
    if (!fieldName || !projectId) return;
    const entry = {
      fieldName,
      fieldDescription: newFieldDraft.fieldDescription.trim(),
      value: '',
    };
    try {
      await setDoc(
        doc(db, 'projects', projectId, 'blackbox', serviceKey),
        { customFields: arrayUnion(entry) },
        { merge: true }
      );
      setServiceData((prev) => {
        const current = prev[serviceKey] || { fields: {}, customFields: [], notes: '' };
        return {
          ...prev,
          [serviceKey]: {
            ...current,
            customFields: [...(current.customFields || []), entry],
          },
        };
      });
      setAddingFieldFor(null);
      setNewFieldDraft({ fieldName: '', fieldDescription: '' });
    } catch (err) {
      console.error('Add custom field failed:', err);
    }
  };

  const saveCustomService = async () => {
    const label = customServiceName.trim();
    if (!label || !projectId) return;
    const key = slugify(label);
    const fields = customServiceFields
      .filter((f) => f.fieldName.trim())
      .map((f) => ({
        fieldName: f.fieldName.trim(),
        fieldDescription: f.fieldDescription.trim(),
      }));

    const entry = { key, label, fields, category: 'Custom' };

    try {
      await setDoc(
        doc(db, 'blackbox_global', 'custom_services'),
        { customServices: arrayUnion(entry) },
        { merge: true }
      );

      await setDoc(
        doc(db, 'projects', projectId, 'blackbox', 'services_config'),
        { enabledServices: arrayUnion(key) },
        { merge: true }
      );

      setAllServices((prev) =>
        prev.some((s) => s.key === key)
          ? prev
          : [...prev, { ...entry, isCustom: true }]
      );
      setEnabledServices((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setServiceData((prev) => ({
        ...prev,
        [key]: { fields: {}, customFields: [], notes: '' },
      }));
      setExpanded((prev) => ({ ...prev, [key]: true }));
      setShowCustomModal(false);
      setCustomServiceName('');
      setCustomServiceFields([{ fieldName: '', fieldDescription: '' }]);
    } catch (err) {
      console.error('Save custom service failed:', err);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await runSeedBlackBox();
      setSeeded(true);
      setSeedJustDone(true);
      await load();
    } catch (err) {
      console.error('Seed failed:', err);
    } finally {
      setSeeding(false);
    }
  };

  const categories = groupByCategory(allServices);
  const enabledOrdered = enabledServices
    .map((key) => allServices.find((s) => s.key === key))
    .filter(Boolean);

  if (loading) {
    return (
      <div className="data-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--teal)',
            borderRadius: '50%',
            margin: '0 auto 12px',
            animation: 'bb-spin 0.8s linear infinite',
          }}
        />
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading Black Box…</div>
        <style>{`@keyframes bb-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="data-section">
      {/* ── Section A: Services selector ── */}
      <div style={{ marginBottom: 28 }}>
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
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
          Toggle a service to show or hide it. Your data is always saved.
        </div>

        {categories.map(({ category, services }) => (
          <div key={category} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
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
              {services.map((svc) => {
                const on = enabledServices.includes(svc.key);
                return (
                  <button
                    key={svc.key}
                    type="button"
                    disabled={toggleBusy === svc.key}
                    onClick={() => toggleService(svc.key)}
                    style={{
                      ...pillBase,
                      background: on ? 'var(--teal)' : 'transparent',
                      color: on ? 'var(--bg-base)' : 'var(--text-secondary)',
                      borderColor: on ? 'var(--teal)' : 'var(--border)',
                      opacity: toggleBusy === svc.key ? 0.6 : 1,
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
          style={{ marginTop: 8 }}
          onClick={() => setShowCustomModal(true)}
        >
          + Add Custom Service
        </button>
      </div>

      {/* ── Section B: Service cards ── */}
      {enabledOrdered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '2.5rem 1rem',
            color: 'var(--text-muted)',
            fontSize: 13,
            border: '1px dashed var(--border)',
            borderRadius: 12,
            marginBottom: 24,
          }}
        >
          Select a service above to get started
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {enabledOrdered.map((svc) => (
            <ServiceCard
              key={svc.key}
              service={svc}
              data={serviceData[svc.key]}
              expanded={!!expanded[svc.key]}
              onToggleExpand={() =>
                setExpanded((prev) => ({ ...prev, [svc.key]: !prev[svc.key] }))
              }
              onFieldChange={(fieldName, value, isCustom) =>
                updateField(svc.key, fieldName, value, isCustom)
              }
              onNotesChange={(value) => updateNotes(svc.key, value)}
              onSave={() => saveService(svc.key)}
              saving={savingKey === svc.key}
              saved={savedKey === svc.key}
              onStartAddField={() => {
                setAddingFieldFor(svc.key);
                setNewFieldDraft({ fieldName: '', fieldDescription: '' });
              }}
              addingField={addingFieldFor === svc.key}
              newFieldDraft={newFieldDraft}
              onNewFieldDraftChange={setNewFieldDraft}
              onConfirmAddField={() => confirmAddField(svc.key)}
              onCancelAddField={() => {
                setAddingFieldFor(null);
                setNewFieldDraft({ fieldName: '', fieldDescription: '' });
              }}
            />
          ))}
        </div>
      )}

      {/* ── Seed button ── */}
      <div
        style={{
          marginTop: 32,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
        }}
      >
        {!seeded ? (
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: 11,
              padding: '6px 12px',
              borderRadius: 6,
              cursor: seeding ? 'wait' : 'pointer',
              opacity: 0.75,
            }}
          >
            {seeding ? 'Seeding…' : 'Pre-populate known DAL credentials'}
          </button>
        ) : seedJustDone ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>✓ Data pre-populated</div>
        ) : null}
      </div>

      {/* ── Section D: Custom service modal ── */}
      {showCustomModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowCustomModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 20,
              width: '100%',
              maxWidth: 480,
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 16,
                color: 'var(--text-primary)',
              }}
            >
              Add Custom Service
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Service Name
              </label>
              <input
                className="form-input"
                value={customServiceName}
                onChange={(e) => setCustomServiceName(e.target.value)}
                placeholder="e.g. Cloudflare"
              />
            </div>

            {customServiceFields.map((row, idx) => (
              <div
                key={idx}
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}
              >
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Field Name
                  </label>
                  <input
                    className="form-input"
                    value={row.fieldName}
                    onChange={(e) => {
                      const next = [...customServiceFields];
                      next[idx] = { ...next[idx], fieldName: e.target.value };
                      setCustomServiceFields(next);
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Description
                  </label>
                  <input
                    className="form-input"
                    value={row.fieldDescription}
                    onChange={(e) => {
                      const next = [...customServiceFields];
                      next[idx] = { ...next[idx], fieldDescription: e.target.value };
                      setCustomServiceFields(next);
                    }}
                  />
                </div>
              </div>
            ))}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginBottom: 16 }}
              onClick={() =>
                setCustomServiceFields((prev) => [...prev, { fieldName: '', fieldDescription: '' }])
              }
            >
              + Add Another Field
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!customServiceName.trim()}
                onClick={saveCustomService}
              >
                Save Service
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCustomModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
