import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  Edit2,
  CheckCircle,
  Tag,
  ShieldCheck,
  Zap,
  Filter,
} from 'lucide-react';
import { KnowledgeDocument, KnowledgeStatus } from '../types';
import { retrieveRelevantKnowledge, RetrievedChunk } from '../services/ragService';

interface KnowledgeBaseViewProps {
  documents: KnowledgeDocument[];
  onAddDocument: (doc: KnowledgeDocument) => void;
  onUpdateDocument: (doc: KnowledgeDocument) => void;
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  documents,
  onAddDocument,
  onUpdateDocument,
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ragTestQuery, setRagTestQuery] = useState<string>('Does Umrah360 support B2B sub-agents?');
  const [ragResults, setRagResults] = useState<RetrievedChunk[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  // Handle RAG retrieval test
  const handleTestRag = () => {
    if (!ragTestQuery.trim()) return;
    const results = retrieveRelevantKnowledge(ragTestQuery, documents, 3);
    setRagResults(results);
  };

  // Handle save
  const handleSaveDoc = () => {
    if (!editingDoc.title || !editingDoc.content) return;

    if (editingDoc.id) {
      onUpdateDocument({
        ...(editingDoc as KnowledgeDocument),
        version: (editingDoc.version || 1) + 1,
        updatedAt: new Date().toISOString(),
      });
    } else {
      const newDoc: KnowledgeDocument = {
        id: `kb-${Date.now()}`,
        title: editingDoc.title,
        category: editingDoc.category || 'PRODUCT',
        content: editingDoc.content,
        tags: editingDoc.tags || ['umrah360'],
        status: editingDoc.status || 'DRAFT',
        version: 1,
        author: 'Admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddDocument(newDoc);
      setSelectedDocId(newDoc.id);
    }

    setIsModalOpen(false);
  };

  // Helper for status badge
  const renderStatusBadge = (status: KnowledgeStatus) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
            <CheckCircle className="w-3 h-3" />
            <span>PUBLISHED (Used by AI)</span>
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
            DRAFT
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* KB Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-6 h-6 text-emerald-500" />
            <h2 className="text-xl font-bold text-white">Official Umrah360 Knowledge Base</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Section 25 & 26: Grounding repository for all AI Inbound and Outbound auto-replies. Only{' '}
            <span className="text-emerald-400 font-semibold">PUBLISHED</span> documents are fed into
            the Gemini RAG engine.
          </p>
        </div>

        <div className="flex items-center space-x-3">
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
            {filteredDocs.map((doc) => {
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
                    <span className="text-[10px] text-slate-500">v{doc.version}</span>
                  </div>

                  <h4 className="font-semibold text-xs text-slate-100 mt-1 line-clamp-1">
                    {doc.title}
                  </h4>

                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {doc.content}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/40 text-[10px]">
                    <span
                      className={`px-1.5 py-0.2 rounded font-medium ${
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
            })}
          </div>
        </div>

        {/* Right 2 Cols: Document Viewer & Live RAG Query Sandbox */}
        <div className="lg:col-span-2 space-y-6">
          {/* Article View Card */}
          {selectedDoc && (
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
                    onClick={() => {
                      setEditingDoc(selectedDoc);
                      setIsModalOpen(true);
                    }}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Article</span>
                  </button>
                </div>
              </div>

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
            </div>
          )}

          {/* Section 27: RAG Retrieval Test Sandbox */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h4 className="font-semibold text-xs text-white uppercase tracking-wider">
                  Live RAG Retrieval Test Sandbox
                </h4>
              </div>
              <span className="text-[11px] text-slate-400">
                Simulates exact context retrieved for Gemini
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
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition flex items-center space-x-1.5"
              >
                <span>Query RAG</span>
              </button>
            </div>

            {ragResults.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-[11px] text-slate-400 font-medium block">
                  Top Relevant Knowledge Chunks:
                </span>
                {ragResults.map((chunk, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-800/80 rounded-lg border border-slate-700/80 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-400">{chunk.title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-700 text-slate-300">
                        Score: {chunk.score}
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">
                {editingDoc.id ? 'Edit Knowledge Document' : 'Create New Knowledge Article'}
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
                <label className="text-slate-400 block mb-1">Article Title *</label>
                <input
                  type="text"
                  value={editingDoc.title || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, title: e.target.value })}
                  placeholder="e.g. Dynamic Costing & Saudi VAT Regulations"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Category</label>
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
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Publishing Status (Workflow)</label>
                  <select
                    value={editingDoc.status || 'DRAFT'}
                    onChange={(e) =>
                      setEditingDoc({
                        ...editingDoc,
                        status: e.target.value as any,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                  >
                    <option value="DRAFT">DRAFT</option>
                    <option value="REVIEW">REVIEW</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="PUBLISHED">PUBLISHED (Active in RAG)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Tags (comma separated)</label>
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
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Approved Knowledge Content *</label>
                <textarea
                  rows={8}
                  value={editingDoc.content || ''}
                  onChange={(e) => setEditingDoc({ ...editingDoc, content: e.target.value })}
                  placeholder="Detailed factual documentation that Gemini will cite..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2.5 text-slate-200 leading-relaxed resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDoc}
                disabled={!editingDoc.title || !editingDoc.content}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                Save Article
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
