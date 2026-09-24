import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  Tag,
  ShieldCheck,
  Zap,
  Clock,
  Sparkles,
  Database,
  Check,
  AlertCircle,
  Layers,
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
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ragTestQuery, setRagTestQuery] = useState<string>('Does Umrah360 support B2B sub-agents?');
  const [ragResults, setRagResults] = useState<RetrievedChunk[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Form State
  const [editingDoc, setEditingDoc] = useState<Partial<KnowledgeDocument>>({
    title: '',
    category: 'PRODUCT',
    content: '',
    tags: [],
    status: 'PUBLISHED',
  });

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || documents[0];

  // Filtered documents
  const filteredDocs = documents.filter((d) => {
    if (categoryFilter !== 'ALL' && d.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const publishedCount = documents.filter((d) => d.status === 'PUBLISHED').length;

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
          id: `kb-${Date.now()}`,
          title: editingDoc.title.trim(),
          category: editingDoc.category || 'PRODUCT',
          content: editingDoc.content.trim(),
          tags: editingDoc.tags && editingDoc.tags.length > 0 ? editingDoc.tags : ['umrah360'],
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

  // Handle Delete
  const handleDeleteDoc = async (id: string, title: string) => {
    if (window.confirm(`Are you sure you want to delete "${title}"?`)) {
      if (onDeleteDocument) {
        await onDeleteDocument(id);
        if (selectedDocId === id) {
          const remaining = documents.filter((d) => d.id !== id);
          if (remaining.length > 0) {
            setSelectedDocId(remaining[0].id);
          }
        }
        setSaveToast(`Deleted article "${title}"`);
        setTimeout(() => setSaveToast(null), 3500);
      }
    }
  };

  // Helper for status badge
  const renderStatusBadge = (status: KnowledgeStatus) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
            <CheckCircle className="w-3 h-3" />
            <span>PUBLISHED (Active in RAG & Auto-Replies)</span>
          </span>
        );
      case 'APPROVED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
            APPROVED
          </span>
        );
      case 'REVIEW':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
            REVIEW
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-700 text-slate-300">
            DRAFT (Not in RAG)
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Toast Notification */}
      {saveToast && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-950 border border-emerald-600 text-emerald-100 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-xs animate-in fade-in slide-in-from-top-4">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{saveToast}</span>
        </div>
      )}

      {/* KB Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-6 h-6 text-emerald-500" />
            <h2 className="text-xl font-bold text-white">Official Umrah360 Knowledge Base</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Ground truth repository for all AI Inbound email auto-replies, WhatsApp dialogues, website leads, and AI testing.
            All <span className="text-emerald-400 font-semibold">PUBLISHED</span> articles are automatically active in RAG with <span className="text-blue-400 font-medium">0ms in-memory latency</span>.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-xs">
            <Database className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-slate-300">
              <span className="font-bold text-emerald-400">{publishedCount}</span> / {documents.length} Published
            </span>
          </div>

          <button
            onClick={() => {
              setEditingDoc({
                title: '',
                category: 'PRODUCT',
                content: '',
                tags: ['umrah', 'feature'],
                status: 'PUBLISHED',
              });
              setIsModalOpen(true);
            }}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Article</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Articles Browser & Article Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 1 Col: Articles List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[calc(100vh-20rem)]">
          {/* Search & Category Filter */}
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search KB by title or tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex space-x-1 overflow-x-auto text-[11px] scrollbar-none pb-1">
              {['ALL', 'PRODUCT', 'B2B', 'MODULES', 'PRICING', 'OPERATIONS', 'FAQS'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2 py-0.5 rounded font-medium transition ${
                    categoryFilter === cat
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* List of articles */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {filteredDocs.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No matching articles found. Click &quot;Create Article&quot; to add one.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = doc.id === selectedDoc?.id;

                return (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`p-3.5 cursor-pointer transition ${
                      isSelected
                        ? 'bg-slate-800/90 border-l-4 border-emerald-500'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                        {doc.category}
                      </span>
                      <span className="text-[10px] text-slate-500">v{doc.version || 1}</span>
                    </div>

                    <h4 className="font-semibold text-xs text-slate-100 mt-1 line-clamp-1">
                      {doc.title}
                    </h4>

                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {doc.content}
                    </p>

                    <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/40 text-[10px]">
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium ${
                          doc.status === 'PUBLISHED'
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-amber-400 bg-amber-500/10'
                        }`}
                      >
                        {doc.status}
                      </span>
                      <span className="text-slate-500">{doc.tags.slice(0, 2).join(', ')}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right 2 Cols: Document Viewer & Live RAG Query Sandbox */}
        <div className="lg:col-span-2 space-y-6">
          {/* Article View Card */}
          {selectedDoc ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-3">
                <div>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs font-bold text-emerald-400 uppercase">
                      {selectedDoc.category}
                    </span>
                    {renderStatusBadge(selectedDoc.status)}
                  </div>
                  <h3 className="text-lg font-bold text-white mt-1">{selectedDoc.title}</h3>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleToggleStatus(selectedDoc)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      selectedDoc.status === 'PUBLISHED'
                        ? 'bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border-amber-800/60'
                        : 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/60'
                    }`}
                  >
                    {selectedDoc.status === 'PUBLISHED' ? 'Set to Draft' : 'Publish to RAG'}
                  </button>

                  <button
                    onClick={() => {
                      setEditingDoc(selectedDoc);
                      setIsModalOpen(true);
                    }}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  {onDeleteDocument && (
                    <button
                      onClick={() => handleDeleteDoc(selectedDoc.id, selectedDoc.title)}
                      className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-800/60 transition"
                      title="Delete Article"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Status information banner */}
              {selectedDoc.status === 'PUBLISHED' ? (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-emerald-200 text-xs flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      <strong>Active in Live AI RAG</strong> — This article is automatically cited by Gemini in the AI Testing Playground, Inbound Emails, WhatsApp, and Website leads.
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-400/80 font-mono">0ms latency cache</span>
                </div>
              ) : (
                <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-amber-200 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Draft Article</strong> — Click &quot;Publish to RAG&quot; to make this article active for AI answers and auto-replies.
                  </span>
                </div>
              )}

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {selectedDoc.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] border border-slate-700 flex items-center space-x-1"
                  >
                    <Tag className="w-3 h-3 text-slate-400" />
                    <span>{tag}</span>
                  </span>
                ))}
              </div>

              {/* Content Body */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs leading-relaxed text-slate-200 whitespace-pre-wrap font-sans">
                {selectedDoc.content}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/60">
                <span className="flex items-center space-x-1">
                  <Clock className="w-3 h-3" />
                  <span>Last updated: {new Date(selectedDoc.updatedAt || selectedDoc.createdAt).toLocaleString()}</span>
                </span>
                <span>Document ID: <code className="text-slate-400 font-mono">{selectedDoc.id}</code></span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-xs">
              Select or create an article to view details.
            </div>
          )}

          {/* RAG Retrieval Test Sandbox */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h4 className="font-semibold text-xs text-white uppercase tracking-wider">
                  Live RAG Retrieval Test Sandbox
                </h4>
              </div>
              <span className="text-[11px] text-slate-400">
                Simulates real-time semantic RAG snippet extraction
              </span>
            </div>

            <div className="flex space-x-2">
              <input
                type="text"
                value={ragTestQuery}
                onChange={(e) => setRagTestQuery(e.target.value)}
                placeholder="Ask any pilgrim or travel agency question..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleTestRag}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition flex items-center space-x-1.5 shadow"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Query RAG</span>
              </button>
            </div>

            {ragResults.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-[11px] text-slate-400 font-medium block">
                  Top Grounded Knowledge Chunks Retrieved:
                </span>
                {ragResults.map((chunk, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-800/80 rounded-lg border border-slate-700/80 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-400">{chunk.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
                        Relevance Score: {chunk.score}
                      </span>
                    </div>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      {chunk.relevantExcerpt}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal for Add / Edit Article */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-emerald-400" />
                <span>{editingDoc.id ? 'Edit Knowledge Document' : 'Create New Knowledge Article'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Article Title *</label>
                <input
                  type="text"
                  value={editingDoc.title || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, title: e.target.value })}
                  placeholder="e.g. Dynamic Costing & Saudi VAT Regulations"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1 font-medium">Category</label>
                  <select
                    value={editingDoc.category || 'PRODUCT'}
                    onChange={(e) =>
                      setEditingDoc({
                        ...editingDoc,
                        category: e.target.value as any,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
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
                  <label className="text-slate-400 block mb-1 font-medium">Publishing Status</label>
                  <select
                    value={editingDoc.status || 'PUBLISHED'}
                    onChange={(e) =>
                      setEditingDoc({
                        ...editingDoc,
                        status: e.target.value as any,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                  >
                    <option value="PUBLISHED">PUBLISHED (Active in RAG & Auto-Replies)</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="REVIEW">REVIEW</option>
                    <option value="DRAFT">DRAFT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Tags (comma separated)</label>
                <input
                  type="text"
                  value={(editingDoc.tags || []).join(', ')}
                  onChange={(e) =>
                    setEditingDoc({
                      ...editingDoc,
                      tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                    })
                  }
                  placeholder="b2b, vouchers, credit-limit"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Knowledge Content (Factual documentation for RAG) *</label>
                <textarea
                  rows={8}
                  value={editingDoc.content || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, content: e.target.value })}
                  placeholder="Detailed factual documentation that Gemini will cite..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2.5 text-slate-200 leading-relaxed resize-none focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                <Database className="w-3.5 h-3.5 text-purple-400" />
                <span>Persisted in DB with zero-latency memory cache</span>
              </span>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDoc}
                  disabled={isSaving || !editingDoc.title || !editingDoc.content}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 flex items-center space-x-1.5 shadow"
                >
                  {isSaving ? <span>Saving to DB...</span> : <span>Save & Activate in RAG</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
