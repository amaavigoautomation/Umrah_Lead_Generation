import React, { useState } from 'react';
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
} from 'lucide-react';
import { KnowledgeDocument, KnowledgeStatus } from '../types';
import { retrieveRelevantKnowledge, RetrievedChunk } from '../services/ragService';

interface KnowledgeBaseViewProps {
  documents: KnowledgeDocument[];
  onAddDocument: (doc: KnowledgeDocument) => Promise<void> | void;
  onUpdateDocument: (doc: KnowledgeDocument) => Promise<void> | void;
  onDeleteDocument?: (id: string) => Promise<void> | void;
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  documents,
  onAddDocument,
  onUpdateDocument,
  onDeleteDocument,
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

  // Form State
  const [editingDoc, setEditingDoc] = useState<Partial<KnowledgeDocument>>({
    title: '',
    category: 'PRODUCT',
    content: '',
    tags: [],
    status: 'PUBLISHED',
  });

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || documents[0];

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
          version: (editingDoc.version || 1) + 1,
          updatedAt: new Date().toISOString(),
        };
        await onUpdateDocument(updatedDoc);
        setSaveToast(`Updated "${updatedDoc.title}" — Saved to Database & Active in RAG`);
      } else {
        const newDoc: KnowledgeDocument = {
          id: `KB-${Date.now().toString().slice(-5)}`,
          title: editingDoc.title.trim(),
          category: editingDoc.category || 'PRODUCT',
          content: editingDoc.content.trim(),
          tags: editingDoc.tags && editingDoc.tags.length > 0 ? editingDoc.tags : [tenantId || 'general'],
          status: editingDoc.status || 'PUBLISHED',
          version: 1,
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
      version: doc.version + 1,
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

  const getDocDisplayId = (doc: KnowledgeDocument, index: number) => {
    if (doc.id.startsWith('KB-') || doc.id.startsWith('AMA-')) return doc.id;
    return `AMA-KB-POL-${String(index + 1).padStart(3, '0')}`;
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Toast Notification */}
      {saveToast && (
        <div className="fixed top-20 right-6 z-50 bg-white border border-emerald-500 text-emerald-800 px-4 py-3 rounded-xl shadow-lg flex items-center space-x-3 text-xs animate-in fade-in slide-in-from-top-4">
          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-semibold">{saveToast}</span>
        </div>
      )}

      {/* 1. HERO HEADER CARD (Matches Screenshot exactly) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 md:p-7 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div>
          <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Knowledge Base
            </h1>
            <span className="bg-orange-50 text-orange-700 border border-orange-200/80 rounded-full px-3 py-0.5 text-xs font-semibold inline-flex items-center">
              Authoring & Revisions
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 font-medium max-w-3xl leading-relaxed">
            Ground truth repository for all AI Inbound email auto-replies, WhatsApp dialogues, website leads, and AI testing. All PUBLISHED articles are automatically active in RAG with 0ms in-memory latency.
          </p>
        </div>

        {/* Action Buttons on Right */}
        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={() => {
              setEditingDoc({
                title: '',
                category: 'PRODUCT',
                content: '',
                tags: tenantId === 'umrah360' ? ['umrah360', 'crm'] : [tenantId || 'general'],
                status: 'PUBLISHED',
              });
              setIsModalOpen(true);
            }}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white text-xs font-semibold shadow-xs transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create article</span>
          </button>
        </div>
      </div>

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
              <option value="PRODUCT">PRODUCT</option>
              <option value="B2B">B2B</option>
              <option value="MODULES">MODULES</option>
              <option value="PRICING">PRICING</option>
              <option value="OPERATIONS">OPERATIONS</option>
              <option value="FAQS">FAQS</option>
              <option value="INTEGRATIONS">INTEGRATIONS</option>
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
              <option value="DRAFT">DRAFT</option>
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
                      <span className="text-[10px] text-slate-400 font-mono">v{doc.version || 1}</span>
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
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-orange-600 uppercase">
                        {selectedDoc.category}
                      </span>
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
                  <select
                    value={editingDoc.category || 'PRODUCT'}
                    onChange={(e) => setEditingDoc({ ...editingDoc, category: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-semibold focus:outline-none"
                  >
                    <option value="PRODUCT">PRODUCT</option>
                    <option value="B2B">B2B</option>
                    <option value="MODULES">MODULES</option>
                    <option value="PRICING">PRICING</option>
                    <option value="OPERATIONS">OPERATIONS</option>
                    <option value="FAQS">FAQS</option>
                    <option value="INTEGRATIONS">INTEGRATIONS</option>
                  </select>
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
