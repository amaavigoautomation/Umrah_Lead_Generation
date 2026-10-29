import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';

type TemplateItem = {
  id?: string;
  name: string;
  language: string;
  category?: string;
  status?: string;
  body: string;
  header?: string;
  footer?: string;
  rejectionReason?: string;
  qualityScore?: string;
  paramCount: number;
};

type Props = { canEdit?: boolean };

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600';

function statusMeta(status?: string) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  if (s === 'APPROVED') return { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
  if (s === 'PENDING' || s === 'PENDING_REVIEW' || s === 'IN_APPEAL') return { label: s === 'IN_APPEAL' ? 'In appeal' : 'Pending review', cls: 'border-amber-200 bg-amber-50 text-amber-700', icon: <Clock3 className="h-3.5 w-3.5" /> };
  if (s === 'REJECTED') return { label: 'Rejected', cls: 'border-rose-200 bg-rose-50 text-rose-700', icon: <AlertCircle className="h-3.5 w-3.5" /> };
  if (s === 'PAUSED' || s === 'DISABLED' || s === 'PENDING_DELETION') return { label: s === 'PAUSED' ? 'Paused' : s === 'PENDING_DELETION' ? 'Pending deletion' : 'Disabled', cls: 'border-slate-200 bg-slate-100 text-slate-600', icon: <AlertCircle className="h-3.5 w-3.5" /> };
  return { label: s.replace(/_/g, ' '), cls: 'border-slate-200 bg-slate-50 text-slate-600', icon: <FileText className="h-3.5 w-3.5" /> };
}

function getVariables(text: string): number[] {
  const indexes = Array.from(String(text || '').matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
  return Array.from(new Set(indexes)).sort((a, b) => a - b);
}

export const WhatsAppTemplatesPanel: React.FC<Props> = ({ canEdit = false }) => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<'UTILITY' | 'MARKETING'>('UTILITY');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('Hello {{1}}, your booking {{2}} is confirmed. We will share further details soon.');
  const [footer, setFooter] = useState('');
  const [samples, setSamples] = useState<Record<number, string>>({ 1: 'Customer name', 2: 'BK-10025' });

  const variables = useMemo(() => getVariables(body), [body]);
  const variableKey = variables.join(',');
  useEffect(() => {
    setSamples((previous) => {
      const next: Record<number, string> = {};
      variables.forEach((index) => {
        next[index] = previous[index] || ('Example ' + index);
      });
      return next;
    });
  }, [variableKey]);

  const loadTemplates = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/whatsapp/templates/manage');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not load WhatsApp templates.');
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load WhatsApp templates.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const hasPending = templates.some((template) => ['PENDING', 'PENDING_REVIEW', 'IN_APPEAL'].includes(String(template.status || '').toUpperCase()));
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setTimeout(() => { void loadTemplates(true); }, 45000);
    return () => window.clearTimeout(timer);
  }, [hasPending, loadTemplates, templates]);

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((template) => {
      const status = String(template.status || 'UNKNOWN').toUpperCase();
      const matchesStatus = statusFilter === 'ALL' || status === statusFilter;
      const matchesQuery = !needle || [template.name, template.language, template.category, template.body].some((value) => String(value || '').toLowerCase().includes(needle));
      return matchesStatus && matchesQuery;
    });
  }, [templates, query, statusFilter]);

  const resetForm = () => {
    setName('');
    setLanguage('en_US');
    setCategory('UTILITY');
    setHeader('');
    setBody('Hello {{1}}, your booking {{2}} is confirmed. We will share further details soon.');
    setFooter('');
    setSamples({ 1: 'Customer name', 2: 'BK-10025' });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!canEdit) {
      setError('Only workspace admins can submit WhatsApp templates.');
      return;
    }
    const requiredSamples = variables.map((index) => String(samples[index] || '').trim());
    if (requiredSamples.some((value) => !value)) {
      setError('Add an example value for every variable so Meta can review the template.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/whatsapp/templates/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().toLowerCase(),
          language,
          category,
          header: header.trim(),
          body: body.trim(),
          footer: footer.trim(),
          samples: requiredSamples,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Meta could not accept the template submission.');
      const status = String(data?.template?.status || 'PENDING').toUpperCase();
      setNotice('Submitted to Meta. Current status: ' + status.replace(/_/g, ' ') + '. It will only be available to send after Meta approves it.');
      setIsCreateOpen(false);
      resetForm();
      await loadTemplates(true);
    } catch (e: any) {
      setError(e?.message || 'Template submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const approvedCount = templates.filter((template) => String(template.status || '').toUpperCase() === 'APPROVED').length;
  const pendingCount = templates.filter((template) => ['PENDING', 'PENDING_REVIEW', 'IN_APPEAL'].includes(String(template.status || '').toUpperCase())).length;
  const rejectedCount = templates.filter((template) => ['REJECTED', 'PAUSED', 'DISABLED'].includes(String(template.status || '').toUpperCase())).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><MessageCircle className="h-5 w-5" /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">WhatsApp Templates</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Create templates in Amaavigo, submit them to Meta for review, and track their live approval status. Only approved templates are eligible for sending.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadTemplates(true)} disabled={refreshing || loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={'h-4 w-4 ' + (refreshing ? 'animate-spin' : '')} /> Refresh status
          </button>
          {canEdit && <button type="button" onClick={() => { setError(null); setNotice(null); setIsCreateOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-orange-600">
            <Plus className="h-4 w-4" /> New template
          </button>}
        </div>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {notice && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span></div>}
      {!canEdit && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You can view template status, but only a workspace admin can create or submit templates.</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total templates</div><div className="mt-1 text-2xl font-bold text-slate-900">{templates.length}</div></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Approved / usable</div><div className="mt-1 text-2xl font-bold text-emerald-800">{approvedCount}</div></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Waiting for Meta</div><div className="mt-1 text-2xl font-bold text-amber-800">{pendingCount}</div></div>
      </div>
      {rejectedCount > 0 && <p className="text-xs text-slate-500">{rejectedCount} template(s) are rejected, paused, or disabled and are not available for sending.</p>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className={inputClass + ' pl-9'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search template name or message" />
        </div>
        <select className={inputClass + ' w-auto min-w-[170px]'} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
          <option value="PAUSED">Paused</option>
          <option value="DISABLED">Disabled</option>
          <option value="IN_APPEAL">In appeal</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates from Meta…</div>
      ) : templates.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <MessageCircle className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-base font-bold text-slate-800">No WhatsApp templates found</h3>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">Connect a WhatsApp Business account in Settings → Connected Channels, or create your first template after connecting one.</p>
          {canEdit && <button type="button" onClick={() => setIsCreateOpen(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"><Plus className="h-4 w-4" /> Create template</button>}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No templates match these filters.</div>
      ) : (
        <div className="space-y-3">
          {filteredTemplates.map((template) => {
            const status = statusMeta(template.status);
            return (
              <article key={(template.id || template.name) + '|' + template.language} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-all text-sm font-bold text-slate-900">{template.name}</h3>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{template.category || 'UNCATEGORIZED'}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{template.language}</span>
                      <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ' + status.cls}>{status.icon}{status.label}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">Meta template ID: {template.id || 'Not returned'}{template.qualityScore ? ' · Quality: ' + template.qualityScore : ''}</p>
                  </div>
                  {String(template.status || '').toUpperCase() === 'APPROVED'
                    ? <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Eligible for sending</span>
                    : <span className="text-xs font-medium text-slate-500">Not available for sending</span>}
                </div>
                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  {template.header && <p className="mb-1 text-xs font-semibold text-slate-700">{template.header}</p>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{template.body || '(No text body)'}</p>
                  {template.footer && <p className="mt-2 text-[11px] text-slate-500">{template.footer}</p>}
                </div>
                {template.rejectionReason && String(template.status || '').toUpperCase() === 'REJECTED' && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">Meta reason: {template.rejectionReason}</p>}
              </article>
            );
          })}
        </div>
      )}

      {isCreateOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Create WhatsApp template">
          <form onSubmit={handleSubmit} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h3 className="text-base font-bold text-slate-900">Create WhatsApp Template</h3><p className="mt-0.5 text-xs text-slate-500">Meta reviews the template before it can be used for sending.</p></div>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-2">
              <div className="space-y-4">
                <div><label className={labelClass}>Template name *</label><input className={inputClass} required value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_'))} maxLength={128} placeholder="booking_confirmation" /><p className="mt-1 text-[11px] text-slate-500">Use lowercase letters, numbers, and underscores. Names must be unique within this WhatsApp Business Account for the language.</p></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>Language *</label><select className={inputClass} value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en_US">English (US)</option><option value="en_GB">English (UK)</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="ur">Urdu</option><option value="fr">French</option><option value="es">Spanish</option></select></div>
                  <div><label className={labelClass}>Category *</label><select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as 'UTILITY' | 'MARKETING')}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option></select></div>
                </div>
                <div><label className={labelClass}>Header (optional)</label><input className={inputClass} value={header} onChange={(event) => setHeader(event.target.value)} maxLength={60} placeholder="Booking confirmed" /><p className="mt-1 text-[11px] text-slate-500">Text header only in this version; up to 60 characters.</p></div>
                <div><label className={labelClass}>Message body *</label><textarea className={inputClass + ' min-h-[130px]'} required value={body} onChange={(event) => setBody(event.target.value)} maxLength={1024} placeholder="Hello {{1}}, your booking {{2}} is confirmed." /><div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>Use numbered variables like {'{{1}}'} and {'{{2}}'}.</span><span>{body.length}/1024</span></div></div>
                {variables.length > 0 && <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-700">Example values required by Meta</p>{variables.map((index) => <div key={index}><label className="mb-1 block text-[11px] text-slate-600">{'Example for {{' + index + '}}'}</label><input className={inputClass} value={samples[index] || ''} onChange={(event) => setSamples((prev) => ({ ...prev, [index]: event.target.value }))} placeholder={'Example ' + index} /></div>)}</div>}
                <div><label className={labelClass}>Footer (optional)</label><input className={inputClass} value={footer} onChange={(event) => setFooter(event.target.value)} maxLength={60} placeholder="Thank you for choosing us." /></div>
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Message preview</p><span className="text-[10px] text-slate-400">Preview only</span></div>
                  <div className="ml-auto max-w-[330px] rounded-2xl rounded-tr-sm bg-emerald-50 p-3 shadow-sm">
                    {header && <p className="mb-2 text-sm font-bold text-slate-900">{header}</p>}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{body.replace(/\{\{(\d+)\}\}/g, (_match, index) => samples[Number(index)] || 'Example ' + index)}</p>
                    {footer && <p className="mt-2 text-[11px] text-slate-500">{footer}</p>}
                    <p className="mt-2 text-right text-[10px] text-slate-400">Just now</p>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">This preview is illustrative. Meta performs the actual review and assigns the template status.</p>
                </div>
                {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <p className="text-[11px] text-slate-500">Submission sends this template to the connected client's WhatsApp Business Account.</p>
              <div className="flex gap-2"><button type="button" onClick={() => setIsCreateOpen(false)} disabled={submitting} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" disabled={submitting || !name.trim() || !body.trim()} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for Meta approval</button></div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
