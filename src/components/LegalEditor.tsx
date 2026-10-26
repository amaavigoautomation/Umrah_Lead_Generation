import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Eye, History, Plus, Save, Send, Trash2, Undo2 } from 'lucide-react';
import { LEGAL_SLUGS, type LegalContent, type LegalSection, type LegalSlug } from '../shared/legalDefaults';
import { LegalMarkdown } from './LegalMarkdown';
import { LEGAL_PATHS } from './LegalPage';

interface PublishedLegal extends LegalContent { version: number; publishedAt?: string; publishedBy?: string }
interface DraftLegal extends LegalContent { updatedAt: string; updatedBy: string }
interface AdminView { slug: LegalSlug; published: PublishedLegal; draft: DraftLegal | null }
interface VersionRow { version: number; title: string; effectiveDate: string; publishedAt?: string; publishedBy?: string }

const TAB_LABEL: Record<LegalSlug, string> = { privacy: 'Privacy Policy', terms: 'Terms of Service', dpa: 'DPA', aup: 'Acceptable Use' };

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const inputCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
const btnCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed';

const newSectionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const toContent = (d: LegalContent): LegalContent => ({ title: d.title, effectiveDate: d.effectiveDate, sections: d.sections.map((s) => ({ ...s })) });

export const LegalEditor: React.FC = () => {
  const [views, setViews] = useState<Partial<Record<LegalSlug, AdminView>>>({});
  const [slug, setSlug] = useState<LegalSlug>('privacy');
  const [content, setContent] = useState<LegalContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);

  const view = views[slug];

  const load = useCallback(async () => {
    setError(null);
    try {
      const { documents } = await api<{ documents: AdminView[] }>('/api/platform/legal');
      setViews(Object.fromEntries(documents.map((d) => [d.slug, d])));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Switching documents (or loading) resets the editor to the draft if there is one, else the live text.
  useEffect(() => {
    const v = views[slug];
    if (v) {
      setContent(toContent(v.draft || v.published));
      setDirty(false);
      setVersions(null);
      setPreview(false);
    }
  }, [slug, views]);

  const hasUnpublished = Boolean(view?.draft) || dirty;

  const edit = (patch: Partial<LegalContent>) => { setContent((c) => (c ? { ...c, ...patch } : c)); setDirty(true); setNotice(null); };
  const editSection = (id: string, patch: Partial<LegalSection>) =>
    edit({ sections: content!.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const moveSection = (i: number, dir: -1 | 1) => {
    const arr = [...content!.sections];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    edit({ sections: arr });
  };
  const removeSection = (id: string) => {
    if (!window.confirm('Delete this section?')) return;
    edit({ sections: content!.sections.filter((s) => s.id !== id) });
  };
  const addSection = (at?: number) => {
    const arr = [...content!.sections];
    arr.splice(at ?? arr.length, 0, { id: newSectionId(), heading: '', body: '' });
    edit({ sections: arr });
  };

  const run = async (label: string, fn: () => Promise<AdminView>, done: string) => {
    setBusy(label); setError(null); setNotice(null);
    try {
      const next = await fn();
      setViews((p) => ({ ...p, [slug]: next }));
      setNotice(done);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () => run('save', () => api(`/api/platform/legal/${slug}/draft`, { method: 'POST', body: JSON.stringify(content) }), 'Draft saved. It is not public until you publish.');
  const publish = () => {
    if (!window.confirm(`Publish "${content!.title}" now? It goes live on ${LEGAL_PATHS[slug]} immediately and the current version is kept in history.`)) return;
    run('publish', () => api(`/api/platform/legal/${slug}/publish`, { method: 'POST', body: JSON.stringify({ content }) }), 'Published. The public page is updated.');
  };
  const discard = () => {
    if (!window.confirm('Discard your draft and go back to the live text?')) return;
    run('discard', () => api(`/api/platform/legal/${slug}/discard`, { method: 'POST', body: '{}' }), 'Draft discarded.');
  };
  const openHistory = async () => {
    setError(null);
    try { setVersions((await api<{ versions: VersionRow[] }>(`/api/platform/legal/${slug}/versions`)).versions); }
    catch (e: any) { setError(e.message); }
  };
  const restore = (v: number) => {
    if (!window.confirm(`Load version ${v} into the editor as a draft? It stays unpublished until you publish.`)) return;
    run('restore', () => api(`/api/platform/legal/${slug}/restore`, { method: 'POST', body: JSON.stringify({ version: v }) }), `Version ${v} loaded as a draft.`);
  };

  const status = useMemo(() => {
    if (!view) return '';
    const p = view.published;
    return p.version === 0
      ? 'Live: built-in text from the ADSL legal document (never published from here yet)'
      : `Live: version ${p.version}, published ${fmtDateTime(p.publishedAt)}${p.publishedBy ? ` by ${p.publishedBy}` : ''}`;
  }, [view]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {LEGAL_SLUGS.map((s) => (
          <button
            key={s}
            onClick={() => {
              if (dirty && !window.confirm('You have unsaved changes. Switch document and lose them?')) return;
              setSlug(s);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${s === slug ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            {TAB_LABEL[s]}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-3 py-2">{notice}</div>}

      {!view || !content ? (
        !error && <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-xs text-slate-500 space-y-0.5">
              <p>{status}</p>
              {hasUnpublished && <p className="text-amber-700 font-semibold">{dirty ? 'Unsaved changes in the editor' : `Draft saved ${fmtDateTime(view.draft?.updatedAt)} - not public yet`}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={LEGAL_PATHS[slug]} target="_blank" rel="noopener noreferrer" className={`${btnCls} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                <ExternalLink className="w-3.5 h-3.5" /> View public page
              </a>
              <button onClick={() => setPreview((p) => !p)} className={`${btnCls} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                <Eye className="w-3.5 h-3.5" /> {preview ? 'Back to editing' : 'Preview'}
              </button>
              <button onClick={openHistory} className={`${btnCls} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                <History className="w-3.5 h-3.5" /> History
              </button>
            </div>
          </div>

          {versions && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900 mb-2">Published versions</p>
              {versions.length === 0 ? (
                <p className="text-slate-500 text-xs">No earlier versions yet. The version you replace when you publish is kept here.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {versions.map((v) => (
                    <li key={v.version} className="py-1.5 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-700">
                        {v.version === 0 ? 'Original built-in text' : `Version ${v.version}`} · {v.effectiveDate ? `effective ${v.effectiveDate} · ` : ''}{fmtDateTime(v.publishedAt)}
                      </span>
                      <button onClick={() => restore(v.version)} disabled={!!busy} className={`${btnCls} border border-slate-200 text-slate-700 hover:bg-white`}>
                        <Undo2 className="w-3.5 h-3.5" /> Load as draft
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {preview ? (
            <article className="border border-slate-200 rounded-xl p-5">
              <h2 className="text-xl font-bold text-slate-900">{content.title}</h2>
              <p className="text-sm text-slate-500 mt-1">{content.effectiveDate ? `Effective date: ${content.effectiveDate}` : 'Effective date: to be confirmed on publication'}</p>
              <div className="mt-6 space-y-6">
                {content.sections.map((s) => (
                  <section key={s.id}>
                    {s.heading && <h3 className="text-base font-semibold text-slate-900 mb-2">{s.heading}</h3>}
                    <div className="space-y-3 text-sm leading-relaxed text-slate-700"><LegalMarkdown text={s.body} /></div>
                  </section>
                ))}
              </div>
            </article>
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="sm:col-span-2 text-xs font-semibold text-slate-600">
                  Document title
                  <input className={`${inputCls} mt-1 font-normal`} value={content.title} onChange={(e) => edit({ title: e.target.value })} />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Effective date
                  <input className={`${inputCls} mt-1 font-normal`} placeholder="e.g. 1 November 2026" value={content.effectiveDate} onChange={(e) => edit({ effectiveDate: e.target.value })} />
                </label>
              </div>

              <div className="space-y-4">
                {content.sections.map((s, i) => (
                  <div key={s.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input className={`${inputCls} font-semibold`} placeholder="Section heading (leave empty for intro text)" value={s.heading} onChange={(e) => editSection(s.id, { heading: e.target.value })} />
                      <button title="Move up" onClick={() => moveSection(i, -1)} disabled={i === 0} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button title="Move down" onClick={() => moveSection(i, 1)} disabled={i === content.sections.length - 1} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button title="Delete section" onClick={() => removeSection(s.id)} className="p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <textarea
                      className={`${inputCls} font-mono text-[13px] leading-relaxed`}
                      rows={Math.min(18, Math.max(5, Math.ceil(s.body.length / 110) + s.body.split('\n').length))}
                      value={s.body}
                      onChange={(e) => editSection(s.id, { body: e.target.value })}
                    />
                    <button onClick={() => addSection(i + 1)} className="text-xs font-semibold text-orange-600 hover:text-orange-700">+ Insert section below</button>
                  </div>
                ))}
                <button onClick={() => addSection()} className={`${btnCls} border border-dashed border-slate-300 text-slate-700 hover:bg-slate-50`}>
                  <Plus className="w-3.5 h-3.5" /> Add section
                </button>
                <p className="text-[11px] text-slate-500">Text supports Markdown: blank line = new paragraph, "- item" lists, **bold**, *italic*, [link text](https://example.com).</p>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100">
            <button onClick={saveDraft} disabled={!!busy || !dirty} className={`${btnCls} bg-slate-900 text-white hover:bg-slate-800`}>
              <Save className="w-3.5 h-3.5" /> {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button onClick={publish} disabled={!!busy || !hasUnpublished} className={`${btnCls} bg-orange-600 text-white hover:bg-orange-700`}>
              <Send className="w-3.5 h-3.5" /> {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
            {view.draft && (
              <button onClick={discard} disabled={!!busy} className={`${btnCls} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                <Undo2 className="w-3.5 h-3.5" /> Discard draft
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
