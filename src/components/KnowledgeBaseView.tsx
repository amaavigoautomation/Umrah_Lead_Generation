import React, { useEffect, useState } from 'react';
import { useBrand } from '../context/BrandContext';
import {
  BookOpen,
  Search,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  Zap,
  Clock,
  Sparkles,
  Check,
  Filter,
  Globe,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { KnowledgeDocument, KnowledgeStatus } from '../types';
import { retrieveRelevantKnowledge, RetrievedChunk } from '../services/ragService';
import { startWebsiteKnowledgeScanRunner } from '../services/websiteKnowledgeScanRunner';

interface KnowledgeBaseViewProps {
  documents: KnowledgeDocument[];
  onAddDocument: (doc: KnowledgeDocument) => Promise<void> | void;
  onUpdateDocument: (doc: KnowledgeDocument) => Promise<void> | void;
  onDeleteDocument?: (id: string) => Promise<void> | void;
  canManageWebsiteScan?: boolean;
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  documents,
  onAddDocument,
  onUpdateDocument,
  onDeleteDocument,
  canManageWebsiteScan = false,
}) => {
  const { brand, tenantId } = useBrand();
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ragTestQuery, setRagTestQuery] = useState<string>(brand.playbook === 'umrah360' ? 'Does Umrah360 support B2B sub-agents?' : `What does ${brand.companyName} offer?`);
  const [ragResults, setRagResults] = useState<RetrievedChunk[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [deleteCandidateDoc, setDeleteCandidateDoc] = useState<KnowledgeDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scanConfig, setScanConfig] = useState<any>({ websiteUrl: brand.websiteUrl, excludePatterns: [], lastSyncedAt: null });
  const [excludeText, setExcludeText] = useState('');
  const [scanJob, setScanJob] = useState<any>(null);
  const [scanReport, setScanReport] = useState<any>(null);
  const [scanError, setScanError] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [scanPanelOpen, setScanPanelOpen] = useState(false);

  // Form State
  const [editingDoc, setEditingDoc] = useState<Partial<KnowledgeDocument>>({
    title: '',
    category: 'General',
    content: '',
    tags: [],
    status: 'PUBLISHED',
  });

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || documents[0];
  const categories = Array.from(new Set(documents.map((doc) => String(doc.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const scanWebsiteUrl = scanConfig.websiteUrl || brand.websiteUrl || '';

  useEffect(() => {
    let active = true;
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.tenantId !== tenantId) return;
      setScanJob(detail.job || null);
      setScanLoading(true);
      setScanError('');
    };
    const onCompleted = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.tenantId !== tenantId) return;
      setScanJob(null);
      setScanLoading(false);
      setScanReport(detail.report || null);
      setScanConfig((current: any) => ({ ...current, lastSyncedAt: detail.report?.lastSyncedAt || new Date().toISOString() }));
      setSaveToast((detail.report?.pagesFailed || 0) > 0 ? 'Website sync finished with some page failures. Review the scan report.' : 'Your Knowledge Base is set and ready.');
      window.setTimeout(() => setSaveToast(null), 6000);
    };
    const onFailed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.tenantId !== tenantId) return;
      setScanLoading(false);
      setScanError(detail.message || 'Website scan stopped unexpectedly. Previously saved Knowledge Base articles have been preserved.');
    };
    window.addEventListener('website-knowledge-scan:progress', onProgress);
    window.addEventListener('website-knowledge-scan:completed', onCompleted);
    window.addEventListener('website-knowledge-scan:failed', onFailed);
    fetch('/api/knowledge/website-scan', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load website scan settings.');
        if (!active) return;
        const config = data.config || {};
        setScanConfig({ ...config, websiteUrl: config.websiteUrl || brand.websiteUrl, excludePatterns: config.excludePatterns || [], lastSyncedAt: config.lastSyncedAt || null });
        setExcludeText((config.excludePatterns || []).join('\n'));
        setScanJob(data.job || null);
        if (data.job) {
          setScanLoading(true);
          void startWebsiteKnowledgeScanRunner(tenantId);
        } else if (data.config?.lastReport) setScanReport(data.config.lastReport);
      })
      .catch((error) => console.warn('[Knowledge Base] Website scan settings could not be loaded:', error));
    return () => {
      active = false;
      window.removeEventListener('website-knowledge-scan:progress', onProgress);
      window.removeEventListener('website-knowledge-scan:completed', onCompleted);
      window.removeEventListener('website-knowledge-scan:failed', onFailed);
    };
  }, [tenantId, brand.websiteUrl]);

  // Counts for metric cards (matching the screenshot)
  const publishedCount = documents.filter((d) => d.status === 'PUBLISHED').length;
  const inReviewCount = documents.filter((d) => d.status === 'REVIEW' || d.status === 'APPROVED').length;
  const revisionRequiredCount = documents.filter((d) => d.status === 'DRAFT').length;
  const supersededCount = Math.max(0, documents.length - publishedCount);

  // Filtered documents
  const filteredDocs = documents.filter((d) => {
    if (categoryFilter !== 'ALL' && d.category !== categoryFilter) return false;
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        d.title.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Handle RAG retrieval test
  const handleTestRag = () => {
    if (!ragTestQuery.trim()) return;
    const results = retrieveRelevantKnowledge(ragTestQuery, documents, 3);
    setRagResults(results);
  };

  // Handle save (Add or Edit)
  const handleSaveDoc = async () => {
    if (!editingDoc.title || !editingDoc.content) return;
    setIsSaving(true);

    try {
      if (editingDoc.id) {
        const updatedDoc: KnowledgeDocument = {
          ...(editingDoc as KnowledgeDocument),
          category: String(editingDoc.category || 'General').trim(),
          sourceType: 'MANUAL',
          sourceUrls: [],
          version: editingDoc.version || 1,
          updatedAt: new Date().toISOString(),
        };
        await onUpdateDocument(updatedDoc);
        setSaveToast(`Updated "${updatedDoc.title}" — Saved to Database & Active in RAG`);
      } else {
        const newDoc: KnowledgeDocument = {
          id: `KB-${Date.now().toString().slice(-5)}`,
          title: editingDoc.title.trim(),
          category: String(editingDoc.category || 'General').trim(),
          content: editingDoc.content.trim(),
          tags: editingDoc.tags && editingDoc.tags.length > 0 ? editingDoc.tags : [tenantId || 'general'],
          status: editingDoc.status || 'PUBLISHED',
          version: 1,
          sourceType: 'MANUAL',
          sourceUrls: [],
          author: 'Admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await onAddDocument(newDoc);
        setSelectedDocId(newDoc.id);
        setSaveToast(`Created "${newDoc.title}" — Saved to Database & Active in RAG`);
      }

      setIsModalOpen(false);
      setTimeout(() => setSaveToast(null), 4000);
    } catch (err) {
      console.error('Error saving article:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Quick toggle status between PUBLISHED and DRAFT
  const handleToggleStatus = async (doc: KnowledgeDocument) => {
    const nextStatus: KnowledgeStatus = doc.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    const updated: KnowledgeDocument = {
      ...doc,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      version: doc.version || 1,
    };
    await onUpdateDocument(updated);
    setSaveToast(`Article "${doc.title}" is now ${nextStatus}`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    if (!deleteCandidateDoc) return;
    const { id, title } = deleteCandidateDoc;
    setIsDeleting(true);

    try {
      if (onDeleteDocument) {
        await onDeleteDocument(id);
      }
      const remaining = documents.filter((d) => d.id !== id);
      if (selectedDocId === id) {
        setSelectedDocId(remaining[0]?.id || '');
      }
      setSaveToast(`Deleted article "${title}" from Database & RAG`);
      setTimeout(() => setSaveToast(null), 3500);
    } catch (err) {
      console.error('Failed to delete document:', err);
    } finally {
      setIsDeleting(false);
      setDeleteCandidateDoc(null);
    }
  };

  const handleRunWebsiteScan = async (resume = false) => {
    setScanLoading(true);
    setScanError('');
    setScanReport(null);
    try {
      let job = scanJob;
      if (!resume || !job) {
        const startResponse = await fetch('/api/knowledge/website-scan/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ excludePatterns: excludeText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }),
        });
        const startData = await startResponse.json().catch(() => ({}));
        if (!startResponse.ok) {
          const stateResponse = await fetch('/api/knowledge/website-scan', { cache: 'no-store' });
          const stateData = await stateResponse.json().catch(() => ({}));
          if (!stateResponse.ok || !stateData.job) throw new Error(startData.error || 'Could not start website scan.');
          job = stateData.job;
        } else job = startData.job;
        setScanJob(job);
      }
      if (!job) throw new Error('The website scanner did not return an active job.');
      void startWebsiteKnowledgeScanRunner(tenantId);
    } catch (error: any) {
      setScanError(error?.message || 'Website scan could not start.');
      setScanLoading(false);
    }
  };

  const getDocDisplayId = (doc: KnowledgeDocument, index: number) => {
    if (doc.id.startsWith('KB-') || doc.id.startsWith('AMA-')) return doc.id;
    return `AMA-KB-POL-${String(index + 1).padStart(3, '0')}`;
  };

  return (
    <div className="knowledge-base-shell marketing-studio-shell">
      {/* Toast Notification */}
      {saveToast && (
        <div className="fixed top-20 right-6 z-50 bg-white border border-emerald-500 text-emerald-800 px-4 py-3 rounded-xl shadow-lg flex items-center space-x-3 text-xs animate-in fade-in slide-in-from-top-4">
          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-semibold">{saveToast}</span>
        </div>
      )}

      {/* 1. HERO HEADER CARD (Matches Screenshot exactly) */}
      <div className="knowledge-base-header">
        <div>
          <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Knowledge Base
            </h1>
            <span className="bg-orange-50 text-orange-700 border border-orange-200/80 rounded-full px-3 py-0.5 text-xs font-semibold inline-flex items-center">
              Website & Manual Knowledge
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 font-medium max-w-3xl leading-relaxed">
            Manage knowledge sourced from your company website or written manually. Published articles are available to the AI assistants through RAG.
          </p>
        </div>

        {/* Action Buttons on Right */}
        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={() => {
              setEditingDoc({
                title: '',
                category: categories[0] || 'General',
                content: '',
                tags: tenantId === 'umrah360' ? ['umrah360', 'crm'] : [tenantId || 'general'],
                status: 'PUBLISHED',
              });
              setIsModalOpen(true);
            }}
            className="knowledge-base-create-button"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create article</span>
          </button>
        </div>
      </div>


      {canManageWebsiteScan && (
        <section className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600"><Globe className="w-5 h-5" /></div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Website knowledge sync</h2>
                <p className="text-xs text-slate-500 mt-1">Fetches all discoverable internal pages, then builds and synchronizes a source-linked Knowledge Base.</p>
                <p className="text-[11px] text-slate-500 mt-1.5">AI analysis: <strong>GPT-6.1-sol</strong> · Fallback: GPT-4o → GPT-4o-mini</p>
                <p className="text-xs text-slate-700 mt-2 break-all">{scanWebsiteUrl || 'Add a website URL in Company Profile to get started.'}</p>
                {scanConfig.lastSyncedAt && <p className="text-[11px] text-slate-400 mt-1">Last synchronized: {new Date(scanConfig.lastSyncedAt).toLocaleString()}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setScanPanelOpen((open) => !open)} className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50">
                {scanPanelOpen ? 'Hide settings' : 'Scan settings'}
              </button>
              <button
                onClick={() => handleRunWebsiteScan(Boolean(scanJob))}
                disabled={scanLoading || !scanWebsiteUrl}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 text-white text-xs font-bold shadow-xs disabled:opacity-50"
              >
                {scanLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : scanJob ? <RefreshCw className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                {scanLoading ? 'Scanning in background…' : scanJob ? 'Resume scan' : 'Scan website'}
              </button>
            </div>
          </div>
          {scanPanelOpen && (
            <div className="border-t border-slate-100 pt-4 space-y-2">
              <label className="block text-xs font-bold text-slate-700">Exclude URL paths</label>
              <textarea
                rows={3}
                value={excludeText}
                onChange={(event) => setExcludeText(event.target.value)}
                placeholder={'/careers/*\n/blog/*\n/privacy-policy'}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
              />
              <p className="text-[11px] text-slate-400">One URL path pattern per line. Wildcards are supported. Only matching paths are excluded; other discoverable internal HTML pages are queued for scanning.</p>
            </div>
          )}
          {scanJob && (
            <div className="border-t border-slate-100 pt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">{scanJob.status === 'DISCOVERING' ? 'Finding sitemaps and website page URLs' : scanJob.status === 'CRAWLING' ? 'Fetching all discovered pages' : scanJob.status === 'VERIFYING' ? 'Checking previously indexed pages' : scanJob.status === 'GENERATING' ? 'Extracting knowledge from every page segment' : scanJob.status === 'MERGING' ? 'Consolidating and deduplicating knowledge articles' : 'Saving the complete website index'}</span>
                <span className="text-slate-500">{scanJob.processedPages || 0} fetch attempts</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: (scanJob.progress || 5) + '%' }} /></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>{scanJob.pagesDiscovered || 0} discovered</span>
                <span>{scanJob.pagesQueued || 0} queued</span>
                <span>{scanJob.pagesFailed || 0} failed</span>
                <span>{scanJob.pagesToVerify || 0} awaiting verification</span>
              </div>
              <p className="text-[11px] text-slate-400">The scan runs in the background. You can switch modules or return to this page; progress continues automatically.</p>
            </div>
          )}
          {scanLoading && <p className="text-[11px] text-slate-500">The AI is comparing current website information with the existing Knowledge Base.</p>}
          {scanError && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{scanError}</span></div>}
          {scanReport && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-600" /><span className="text-sm font-extrabold text-slate-900">Website synchronization complete</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xl font-extrabold text-emerald-700">{scanReport.articlesAdded || 0}</p><p className="text-[11px] text-emerald-700">Articles added</p></div>
                <div className="rounded-xl bg-blue-50 p-3"><p className="text-xl font-extrabold text-blue-700">{scanReport.articlesUpdated || 0}</p><p className="text-[11px] text-blue-700">Articles updated</p></div>
                <div className="rounded-xl bg-red-50 p-3"><p className="text-xl font-extrabold text-red-700">{scanReport.articlesRemoved || 0}</p><p className="text-[11px] text-red-700">Articles removed</p></div>
                <div className="rounded-xl bg-slate-100 p-3"><p className="text-xl font-extrabold text-slate-700">{scanReport.articlesUnchanged || 0}</p><p className="text-[11px] text-slate-600">Unchanged articles</p></div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-slate-600">
                <span>Discovered: <strong>{scanReport.pagesDiscovered || 0}</strong></span>
                <span>Attempted: <strong>{scanReport.pagesAttempted || 0}</strong></span>
                <span>Indexed: <strong>{scanReport.pagesIndexed || 0}</strong></span>
                <span>Added: <strong>{scanReport.pagesAdded || 0}</strong></span>
                <span>Modified: <strong>{scanReport.pagesUpdated || 0}</strong></span>
                <span>Removed: <strong>{scanReport.pagesRemoved || 0}</strong></span>
                <span>Unchanged: <strong>{scanReport.pagesUnchanged || 0}</strong></span>
                <span>Excluded: <strong>{scanReport.pagesExcluded || 0}</strong></span>
                <span>Failed: <strong>{scanReport.pagesFailed || 0}</strong></span>
              </div>
              {scanReport.initialScan && <p className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">New website articles are in Review. Publish them after checking their accuracy.</p>}
              {(scanReport.pagesFailed || 0) > 0 && <p className="text-xs text-amber-700">Some pages could not be fetched. They are listed below; previously indexed content was preserved when available. Review these failures before treating the Knowledge Base as fully complete.</p>}
              {Array.isArray(scanReport.warnings) && scanReport.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1"><p className="text-xs font-bold text-amber-800">Pages needing attention</p>{scanReport.warnings.slice(0, 10).map((warning, index) => <p key={index} className="text-[11px] text-amber-700">{warning}</p>)}</div>}
            </div>
          )}
        </section>
      )}

      {/* 3. SEARCH & FILTER TOOLBAR (Matches Screenshot) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Document ID, Title, Category, Department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50/70 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs md:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 font-medium"
          />
        </div>

        {/* Filter Dropdowns and Layout Toggle */}
        <div className="flex items-center space-x-2 flex-wrap">
          {/* Category Dropdown */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-semibold">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent text-slate-900 font-bold focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>

          {/* Status Dropdown */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-semibold">
            <span>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-slate-900 font-bold focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="PUBLISHED">PUBLISHED</option>
              <option value="REVIEW">REVIEW</option>
              <option value="DRAFT">DRAFT</option>
              <option value="APPROVED">APPROVED</option>
            </select>
          </div>

        </div>
      </div>

      {/* SPLIT VIEW (Inspector & RAG Sandbox) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Quick Article List */}
        <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs flex flex-col h-[650px]">
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <span className="font-extrabold text-xs text-slate-900 uppercase tracking-wider">
              Articles ({filteredDocs.length})
            </span>
          </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {filteredDocs.map((doc) => {
                const isSelected = doc.id === selectedDoc?.id;
                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`p-3.5 cursor-pointer transition ${
                      isSelected ? 'bg-orange-50/90 border-l-4 border-orange-500' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold text-orange-600 uppercase">
                        {doc.category}
                      </span>
                      <span className="text-[10px] text-slate-400">{doc.sourceType === 'WEBSITE' ? 'WEBSITE' : 'MANUAL'}</span>
                    </div>
                    <h4 className="font-bold text-xs text-slate-900 mt-1 line-clamp-1">{doc.title}</h4>
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                      {doc.content}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Article Details & Live RAG Query Sandbox */}
          <div className="lg:col-span-2 space-y-6">
            {selectedDoc ? (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-3">
                  <div>
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="text-xs font-bold text-orange-600 uppercase">
                        {selectedDoc.category}
                      </span>
                      <span className="text-[10px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 font-bold">{selectedDoc.sourceType === 'WEBSITE' ? 'WEBSITE SOURCE' : 'MANUAL ARTICLE'}</span>
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-0.5 text-xs font-bold">
                        {selectedDoc.status}
                      </span>
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 mt-1">{selectedDoc.title}</h3>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleToggleStatus(selectedDoc)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                        selectedDoc.status === 'PUBLISHED'
                          ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                          : 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500'
                      }`}
                    >
                      {selectedDoc.status === 'PUBLISHED' ? 'Set to Draft' : 'Publish to RAG'}
                    </button>

                    <button
                      onClick={() => {
                        setEditingDoc(selectedDoc);
                        setIsModalOpen(true);
                      }}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {onDeleteDocument && (
                      <button
                        onClick={() => setDeleteCandidateDoc(selectedDoc)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 transition"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap font-sans">
                  {selectedDoc.content}
                </div>
                {selectedDoc.sourceType === 'WEBSITE' && Array.isArray(selectedDoc.sourceUrls) && selectedDoc.sourceUrls.length > 0 && (
                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <p className="text-[11px] font-bold text-slate-600">Website sources supporting this article</p>
                    <div className="flex flex-wrap gap-2">{selectedDoc.sourceUrls.map((sourceUrl) => <a key={sourceUrl} href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[11px] text-blue-700 hover:bg-blue-50"><ExternalLink className="w-3 h-3" />{new URL(sourceUrl).pathname || sourceUrl}</a>)}</div>
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100">
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Last updated: {new Date(selectedDoc.updatedAt || selectedDoc.createdAt).toLocaleString()}</span>
                  </span>
                  <span>ID: <code className="font-mono text-slate-600 font-semibold">{selectedDoc.id}</code></span>
                </div>
              </div>
            ) : null}

            {/* RAG Retrieval Sandbox */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-orange-500" />
                  <h4 className="font-extrabold text-xs text-slate-900 uppercase tracking-wider">
                    Live RAG Semantic Retrieval Sandbox
                  </h4>
                </div>
                <span className="text-xs text-slate-500">Instant in-memory semantic extraction</span>
              </div>

              <div className="flex space-x-2">
                <input
                  type="text"
                  value={ragTestQuery}
                  onChange={(e) => setRagTestQuery(e.target.value)}
                  placeholder="Ask any customer question to test retrieval..."
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 font-medium"
                />
                <button
                  onClick={handleTestRag}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white text-xs font-bold transition shadow-xs flex items-center space-x-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Query RAG</span>
                </button>
              </div>

              {ragResults.length > 0 && (
                <div className="space-y-2 pt-2">
                  {ragResults.map((chunk, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-orange-600">{chunk.title}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-mono">
                          Score: {chunk.score}
                        </span>
                      </div>
                      <p className="text-slate-700 text-xs leading-relaxed">{chunk.relevantExcerpt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Modal for Add / Edit Article */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-slate-900 text-base flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-orange-500" />
                <span>{editingDoc.id ? 'Edit Knowledge Document Master' : 'New Document Master'}</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg">
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-700 block mb-1 font-bold">Document Title *</label>
                <input
                  type="text"
                  value={editingDoc.title || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, title: e.target.value })}
                  placeholder="e.g. Pricing & Plans, Refund Policy, Product Overview"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-700 block mb-1 font-bold">Category</label>
                  <input
                    list="knowledge-category-suggestions"
                    value={editingDoc.category || ''}
                    onChange={(e) => setEditingDoc({ ...editingDoc, category: e.target.value })}
                    placeholder="Enter a category"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-semibold focus:outline-none"
                  />
                  <datalist id="knowledge-category-suggestions">{categories.map((category) => <option key={category} value={category} />)}</datalist>
                </div>

                <div>
                  <label className="text-slate-700 block mb-1 font-bold">Status</label>
                  <select
                    value={editingDoc.status || 'PUBLISHED'}
                    onChange={(e) => setEditingDoc({ ...editingDoc, status: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-semibold focus:outline-none"
                  >
                    <option value="PUBLISHED">PUBLISHED (Active in RAG)</option>
                    <option value="DRAFT">DRAFT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-700 block mb-1 font-bold">Content & Guidelines *</label>
                <textarea
                  rows={8}
                  value={editingDoc.content || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, content: e.target.value })}
                  placeholder="Factual documentation cited by AI in automated emails, WhatsApp, and leads..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 leading-relaxed resize-none focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-400">Synchronized with database & 0ms in-memory RAG</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDoc}
                  disabled={isSaving || !editingDoc.title || !editingDoc.content}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white text-xs font-bold disabled:opacity-50 shadow-xs"
                >
                  {isSaving ? 'Saving...' : 'Save & Publish'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteCandidateDoc && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3 text-red-600">
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Delete Knowledge Article</h3>
                <p className="text-[11px] text-slate-500">Permanently removes document from Database & RAG</p>
              </div>
            </div>

            <p className="text-slate-600 text-xs">
              Are you sure you want to delete <strong className="text-slate-900">&ldquo;{deleteCandidateDoc.title}&rdquo;</strong>?
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteCandidateDoc(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBaseView;
