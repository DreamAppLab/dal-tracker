// src/components/ProjectDetail.js
import React, { useState, useRef, useEffect } from 'react';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../data/initialData';
import { storage, db } from '../firebase';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import MilestoneModal from './MilestoneModal';
import EditModal from './EditModal';
import ExpenseModal from './ExpenseModal';
import TechStackModal from './TechStackModal';
import PaymentModal from './PaymentModal';
import AppChecklist from './AppChecklist';
import AppPipelineChecklist from './AppPipelineChecklist';
import WebsitePipelineChecklist from './WebsitePipelineChecklist';
import PWAPipelineChecklist from './PWAPipelineChecklist';
import AppLogo from './AppLogo';
import BlackBox from './BlackBox';
import { FamilyThreadAdminTab } from '../pages/FamilyThreadAdmin';
import QuotesTab from '../tabs/QuotesTab';
import BuildBoardTab from '../tabs/BuildBoardTab';
import ClientTab from './ClientTab';
import { hasPipelineTab, pipelineKindForProjectType, PROJECT_TYPE_BADGE } from '../data/projectTypes';
import { openProjectHandoffPrint } from '../utils/projectHandoffPrint';
import BlogAdmin from '../pages/BlogAdmin';

function getProgress(project) {
  const allTasks = [...(project.milestones || []), ...(project.edits || [])];
  if (!allTasks.length) return { done: 0, total: 0, pct: 0 };
  const done = allTasks.filter(t => t.completed).length;
  return { done, total: allTasks.length, pct: Math.round((done / allTasks.length) * 100) };
}

function getMonthlyExpenses(project) {
  return (project.expenses || []).reduce((sum, e) => {
    const amt = e.period === 'yearly' ? e.amount / 12 : e.amount;
    return sum + amt;
  }, 0);
}

function getOutstandingEditCosts(project) {
  return (project.edits || []).filter(e => e.amount > 0 && !e.completed).reduce((sum, e) => sum + (e.amount || 0), 0);
}

function getOutstandingMilestoneCosts(project) {
  return (project.milestones || []).filter(m => m.amount > 0 && !m.completed).reduce((sum, m) => sum + (m.amount || 0), 0);
}

function getTotalPaidOut(project) {
  return (project.payments || []).filter(p => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
}

function getTotalPaidIn(project) {
  return (project.payments || []).filter(p => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function generateEditsPDF(project, filter) {
  const edits = getFilteredEdits(project.edits || [], filter);
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...edits].sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
  const totalCost = sorted.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const priorityColors = {
    high: { bg: '#fee2e2', text: '#dc2626', label: 'HIGH' },
    medium: { bg: '#fef3c7', text: '#d97706', label: 'MEDIUM' },
    low: { bg: '#dbeafe', text: '#2563eb', label: 'LOW' },
  };

  const rowsHtml = sorted.map((e, i) => {
    const images = e.images || [];
    const pc = priorityColors[e.priority] || { bg: '#f3f4f6', text: '#6b7280', label: (e.priority || '').toUpperCase() };
    const sentText = e.sentToDev
      ? `Sent to Dev: Yes${e.sentToDevAt ? ' (' + formatDate(e.sentToDevAt) + ')' : ''}`
      : 'Sent to Dev: No';

    const imagesHtml = images.map((img) => {
      const rawUrl = typeof img === 'string' ? img : img.downloadUrl;
      if (!rawUrl) return '';
      const url = rawUrl.includes('alt=media') ? rawUrl : (rawUrl.includes('?') ? rawUrl + '&alt=media' : rawUrl + '?alt=media');
      return `<img src="${url}" style="max-width:280px;max-height:500px;width:auto;height:auto;object-fit:contain;margin:4px 8px 4px 0;display:inline-block;vertical-align:top;border-radius:6px;border:1px solid #e5e7eb;" />`;
    }).join('');

    return `
      <div style="background:${i % 2 === 0 ? '#f8f9fa' : '#ffffff'};border-radius:8px;padding:14px 16px;margin-bottom:10px;border:1px solid #e5e7eb;page-break-inside:avoid;">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:6px;">
          <span style="color:#9ca3af;font-size:12px;min-width:24px;margin-top:2px;">#${i + 1}</span>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span style="font-weight:700;font-size:14px;color:#1a2234;">${e.item || ''}</span>
              <span style="background:${pc.bg};color:${pc.text};font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;">${pc.label}</span>
              ${e.amount > 0 ? `<span style="color:#b45309;font-weight:700;font-size:13px;">$${e.amount.toFixed(2)}</span>` : ''}
            </div>
            <div style="color:#6b7280;font-size:12px;margin-top:4px;">
              Page: ${e.page || '—'} &nbsp;|&nbsp; Location: ${e.location || '—'}
              ${e.createdAt ? `&nbsp;|&nbsp; ${formatDate(e.createdAt)}` : ''}
            </div>
            <div style="color:#6b7280;font-size:11px;margin-top:3px;">
              ${sentText} &nbsp;|&nbsp; Status: ${e.completed ? 'Done' : 'Open'}
            </div>
            ${e.notes ? `<div style="color:#4b5563;font-size:12px;font-style:italic;margin-top:6px;padding:8px;background:#f0f4ff;border-radius:4px;">Note: ${e.notes}</div>` : ''}
            ${imagesHtml ? `<div style="margin-top:10px;">${imagesHtml}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  const totalFooter = totalCost > 0
    ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-top:16px;">
        <span style="font-weight:700;font-size:15px;color:#b45309;">Total Outstanding Dev Costs: $${totalCost.toFixed(2)}</span>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${project.name} — Edits Needed</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1a2234; padding: 32px; }
    @media print {
      body { padding: 16px; }
      @page { margin: 16mm; }
      img { max-width: 280px !important; max-height: 500px !important; }
    }
  </style>
</head>
<body>
  <div style="margin-bottom:6px;">
    <span style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;">DAL Mission Control</span>
  </div>
  <h1 style="font-size:22px;font-weight:800;color:#1a2234;margin-bottom:6px;">${project.name} — Edits Needed</h1>
  <p style="font-size:12px;color:#6b7280;margin-bottom:16px;">Generated: ${dateStr} &nbsp;|&nbsp; Filter: ${filter} &nbsp;|&nbsp; ${sorted.length} item(s)</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:20px;" />
  ${rowsHtml}
  ${totalFooter}
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}

function getFilteredEdits(edits, filter) {
  switch (filter) {
    case 'open': return edits.filter(e => !e.completed);
    case 'completed': return edits.filter(e => e.completed);
    case 'sent': return edits.filter(e => e.sentToDev);
    case 'not-sent': return edits.filter(e => !e.sentToDev && !e.completed);
    case 'has-cost': return edits.filter(e => e.amount > 0 && !e.completed);
    default: return edits;
  }
}

const BASE_TABS = [
  { key: "overview", label: "Overview" },
  { key: "milestones", label: "Milestones" },
  { key: "edits", label: "Edits Needed" },
  { key: "stack", label: "Tech Stack" },
  { key: "financials", label: "Financials" },
  { key: "vault", label: "🔒 Black Box" }
];

function isAppProject(project) {
  if (!project.type) return false;
  return project.type === 'own-app' || project.type === 'client-app';
}

function isFamilyThreadProject(project) {
  const bundleId = (project.bundleId || '').toLowerCase();
  const name = (project.name || '').toLowerCase().replace(/\s+/g, '');
  const id = (project.id || '').toLowerCase();
  return (
    bundleId === 'com.dreamapplab.familythread' ||
    name === 'familythread' ||
    id.includes('familythread')
  );
}

function isDalWebsiteProject(project) {
  const id = (project.id || '').toLowerCase();
  const name = (project.name || '').toLowerCase();
  return id === 'dal-website' || name.includes('dream app lab');
}

export default function ProjectDetail({ project, revenueLogos = {}, onUpdate, onDelete, onBack, onOpenProject, onToast, quotesUnread = 0, onQuotesUnread, onboardingUploadsByClientId = {} }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [clientUnread, setClientUnread] = useState(0);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showStackModal, setShowStackModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [paymentType, setPaymentType] = useState('out');
  const [editingItem, setEditingItem] = useState(null);
  const [editsFilter, setEditsFilter] = useState('all');
  const [uploadingEditId, setUploadingEditId] = useState(null);
  const [editUploadError, setEditUploadError] = useState(null);
  const [printBusy, setPrintBusy] = useState(false);
  const editImageInputRef = useRef(null);
  const pendingEditIdRef = useRef(null);
  const logoInputRef = useRef(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const isApp = isAppProject(project) || project.projectType === 'Own App' || project.projectType === 'Client App';
  const showPipeline = hasPipelineTab(project.projectType);
  const pipelineKind = pipelineKindForProjectType(project.projectType);
  const typeBadge = PROJECT_TYPE_BADGE[project.projectType];
  const isFamilyThread = isFamilyThreadProject(project);
  const isDalWebsite = isDalWebsiteProject(project);
  const totalOnboardingUploads = Object.values(onboardingUploadsByClientId).reduce((s, arr) => s + arr.length, 0);
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'client', label: 'Client', badge: clientUnread },
    ...(isDalWebsite ? [
      { key: 'quotes', label: 'Quotes', badge: quotesUnread, uploadBadge: totalOnboardingUploads },
      { key: 'builds', label: 'Build Board' },
    ] : []),
    ...(isFamilyThread ? [{ key: 'admin', label: 'Admin Panel' }] : []),
    ...(showPipeline ? [{ key: 'pipeline', label: 'Pipeline' }] : []),
    ...(project.hasBlog === true ? [{ key: 'blog', label: 'Blog' }] : []),
    ...BASE_TABS.filter((t) => t.key !== 'overview'),
    ...(isApp ? [{ key: 'checklist', label: 'Checklists' }] : []),
  ];
  const prog = getProgress(project);
  const monthlyExp = getMonthlyExpenses(project);
  const outstandingEditCosts = getOutstandingEditCosts(project);
  const outstandingMilestoneCosts = getOutstandingMilestoneCosts(project);
  const totalOutstanding = outstandingEditCosts + outstandingMilestoneCosts;
  const totalPaidOut = getTotalPaidOut(project);
  const totalPaidIn = getTotalPaidIn(project);
  const sc = STATUS_CONFIG[project.status] || STATUS_CONFIG.ideation;

  useEffect(() => {
    if (activeTab === 'admin' && !isFamilyThread) {
      setActiveTab('overview');
    }
    if (activeTab === 'quotes' && !isDalWebsite) {
      setActiveTab('overview');
    }
    if (activeTab === 'builds' && !isDalWebsite) {
      setActiveTab('overview');
    }
    if (activeTab === 'pipeline' && !showPipeline) {
      setActiveTab('overview');
    }
    if (activeTab === 'blog' && project.hasBlog !== true) {
      setActiveTab('overview');
    }
  }, [activeTab, isFamilyThread, isDalWebsite, showPipeline, project.hasBlog, project.id]);

  useEffect(() => {
    if (!project?.id) return;
    const q = query(
      collection(db, 'clientEmails'),
      where('projectId', '==', project.id),
      where('source', '==', 'project'),
      where('direction', '==', 'inbound'),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, snap => setClientUnread(snap.size));
    return () => unsub();
  }, [project?.id]);

  const toggleMilestone = (id) => {
    const milestone = project.milestones.find(m => m.id === id);
    const isCompleting = milestone && !milestone.completed;
    const updatedMilestones = project.milestones.map(m => m.id === id ? { ...m, completed: !m.completed } : m);
    
    // Auto-log payment out if milestone has an amount and is being marked complete
    if (isCompleting && milestone.amount > 0) {
      const autoPayment = {
        id: `pay${Date.now()}`,
        type: 'out',
        description: `Milestone completed: ${milestone.title}`,
        recipient: 'Developer',
        amount: milestone.amount,
        date: new Date().toISOString().split('T')[0],
        method: '',
        notes: 'Auto-logged when milestone marked complete'
      };
      onUpdate({ ...project, milestones: updatedMilestones, payments: [...(project.payments || []), autoPayment] });
    } else {
      onUpdate({ ...project, milestones: updatedMilestones });
    }
  };

  const toggleEdit = (id) => {
    onUpdate({ ...project, edits: project.edits.map(e => e.id === id ? { ...e, completed: !e.completed } : e) });
  };

  const toggleSentToDev = (id) => {
    onUpdate({ ...project, edits: project.edits.map(e => e.id === id ? { ...e, sentToDev: !e.sentToDev, sentToDevAt: !e.sentToDev ? new Date().toISOString() : null } : e) });
  };

  const deleteMilestone = (id) => onUpdate({ ...project, milestones: project.milestones.filter(m => m.id !== id) });
  const deleteEdit = (id) => onUpdate({ ...project, edits: project.edits.filter(e => e.id !== id) });
  const deleteExpense = (id) => onUpdate({ ...project, expenses: project.expenses.filter(e => e.id !== id) });
  const deletePayment = (id) => onUpdate({ ...project, payments: (project.payments || []).filter(p => p.id !== id) });

  const deleteTechStack = (idx) => {
    const stack = [...(project.techStack || [])];
    stack.splice(idx, 1);
    onUpdate({ ...project, techStack: stack });
  };

  const handleSaveMilestone = (milestone) => {
    if (milestone.id && project.milestones.find(m => m.id === milestone.id)) {
      onUpdate({ ...project, milestones: project.milestones.map(m => m.id === milestone.id ? milestone : m) });
    } else {
      onUpdate({ ...project, milestones: [...(project.milestones || []), { ...milestone, id: `m${Date.now()}` }] });
    }
    setShowMilestoneModal(false);
    setEditingItem(null);
  };

  const handleSaveEdit = (edit) => {
    const withDate = { ...edit, createdAt: edit.createdAt || new Date().toISOString() };
    if (edit.id && project.edits.find(e => e.id === edit.id)) {
      onUpdate({ ...project, edits: project.edits.map(e => e.id === edit.id ? withDate : e) });
    } else {
      onUpdate({ ...project, edits: [...(project.edits || []), { ...withDate, id: `ed${Date.now()}` }] });
    }
    setShowEditModal(false);
    setEditingItem(null);
  };

  const handleSaveExpense = (expense) => {
    if (expense.id && project.expenses.find(e => e.id === expense.id)) {
      onUpdate({ ...project, expenses: project.expenses.map(e => e.id === expense.id ? expense : e) });
    } else {
      onUpdate({ ...project, expenses: [...(project.expenses || []), { ...expense, id: `e${Date.now()}` }] });
    }
    setShowExpenseModal(false);
    setEditingItem(null);
  };

  const handleSavePayment = (payment) => {
    onUpdate({ ...project, payments: [...(project.payments || []), { ...payment, id: `pay${Date.now()}` }] });
    setShowPaymentModal(false);
  };

  const handleSaveStack = (entry) => {
    onUpdate({ ...project, techStack: [...(project.techStack || []), entry] });
    setShowStackModal(false);
  };

  const handleUpdateRevenue = (field, value) => {
    onUpdate({ ...project, revenue: { ...project.revenue, [field]: value } });
  };

  const handleEditImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const editId = pendingEditIdRef.current;
    if (!editId) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(png|jpe?g|gif|webp)$/i)) {
      setEditUploadError('Unsupported type. Allowed: PNG, JPG, GIF, WEBP');
      return;
    }
    setUploadingEditId(editId);
    setEditUploadError(null);
    try {
      const fileId = `img${Date.now()}`;
      const path = `projects/${project.id}/edits/${editId}/${fileId}_${file.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const downloadUrl = await getDownloadURL(sRef);
      const newImage = { id: fileId, name: file.name, storagePath: path, downloadUrl, uploadedAt: new Date().toISOString() };
      const updatedEdits = project.edits.map(ed =>
        ed.id === editId ? { ...ed, images: [...(ed.images || []), newImage] } : ed
      );
      onUpdate({ ...project, edits: updatedEdits });
    } catch (err) {
      setEditUploadError(err.message || 'Upload failed');
    } finally {
      setUploadingEditId(null);
      pendingEditIdRef.current = null;
    }
  };

  const deleteEditImage = async (editId, img) => {
    if (!window.confirm(`Delete screenshot "${img.name}"?`)) return;
    try {
      await deleteObject(storageRef(storage, img.storagePath));
    } catch {}
    const updatedEdits = project.edits.map(ed =>
      ed.id === editId ? { ...ed, images: (ed.images || []).filter(i => i.id !== img.id) } : ed
    );
    onUpdate({ ...project, edits: updatedEdits });
  };

  const handleProjectLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !project.id) return;
    const ext = (file.name.split('.').pop() || 'webp').toLowerCase();
    setLogoUploading(true);
    try {
      const path = `projectLogos/${project.id}/logo.${ext}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file, { contentType: file.type || undefined });
      const downloadUrl = await getDownloadURL(sRef);
      await onUpdate({ ...project, logoUrl: downloadUrl });
      if (typeof onToast === 'function') onToast('Logo updated');
    } catch (err) {
      if (typeof onToast === 'function') onToast(err.message || 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  const filteredEdits = getFilteredEdits(project.edits || [], editsFilter);
  const sortedEdits = [...filteredEdits].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
  });

  const openCount = (project.edits || []).filter(e => !e.completed).length;
  const sentCount = (project.edits || []).filter(e => e.sentToDev).length;
  const completedCount = (project.edits || []).filter(e => e.completed).length;
  const hasCostCount = (project.edits || []).filter(e => e.amount > 0 && !e.completed).length;

  const paymentsOut = (project.payments || []).filter(p => p.type === 'out').sort((a, b) => new Date(b.date) - new Date(a.date));
  const paymentsIn = (project.payments || []).filter(p => p.type === 'in').sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      <div className="detail-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button>
        <div className="detail-logo">
          <AppLogo logoUrl={project.logoUrl || revenueLogos[project.id]} fallback={project.logo} color={project.color} size={48} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="detail-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {project.websiteUrl ? (
              <a
                href={project.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="detail-title-link"
              >
                {project.name}
                <span className="detail-title-link-icon" aria-hidden="true">🔗</span>
              </a>
            ) : (
              project.name
            )}
            {project.projectType && typeBadge && (
              <span
                className="status-badge"
                style={{ background: typeBadge.bg, color: typeBadge.color, fontSize: 11 }}
              >
                {project.projectType}
              </span>
            )}
          </div>
          <div className="detail-meta">
            <span className="status-badge" style={{ background: sc.bg, color: sc.color }}>
              <span className="status-dot" style={{ background: sc.color }} /> {sc.label}
            </span>
            <span className="platform-chip">{project.platform}</span>
            <span className="detail-meta-item">{project.tagline}</span>
            {project.bundleId && <span className="detail-meta-item" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{project.bundleId}</span>}
          </div>
        </div>
        <div className="detail-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={printBusy}
            onClick={async () => {
              setPrintBusy(true);
              try {
                await openProjectHandoffPrint(project);
              } catch (err) {
                console.error(err);
              } finally {
                setPrintBusy(false);
              }
            }}
          >
            {printBusy ? 'Preparing…' : 'Print / Export'}
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              setDeleteConfirmText('');
              setDeleteError('');
              setShowDeleteModal(true);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="tabs-bar">
        {TABS.map(t => {
          let count = null;
          if (t.key === 'milestones') count = (project.milestones || []).filter(m => !m.completed).length;
          if (t.key === 'edits') count = openCount;
          if (t.key === 'stack') count = (project.techStack || []).length;
          if (t.key === 'financials') count = (project.expenses || []).length + (project.payments || []).length;
          if (t.key === 'vault') count = (project.vault || []).length;
          return (
            <button key={t.key} className={`tab-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
              {t.badge > 0 && (
                <span style={{ background: 'var(--coral)', color: 'white', borderRadius: 10, padding: '1px 5px', fontSize: 10, fontWeight: 700, marginLeft: 6 }}>
                  {t.badge}
                </span>
              )}
              {t.uploadBadge > 0 && (
                <span style={{ background: '#e6a817', color: 'white', borderRadius: 10, padding: '1px 5px', fontSize: 10, fontWeight: 700, marginLeft: 4 }}>
                  {t.uploadBadge}
                </span>
              )}
              {count !== null && count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {activeTab === 'client' && <ClientTab project={project} />}

      {activeTab === 'overview' && (
        <div className="data-section">
          <div className="overview-logo-area">
            <div className="detail-logo">
              <AppLogo logoUrl={project.logoUrl || revenueLogos[project.id]} fallback={project.logo} color={project.color} size={48} />
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
              style={{ display: 'none' }}
              onChange={handleProjectLogoUpload}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={logoUploading}
              onClick={() => logoInputRef.current?.click()}
            >
              {logoUploading ? (
                <>
                  <span className="logo-upload-spinner" aria-hidden="true" />
                  Uploading…
                </>
              ) : (
                'Update Logo'
              )}
            </button>
          </div>
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card teal">
              <div className="stat-label">Overall Progress</div>
              <div className="stat-value" style={{ color: project.color }}>{prog.pct}%</div>
              <div className="stat-sub">{prog.done} of {prog.total} tasks</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Total Paid In</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>${totalPaidIn.toFixed(0)}</div>
              <div className="stat-sub">{paymentsIn.length} payment{paymentsIn.length !== 1 ? 's' : ''} received</div>
            </div>
            <div className="stat-card coral">
              <div className="stat-label">Total Paid Out</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${totalPaidOut.toFixed(0)}</div>
              <div className="stat-sub">{paymentsOut.length} payment{paymentsOut.length !== 1 ? 's' : ''} made</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Total Outstanding</div>
              <div className="stat-value" style={{ color: totalOutstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' }}>${totalOutstanding.toFixed(0)}</div>
              <div className="stat-sub">Edits + milestones unpaid</div>
            </div>
            <div className="stat-card indigo">
              <div className="stat-label">Monthly Operating</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${monthlyExp.toFixed(0)}</div>
              <div className="stat-sub">Recurring costs/mo</div>
            </div>
            <div className="stat-card electric">
              <div className="stat-label">Open Edits</div>
              <div className="stat-value">{openCount}</div>
              <div className="stat-sub">{sentCount} sent to dev</div>
            </div>
          </div>
          <div className="progress-section" style={{ marginBottom: 24 }}>
            <div className="progress-header">
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Project Progress</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: project.color }}>{prog.pct}%</span>
            </div>
            <div className="progress-track" style={{ height: 10 }}>
              <div className="progress-fill" style={{ width: `${prog.pct}%`, background: `linear-gradient(90deg, ${project.color}, ${project.color}88)` }} />
            </div>
          </div>
          <div className="data-section-header">
            <h3 className="data-section-title">Recent Milestones</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('milestones')}>View All</button>
          </div>
          <div className="item-list">
            {(project.milestones || []).slice(-3).reverse().map(m => (
              <div key={m.id} className={`item-row ${m.completed ? 'completed' : ''}`}>
                <div className="check-btn checked" style={{ background: m.completed ? project.color : undefined, borderColor: project.color }}>{m.completed ? '✓' : ''}</div>
                <div className="item-main">
                  <div className="item-title">{m.title}</div>
                  <div className="item-desc">{m.description}</div>
                </div>
                {m.amount > 0 && <div className="item-amount">${m.amount.toLocaleString()}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'admin' && isFamilyThread && <FamilyThreadAdminTab />}

      {activeTab === 'quotes' && isDalWebsite && (
        <QuotesTab
          onOpenProject={onOpenProject}
          onToast={onToast}
          onUnreadCount={onQuotesUnread}
          onboardingUploadsByClientId={onboardingUploadsByClientId}
        />
      )}

      {activeTab === 'pipeline' && showPipeline && pipelineKind === 'app' && (
        <AppPipelineChecklist project={project} />
      )}
      {activeTab === 'pipeline' && showPipeline && pipelineKind === 'website' && (
        <WebsitePipelineChecklist project={project} />
      )}
      {activeTab === 'pipeline' && showPipeline && pipelineKind === 'pwa' && (
        <PWAPipelineChecklist project={project} />
      )}

      {activeTab === 'builds' && isDalWebsite && <BuildBoardTab />}

      {activeTab === 'milestones' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Milestones</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowMilestoneModal(true); }}>+ Add Milestone</button>
          </div>
          {(project.milestones || []).length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No milestones yet.</div></div>
          ) : (
            <div className="item-list">
              {(project.milestones || []).map(m => (
                <div key={m.id} className={`item-row ${m.completed ? 'completed' : ''}`}>
                  <button className={`check-btn ${m.completed ? 'checked' : ''}`} style={m.completed ? { background: project.color, borderColor: project.color } : { borderColor: project.color }} onClick={() => toggleMilestone(m.id)}>{m.completed ? '✓' : ''}</button>
                  <div className="item-main">
                    <div className="item-title">{m.title}{m.dueDate && <span className="tag" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{m.dueDate}</span>}</div>
                    <div className="item-desc">{m.description}</div>
                  </div>
                  {m.amount > 0 && <div className="item-amount">${m.amount.toLocaleString()}</div>}
                  <div className="item-actions">
                    <button className="icon-btn" onClick={() => { setEditingItem(m); setShowMilestoneModal(true); }}>Edit</button>
                    <button className="icon-btn danger" onClick={() => deleteMilestone(m.id)}>Del</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'edits' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Edits Needed</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => generateEditsPDF(project, editsFilter)}>Export PDF</button>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowEditModal(true); }}>+ Add Edit</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: `All (${(project.edits || []).length})` },
              { key: 'open', label: `Open (${openCount})` },
              { key: 'not-sent', label: `Not Sent (${(project.edits || []).filter(e => !e.sentToDev && !e.completed).length})` },
              { key: 'sent', label: `Sent to Dev (${sentCount})` },
              { key: 'has-cost', label: `Has Cost (${hasCostCount})` },
              { key: 'completed', label: `Completed (${completedCount})` }
            ].map(f => (
              <button key={f.key} onClick={() => setEditsFilter(f.key)}
                style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid', background: editsFilter === f.key ? project.color : 'var(--bg-card)', color: editsFilter === f.key ? 'var(--bg-base)' : 'var(--text-secondary)', borderColor: editsFilter === f.key ? project.color : 'var(--border)' }}
              >{f.label}</button>
            ))}
          </div>
          {outstandingEditCosts > 0 && (
            <div style={{ padding: '12px 16px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600 }}>Outstanding Dev Costs</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontSize: 18, fontWeight: 700 }}>${outstandingEditCosts.toFixed(2)}</span>
            </div>
          )}
          <input ref={editImageInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" style={{ display: 'none' }} onChange={handleEditImageUpload} />
          {editUploadError && (
            <div style={{ color: 'var(--coral)', fontSize: 12, marginBottom: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)' }}>
              {editUploadError}
            </div>
          )}
          {sortedEdits.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No edits in this filter.</div></div>
          ) : (
            <div className="item-list">
              {sortedEdits.map(e => {
                const pc = PRIORITY_CONFIG[e.priority] || PRIORITY_CONFIG.medium;
                return (
                  <div key={e.id} className={`item-row ${e.completed ? 'completed' : ''}`}>
                    <button className={`check-btn ${e.completed ? 'checked' : ''}`} style={e.completed ? { background: project.color, borderColor: project.color } : { borderColor: project.color }} onClick={() => toggleEdit(e.id)}>{e.completed ? '✓' : ''}</button>
                    <div className="item-main">
                      <div className="item-title">
                        {e.item}
                        <span className="tag" style={{ background: `${pc.color}18`, color: pc.color }}>{pc.label}</span>
                        {e.amount > 0 && !e.completed && <span className="tag" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>${e.amount.toFixed(2)}</span>}
                        {e.sentToDev && <span className="tag" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)' }}>Sent to Dev</span>}
                      </div>
                      <div className="item-tags">
                        <span className="tag" style={{ background: 'var(--indigo-dim)', color: 'var(--indigo)' }}>{e.page}</span>
                        <span className="tag" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}> {e.location}</span>
                        {e.createdAt && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>Added {formatDate(e.createdAt)}</span>}
                        {e.sentToDevAt && <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 4 }}>Sent {formatDate(e.sentToDevAt)}</span>}
                      </div>
                      {e.notes && <div className="item-desc" style={{ marginTop: 6 }}>Note: {e.notes}</div>}
                      {(e.images || []).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {(e.images || []).map(img => (
                            <div key={img.id} style={{ position: 'relative', display: 'inline-block' }}>
                              <img
                                src={img.downloadUrl}
                                alt={img.name}
                                style={{
                                  maxWidth: 150,
                                  maxHeight: 100,
                                  borderRadius: 6,
                                  border: '1px solid var(--border)',
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />
                              <button
                                onClick={() => deleteEditImage(e.id, img)}
                                title={`Delete ${img.name}`}
                                style={{
                                  position: 'absolute',
                                  top: 3,
                                  right: 3,
                                  background: 'rgba(0,0,0,0.65)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: 10,
                                  padding: '2px 5px',
                                  lineHeight: 1.3,
                                }}
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="item-actions">
                      <button className="icon-btn" title={e.sentToDev ? 'Unmark sent' : 'Mark sent to dev'} onClick={() => toggleSentToDev(e.id)} style={e.sentToDev ? { color: 'var(--green)', borderColor: 'var(--green)' } : {}}>{e.sentToDev ? 'Sent' : 'Send'}</button>
                      <button
                        className="icon-btn"
                        title="Add screenshot"
                        disabled={uploadingEditId === e.id}
                        onClick={() => { pendingEditIdRef.current = e.id; editImageInputRef.current?.click(); }}
                      >{uploadingEditId === e.id ? '...' : '📷'}</button>
                      <button className="icon-btn" onClick={() => { setEditingItem(e); setShowEditModal(true); }}>Edit</button>
                      <button className="icon-btn danger" onClick={() => deleteEdit(e.id)}>Del</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'stack' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Tech Stack</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowStackModal(true)}>+ Add Layer</button>
          </div>
          {(project.techStack || []).length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No tech stack defined yet.</div></div>
          ) : (
            <table className="stack-table">
              <thead><tr><th>Layer</th><th>Technology</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {(project.techStack || []).map((s, i) => (
                  <tr key={i}>
                    <td><span className="layer-badge">{s.layer}</span></td>
                    <td><span className="tech-value">{s.tech}</span></td>
                    <td><button className="icon-btn danger" onClick={() => deleteTechStack(i)}>Del</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'financials' && (
        <div className="data-section">

          {/* Top P&L summary */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card green">
              <div className="stat-label">Total Paid In</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>${totalPaidIn.toFixed(2)}</div>
              <div className="stat-sub">From clients / revenue</div>
            </div>
            <div className="stat-card coral">
              <div className="stat-label">Total Paid Out</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${totalPaidOut.toFixed(2)}</div>
              <div className="stat-sub">To developer / vendors</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Total Outstanding</div>
              <div className="stat-value" style={{ color: totalOutstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' }}>${totalOutstanding.toFixed(2)}</div>
              <div className="stat-sub">Edits ${outstandingEditCosts.toFixed(0)} + Milestones ${outstandingMilestoneCosts.toFixed(0)}</div>
            </div>
            <div className="stat-card teal">
              <div className="stat-label">Balance Owed to Dev</div>
              <div className="stat-value" style={{ color: (totalOutstanding - totalPaidOut) > 0 ? 'var(--coral)' : 'var(--green)' }}>
                ${Math.max(0, totalOutstanding - totalPaidOut).toFixed(2)}
              </div>
              <div className="stat-sub">Outstanding minus paid out</div>
            </div>
          </div>

          {/* Revenue inputs */}
          <div className="finance-grid" style={{ marginBottom: 20 }}>
            <div className="finance-card">
              <div className="finance-card-title">Monthly Revenue (MRR)</div>
              <div className="finance-big-num green">${project.revenue?.monthly || 0}</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>Monthly MRR ($)</label>
                  <input className="form-input" type="number" value={project.revenue?.monthly || 0} onChange={e => handleUpdateRevenue('monthly', parseFloat(e.target.value) || 0)} style={{ width: 140 }} />
                </div>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>Total Revenue ($)</label>
                  <input className="form-input" type="number" value={project.revenue?.total || 0} onChange={e => handleUpdateRevenue('total', parseFloat(e.target.value) || 0)} style={{ width: 140 }} />
                </div>
              </div>
            </div>
            <div className="finance-card">
              <div className="finance-card-title">Monthly Operating Expenses</div>
              <div className="finance-big-num coral">${monthlyExp.toFixed(2)}</div>
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Net Monthly: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: (project.revenue?.monthly || 0) - monthlyExp >= 0 ? 'var(--green)' : 'var(--coral)', fontWeight: 700 }}>
                  ${((project.revenue?.monthly || 0) - monthlyExp).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Outstanding edit costs */}
          {outstandingEditCosts > 0 && (
            <div style={{ padding: '16px 20px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Outstanding Edit Charges</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--amber)', marginBottom: 12 }}>${outstandingEditCosts.toFixed(2)}</div>
              <div className="expense-list">
                {(project.edits || []).filter(e => e.amount > 0 && !e.completed).map(e => (
                  <div key={e.id} className="expense-row" style={{ background: 'var(--bg-card)' }}>
                    <div>
                      <div className="expense-name">{e.item}</div>
                      <div className="expense-meta">{e.page} — {e.location} {e.sentToDev ? '· Sent to Dev' : '· Not yet sent'}</div>
                    </div>
                    <div className="expense-amount">${e.amount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outstanding milestone costs */}
          {outstandingMilestoneCosts > 0 && (
            <div style={{ padding: '16px 20px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Outstanding Milestone Costs</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--indigo)', marginBottom: 12 }}>${outstandingMilestoneCosts.toFixed(2)}</div>
              <div className="expense-list">
                {(project.milestones || []).filter(m => m.amount > 0 && !m.completed).map(m => (
                  <div key={m.id} className="expense-row" style={{ background: 'var(--bg-card)' }}>
                    <div>
                      <div className="expense-name">{m.title}</div>
                      <div className="expense-meta">{m.dueDate ? 'Due: ' + m.dueDate : 'No due date'}</div>
                    </div>
                    <div className="expense-amount" style={{ color: 'var(--indigo)' }}>${m.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payments OUT */}
          <div className="data-section-header" style={{ marginTop: 8 }}>
            <h3 className="data-section-title" style={{ color: 'var(--coral)' }}>Payments Out — To Developer / Vendors</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setPaymentType('out'); setShowPaymentModal(true); }}>+ Log Payment Out</button>
          </div>
          {paymentsOut.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px' }}><div className="empty-state-text">No outgoing payments logged yet.</div></div>
          ) : (
            <div className="expense-list" style={{ marginBottom: 24 }}>
              {paymentsOut.map(p => (
                <div key={p.id} className="expense-row">
                  <div>
                    <div className="expense-name">{p.description}</div>
                    <div className="expense-meta">
                      {p.recipient && <span style={{ marginRight: 8 }}>To: {p.recipient}</span>}
                      {formatDate(p.date)}
                      {p.method && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'var(--bg-card)', borderRadius: 4, fontSize: 10 }}>{p.method}</span>}
                    </div>
                    {p.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="expense-amount" style={{ color: 'var(--coral)' }}>${p.amount.toFixed(2)}</div>
                    <button className="icon-btn danger" onClick={() => deletePayment(p.id)}>Del</button>
                  </div>
                </div>
              ))}
              <div className="expense-row" style={{ background: 'rgba(255,91,91,0.08)', borderColor: 'rgba(255,91,91,0.2)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total Paid Out</div>
                <div className="expense-amount" style={{ color: 'var(--coral)', fontSize: 16 }}>${totalPaidOut.toFixed(2)}</div>
              </div>
              {totalOutstanding > 0 && (
                <div className="expense-row" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Remaining Balance Owed</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>${totalOutstanding.toFixed(2)} outstanding minus ${totalPaidOut.toFixed(2)} paid</div>
                  </div>
                  <div className="expense-amount" style={{ color: Math.max(0, totalOutstanding - totalPaidOut) > 0 ? 'var(--amber)' : 'var(--green)', fontSize: 16 }}>
                    ${Math.max(0, totalOutstanding - totalPaidOut).toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payments IN */}
          <div className="data-section-header">
            <h3 className="data-section-title" style={{ color: 'var(--green)' }}>Payments In — From Clients / Revenue</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setPaymentType('in'); setShowPaymentModal(true); }}>+ Log Payment In</button>
          </div>
          {paymentsIn.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px' }}><div className="empty-state-text">No incoming payments logged yet.</div></div>
          ) : (
            <div className="expense-list" style={{ marginBottom: 24 }}>
              {paymentsIn.map(p => (
                <div key={p.id} className="expense-row">
                  <div>
                    <div className="expense-name">{p.description}</div>
                    <div className="expense-meta">
                      {p.recipient && <span style={{ marginRight: 8 }}>From: {p.recipient}</span>}
                      {formatDate(p.date)}
                      {p.method && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'var(--bg-card)', borderRadius: 4, fontSize: 10 }}>{p.method}</span>}
                    </div>
                    {p.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="expense-amount" style={{ color: 'var(--green)' }}>${p.amount.toFixed(2)}</div>
                    <button className="icon-btn danger" onClick={() => deletePayment(p.id)}>Del</button>
                  </div>
                </div>
              ))}
              <div className="expense-row" style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.2)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total Paid In</div>
                <div className="expense-amount" style={{ color: 'var(--green)', fontSize: 16 }}>${totalPaidIn.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Operating Expenses */}
          <div className="data-section-header">
            <h3 className="data-section-title">Operating Expenses (Recurring)</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowExpenseModal(true); }}>+ Add Expense</button>
          </div>
          {(project.expenses || []).length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No recurring expenses yet.</div></div>
          ) : (
            <div className="expense-list">
              {(project.expenses || []).map(e => {
                const monthlyAmt = e.period === 'yearly' ? e.amount / 12 : e.amount;
                return (
                  <div key={e.id} className="expense-row">
                    <div>
                      <div className="expense-name">{e.name}</div>
                      <div className="expense-meta">
                        <span className="tag" style={{ background: 'var(--indigo-dim)', color: 'var(--indigo)', marginRight: 6 }}>{e.category}</span>
                        {e.period === 'yearly' ? `$${e.amount}/yr` : `$${e.amount}/mo`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="expense-amount">${monthlyAmt.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span></div>
                      <button className="icon-btn" onClick={() => { setEditingItem(e); setShowExpenseModal(true); }}>Edit</button>
                      <button className="icon-btn danger" onClick={() => deleteExpense(e.id)}>Del</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'checklist' && isApp && (
        <AppChecklist project={project} />
      )}

      {activeTab === 'blog' && project.hasBlog === true && (
        <BlogAdmin />
      )}

      {activeTab === 'vault' && (
        <BlackBox project={project} />
      )}

      {showMilestoneModal && <MilestoneModal milestone={editingItem} onSave={handleSaveMilestone} onClose={() => { setShowMilestoneModal(false); setEditingItem(null); }} />}
      {showEditModal && <EditModal edit={editingItem} onSave={handleSaveEdit} onClose={() => { setShowEditModal(false); setEditingItem(null); }} />}
      {showExpenseModal && <ExpenseModal expense={editingItem} onSave={handleSaveExpense} onClose={() => { setShowExpenseModal(false); setEditingItem(null); }} />}
      {showStackModal && <TechStackModal onSave={handleSaveStack} onClose={() => setShowStackModal(false)} />}
      {showPaymentModal && <PaymentModal type={paymentType} onSave={handleSavePayment} onClose={() => setShowPaymentModal(false)} />}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => { if (deletingProject) return; setDeleteConfirmText(''); setDeleteError(''); setShowDeleteModal(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete project</div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={deletingProject} onClick={() => { setDeleteConfirmText(''); setDeleteError(''); setShowDeleteModal(false); }}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--coral)', marginBottom: 12, lineHeight: 1.5 }}>
                This will permanently delete this project and cannot be undone.
              </p>
              <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
                You are about to delete <strong>{project.name}</strong>.
              </p>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Type DELETE to confirm</label>
                <input
                  className="form-input"
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE to confirm"
                  autoFocus
                  disabled={deletingProject}
                />
              </div>
              {deleteError && <div className="quotes-error" style={{ marginTop: 12 }}>{deleteError}</div>}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deletingProject}
                onClick={() => {
                  setDeleteConfirmText('');
                  setDeleteError('');
                  setShowDeleteModal(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleteConfirmText !== 'DELETE' || deletingProject}
                onClick={async () => {
                  if (deleteConfirmText !== 'DELETE') return;
                  setDeletingProject(true);
                  setDeleteError('');
                  try {
                    const res = await fetch('/api/delete-project', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: project.id }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || !data.ok) {
                      throw new Error(data.error || data.detail || 'Failed to delete project');
                    }
                    onDelete(project.id);
                  } catch (err) {
                    console.error(err);
                    setDeleteError(err.message || String(err));
                    setDeletingProject(false);
                  }
                }}
              >
                {deletingProject ? 'Deleting…' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
