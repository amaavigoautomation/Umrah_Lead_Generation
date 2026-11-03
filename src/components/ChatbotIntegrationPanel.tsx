import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, Eye, EyeOff, Loader2, RefreshCw, Save, ShieldCheck, Code2, MessageSquareText } from 'lucide-react';

type ResponseLength = 'short' | 'balanced' | 'detailed';
type BubbleMode = 'single' | 'auto' | 'two' | 'three';
type Tone = 'professional' | 'friendly' | 'casual';

interface ChatbotPreferences {
  responseLength: ResponseLength;
  bubbleMode: BubbleMode;
  tone: Tone;
  language: string;
  additionalInstructions: string;
}
interface IntegrationView {
  webhookId: string;
  path: string;
  apiSecret: string;
  preferences: ChatbotPreferences;
  createdAt: string;
}

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed (' + response.status + ')');
  return data as T;
}

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/10 disabled:bg-slate-50';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

const CopyValue: React.FC<{ label: string; value: string; multiline?: boolean }> = ({ label, value, multiline }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={'overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 ' + (multiline ? 'whitespace-pre' : 'whitespace-pre-wrap break-all')}>{value}</pre>
    </div>
  );
};

export const ChatbotIntegrationPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const endpoint = '/api/tenants/' + encodeURIComponent(tenantId) + '/webhook/chatbot';
  const [view, setView] = useState<IntegrationView | null>(null);
  const [preferences, setPreferences] = useState<ChatbotPreferences>({
    responseLength: 'balanced', bubbleMode: 'auto', tone: 'friendly', language: 'auto', additionalInstructions: '',
  });
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const applyView = (next: IntegrationView) => {
    setView(next);
    setPreferences(next.preferences);
  };
  const load = useCallback(async () => {
    if (!canEdit) return;
    setLoading(true);
    setError(null);
    try {
      applyView(await api<IntegrationView>(endpoint));
    } catch (err: any) {
      setError(err?.message || 'Could not load chatbot integration.');
    } finally {
      setLoading(false);
    }
  }, [canEdit, endpoint]);
  useEffect(() => { load(); }, [load]);

  const webhookUrl = useMemo(
    () => view ? new URL(view.path, window.location.origin).toString() : '',
    [view],
  );
  const integrationSnippet = useMemo(() => [
    '// Run this from your chatbot backend, not browser-side JavaScript.',
    'const webhookUrl = process.env.AMAAVIGO_CHATBOT_WEBHOOK_URL;',
    'const apiSecret = process.env.AMAAVIGO_CHATBOT_API_SECRET;',
    '',
    'export async function getChatbotReply({ message, conversationId, history, visitor }) {',
    '  const response = await fetch(webhookUrl, {',
    '    method: "POST",',
    '    headers: {',
    '      "Content-Type": "application/json",',
    '      "Authorization": "Bearer " + apiSecret',
    '    },',
    '    body: JSON.stringify({ message, conversationId, history, visitor })',
    '  });',
    '  const data = await response.json();',
    '  if (!response.ok) throw new Error(data.error || "Chatbot request failed");',
    '  return data; // Render data.messages as separate chat bubbles.',
    '}',
  ].join('\n'), []);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || 'The request could not be completed.');
    } finally {
      setBusy(null);
    }
  };
  const savePreferences = () => run('save', async () => {
    const next = await api<IntegrationView>(endpoint, { method: 'POST', body: JSON.stringify({ preferences }) });
    applyView(next);
    setNotice('Chatbot response settings saved.');
  });
  const testConnection = () => run('test', async () => {
    if (!view || !webhookUrl) throw new Error('Webhook details are not ready.');
    const response = await fetch(webhookUrl, { headers: { Authorization: 'Bearer ' + view.apiSecret } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Webhook verification failed.');
    setNotice('Webhook URL and API secret are valid. No AI request or token usage was generated by this test.');
  });
  const rotateCredentials = () => run('rotate', async () => {
    const next = await api<IntegrationView>(endpoint + '/rotate', { method: 'POST' });
    applyView(next);
    setShowSecret(false);
    setConfirmRotate(false);
    setNotice('New webhook URL and API secret created. The previous credentials have been disabled.');
  });

  if (!canEdit) return null;
  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Bot className="h-5 w-5" /></div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Website chatbot integration</h3>
          <p className="mt-1 text-sm text-slate-500">Connect your existing website chatbot to this workspace's AI and approved Knowledge Base.</p>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading chatbot integration…</div>
      ) : view ? (
        <>
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Tenant-specific webhook credentials</div>
            <CopyValue label="Webhook URL" value={webhookUrl} />
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600">API secret · keep private</span>
                <button type="button" onClick={() => setShowSecret((value) => !value)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{showSecret ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 break-all">
                  {showSecret ? view.apiSecret : '••••••••••••••••••••••••••••••••'}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(view.apiSecret);
                      setNotice('API secret copied to clipboard.');
                    } catch {
                      setError('Could not copy the API secret. Please reveal and copy it manually.');
                    }
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={secondaryButton} disabled={busy !== null} onClick={testConnection}>
                {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Verify connection
              </button>
              {!confirmRotate ? (
                <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => setConfirmRotate(true)}><RefreshCw className="h-4 w-4" /> Rotate credentials</button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  Rotating disables the old URL and secret immediately.
                  <button type="button" className={primaryButton} disabled={busy !== null} onClick={rotateCredentials}>{busy === 'rotate' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm rotation</button>
                  <button type="button" className={secondaryButton} onClick={() => setConfirmRotate(false)}>Cancel</button>
                </div>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">Use this endpoint from your chatbot server or a trusted automation backend. Do not put the API secret in public website JavaScript, page source, or a browser widget. Store it as a server-side environment variable.</p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><MessageSquareText className="h-4 w-4 text-orange-600" /> AI response behaviour</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Response length
                <select className={inputClass + ' mt-1'} value={preferences.responseLength} onChange={(event) => setPreferences({ ...preferences, responseLength: event.target.value as ResponseLength })}>
                  <option value="short">Short</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Message bubble format
                <select className={inputClass + ' mt-1'} value={preferences.bubbleMode} onChange={(event) => setPreferences({ ...preferences, bubbleMode: event.target.value as BubbleMode })}>
                  <option value="single">Single bubble</option><option value="auto">Automatic (1–3 bubbles)</option><option value="two">Two bubbles</option><option value="three">Three bubbles</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Response tone
                <select className={inputClass + ' mt-1'} value={preferences.tone} onChange={(event) => setPreferences({ ...preferences, tone: event.target.value as Tone })}>
                  <option value="friendly">Friendly</option><option value="professional">Professional</option><option value="casual">Casual</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Response language
                <select className={inputClass + ' mt-1'} value={preferences.language} onChange={(event) => setPreferences({ ...preferences, language: event.target.value })}>
                  <option value="auto">Automatic · match visitor</option><option value="English">English</option><option value="Hindi">Hindi</option><option value="Urdu">Urdu</option><option value="Arabic">Arabic</option><option value="Marathi">Marathi</option><option value="Gujarati">Gujarati</option><option value="Bengali">Bengali</option><option value="Tamil">Tamil</option><option value="Telugu">Telugu</option><option value="Kannada">Kannada</option><option value="Malayalam">Malayalam</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-700">Additional instructions
              <textarea className={inputClass + ' mt-1'} rows={4} maxLength={2000} value={preferences.additionalInstructions} onChange={(event) => setPreferences({ ...preferences, additionalInstructions: event.target.value })} placeholder="For example: use simple words, avoid long introductions, use emojis sparingly…" />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">Response length and bubble count are independent. These preferences apply to new chatbot replies.</p>
              <button type="button" className={primaryButton} disabled={busy !== null} onClick={savePreferences}>
                {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save response settings
              </button>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Code2 className="h-4 w-4 text-slate-600" /> Integration example</div>
            <CopyValue label="Node.js server-side example" value={integrationSnippet} multiline />
            <p className="text-[11px] leading-relaxed text-slate-500">Send a POST request with a visitor message. Include the same conversationId and recent history on later turns. Render each item in <code>data.messages</code> as its own chat bubble.</p>
          </div>
        </>
      ) : <div className="text-sm text-slate-500">Chatbot integration is not available right now.</div>}
    </section>
  );
};
