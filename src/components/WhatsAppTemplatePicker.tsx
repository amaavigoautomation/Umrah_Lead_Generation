import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Send } from 'lucide-react';

type Template = { name: string; language: string; category?: string; body: string; paramCount: number };

interface Props {
  onClose: () => void;
  onSend: (template: { name: string; language: string; params: string[] }) => Promise<boolean>;
  defaultFirstParam?: string;
}

export const WhatsAppTemplatePicker: React.FC<Props> = ({ onClose, onSend, defaultFirstParam }) => {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/templates');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load templates.');
        if (cancelled) return;
        setTemplates(data.templates || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load templates.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const key = (t: Template) => `${t.name}|${t.language}`;
  const selected = templates?.find((t) => key(t) === selectedKey) || null;

  const choose = (k: string) => {
    setSelectedKey(k);
    const t = templates?.find((x) => key(x) === k);
    const initial = Array.from({ length: t?.paramCount || 0 }, (_v, i) => (i === 0 ? defaultFirstParam || '' : ''));
    setParams(initial);
  };

  const preview = selected
    ? selected.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] || `{{${n}}}`)
    : '';
  const ready = Boolean(selected) && params.every((p) => p.trim());

  const send = async () => {
    if (!selected || !ready) return;
    setSending(true);
    const ok = await onSend({ name: selected.name, language: selected.language, params: params.map((p) => p.trim()) });
    setSending(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3 text-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-sm">Send WhatsApp template</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-slate-500">Approved templates can be sent at any time, including after the 24-hour reply window has closed.</p>

        {error && <p className="text-xs font-semibold text-rose-700">{error}</p>}
        {!templates && !error && (
          <p className="text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading templates…</p>
        )}
        {templates && templates.length === 0 && (
          <p className="text-xs text-slate-600">No approved templates yet. Create and submit one in WhatsApp Manager (Meta Business Suite); once Meta approves it, it will appear here.</p>
        )}
        {templates && templates.length > 0 && (
          <div className="space-y-3">
            <select value={selectedKey} onChange={(e) => choose(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={key(t)} value={key(t)}>{t.name} ({t.language})</option>
              ))}
            </select>
            {selected && (
              <>
                {params.map((value, i) => (
                  <input
                    key={i}
                    value={value}
                    onChange={(e) => setParams((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                    placeholder={`Value for {{${i + 1}}}`}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:border-orange-500"
                  />
                ))}
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-xs whitespace-pre-wrap text-emerald-900">{preview}</div>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={send} disabled={!ready || sending} className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50">
            {sending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send template
          </button>
        </div>
      </div>
    </div>
  );
};
