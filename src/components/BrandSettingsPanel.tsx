import React, { useEffect, useState } from 'react';
import {
  Building2, Globe, Sparkles, Save, Loader2, CheckCircle2, AlertTriangle,
  ExternalLink, Palette, BookOpen, X, Image as ImageIcon,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { CompanyAssetsPanel } from './CompanyAssetsPanel';
import type { CompanyAsset } from '../types';

const inputCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 disabled:bg-slate-50 disabled:text-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block min-w-0">
    <span className={labelCls}>{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

export const BrandSettingsPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const { brand, setBrand } = useBrand();
  const [draft, setDraft] = useState<TenantBrand>(brand);
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [metadata, setMetadata] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAssets, setShowAssets] = useState(false);

  useEffect(() => setDraft(brand), [brand]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/tenants/' + encodeURIComponent(tenantId) + '/company-profile');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load company profile.');
        if (!active) return;
        if (data.brand) setDraft(data.brand);
        setMetadata(data.metadata || null);
        setKnowledgeContent(data.knowledgeContent || '');
      } catch (loadError: any) {
        if (active) setError(loadError && loadError.message ? loadError.message : 'Could not load company profile.');
      } finally {
        if (active) setLoading(false);
      }
    };
    if (tenantId) void load();
    return () => { active = false; };
  }, [tenantId]);

  const set = <K extends keyof TenantBrand>(key: K, value: TenantBrand[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const text = (key: keyof TenantBrand, label: string, placeholder = '', hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        disabled={!canEdit || busy}
        placeholder={placeholder}
        value={String(draft[key] || '')}
        onChange={(event) => set(key, event.target.value as any)}
      />
    </Field>
  );

  const updateSocialLink = (platform: string, value: string) => {
    set('socialLinks', { ...(draft.socialLinks || {}), [platform]: value } as any);
  };

  const analyzeWebsite = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setAnalysis(null);
    try {
      const response = await fetch('/api/tenants/' + encodeURIComponent(tenantId) + '/company-profile/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: draft.websiteUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Website analysis failed.');
      const result = data.analysis;
      if (!result || !result.brandProfile) throw new Error('The website analyzer returned an incomplete company profile.');
      setAnalysis(result);
      setKnowledgeContent(result.knowledgeContent || '');
      setDraft((current) => ({
        ...current,
        websiteUrl: result.brandProfile.websiteUrl || current.websiteUrl,
        companyName: result.brandProfile.companyName || current.companyName,
        tagline: result.brandProfile.tagline || current.tagline,
        companyDescription: result.companyDescription || result.brandProfile.description || current.companyDescription || '',
        industryDescription: [result.industry, result.targetAudience ? 'Target audience: ' + result.targetAudience : ''].filter(Boolean).join(' — ') || current.industryDescription,
        defaultProduct: result.structuredData && result.structuredData.productsAndServices && result.structuredData.productsAndServices[0]
          ? (result.structuredData.productsAndServices[0].name || current.defaultProduct)
          : current.defaultProduct,
        salesEmail: result.brandProfile.contactEmail || current.salesEmail,
        supportPhone: result.brandProfile.contactPhone || current.supportPhone,
        logoUrl: result.brandProfile.logoUrl || current.logoUrl,
        primaryColor: result.brandProfile.colors && result.brandProfile.colors[0] || current.primaryColor || '',
        secondaryColor: result.brandProfile.colors && result.brandProfile.colors[1] || current.secondaryColor || '',
        accentColor: result.brandProfile.colors && result.brandProfile.colors[2] || current.accentColor || '',
        headingFontFamily: result.headingFontFamily || current.headingFontFamily || '',
        bodyFontFamily: result.bodyFontFamily || current.bodyFontFamily || '',
        brandVoice: result.brandVoice || current.brandVoice || '',
        socialLinks: { ...(current.socialLinks || {}), ...(result.brandProfile.socialLinks || {}) },
      }));
      setNotice('Analyzed ' + ((result.pagesScanned && result.pagesScanned.length) || 1) + ' relevant website page(s). Review the extracted facts and save to approve them.');
    } catch (analysisError: any) {
      setError(analysisError && analysisError.message ? analysisError.message : 'Website analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/tenants/' + encodeURIComponent(tenantId) + '/company-profile/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: draft, analysis, knowledgeContent }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save company profile.');
      setBrand(data.brand);
      setDraft(data.brand);
      setMetadata(data.metadata || null);
      setKnowledgeContent(data.knowledgeContent || knowledgeContent);
      setAnalysis(null);
      setNotice('Company profile saved. Approved website knowledge is now published to this workspace knowledge base.');
    } catch (saveError: any) {
      setError(saveError && saveError.message ? saveError.message : 'Could not save company profile.');
    } finally {
      setBusy(false);
    }
  };

  const colors: Array<{ key: 'primaryColor' | 'secondaryColor' | 'accentColor'; label: string }> = [
    { key: 'primaryColor', label: 'Primary' },
    { key: 'secondaryColor', label: 'Secondary' },
    { key: 'accentColor', label: 'Accent' },
  ];
  const socialPlatforms = ['instagram', 'facebook', 'linkedin', 'youtube', 'x'];

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-orange-600"><Building2 className="w-5 h-5" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Workspace identity</span></div>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-1">Company Profile</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">Analyze your public website once, review the extracted company facts, and approve them for the workspace knowledge base.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={'inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold border ' + (metadata && metadata.analyzedAt ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500')}>
            <CheckCircle2 className="w-3.5 h-3.5" />{metadata && metadata.analyzedAt ? 'Website analyzed' : 'Not analyzed yet'}
          </span>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}
      {notice && <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />{notice}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
        <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-orange-600" /><h2 className="text-sm font-bold text-slate-900">Company website</h2></div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="Website URL" hint="We inspect the homepage and a small set of relevant same-domain pages such as About, Services, Pricing, FAQ and Contact.">
            <input className={inputCls} disabled={!canEdit || busy} type="url" placeholder="https://www.yourcompany.com" value={draft.websiteUrl || ''} onChange={(event) => set('websiteUrl', event.target.value)} />
          </Field>
          {canEdit && <button type="button" onClick={analyzeWebsite} disabled={busy || loading || !draft.websiteUrl || !draft.websiteUrl.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {metadata && metadata.analyzedAt ? 'Refresh website analysis' : 'Analyze website'}
          </button>}
        </div>
        {metadata && metadata.analyzedAt && <p className="text-[11px] text-slate-400">Last approved analysis: {new Date(metadata.analyzedAt).toLocaleString()} · {(metadata.pagesScanned || []).length || 1} page(s) scanned</p>}
        {!canEdit && <p className="text-xs text-slate-500">Only workspace admins can analyze or change the company profile. You can view the approved information below.</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-orange-600" /><h2 className="text-sm font-bold text-slate-900">Company details</h2></div>
        {loading ? <div className="py-8 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading company profile…</div> : <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {text('companyName', 'Company name', 'Your company')}
            {text('tagline', 'Tagline / short description', 'What your company does')}
            {text('industryDescription', 'Industry and target audience', 'Industry; target customers')}
            {text('defaultProduct', 'Main product / service', 'Primary product or service')}
            {text('salesEmail', 'Business contact email', 'hello@company.com')}
            {text('supportPhone', 'Business phone / WhatsApp', '+91 …')}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
              {text('logoUrl', 'Logo URL', 'https://…/logo.png', 'Use the website-detected logo or choose an approved Company Asset.')}
              {canEdit && <button type="button" onClick={() => setShowAssets(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-orange-300"><ImageIcon className="w-4 h-4" />Choose asset</button>}
            </div>
          </div>
          <Field label="Company description">
            <textarea className={inputCls + ' min-h-[100px] resize-y'} disabled={!canEdit || busy} value={draft.companyDescription || ''} onChange={(event) => set('companyDescription', event.target.value)} placeholder="A verified description of the company, its offering and value proposition." />
          </Field>
        </>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-2"><Palette className="w-4 h-4 text-orange-600" /><h2 className="text-sm font-bold text-slate-900">Brand identity</h2></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {colors.map(({ key, label }) => <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-medium text-slate-600">{label} colour</span>
            <span className="flex items-center gap-2"><span className="text-[10px] font-mono text-slate-400">{draft[key] || 'Not detected'}</span><input aria-label={label + ' brand colour'} disabled={!canEdit || busy} type="color" value={/^#[0-9a-fA-F]{6}$/.test(draft[key] || '') ? draft[key] : '#183B66'} onChange={(event) => set(key, event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0 disabled:opacity-50" /></span>
          </label>)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {text('headingFontFamily', 'Heading font', 'Arial, sans-serif')}
          {text('bodyFontFamily', 'Body font', 'Arial, sans-serif')}
        </div>
        <Field label="Brand voice and communication style" hint="Review the detected writing style or add your preferred instructions for future AI-generated content.">
          <textarea className={inputCls + ' min-h-[88px] resize-y'} disabled={!canEdit || busy} value={draft.brandVoice || ''} onChange={(event) => set('brandVoice', event.target.value)} placeholder="For example: warm, trustworthy, concise and premium." />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {socialPlatforms.map((platform) => <Field key={platform} label={platform.charAt(0).toUpperCase() + platform.slice(1) + ' URL'}>
            <input className={inputCls} disabled={!canEdit || busy} value={(draft.socialLinks && draft.socialLinks[platform]) || ''} onChange={(event) => updateSocialLink(platform, event.target.value)} placeholder={'https://' + platform + '.com/…'} />
          </Field>)}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-3 shadow-sm">
        <div className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-orange-600" /><h2 className="text-sm font-bold text-slate-900">Company knowledge review</h2></div>
        <p className="text-xs text-slate-500">Products and services, published pricing, FAQs, policies, booking details and key facts are combined into one searchable tenant knowledge document. Review or correct it before approving.</p>
        {(analysis && analysis.counts || metadata && metadata.counts) && <div className="flex flex-wrap gap-2">{Object.entries((analysis && analysis.counts) || metadata.counts || {}).map(([key, value]) => <span key={key} className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600"><strong>{String(value)}</strong> {key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>)}</div>}
        <textarea className={inputCls + ' min-h-[300px] resize-y font-mono text-xs leading-relaxed'} disabled={!canEdit || busy} value={knowledgeContent} onChange={(event) => setKnowledgeContent(event.target.value)} placeholder="Run website analysis to draft your company knowledge. You can edit the extracted facts or add other verified business information." />
        <p className="text-[11px] text-slate-400">Website content is not published automatically. It enters the knowledge base only after an admin saves the approved profile.</p>
      </div>

      {canEdit && <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-[11px] text-slate-400">Saving publishes the reviewed knowledge to this tenant only. It does not send campaigns or messages.</div>
        <button type="button" onClick={save} disabled={busy || loading} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-3 shadow-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save &amp; approve company profile
        </button>
      </div>}
      {metadata && metadata.websiteUrl && <a href={metadata.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-orange-700"><ExternalLink className="w-3 h-3" />Open analyzed website</a>}

      {showAssets && <div className="fixed inset-0 z-[95] bg-slate-950/50 flex items-center justify-center p-3">
        <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
            <div className="text-sm font-bold text-slate-900">Choose from Company Assets</div>
            <button type="button" onClick={() => setShowAssets(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-4"><CompanyAssetsPanel isDrawerMode onSelectAsset={(asset: CompanyAsset) => { set('logoUrl', asset.url); setShowAssets(false); }} /></div>
        </div>
      </div>}
    </div>
  );
};
