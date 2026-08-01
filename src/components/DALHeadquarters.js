import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const COLLECTION = 'blackbox';
const DOCUMENT = 'dal_wide';

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
    </div>
  );
}
