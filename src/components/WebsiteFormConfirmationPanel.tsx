import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Mail, MessageCircle, RefreshCw, Save, ShieldCheck } from 'lucide-react';

type ChannelChoice = 'EMAIL' | 'WHATSAPP' | 'BOTH';
type FieldChoice = 'firstName' | 'fullName' | 'company' | 'email' | 'phone' | 'product' | 'teamSize' | 'city' | 'country' | 'message';
type FormSettings = {
  channel: ChannelChoice;
  emailTemplateId: string;
  whatsappTemplateName: string;
  whatsappLanguage: string;
  whatsappParameterMapping: FieldChoice[];
  requireWhatsAppOptIn: true;
  updatedAt?: string;
};
type EmailTemplate = { templateId: string; name: string; subject?: string; purpose?: string };
type WhatsAppTemplate = { name: string; language: string; body: string; paramCount: number; category?: string; status?: string };

const DEFAULT_SETTINGS: FormSettings = {
  channel: 'EMAIL',
  emailTemplateId: 'website-form-thankyou-default',
  whatsappTemplateName: '',
  whatsappLanguage: '',
  whatsappParameterMapping: [],
  requireWhatsAppOptIn: true,
};
const FIELDS: Array<{ value: FieldChoice; label: string }> = [
  { value: 'firstName', label: 'First name' },
  { value: 'fullName', label: 'Full name' },
  { value: 'company', label: 'Company' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'product', label: 'Product / interest' },
  { value: 'teamSize', label: 'Team size' },
  { value: 'city', label: 'City' },
  { value: 'country', label: 'Country' },
  { value: 'message', label: 'Message' },
];

async function readJson(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || ('Request failed (' + response.status + ')'));
  return data;
}

export const WebsiteFormConfirmationPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const [settings, setSettings] = useState<FormSettings>(DEFAULT_SETTINGS);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingWhatsApp, setRefreshingWhatsApp] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configuration, whatsapp] = await Promise.all([
        readJson('/api/website-form-confirmations/settings'),
        readJson('/api/whatsapp/templates').catch(() => ({ templates: [] })),
      ]);
      setSettings({ ...DEFAULT_SETTINGS, ...(configuration.settings || {}) });
      setEmailTemplates(Array.isArray(configuration.emailTemplates) ? configuration.emailTemplates : []);
      setWhatsappTemplates(Array.isArray(whatsapp.templates) ? whatsapp.templates : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load website confirmation settings.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const wantsEmail = settings.channel === 'EMAIL' || settings.channel === 'BOTH';
  const wantsWhatsApp = settings.channel === 'WHATSAPP' || settings.channel === 'BOTH';
  const selectedWhatsApp = useMemo(
    () => whatsappTemplates.find((item) => item.name === settings.whatsappTemplateName && item.language === settings.whatsappLanguage && String(item.category || '').toUpperCase() === 'UTILITY'),
    [whatsappTemplates, settings.whatsappTemplateName, settings.whatsappLanguage],
  );

  const refreshWhatsApp = async () => {
    setRefreshingWhatsApp(true);
    setError('');
    try {
      const data = await readJson('/api/whatsapp/templates');
      setWhatsappTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (e: any) {
      setError(e?.message || 'Could not refresh approved WhatsApp templates.');
    } finally {
      setRefreshingWhatsApp(false);
    }
  };

  const changeWhatsAppTemplate = (value: string) => {
    const [name, language] = value.split('::');
    const match = whatsappTemplates.find((item) => item.name === name && item.language === language);
    setSettings((current) => ({
      ...current,
      whatsappTemplateName: match?.name || '',
      whatsappLanguage: match?.language || '',
      whatsappParameterMapping: match
        ? Array.from({ length: Math.max(0, Number(match.paramCount || 0)) }, (_, index) => current.whatsappParameterMapping[index] || '')
        : [],
    }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/website-form-confirmations/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, requireWhatsAppOptIn: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data?.error || 'Could not save website confirmation settings.');
      setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || settings) });
      setNotice('Website Form Thank-you settings saved for this workspace.');
    } catch (e: any) {
      setError(e?.message || 'Could not save website confirmation settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Mail className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900">Website Form Thank-you Automation</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Choose the confirmation channel and tenant-owned templates used after every website form submission. This runs independently from AI auto-replies.</p>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Loading workspace settings…</div>
      ) : (
        <>
          <div>
            <label className="mb-2 block text-xs font-bold text-slate-700">Send confirmation through</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                ['EMAIL', 'Email', Mail, 'Send the saved thank-you email'],
                ['WHATSAPP', 'WhatsApp', MessageCircle, 'Send an approved WhatsApp template'],
                ['BOTH', 'Both channels', ShieldCheck, 'Send Email and WhatsApp independently'],
              ] as const).map(([value, label, Icon, description]) => (
                <button
                  key={value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setSettings((current) => ({ ...current, channel: value }))}
                  className={'rounded-xl border p-3 text-left transition ' + (settings.channel === value ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-100' : 'border-slate-200 hover:bg-slate-50')}
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-800"><Icon className="h-4 w-4 text-orange-600" />{label}</span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{description}</span>
                </button>
              ))}
            </div>
          </div>

          {wantsEmail && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Mail className="h-4 w-4 text-orange-600" />Email thank-you template</div>
              <select
                disabled={!canEdit}
                value={settings.emailTemplateId}
                onChange={(event) => setSettings((current) => ({ ...current, emailTemplateId: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
              >
                {emailTemplates.map((template) => <option key={template.templateId} value={template.templateId}>{template.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-500">Create or edit these designs in Template Studio → Website Form Thank-you. Personalization fields: {{first_name}}, {{full_name}}, {{company}}, {{email}}, {{phone}}, {{product}}, {{team_size}}, {{city}}, {{country}}, {{message}}.</p>
              {!emailTemplates.length && <p className="text-xs text-amber-700">No Website Form Thank-you templates are available yet. The default template is created automatically when settings load.</p>}
            </div>
          )}

          {wantsWhatsApp && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><MessageCircle className="h-4 w-4 text-emerald-600" />Approved WhatsApp template</div>
                <button type="button" onClick={refreshWhatsApp} disabled={refreshingWhatsApp || !canEdit} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"><RefreshCw className={'h-3.5 w-3.5 ' + (refreshingWhatsApp ? 'animate-spin' : '')} />Refresh</button>
              </div>
              <select
                disabled={!canEdit}
                value={settings.whatsappTemplateName ? settings.whatsappTemplateName + '::' + settings.whatsappLanguage : ''}
                onChange={(event) => changeWhatsAppTemplate(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="">Select an approved Meta template</option>
                {whatsappTemplates.filter((template) => String(template.category || '').toUpperCase() === 'UTILITY').map((template) => <option key={template.name + '::' + template.language} value={template.name + '::' + template.language}>{template.name} · {template.language} · {template.paramCount} variables</option>)}
              </select>
              {selectedWhatsApp && selectedWhatsApp.paramCount > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Map each WhatsApp body placeholder to a submitted form field.</p>
                  {Array.from({ length: selectedWhatsApp.paramCount }, (_, index) => (
                    <label key={index} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[120px_1fr]">
                      <span className="text-xs font-medium text-slate-600">{'{{' + (index + 1) + '}}'}</span>
                      <select
                        disabled={!canEdit}
                        value={settings.whatsappParameterMapping[index] || ''}
                        onChange={(event) => setSettings((current) => {
                          const mapping = [...current.whatsappParameterMapping];
                          mapping[index] = event.target.value as FieldChoice;
                          return { ...current, whatsappParameterMapping: mapping };
                        })}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="">Choose a form field</option>
                        {FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                WhatsApp is sent only when the website visitor explicitly checks the WhatsApp consent checkbox. The form examples include <code>name="whatsapp_opt_in"</code>. Sending uses only a currently approved Meta template.
              </div>
              {!whatsappTemplates.length && <p className="text-xs text-slate-500">Connect WhatsApp and approve a Utility template in Template Studio → WhatsApp Templates to enable this channel.</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="max-w-xl text-[11px] leading-relaxed text-slate-500">Website channel AUTO sends the selected confirmation, REVIEW queues it for approval in Unified Inbox, and OFF suppresses all confirmations.</p>
            <button type="button" onClick={save} disabled={!canEdit || saving || (wantsEmail && !settings.emailTemplateId) || (wantsWhatsApp && (!settings.whatsappTemplateName || !settings.whatsappLanguage))} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save confirmation settings
            </button>
          </div>
        </>
      )}
    </section>
  );
};
