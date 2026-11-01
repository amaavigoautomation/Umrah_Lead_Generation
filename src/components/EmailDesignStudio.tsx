import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUp, ArrowDown, Check, Code2, Copy, Eye, FileImage, Heading1, ImagePlus,
  LayoutTemplate, Mail, Monitor, Palette, Plus, Save, Search, Smartphone, Sparkles, Trash2,
  Type, X, MousePointerClick, Minus, Link2, Loader2, Star, FolderOpen, AlignLeft,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import { CompanyAssetsPanel } from './CompanyAssetsPanel';
import type { CompanyAsset } from '../types';
import {
  createBlankEmailDesignTemplate, createEmailDesignBlockId, createEmailDesignHtmlSource, PREDEFINED_EMAIL_DESIGNS,
  SAMPLE_EMAIL_CONTENT, renderEmailDesignHtml, validateEmailDesignHtml, type EmailBrandProfile, type EmailDesignBlock,
  type EmailDesignBlockType, type EmailDesignTemplate, type EmailDesignTheme,
} from '../shared/emailDesign';

type StudioTab = 'gallery' | 'my-designs';
type EditorPanel = 'blocks' | 'styles';
type PreviewMode = 'desktop' | 'mobile';
type EditorMode = 'visual' | 'html';

const CATEGORY_FILTERS = ['All', ...Array.from(new Set(PREDEFINED_EMAIL_DESIGNS.map((item) => item.category)))];
const BLOCK_OPTIONS: Array<{ type: EmailDesignBlockType; label: string; description: string; icon: React.ReactNode }> = [
  { type: 'logo', label: 'Brand header', description: 'Logo, brand name and header styling', icon: <LayoutTemplate className="h-4 w-4" /> },
  { type: 'hero', label: 'Hero banner', description: 'A styled headline and supporting introduction', icon: <Sparkles className="h-4 w-4" /> },
  { type: 'heading', label: 'Heading', description: 'A clear section heading', icon: <Heading1 className="h-4 w-4" /> },
  { type: 'text', label: 'Text', description: 'Supporting text or a short label', icon: <Type className="h-4 w-4" /> },
  { type: 'image', label: 'Image', description: 'Insert a brand image or banner', icon: <ImagePlus className="h-4 w-4" /> },
  { type: 'button', label: 'Button', description: 'Add a linked call-to-action', icon: <MousePointerClick className="h-4 w-4" /> },
  { type: 'divider', label: 'Divider', description: 'Separate content sections', icon: <Minus className="h-4 w-4" /> },
  { type: 'spacer', label: 'Spacer', description: 'Control vertical rhythm', icon: <AlignLeft className="h-4 w-4" /> },
  { type: 'social', label: 'Social links', description: 'Add social destinations', icon: <Link2 className="h-4 w-4" /> },
  { type: 'footer', label: 'Company footer', description: 'Company details and contact links', icon: <Mail className="h-4 w-4" /> },
];

const HTML_INSERT_OPTIONS = [
  { label: 'Message content', value: '{{content}}', description: 'Required. Inserts the AI or manually written email message.' },
  { label: 'Company name', value: '{{companyName}}', description: 'Your workspace company name.' },
  { label: 'Company tagline', value: '{{tagline}}', description: 'Your workspace tagline.' },
  { label: 'Website URL', value: '{{websiteUrl}}', description: 'Your workspace website URL.' },
];
const HTML_CTA_SNIPPET = String.raw`<table role="presentation" cellspacing="0" cellpadding="0" border="0">
  <tr><td bgcolor="#183B66" style="background:#183B66;border-radius:6px">
    <a href="{{websiteUrl}}" target="_blank" style="display:inline-block;padding:13px 22px;color:#FFFFFF;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none">Explore more</a>
  </td></tr>
</table>`;


function cloneTemplate(template: EmailDesignTemplate): EmailDesignTemplate {
  return JSON.parse(JSON.stringify(template)) as EmailDesignTemplate;
}

function EmailPreview({
  template,
  brand,
  mode = 'desktop',
  compact = false,
}: {
  template: EmailDesignTemplate;
  brand: Record<string, any>;
  mode?: PreviewMode;
  compact?: boolean;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const srcDoc = renderEmailDesignHtml(template, SAMPLE_EMAIL_CONTENT, brand, origin);
  return (
    <div className={compact ? 'h-[154px] overflow-hidden rounded-lg bg-slate-100 border border-slate-200 relative' : 'flex-1 min-h-0 overflow-auto rounded-xl bg-slate-100 border border-slate-200 p-4'}>
      <div className={compact ? 'absolute top-0 left-0 origin-top-left pointer-events-none' : 'mx-auto'} style={compact ? { width: 600, transform: 'scale(0.37)' } : mode === 'mobile' ? { width: 390, maxWidth: '100%' } : { width: '100%', maxWidth: 760 }}>
        <iframe
          title={template.name + ' email preview'}
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          className="block bg-white border-0 shadow-sm"
          style={compact ? { width: 600, height: 410 } : mode === 'mobile' ? { width: '100%', height: 720 } : { width: '100%', height: 780 }}
        />
      </div>
      {compact && <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-100 to-transparent pointer-events-none" />}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-slate-400">{value}</span>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
      </span>
    </label>
  );
}

export const EmailDesignStudio: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { brand } = useBrand();
  const brandData = brand as unknown as Record<string, any>;
  const [templates, setTemplates] = useState<EmailDesignTemplate[]>(PREDEFINED_EMAIL_DESIGNS);
  const [defaultTemplateId, setDefaultTemplateId] = useState('modern-professional');
  const [tab, setTab] = useState<StudioTab>('gallery');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [editing, setEditing] = useState<EmailDesignTemplate | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [editorPanel, setEditorPanel] = useState<EditorPanel>('blocks');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [editorMode, setEditorMode] = useState<EditorMode>('visual');
  const htmlEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [showAssets, setShowAssets] = useState(false);
  const [aiStep, setAiStep] = useState<'website' | 'verify' | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [brandProfile, setBrandProfile] = useState<EmailBrandProfile | null>(null);
  const [aiStyle, setAiStyle] = useState('Modern corporate');
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiError, setAiError] = useState('');

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/email-design');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load email designs.');
      setTemplates(Array.isArray(data.templates) ? data.templates : PREDEFINED_EMAIL_DESIGNS);
      setDefaultTemplateId(data.defaultTemplateId || 'modern-professional');
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.message || 'Could not load email designs.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTemplates(); }, [tenantId]);

  const customTemplates = useMemo(() => templates.filter((item) => item.source !== 'PREDEFINED'), [templates]);
  const predefinedTemplates = useMemo(() => templates.filter((item) => item.source === 'PREDEFINED'), [templates]);
  const visibleTemplates = useMemo(() => {
    const source = tab === 'gallery' ? predefinedTemplates : customTemplates;
    return source.filter((item) => {
      const matchesCategory = tab !== 'gallery' || category === 'All' || item.category === category;
      const query = search.trim().toLowerCase();
      return matchesCategory && (!query || (item.name + ' ' + item.description + ' ' + item.category).toLowerCase().includes(query));
    });
  }, [tab, predefinedTemplates, customTemplates, category, search]);

  const selectedBlock = editing?.blocks.find((item) => item.id === selectedBlockId) || null;

  const startEditing = (template: EmailDesignTemplate) => {
    const copy = cloneTemplate(template);
    setEditing(copy);
    setSelectedBlockId(copy.blocks.find((item) => item.type !== 'content')?.id || copy.blocks[0]?.id || '');
    setEditorPanel('blocks');
    setPreviewMode('desktop');
    setEditorMode(copy.customHtml ? 'html' : 'visual');
  };

  const startFromScratch = () => {
    const template = createBlankEmailDesignTemplate();
    setEditing(template);
    setSelectedBlockId(template.blocks[0]?.id || '');
    setEditorPanel('blocks');
    setEditorMode('visual');
  };

  const updateTemplate = (patch: Partial<EmailDesignTemplate>) => {
    setEditing((current) => current ? { ...current, ...patch } : current);
  };
  const insertHtmlAtCursor = (snippet: string) => {
    const current = editing?.customHtml || '';
    const textarea = htmlEditorRef.current;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    updateTemplate({ customHtml: next });
    window.requestAnimationFrame(() => {
      const editor = htmlEditorRef.current;
      if (!editor) return;
      const caret = start + snippet.length;
      editor.focus();
      editor.setSelectionRange(caret, caret);
    });
  };

  const switchToHtmlMode = () => {
    if (!editing) return;
    if (editing.customHtml !== undefined) {
      setEditorMode('html');
      return;
    }
    const source = createEmailDesignHtmlSource(editing, brandData);
    setEditing((current) => current ? { ...current, customHtml: source } : current);
    setEditorMode('html');
    setNotice({ tone: 'info', text: 'Your visual layout has been converted into editable email-safe HTML. The dynamic message placeholder is preserved.' });
  };

  const switchToVisualMode = async () => {
    if (!editing) return;
    if (editing.customHtml === undefined) {
      setEditorMode('visual');
      return;
    }
    const confirmed = window.confirm(
      'Full HTML cannot be converted back into visual blocks without losing custom layout and CSS. Save this HTML design and create a separate Visual Builder copy from its original block layout? Your HTML design will remain saved in My Designs.'
    );
    if (!confirmed) return;
    const savedHtmlDesign = await saveTemplate(false);
    if (!savedHtmlDesign) return;
    const visualCopy = cloneTemplate(savedHtmlDesign);
    visualCopy.id = '';
    visualCopy.name = (savedHtmlDesign.name + ' (Visual Copy)').slice(0, 100);
    visualCopy.source = 'CUSTOM';
    visualCopy.version = 1;
    visualCopy.customHtml = undefined;
    visualCopy.createdAt = undefined;
    visualCopy.updatedAt = undefined;
    setEditing(visualCopy);
    setSelectedBlockId(visualCopy.blocks.find((item) => item.type !== 'content')?.id || visualCopy.blocks[0]?.id || '');
    setEditorMode('visual');
    setEditorPanel('blocks');
    setNotice({ tone: 'success', text: 'Your HTML design has been saved separately. You are now editing a new Visual Builder copy.' });
  };


  const updateTheme = (patch: Partial<EmailDesignTheme>) => {
    setEditing((current) => current ? { ...current, customHtml: undefined, theme: { ...current.theme, ...patch } } : current);
  };

  const updateBlock = (id: string, patch: Partial<EmailDesignBlock>) => {
    setEditing((current) => current ? {
      ...current,
      customHtml: undefined,
      blocks: current.blocks.map((item) => item.id === id ? { ...item, ...patch } : item),
    } : current);
  };

  const addBlock = (type: EmailDesignBlockType) => {
    const id = createEmailDesignBlockId(type);
    const defaultBlocks: Partial<Record<EmailDesignBlockType, Partial<EmailDesignBlock>>> = {
      heading: { text: 'A clear heading', fontSize: editing?.theme.headingFontSize || 24, padding: 18 },
      hero: { eyebrow: 'A SHORT INTRODUCTION', text: 'A compelling headline goes here', secondaryText: 'Add one short supporting sentence to explain the value.', fontSize: editing?.theme.headingFontSize || 28, color: '#FFFFFF', backgroundColor: editing?.theme.primaryColor || '#183B66', padding: 28, align: 'left' },
      logo: { width: 160, padding: 22, color: '#183B66', backgroundColor: '#FFFFFF', align: 'left' },
      text: { text: 'Add supporting information here.', padding: 14 },
      image: { url: '', altText: 'Company image', width: 540, padding: 12 },
      button: { text: 'Learn more', url: '', align: 'left', padding: 18, backgroundColor: editing?.theme.primaryColor || '#183B66', color: '#FFFFFF' },
      divider: { color: '#E6EAF0', padding: 14 },
      spacer: { padding: 28 },
      social: { links: [], padding: 12, align: 'left' },
      footer: { padding: 24 },
    };
    const defaults = defaultBlocks[type] || {};
    const item: EmailDesignBlock = { id, type, enabled: true, ...defaults };
    setEditing((current) => current ? { ...current, customHtml: undefined, blocks: [...current.blocks, item] } : current);
    setSelectedBlockId(id);
  };

  const removeBlock = (id: string) => {
    if (editing?.blocks.find((item) => item.id === id)?.type === 'content') return;
    const next = editing?.blocks.filter((item) => item.id !== id) || [];
    setEditing((current) => current ? { ...current, customHtml: undefined, blocks: next } : current);
    setSelectedBlockId(next.find((item) => item.type !== 'content')?.id || next[0]?.id || '');
  };

  const moveBlock = (id: string, offset: number) => {
    setEditing((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((item) => item.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.blocks.length) return current;
      const next = [...current.blocks];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...current, customHtml: undefined, blocks: next };
    });
  };

  const moveBlockTo = (from: number, to: number) => {
    setEditing((current) => {
      if (!current || from === to || from < 0 || to < 0 || from >= current.blocks.length || to >= current.blocks.length) return current;
      const next = [...current.blocks];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...current, customHtml: undefined, blocks: next };
    });
  };

  const saveTemplate = async (makeDefault = false): Promise<EmailDesignTemplate | null> => {
    if (!editing) return null;
    const name = editing.name.trim();
    if (!name) {
      setNotice({ tone: 'error', text: 'Give your email design a name before saving.' });
      return null;
    }
    if (editing.customHtml !== undefined) {
      const validation = validateEmailDesignHtml(editing.customHtml);
      if (!validation.valid) {
        setNotice({ tone: 'error', text: validation.error || 'Please fix the HTML before saving.' });
        return null;
      }
    }
    setBusy(true);
    setNotice(null);
    try {
      const payload = { ...editing, name, source: editing.source === 'AI' ? 'AI' : 'CUSTOM' };
      const response = await fetch('/api/email-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save this design.');
      const saved = data.template as EmailDesignTemplate;
      setTemplates((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setEditing(saved);
      if (makeDefault) {
        const defaultResponse = await fetch('/api/email-design/default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: saved.id }),
        });
        const defaultData = await defaultResponse.json().catch(() => ({}));
        if (!defaultResponse.ok || !defaultData.success) throw new Error(defaultData.error || 'Design saved, but could not set it as default.');
        setDefaultTemplateId(saved.id);
      }
      setNotice({ tone: 'success', text: makeDefault ? 'Design saved and selected as the default for AI replies, follow-ups and manual inbox emails.' : 'Your email design has been saved.' });
      return saved;
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.message || 'Could not save this design.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch('/api/email-design/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not set the default design.');
      setDefaultTemplateId(id);
      setNotice({ tone: 'success', text: 'Default email design updated. It will be used for AI replies, auto follow-ups and manual Unified Inbox emails.' });
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.message || 'Could not set the default design.' });
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async (template: EmailDesignTemplate) => {
    if (!window.confirm('Delete "' + template.name + '"? Sent emails are not affected.')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/email-design/' + encodeURIComponent(template.id), { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not delete this design.');
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (defaultTemplateId === template.id) setDefaultTemplateId('modern-professional');
      setNotice({ tone: 'success', text: 'Design deleted. Previously sent emails are unchanged.' });
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.message || 'Could not delete this design.' });
    } finally {
      setBusy(false);
    }
  };

  const duplicateTemplate = (template: EmailDesignTemplate) => {
    const copy = cloneTemplate(template);
    copy.id = '';
    copy.name = template.name + ' Copy';
    copy.source = 'CUSTOM';
    copy.version = 1;
    copy.createdAt = undefined;
    copy.updatedAt = undefined;
    startEditing(copy);
  };

  const openAiBuilder = () => {
    setWebsiteUrl(brand.websiteUrl || '');
    setBrandProfile(null);
    setAiError('');
    setAiStep('website');
  };

  const analyzeWebsite = async () => {
    setBusy(true);
    setAiError('');
    try {
      const normalizedUrl = /^https?:\/\//i.test(websiteUrl.trim()) ? websiteUrl.trim() : 'https://' + websiteUrl.trim();
      const response = await fetch('/api/email-design/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: normalizedUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not analyse this website.');
      setBrandProfile(data.brandProfile);
      setWebsiteUrl(normalizedUrl);
      setAiStep('verify');
    } catch (error: any) {
      setAiError(error?.message || 'Could not analyse this website.');
    } finally {
      setBusy(false);
    }
  };

  const updateProfile = (patch: Partial<EmailBrandProfile>) => {
    setBrandProfile((current) => current ? { ...current, ...patch } : current);
  };

  const generateWithAi = async () => {
    if (!brandProfile) return;
    setBusy(true);
    setAiError('');
    try {
      const response = await fetch('/api/email-design/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandProfile, style: aiStyle, instructions: aiInstructions }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'AI could not generate the email design.');
      const template = data.template as EmailDesignTemplate;
      setAiStep(null);
      startEditing({ ...template, id: '', source: 'AI', version: 1 });
      setNotice({ tone: 'success', text: 'Your AI-generated brand design is ready. Review and customize it before saving.' });
    } catch (error: any) {
      setAiError(error?.message || 'AI could not generate the email design.');
    } finally {
      setBusy(false);
    }
  };

  const insertAsset = (asset: CompanyAsset) => {
    if (!editing) return;
    const current = editing.blocks.find((item) => item.id === selectedBlockId);
    if (current && (current.type === 'logo' || current.type === 'image')) {
      updateBlock(current.id, { url: asset.url, altText: asset.name });
    } else {
      const id = createEmailDesignBlockId('image');
      const image: EmailDesignBlock = { id, type: 'image', url: asset.url, altText: asset.name, width: 540, padding: 12, enabled: true };
      setEditing((value) => value ? { ...value, customHtml: undefined, blocks: [...value.blocks, image] } : value);
      setSelectedBlockId(id);
    }
    setShowAssets(false);
  };

  const filteredPredefined = tab === 'gallery';
  const profileColors = brandProfile?.colors || [];

  if (editing && editorMode === 'html') {
    const htmlValidation = validateEmailDesignHtml(editing.customHtml ?? '');
    return (
      <div className="h-full min-h-[760px] flex flex-col bg-slate-50 -m-4 lg:-m-6">
        <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
          <button onClick={() => { setEditing(null); setNotice(null); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Back to Email Design Studio">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-[170px] flex-1">
            <input value={editing.name} onChange={(event) => updateTemplate({ name: event.target.value })} className="w-full text-sm font-bold text-slate-900 outline-none border-b border-transparent focus:border-orange-400 py-1" placeholder="Name your email design" />
            <p className="text-[10px] text-slate-400">Full HTML email design · Your message is inserted at the required content placeholder</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button onClick={() => void switchToVisualMode()} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5">
              <LayoutTemplate className="w-3.5 h-3.5" /> Visual Builder
            </button>
            <button className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white shadow-sm flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5" /> Full HTML
            </button>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setPreviewMode('desktop')} className={'p-2 rounded-md ' + (previewMode === 'desktop' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')} title="Desktop preview"><Monitor className="w-4 h-4" /></button>
            <button onClick={() => setPreviewMode('mobile')} className={'p-2 rounded-md ' + (previewMode === 'mobile' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')} title="Mobile preview"><Smartphone className="w-4 h-4" /></button>
          </div>
          <button disabled={busy} onClick={() => void saveTemplate(false)} className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Save design
          </button>
          <button disabled={busy} onClick={() => void saveTemplate(true)} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50">
            <Star className="w-3.5 h-3.5" /> Save & set default
          </button>
        </div>
        {notice && <div className={'px-5 py-2 text-xs border-b ' + (notice.tone === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : notice.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-700')}>{notice.text}</div>}
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
          <section className="min-h-[580px] xl:min-h-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold text-slate-800">HTML source</h2>
                <p className="text-[10px] text-slate-400">Email-safe HTML · inline CSS and responsive media queries</p>
              </div>
              <span className={'text-[10px] font-bold px-2.5 py-1 rounded-full ' + (htmlValidation.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
                {htmlValidation.valid ? 'Message slot ready' : 'Needs attention'}
              </span>
            </div>
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mr-1">Insert</span>
                {HTML_INSERT_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => insertHtmlAtCursor(option.value)} title={option.description} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-orange-300 hover:text-orange-700 text-[10px] font-semibold text-slate-700">
                    {option.label}
                  </button>
                ))}
                <button type="button" onClick={() => insertHtmlAtCursor(HTML_CTA_SNIPPET)} className="px-2.5 py-1.5 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-[10px] font-semibold text-orange-700">
                  Insert CTA button
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <textarea
                ref={htmlEditorRef}
                value={editing.customHtml ?? ''}
                onChange={(event) => updateTemplate({ customHtml: event.target.value })}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                wrap="off"
                aria-label="Full HTML email source"
                placeholder={'<!doctype html>\\n<html>\\n<head>\\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\\n</head>\\n<body>\\n  <!-- Header, layout and footer -->\\n  <table role=\"presentation\" width=\"100%\">\\n    <tr><td>{{content}}</td></tr>\\n  </table>\\n</body>\\n</html>'}
                className="w-full h-full min-h-[500px] resize-none rounded-xl border border-slate-200 bg-slate-950 p-4 text-[11px] leading-[1.65] text-emerald-100 font-mono outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-white space-y-1.5">
              {htmlValidation.valid ? (
                <p className="text-[11px] text-emerald-700 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Exactly one {'{{content}}'} placeholder is present and survives email sanitization.</p>
              ) : (
                <p className="text-[11px] text-rose-700 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> {htmlValidation.error}</p>
              )}
              {htmlValidation.warnings.map((warning) => <p key={warning} className="text-[10px] text-amber-700">• {warning}</p>)}
              <p className="text-[10px] text-slate-400">Scripts, forms, iframes and unsafe CSS are removed. Use tables for layout; safe inline styles and screen media queries are retained.</p>
            </div>
          </section>
          <main className="min-h-[580px] xl:min-h-0 flex flex-col p-3 lg:p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div><h2 className="text-xs font-bold text-slate-700">Live email preview</h2><p className="text-[10px] text-slate-400">Sample recipient message is inserted where {'{{content}}'} appears.</p></div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{previewMode} view</span>
            </div>
            <EmailPreview template={editing} brand={brandData} mode={previewMode} />
          </main>
        </div>
      </div>
    );
  }

  if (editing) {
    const selectedIndex = editing.blocks.findIndex((item) => item.id === selectedBlockId);
    return (
      <div className="h-full min-h-[760px] flex flex-col bg-slate-50 -m-4 lg:-m-6">
        <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
          <button onClick={() => { setEditing(null); setNotice(null); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Back to Email Design Studio">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-[180px] flex-1">
            <input value={editing.name} onChange={(event) => updateTemplate({ name: event.target.value })} className="w-full text-sm font-bold text-slate-900 outline-none border-b border-transparent focus:border-orange-400 py-1" placeholder="Name your email design" />
            <p className="text-[10px] text-slate-400">{editing.source === 'AI' ? 'AI-generated design' : 'Custom email design'} · Message content is inserted automatically at the reserved content block</p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setPreviewMode('desktop')} className={'p-2 rounded-md ' + (previewMode === 'desktop' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')} title="Desktop preview"><Monitor className="w-4 h-4" /></button>
            <button onClick={() => setPreviewMode('mobile')} className={'p-2 rounded-md ' + (previewMode === 'mobile' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')} title="Mobile preview"><Smartphone className="w-4 h-4" /></button>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button onClick={() => { if (editorMode === 'html') void switchToVisualMode(); else setEditorMode('visual'); }} className={'px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ' + (editorMode === 'visual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              <LayoutTemplate className="w-3.5 h-3.5" /> Visual Builder
            </button>
            <button onClick={switchToHtmlMode} className={'px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ' + (editorMode === 'html' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              <Code2 className="w-3.5 h-3.5" /> Full HTML
            </button>
          </div>
          <button disabled={busy} onClick={() => saveTemplate(false)} className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Save design
          </button>
          <button disabled={busy} onClick={() => saveTemplate(true)} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50">
            <Star className="w-3.5 h-3.5" /> Save & set default
          </button>
        </div>
        {notice && <div className={'px-5 py-2 text-xs border-b ' + (notice.tone === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : notice.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-700')}>{notice.text}</div>}
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[250px_minmax(420px,1fr)_300px]">
          <aside className="bg-white border-r border-slate-200 p-3 overflow-y-auto max-h-[280px] xl:max-h-none">
            <div className="grid grid-cols-2 gap-1 mb-4">
              <button onClick={() => setEditorPanel('blocks')} className={'rounded-lg py-2 text-xs font-semibold ' + (editorPanel === 'blocks' ? 'bg-orange-50 text-orange-700' : 'text-slate-500 hover:bg-slate-50')}><LayoutTemplate className="inline w-3.5 h-3.5 mr-1" />Blocks</button>
              <button onClick={() => setEditorPanel('styles')} className={'rounded-lg py-2 text-xs font-semibold ' + (editorPanel === 'styles' ? 'bg-orange-50 text-orange-700' : 'text-slate-500 hover:bg-slate-50')}><Palette className="inline w-3.5 h-3.5 mr-1" />Styles</button>
            </div>
            {editorPanel === 'blocks' ? (
              <>
                <div className="flex items-center justify-between mb-2"><h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Add a block</h3><button onClick={() => setShowAssets(true)} className="text-[10px] font-semibold text-orange-600 hover:text-orange-700"><FolderOpen className="inline w-3 h-3 mr-1" />Assets</button></div>
                <div className="grid grid-cols-2 gap-1.5 mb-5">
                  {BLOCK_OPTIONS.map((option) => (
                    <button key={option.type} onClick={() => addBlock(option.type)} className="text-left p-2.5 border border-slate-200 rounded-lg hover:border-orange-300 hover:bg-orange-50/40 transition group">
                      <span className="text-slate-500 group-hover:text-orange-600">{option.icon}</span>
                      <span className="block text-[11px] mt-1 font-semibold text-slate-700">{option.label}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between mb-2"><h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Email structure</h3><span className="text-[10px] text-slate-400">{editing.blocks.length} blocks</span></div>
                <div className="space-y-1">
                  {editing.blocks.map((item, index) => (
                    <div key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveBlockTo(Number(event.dataTransfer.getData('text/plain')), index); }} className={'rounded-lg border flex items-center gap-1 p-1.5 ' + (selectedBlockId === item.id ? 'bg-orange-50 border-orange-300' : 'border-transparent hover:bg-slate-50')}>
                      <button onClick={() => setSelectedBlockId(item.id)} className="min-w-0 flex-1 text-left px-1.5 py-1">
                        <span className="block text-xs font-semibold text-slate-700 capitalize">{item.type === 'content' ? 'Message content (locked)' : item.type === 'logo' ? 'Brand header' : item.type === 'hero' ? 'Hero banner' : item.type}</span>
                        <span className="block text-[10px] text-slate-400 truncate">{item.type === 'content' ? 'Original email text is inserted here' : (item.text || item.altText || 'Design block')}</span>
                      </button>
                      <button onClick={() => moveBlock(item.id, -1)} disabled={index === 0} className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-20" title="Move up"><ArrowUp className="w-3 h-3" /></button>
                      <button onClick={() => moveBlock(item.id, 1)} disabled={index === editing.blocks.length - 1} className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-20" title="Move down"><ArrowDown className="w-3 h-3" /></button>
                      {item.type !== 'content' && <button onClick={() => removeBlock(item.id)} className="p-1 text-slate-300 hover:text-rose-600" title="Remove block"><Trash2 className="w-3 h-3" /></button>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div><h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Brand colours</h3>
                  <div className="space-y-2">
                    <ColorField label="Page background" value={editing.theme.pageBackground} onChange={(value) => updateTheme({ pageBackground: value })} />
                    <ColorField label="Email surface" value={editing.theme.cardBackground} onChange={(value) => updateTheme({ cardBackground: value })} />
                    <ColorField label="Primary" value={editing.theme.primaryColor} onChange={(value) => updateTheme({ primaryColor: value })} />
                    <ColorField label="Accent" value={editing.theme.accentColor} onChange={(value) => updateTheme({ accentColor: value })} />
                    <ColorField label="Text" value={editing.theme.textColor} onChange={(value) => updateTheme({ textColor: value })} />
                    <ColorField label="Muted text" value={editing.theme.mutedColor} onChange={(value) => updateTheme({ mutedColor: value })} />
                  </div>
                </div>
                <label className="block text-xs font-semibold text-slate-600">Font family
                  <select value={editing.theme.fontFamily} onChange={(event) => updateTheme({ fontFamily: event.target.value })} className="mt-1 w-full p-2 rounded-lg border border-slate-200 text-xs bg-white">
                    <option>Arial, Helvetica, sans-serif</option><option>Helvetica, Arial, sans-serif</option><option>Georgia, Times New Roman, serif</option><option>Tahoma, Arial, sans-serif</option><option>Verdana, Geneva, sans-serif</option><option>Trebuchet MS, Arial, sans-serif</option>
                  </select>
                </label>
                <div className="rounded-xl border border-slate-200 p-3 space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Typography scale</h4>
                  <label className="block text-xs font-semibold text-slate-600">Default heading size
                    <input type="range" min="18" max="42" value={editing.theme.headingFontSize} onChange={(event) => updateTheme({ headingFontSize: Number(event.target.value) })} className="mt-2 w-full" />
                    <span className="text-[10px] font-normal text-slate-400">{editing.theme.headingFontSize}px</span>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Message text size
                    <input type="range" min="12" max="20" value={editing.theme.bodyFontSize} onChange={(event) => updateTheme({ bodyFontSize: Number(event.target.value) })} className="mt-2 w-full" />
                    <span className="text-[10px] font-normal text-slate-400">{editing.theme.bodyFontSize}px</span>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Message line spacing
                    <input type="range" min="14" max="20" value={Math.round(editing.theme.bodyLineHeight * 10)} onChange={(event) => updateTheme({ bodyLineHeight: Number(event.target.value) / 10 })} className="mt-2 w-full" />
                    <span className="text-[10px] font-normal text-slate-400">{editing.theme.bodyLineHeight.toFixed(1)}</span>
                  </label>
                </div>
                <label className="block text-xs font-semibold text-slate-600">Content width
                  <input type="range" min="480" max="680" step="10" value={editing.theme.contentWidth} onChange={(event) => updateTheme({ contentWidth: Number(event.target.value) })} className="mt-2 w-full" />
                  <span className="text-[10px] font-normal text-slate-400">{editing.theme.contentWidth}px</span>
                </label>
                <label className="block text-xs font-semibold text-slate-600">Card corner radius
                  <input type="range" min="0" max="24" value={editing.theme.cardRadius} onChange={(event) => updateTheme({ cardRadius: Number(event.target.value) })} className="mt-2 w-full" />
                  <span className="text-[10px] font-normal text-slate-400">{editing.theme.cardRadius}px</span>
                </label>
              </div>
            )}
          </aside>
          <main className="min-h-[520px] xl:min-h-0 flex flex-col p-3 lg:p-5">
            <div className="flex items-center justify-between mb-3">
              <div><h2 className="text-xs font-bold text-slate-700">Live email preview</h2><p className="text-[10px] text-slate-400">The sample text represents the message generated or written by the user.</p></div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{previewMode} view</span>
            </div>
            <EmailPreview template={editing} brand={brandData} mode={previewMode} />
          </main>
          <aside className="bg-white border-l border-slate-200 p-4 overflow-y-auto max-h-[360px] xl:max-h-none">
            {selectedBlock ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 capitalize">{selectedBlock.type === 'content' ? 'Message content area' : selectedBlock.type + ' settings'}</h3><p className="text-[10px] text-slate-400">Selected block</p></div>{selectedBlock.type === 'content' && <span className="text-[9px] px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full font-bold">Required</span>}</div>
                {selectedBlock.type === 'content' ? (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs leading-relaxed text-emerald-900">This is the reserved message area. Amaavigo inserts the original AI-generated, follow-up or manually composed email text here. It cannot be removed or rewritten by the template.</div>
                ) : (
                  <>
                    {['heading','text','button','hero'].includes(selectedBlock.type) && <label className="block text-xs font-semibold text-slate-600">{selectedBlock.type === 'hero' ? 'Hero headline' : 'Text'}
                      <textarea rows={3} value={selectedBlock.text || ''} onChange={(event) => updateBlock(selectedBlock.id, { text: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" />
                    </label>}
                    {selectedBlock.type === 'hero' && <>
                      <label className="block text-xs font-semibold text-slate-600">Eyebrow / small label
                        <input value={selectedBlock.eyebrow || ''} onChange={(event) => updateBlock(selectedBlock.id, { eyebrow: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" placeholder="PRODUCT UPDATE" />
                      </label>
                      <label className="block text-xs font-semibold text-slate-600">Supporting text
                        <textarea rows={3} value={selectedBlock.secondaryText || ''} onChange={(event) => updateBlock(selectedBlock.id, { secondaryText: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" />
                      </label>
                    </>}
                    {['logo','image'].includes(selectedBlock.type) && <>
                      <label className="block text-xs font-semibold text-slate-600">Image URL
                        <input value={selectedBlock.url || ''} onChange={(event) => updateBlock(selectedBlock.id, { url: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" placeholder="/api/assets/..." />
                      </label>
                      <button onClick={() => setShowAssets(true)} className="w-full py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200"><FolderOpen className="inline w-3.5 h-3.5 mr-1" />Choose from Company Assets</button>
                      <label className="block text-xs font-semibold text-slate-600">Alternative text
                        <input value={selectedBlock.altText || ''} onChange={(event) => updateBlock(selectedBlock.id, { altText: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" />
                      </label>
                    </>}
                    {selectedBlock.type === 'button' && <label className="block text-xs font-semibold text-slate-600">Button destination
                      <input type="url" value={selectedBlock.url || ''} onChange={(event) => updateBlock(selectedBlock.id, { url: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" placeholder="https://..." />
                    </label>}
                    {selectedBlock.type === 'social' && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-500">Add public company social profiles. Links are rendered as accessible text links in the email.</p>
                        {(selectedBlock.links || []).map((link, index) => (
                          <div key={index} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                            <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-500">Link {index + 1}</span><button onClick={() => updateBlock(selectedBlock.id, { links: (selectedBlock.links || []).filter((_, i) => i !== index) })} className="text-[10px] font-semibold text-rose-600">Remove</button></div>
                            <input value={link.label} onChange={(event) => updateBlock(selectedBlock.id, { links: (selectedBlock.links || []).map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} placeholder="LinkedIn" className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"/>
                            <input type="url" value={link.url} onChange={(event) => updateBlock(selectedBlock.id, { links: (selectedBlock.links || []).map((item, i) => i === index ? { ...item, url: event.target.value } : item) })} placeholder="https://..." className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"/>
                          </div>
                        ))}
                        <button onClick={() => updateBlock(selectedBlock.id, { links: [...(selectedBlock.links || []), { label: 'LinkedIn', url: '' }] })} className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:border-orange-300 hover:text-orange-700"><Plus className="inline w-3 h-3 mr-1"/>Add social link</button>
                      </div>
                    )}
                    {['heading','hero','text'].includes(selectedBlock.type) && <label className="block text-xs font-semibold text-slate-600">Font size
                      <input type="range" min="10" max="42" value={selectedBlock.fontSize || (selectedBlock.type === 'text' ? editing.theme.bodyFontSize : editing.theme.headingFontSize)} onChange={(event) => updateBlock(selectedBlock.id, { fontSize: Number(event.target.value) })} className="mt-2 w-full" />
                      <span className="text-[10px] font-normal text-slate-400">{selectedBlock.fontSize || (selectedBlock.type === 'text' ? editing.theme.bodyFontSize : editing.theme.headingFontSize)}px</span>
                    </label>}
                    <label className="block text-xs font-semibold text-slate-600">Alignment
                      <select value={selectedBlock.align || 'left'} onChange={(event) => updateBlock(selectedBlock.id, { align: event.target.value as any })} className="mt-1 w-full p-2 rounded-lg border border-slate-200 text-xs bg-white">
                        <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                      </select>
                    </label>
                    <ColorField label="Text / rule colour" value={selectedBlock.color || editing.theme.textColor} onChange={(value) => updateBlock(selectedBlock.id, { color: value })} />
                    {['logo','hero','footer','button'].includes(selectedBlock.type) && <ColorField label={selectedBlock.type === 'footer' ? 'Footer background' : selectedBlock.type === 'logo' ? 'Header background' : selectedBlock.type === 'hero' ? 'Hero background' : 'Button background'} value={selectedBlock.backgroundColor || editing.theme.cardBackground} onChange={(value) => updateBlock(selectedBlock.id, { backgroundColor: value })} />}
                    <label className="block text-xs font-semibold text-slate-600">Spacing
                      <input type="range" min="0" max="60" value={selectedBlock.padding ?? 16} onChange={(event) => updateBlock(selectedBlock.id, { padding: Number(event.target.value) })} className="mt-2 w-full" />
                      <span className="text-[10px] font-normal text-slate-400">{selectedBlock.padding ?? 16}px</span>
                    </label>
                    <label className="flex items-center justify-between text-xs font-medium text-slate-600 py-2"><span>Show this block</span><input type="checkbox" checked={selectedBlock.enabled !== false} onChange={(event) => updateBlock(selectedBlock.id, { enabled: event.target.checked })} /></label>
                  </>
                )}
              </div>
            ) : <p className="text-xs text-slate-400">Select a block to edit its properties.</p>}
            <div className="mt-6 pt-4 border-t border-slate-100">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Design details</h4>
              <label className="block text-xs font-semibold text-slate-600">Description
                <textarea rows={3} value={editing.description} onChange={(event) => updateTemplate({ description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" />
              </label>
              <p className="mt-3 text-[10px] text-slate-400">Template version {editing.version || 1}. The selected design applies only to AI replies, AI auto follow-ups and manual emails sent from Unified Inbox.</p>
            </div>
          </aside>
        </div>
        {showAssets && <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-3 lg:p-8">
          <div className="w-full max-w-6xl h-[88vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Company Assets</h3><p className="text-[10px] text-slate-500">Reuse the same assets available to Outbound Campaigns.</p></div><button onClick={() => setShowAssets(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button></div>
            <div className="flex-1 min-h-0 overflow-auto p-4"><CompanyAssetsPanel onSelectAsset={insertAsset} /></div>
          </div>
        </div>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-orange-600 mb-1"><Mail className="w-5 h-5" /><span className="text-[11px] uppercase tracking-[0.18em] font-bold">Amaavigo Workspace</span></div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Email Design Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Create a consistent, branded email experience for AI replies, AI auto follow-ups and manual Unified Inbox emails.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={startFromScratch} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-orange-300 text-slate-700 text-xs font-bold shadow-sm"><Plus className="w-4 h-4" />Create from scratch</button>
          <button onClick={openAiBuilder} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm"><Sparkles className="w-4 h-4" />Generate with AI</button>
        </div>
      </div>

      <div className="rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50 via-white to-amber-50 p-4 lg:p-5 flex flex-col md:flex-row md:items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-white border border-orange-100 flex items-center justify-center text-orange-600"><Star className="w-5 h-5" /></div>
        <div className="flex-1"><p className="text-xs font-bold text-slate-900">Default email design</p><p className="text-sm text-slate-600">{templates.find((item) => item.id === defaultTemplateId)?.name || 'Modern Professional'}</p><p className="text-[11px] text-slate-500 mt-0.5">This design is used for all AI-generated replies, AI auto follow-ups and manual replies from Unified Inbox. Outbound campaign templates remain separate.</p></div>
        <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] font-bold"><Check className="w-3.5 h-3.5" />Active default</span>
      </div>

      {notice && <div className={'px-4 py-3 rounded-xl border text-xs ' + (notice.tone === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : notice.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-700')}>{notice.text}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          <button onClick={() => { setTab('gallery'); setSearch(''); }} className={'px-4 py-2 rounded-lg text-xs font-bold ' + (tab === 'gallery' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><LayoutTemplate className="inline w-3.5 h-3.5 mr-1.5" />Predefined templates</button>
          <button onClick={() => { setTab('my-designs'); setSearch(''); }} className={'px-4 py-2 rounded-lg text-xs font-bold ' + (tab === 'my-designs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>My designs <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-200 text-[10px]">{customTemplates.length}</span></button>
        </div>
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email designs..." className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs outline-none focus:border-orange-400" /></div>
      </div>

      {tab === 'gallery' && <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((item) => <button key={item} onClick={() => setCategory(item)} className={'px-3 py-1.5 rounded-full text-[11px] font-semibold border ' + (category === item ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300')}>{item}</button>)}
      </div>}

      {loading ? <div className="py-20 flex items-center justify-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading designs...</div> : visibleTemplates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center"><LayoutTemplate className="w-8 h-8 mx-auto text-slate-300" /><h3 className="mt-3 text-sm font-bold text-slate-800">{filteredPredefined ? 'No templates match your search' : 'Your saved designs will appear here'}</h3><p className="mt-1 text-xs text-slate-500">{filteredPredefined ? 'Try another search or category.' : 'Start with a predefined design, a blank canvas or AI generation.'}</p><button onClick={startFromScratch} className="mt-4 text-xs font-bold text-orange-600">Create your first design</button></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
          {visibleTemplates.map((template) => {
            const isDefault = template.id === defaultTemplateId;
            return <article key={template.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow-md hover:border-slate-300 transition">
              <EmailPreview template={template} brand={brandData} compact />
              <div className="px-1 pt-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-slate-900 truncate">{template.name}</h3>{isDefault && <span className="shrink-0 text-[9px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">DEFAULT</span>}</div><p className="mt-1 text-[11px] text-slate-500 line-clamp-2 min-h-[32px]">{template.description}</p></div><span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-400">{template.category}</span></div>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => startEditing({ ...cloneTemplate(template), id: template.source === 'PREDEFINED' ? '' : template.id, source: template.source === 'PREDEFINED' ? 'CUSTOM' : template.source })} className="flex-1 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold"><Eye className="inline w-3.5 h-3.5 mr-1.5" />Customize</button>
                  <button disabled={busy || isDefault} onClick={() => setDefault(template.id)} className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-semibold disabled:opacity-40">{isDefault ? 'Selected' : 'Set default'}</button>
                  {tab === 'my-designs' && <>
                    <button onClick={() => duplicateTemplate(template)} title="Duplicate" className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"><Copy className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteTemplate(template)} title="Delete" className="p-2 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>}
                </div>
              </div>
            </article>;
          })}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600"><FileImage className="w-4 h-4" /></div>
        <div className="flex-1"><p className="text-xs font-bold text-slate-800">Company Assets are shared with Outbound Campaigns</p><p className="text-[11px] text-slate-500">Use your existing logos, banners and images in email designs. Campaign template creation and campaign sending remain unchanged.</p></div>
        <button onClick={() => { setEditing(createBlankEmailDesignTemplate()); setSelectedBlockId(''); setShowAssets(true); }} className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700">Browse assets</button>
      </div>

      {aiStep && <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-3 lg:p-8">
        <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between"><div><div className="flex items-center gap-2 text-orange-600"><Sparkles className="w-4 h-4" /><span className="text-[10px] uppercase font-bold tracking-widest">AI design generator</span></div><h2 className="mt-1 text-lg font-extrabold text-slate-900">{aiStep === 'website' ? 'Start with your company website' : 'Verify your brand details'}</h2><p className="text-xs text-slate-500 mt-1">{aiStep === 'website' ? 'We will analyse your public website to identify your visual identity.' : 'Review the extracted information before asking AI to create the template.'}</p></div><button onClick={() => setAiStep(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button></div>
          <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto">
            {aiError && <div className="rounded-lg bg-rose-50 border border-rose-100 text-rose-700 text-xs px-3 py-2">{aiError}</div>}
            {aiStep === 'website' ? <>
              <label className="block text-xs font-bold text-slate-700">Company website URL
                <input type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://www.yourcompany.com" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal outline-none focus:border-orange-400" />
              </label>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 leading-relaxed"><strong>What we analyse:</strong> company identity, public logo and images, visible brand colours, page title and description, contact details and social links. You will review and correct the details before design generation.</div>
            </> : brandProfile && <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-600">Company name<input value={brandProfile.companyName} onChange={(event) => updateProfile({ companyName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
                <label className="block text-xs font-semibold text-slate-600">Tagline<input value={brandProfile.tagline} onChange={(event) => updateProfile({ tagline: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
                <label className="block text-xs font-semibold text-slate-600">Contact email<input value={brandProfile.contactEmail} onChange={(event) => updateProfile({ contactEmail: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
                <label className="block text-xs font-semibold text-slate-600">Contact phone<input value={brandProfile.contactPhone} onChange={(event) => updateProfile({ contactPhone: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              </div>
              <label className="block text-xs font-semibold text-slate-600">Company description<textarea rows={3} value={brandProfile.description} onChange={(event) => updateProfile({ description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-600">Logo URL<input value={brandProfile.logoUrl} onChange={(event) => updateProfile({ logoUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              <div><p className="text-xs font-semibold text-slate-600 mb-2">Extracted brand colours</p><div className="flex flex-wrap items-center gap-2">{profileColors.map((color, index) => <label key={color + index} className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1.5"><input type="color" value={color} onChange={(event) => updateProfile({ colors: profileColors.map((value, i) => i === index ? event.target.value : value) })} className="w-6 h-6" /><span className="text-[10px] font-mono text-slate-500">{color}</span></label>)}{profileColors.length === 0 && <span className="text-[11px] text-slate-400">No prominent colours detected. AI will use a neutral professional palette.</span>}</div></div>
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">Design direction
                  <select value={aiStyle} onChange={(event) => setAiStyle(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white">
                    <option>Modern corporate</option><option>Minimal and editorial</option><option>Premium and luxury</option><option>Warm customer care</option><option>Technology and SaaS</option><option>Creative and expressive</option><option>Classic professional</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-600">Additional design instructions (optional)<textarea value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} rows={2} placeholder="For example: keep the header compact, use our primary blue, and make the design feel premium." className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              </div>
            </>}
          </div>
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
            {aiStep === 'verify' ? <button disabled={busy} onClick={() => setAiStep('website')} className="px-3 py-2 text-xs font-semibold text-slate-600">Change website</button> : <span className="text-[10px] text-slate-400">Public website information only</span>}
            {aiStep === 'website' ? <button disabled={busy || !websiteUrl.trim()} onClick={analyzeWebsite} className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50">{busy ? <><Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" />Analysing website...</> : 'Analyse website'}</button> : <button disabled={busy || !brandProfile?.companyName.trim()} onClick={generateWithAi} className="px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold disabled:opacity-50">{busy ? <><Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" />Creating your design...</> : <><Sparkles className="inline w-3.5 h-3.5 mr-1" />Generate email design</>}</button>}
          </div>
        </div>
      </div>}
    </div>
  );
};
