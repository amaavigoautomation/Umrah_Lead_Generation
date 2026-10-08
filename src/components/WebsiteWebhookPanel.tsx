import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Copy, Check, Loader2, RefreshCw, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface WebhookView {
  key: string;
  path: string;
  allowedOrigins: string[];
}

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const inputCls =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
const btnPrimary =
  'inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors';
const btnGhost =
  'inline-flex items-center gap-2 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 transition-colors';

const CopyBox: React.FC<{ label: string; text: string; multiline?: boolean }> = ({ label, text, multiline }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {}
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700">
          {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {done ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 overflow-x-auto ${multiline ? 'whitespace-pre' : 'whitespace-pre-wrap break-all'}`}>{text}</pre>
    </div>
  );
};

export const WebsiteWebhookPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const base = `/api/tenants/${encodeURIComponent(tenantId)}/webhook`;
  const [view, setView] = useState<WebhookView | null>(null);
  const [sites, setSites] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const apply = (v: WebhookView) => {
    setView(v);
    setSites(v.allowedOrigins.join('\n'));
  };

  const load = useCallback(async () => {
    try {
      apply(await api<WebhookView>(base));
    } catch (e: any) {
      setError(e.message);
    }
  }, [base]);

  useEffect(() => {
    if (canEdit) load();
  }, [canEdit, load]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!canEdit) return null;

  const url = view ? `${window.location.origin}${view.path}` : '';
  const siteList = sites.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const firstSite = view?.allowedOrigins[0] || 'yourwebsite.com';

  const fetchSnippet = `<form id="lead-form">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Email" required>
  <input name="phone" placeholder="Phone">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <button type="submit">Send</button>
  <p id="lead-msg"></p>
</form>
<script>
document.getElementById('lead-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const res = await fetch('${url}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  document.getElementById('lead-msg').textContent = res.ok ? 'Thank you! We will contact you shortly.' : 'Something went wrong. Please try again.';
  if (res.ok) e.target.reset();
});
</script>`;

  const plainSnippet = `<form action="${url}" method="POST">
  <input type="hidden" name="_redirect" value="https://${firstSite}/thank-you">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Email" required>
  <input name="phone" placeholder="Phone">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <button type="submit">Send</button>
</form>`;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
          <Globe className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Website leads</h3>
          <p className="text-sm text-slate-500">Send contact-form submissions from your website straight into this workspace.</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {!view ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          <div>
            <div className="text-sm font-semibold text-slate-800 mb-1">1. Your webhook link</div>
            <CopyBox label="Give this to whoever manages your website" text={url} />
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-800 mb-1">2. Websites allowed to send leads</div>
            <p className="text-xs text-slate-500 mb-2">One per line, for example <span className="font-mono">yourwebsite.com</span>. Until you add one, every request is rejected.</p>
            <textarea value={sites} onChange={(e) => setSites(e.target.value)} rows={3} className={`${inputCls} font-mono`} placeholder="yourwebsite.com" />
            <div className="mt-2">
              <button
                className={btnPrimary}
                disabled={busy !== null}
                onClick={() =>
                  run('save', async () => {
                    apply(await api<WebhookView>(base, { method: 'POST', body: JSON.stringify({ allowedOrigins: siteList }) }));
                    setNotice('Allowed websites saved.');
                  })
                }
              >
                {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save websites
              </button>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-800 mb-1">3. Add the form to your website</div>
            <div className="space-y-3">
              <CopyBox label="Recommended: shows a thank-you message on the same page" text={fetchSnippet} multiline />
              <CopyBox label="Simpler: plain HTML form that sends visitors to your thank-you page" text={plainSnippet} multiline />
              <p className="text-xs text-slate-500">Using WordPress, Wix, Webflow or a form plugin? Paste the webhook link into its "webhook URL" or "send form data to" setting instead.</p>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-800 mb-1">4. Test it</div>
            <p className="text-xs text-slate-500 mb-2">Sends a sample lead to your inbox. The thank-you email goes to your own address.</p>
            <button
              className={btnGhost}
              disabled={busy !== null || view.allowedOrigins.length === 0}
              title={view.allowedOrigins.length === 0 ? 'Save a website first' : undefined}
              onClick={() =>
                run('test', async () => {
                  await api(`${base}/test`, { method: 'POST' });
                  setNotice('Test lead sent. Check Unified Inbox in a few seconds.');
                })
              }
            >
              {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send test lead
            </button>
          </div>

          <div className="pt-4 border-t border-slate-100">
            {!confirmRegen ? (
              <button className={btnGhost} onClick={() => setConfirmRegen(true)} disabled={busy !== null}>
                <RefreshCw className="w-4 h-4" /> Regenerate link
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-slate-700">The old link stops working at once. Forms using it must be updated.</span>
                <button
                  className={btnPrimary}
                  disabled={busy !== null}
                  onClick={() =>
                    run('regen', async () => {
                      apply(await api<WebhookView>(`${base}/regenerate`, { method: 'POST' }));
                      setConfirmRegen(false);
                      setNotice('New link created. Update your website forms.');
                    })
                  }
                >
                  {busy === 'regen' ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Yes, regenerate
                </button>
                <button className={btnGhost} onClick={() => setConfirmRegen(false)}>Cancel</button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};