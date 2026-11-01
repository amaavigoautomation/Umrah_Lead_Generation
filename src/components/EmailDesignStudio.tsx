import React, { useEffect, useMemo, useRef, useState } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  ArrowLeft, ArrowUp, ArrowDown, Check, Code2, Copy, Eye, FileImage, Heading1, ImagePlus,
  LayoutTemplate, Mail, Monitor, Palette, Plus, Save, Search, Smartphone, Sparkles, Trash2,
  Type, X, MousePointerClick, Minus, Link2, Loader2, Star, FolderOpen, AlignLeft,
  Maximize2, Minimize2, WrapText, Paperclip,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import { CompanyAssetsPanel } from './CompanyAssetsPanel';
import type { CompanyAsset, EmailTemplate } from '../types';
import { getUnsupportedEmailTemplateVariables } from '../shared/emailTemplateValidation';
import {
  createBlankEmailDesignTemplate, createEmailDesignBlockId, createEmailDesignHtmlSource, PREDEFINED_EMAIL_DESIGNS,
  SAMPLE_EMAIL_CONTENT, renderEmailDesignHtml, validateEmailDesignHtml, type EmailBrandProfile, type EmailDesignBlock,
  type EmailDesignBlockType, type EmailDesignTemplate, type EmailDesignTheme,
} from '../shared/emailDesign';

type StudioTab = 'gallery' | 'my-designs';
type EditorPanel = 'blocks' | 'styles';
type PreviewMode = 'desktop' | 'mobile';
type EditorMode = 'visual' | 'html';

const CATEGORY_FILTERS = ['All', 'Shared designs', ...Array.from(new Set(PREDEFINED_EMAIL_DESIGNS.map((item) => item.category)))];
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

function previewCampaignValue(value: string): string {
  return String(value || '')
    .replace(/\{\{\s*name\s*\}\}/gi, 'Tariq Farooq')
    .replace(/\{\{\s*firstName\s*\}\}/gi, 'Tariq')
    .replace(/\{\{\s*lastName\s*\}\}/gi, 'Farooq')
    .replace(/\{\{\s*company\s*\}\}/gi, 'Al-Bait Pilgrimage Tours')
    .replace(/\{\{\s*companyName\s*\}\}/gi, 'Al-Bait Pilgrimage Tours')
    .replace(/\{\{\s*designation\s*\}\}/gi, 'Managing Director')
    .replace(/\{\{\s*jobTitle\s*\}\}/gi, 'Managing Director')
    .replace(/\{\{\s*email\s*\}\}/gi, 'tariq@albait-tours.com');
}

function cloneTemplate(template: EmailDesignTemplate): EmailDesignTemplate {
  return JSON.parse(JSON.stringify(template)) as EmailDesignTemplate;
}

const CAMPAIGN_PREDEFINED_IDS = new Set(['tpl-b2b-portal', 'tpl-visa-allotments', 'tpl-enterprise-suite']);

function campaignEmailToDesign(template: EmailTemplate): EmailDesignTemplate {
  const snapshot = template.designSnapshot && Array.isArray(template.designSnapshot.blocks)
    ? cloneTemplate(template.designSnapshot as unknown as EmailDesignTemplate)
    : createBlankEmailDesignTemplate();
  const isPredefined = CAMPAIGN_PREDEFINED_IDS.has(template.templateId);
  return {
    ...snapshot,
    id: template.templateId,
    name: template.name || snapshot.name,
    description: snapshot.description || 'Campaign email template',
    category: snapshot.category || 'Campaign',
    source: isPredefined ? 'PREDEFINED' : 'CUSTOM',
    campaignTemplateId: template.templateId,
    campaignSubject: template.subject || '',
    campaignPreheader: template.preheader || '',
    campaignBody: template.body || '',
    campaignAttachments: Array.isArray(template.attachments) ? template.attachments : [],
    createdAt: template.createdAt || snapshot.createdAt,
    updatedAt: template.updatedAt || snapshot.updatedAt,
    ...(!template.designSnapshot && template.htmlBody ? { customHtml: template.htmlBody } : {}),
  };
}

function EmailPreview({
  template,
  brand,
  mode = 'desktop',
  compact = false,
  content,
}: {
  template: EmailDesignTemplate;
  brand: Record<string, any>;
  mode?: PreviewMode;
  compact?: boolean;
  content?: string;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const srcDoc = renderEmailDesignHtml(template, content || template.campaignBody || SAMPLE_EMAIL_CONTENT, brand, origin);
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

function formatEmailHtml(source: string): string {
  const input = String(source || '').replace(/\r\n?/g, '\n').trim();
  if (!input) return '';
  const tokens = input.match(/<!--[\s\S]*?-->|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!doctype[^>]*>|<\/?[a-z][^>]*>|[^<]+|</gi) || [];
  const blockTags = new Set(['html','head','body','table','thead','tbody','tfoot','tr','td','th','div','p','h1','h2','h3','h4','ul','ol','li','blockquote','center','section','article','header','footer']);
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const output: string[] = [];
  let indent = 0;
  let line = '';
  const pad = () => '  '.repeat(Math.max(0, indent));
  const flush = () => {
    if (line.trim()) output.push(pad() + line.trim());
    line = '';
  };
  for (const token of tokens) {
    if (/^<style\b/i.test(token)) {
      flush();
      const match = token.match(/^<style\b([^>]*)>([\s\S]*?)<\/style\s*>$/i);
      if (match) {
        output.push(pad() + '<style' + match[1].trimEnd() + '>');
        const css = match[2].trim();
        if (css) {
          const cssLines = css.replace(/\s*{\s*/g, ' {\n  ').replace(/;\s*/g, ';\n  ').replace(/\s*}\s*/g, '\n}').split('\n');
          for (const cssLine of cssLines) if (cssLine.trim()) output.push(pad() + '  ' + cssLine.trim());
        }
        output.push(pad() + '</style>');
      } else output.push(pad() + token);
      continue;
    }
    if (/^<!--/.test(token) || /^<!doctype/i.test(token)) {
      flush();
      output.push(pad() + token.trim());
      continue;
    }
    const tagMatch = token.match(/^<\s*(\/)?\s*([a-z][a-z0-9:-]*)\b/i);
    if (tagMatch) {
      const closing = Boolean(tagMatch[1]);
      const tag = tagMatch[2].toLowerCase();
      const selfClosing = /\/\s*>$/.test(token) || voidTags.has(tag);
      if (blockTags.has(tag)) {
        flush();
        if (closing) indent = Math.max(0, indent - 1);
        output.push(pad() + token.trim());
        if (!closing && !selfClosing) indent++;
      } else {
        line += token;
      }
      continue;
    }
    const text = token.replace(/\s+/g, ' ');
    if (!text.trim()) {
      if (line && !line.endsWith(' ')) line += ' ';
      continue;
    }
    line += line ? text : text.trimStart();
  }
  flush();
  return output.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function HtmlSourceEditor({
  value,
  onChange,
  editorRef,
  wordWrap,
}: {
  value: string;
  onChange: (value: string) => void;
  editorRef: React.RefObject<EditorView | null>;
  wordWrap: boolean;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const wrapCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;

    const editorTheme = EditorView.theme({
      '&': {
        height: '100%',
        width: '100%',
        color: '#E6EDF7',
        backgroundColor: '#0B1220',
        fontSize: '13px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        lineHeight: '1.65',
        scrollbarGutter: 'stable',
      },
      '.cm-content': {
        padding: '16px 0',
        caretColor: '#FFFFFF',
      },
      '.cm-line': {
        padding: '0 18px',
      },
      '.cm-gutters': {
        backgroundColor: '#101827',
        color: '#8291A8',
        borderRight: '1px solid #263449',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '42px',
        padding: '0 12px 0 8px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: '#1C2A3E',
        color: '#F8FAFC',
      },
      '.cm-activeLine': {
        backgroundColor: '#142338',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#F8FAFC',
      },
      '.cm-selectionBackground': {
        backgroundColor: '#244A72 !important',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: '#315B85 !important',
      },
      '.cm-matchingBracket': {
        backgroundColor: '#27445D',
        outline: '1px solid #5B91B8',
      },
      '.cm-tooltip': {
        border: '1px solid #334155',
        backgroundColor: '#172033',
        color: '#E6EDF7',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: '#28415F',
      },
    }, { dark: true });

    const view = new EditorView({
      doc: value,
      parent,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        editorTheme,
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    editorRef.current = view;
    return () => {
      if (editorRef.current === view) editorRef.current = null;
      view.destroy();
    };
    // The editor instance is intentionally created once per mounted workspace.
  }, [editorRef, wrapCompartment]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value, editorRef]);

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap, editorRef, wrapCompartment]);

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-[#0B1220] shadow-inner focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100">
      <div ref={mountRef} className="h-full min-h-0 min-w-0 w-full" aria-label="Full HTML email source" />
    </div>
  );
}


type EmailDesignStudioProps = {
  tenantId: string;
  purpose?: 'conversation' | 'campaign';
  initialTemplateId?: string;
};

export const EmailDesignStudio: React.FC<EmailDesignStudioProps> = ({ tenantId, purpose = 'conversation', initialTemplateId }) => {
  const isCampaignMode = purpose === 'campaign';
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
  const htmlEditorRef = useRef<EditorView | null>(null);
  const campaignAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingAttachmentReads, setPendingAttachmentReads] = useState(0);
  const [htmlFind, setHtmlFind] = useState('');
  const [htmlWordWrap, setHtmlWordWrap] = useState(true);
  const [htmlExpanded, setHtmlExpanded] = useState(false);
  const initialTemplateOpenedRef = useRef('');
  const [showAssets, setShowAssets] = useState(false);
  const [aiStep, setAiStep] = useState<'website' | 'verify' | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [brandProfile, setBrandProfile] = useState<EmailBrandProfile | null>(null);
  const [aiStyle, setAiStyle] = useState('Modern corporate');
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiWarning, setAiWarning] = useState('');

  const loadTemplates = async () => {
    setLoading(true);
    try {
      if (isCampaignMode) {
        const response = await fetch('/api/templates');
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Could not load campaign email templates.');
        const campaignTemplates = (Array.isArray(data.templates) ? data.templates : []).map((item: EmailTemplate) => campaignEmailToDesign(item));
        let sharedDesignStarters: EmailDesignTemplate[] = [];
        try {
          const designsResponse = await fetch('/api/email-design');
          const designsData = await designsResponse.json().catch(() => ({}));
          if (designsResponse.ok && designsData.success && Array.isArray(designsData.templates)) {
            sharedDesignStarters = designsData.templates.map((item: EmailDesignTemplate) => ({
              ...cloneTemplate(item),
              id: 'conversation-design-' + item.id,
              source: 'PREDEFINED' as const,
              category: 'Shared designs',
              description: 'Shared from Conversation & AI. Customize this branded layout for a campaign.',
              campaignTemplateId: '',
              campaignSubject: '',
              campaignPreheader: '',
              campaignBody: 'Hello {{firstName}},\n\nWrite your campaign message here. Add personalization fields where they belong.',
              campaignAttachments: [],
            }));
          }
        } catch {
          // Campaign templates remain available when the optional shared-design request fails.
        }
        setTemplates([...campaignTemplates, ...sharedDesignStarters]);
        setDefaultTemplateId('');
      } else {
        const response = await fetch('/api/email-design');
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Could not load email designs.');
        setTemplates(Array.isArray(data.templates) ? data.templates : PREDEFINED_EMAIL_DESIGNS);
        setDefaultTemplateId(data.defaultTemplateId || 'modern-professional');
      }
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.message || (isCampaignMode ? 'Could not load campaign email templates.' : 'Could not load email designs.') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTemplates(); }, [tenantId, isCampaignMode]);

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
    if (copy.customHtml !== undefined) copy.customHtml = formatEmailHtml(copy.customHtml);
    setEditing(copy);
    setSelectedBlockId(copy.blocks.find((item) => item.type !== 'content')?.id || copy.blocks[0]?.id || '');
    setEditorPanel('blocks');
    setPreviewMode('desktop');
    setEditorMode(copy.customHtml ? 'html' : 'visual');
    setHtmlExpanded(false);
  };

  useEffect(() => {
    if (!isCampaignMode || !initialTemplateId || loading || editing || initialTemplateOpenedRef.current === initialTemplateId) return;
    const match = templates.find((item) => item.campaignTemplateId === initialTemplateId || item.id === initialTemplateId);
    if (match) {
      initialTemplateOpenedRef.current = initialTemplateId;
      startEditing(match);
    }
  }, [initialTemplateId, isCampaignMode, loading, templates, editing]);

  const startFromScratch = () => {
    const template = createBlankEmailDesignTemplate();
    if (isCampaignMode) {
      template.name = 'New campaign email';
      template.description = 'A reusable campaign email template.';
      template.campaignSubject = '';
      template.campaignPreheader = '';
      template.campaignBody = 'Hello {{firstName}},\n\nWrite your campaign message here. Add personalization fields where they belong.';
      template.campaignAttachments = [];
      template.campaignTemplateId = '';
    }
    setEditing(template);
    setSelectedBlockId(template.blocks[0]?.id || '');
    setEditorPanel('blocks');
    setEditorMode('visual');
    setHtmlExpanded(false);
  };

  const updateTemplate = (patch: Partial<EmailDesignTemplate>) => {
    setEditing((current) => current ? { ...current, ...patch } : current);
  };

  const addCampaignAttachments = (files: FileList | null) => {
    if (!files || !files.length) return;
    Array.from(files).forEach((file) => {
      if (file.size > 15 * 1024 * 1024) {
        setNotice({ tone: 'error', text: 'File "' + file.name + '" exceeds the 15 MB per-file limit.' });
        return;
      }
      setPendingAttachmentReads((count) => count + 1);
      const reader = new FileReader();
      reader.onload = () => {
        setPendingAttachmentReads((count) => Math.max(0, count - 1));
        const dataUrl = String(reader.result || '');
        const attachment = {
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: file.name,
          filename: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          contentType: file.type || 'application/octet-stream',
          dataUrl,
          base64: dataUrl.split(',')[1] || '',
        };
        setEditing((current) => current ? {
          ...current,
          campaignAttachments: [...(current.campaignAttachments || []), attachment],
        } : current);
      };
      reader.onerror = () => {
        setPendingAttachmentReads((count) => Math.max(0, count - 1));
        setNotice({ tone: 'error', text: 'Could not read attachment "' + file.name + '".' });
      };
      reader.readAsDataURL(file);
    });
    if (campaignAttachmentInputRef.current) campaignAttachmentInputRef.current.value = '';
  };

  const removeCampaignAttachment = (id: string) => {
    updateTemplate({ campaignAttachments: (editing?.campaignAttachments || []).filter((item: any) => item.id !== id) });
  };

  const formatCurrentHtml = () => {
    if (!editing || editing.customHtml === undefined) return;
    updateTemplate({ customHtml: formatEmailHtml(editing.customHtml) });
    setNotice({ tone: 'success', text: 'HTML formatted. Your code has not been changed while typing.' });
  };

  const copyCurrentHtml = async () => {
    if (!editing || editing.customHtml === undefined) return;
    try {
      await navigator.clipboard.writeText(editing.customHtml);
      setNotice({ tone: 'success', text: 'Formatted HTML copied to your clipboard.' });
    } catch {
      const editor = htmlEditorRef.current;
      if (editor) {
        editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
        editor.focus();
        setNotice({ tone: 'info', text: 'The HTML source is selected. Press Ctrl+C to copy it.' });
      } else {
        setNotice({ tone: 'error', text: 'Clipboard access is unavailable in this browser.' });
      }
    }
  };

  const findNextHtmlMatch = () => {
    const editor = htmlEditorRef.current;
    const query = htmlFind.trim();
    if (!editor || !query) return;
    const source = editor.state.doc.toString();
    const cursor = editor.state.selection.main.head;
    const found = source.toLowerCase().indexOf(query.toLowerCase(), cursor);
    const index = found >= 0 ? found : source.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) {
      setNotice({ tone: 'error', text: 'No matching text was found in the HTML source.' });
      return;
    }
    editor.dispatch({
      selection: { anchor: index, head: index + query.length },
      scrollIntoView: true,
    });
    editor.focus();
  };

  const switchToHtmlMode = () => {
    if (!editing) return;
    if (editing.customHtml !== undefined) {
      setEditorMode('html');
      return;
    }
    const source = formatEmailHtml(createEmailDesignHtmlSource(editing, brandData));
    setEditing((current) => current ? { ...current, customHtml: source } : current);
    setEditorMode('html');
    setHtmlExpanded(false);
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
    if (isCampaignMode) visualCopy.campaignTemplateId = '';
    visualCopy.createdAt = undefined;
    visualCopy.updatedAt = undefined;
    setEditing(visualCopy);
    setSelectedBlockId(visualCopy.blocks.find((item) => item.type !== 'content')?.id || visualCopy.blocks[0]?.id || '');
    setEditorMode('visual');
    setEditorPanel('blocks');
    setHtmlExpanded(false);
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
      setNotice({ tone: 'error', text: isCampaignMode ? 'Give your campaign email a name before saving.' : 'Give your email design a name before saving.' });
      return null;
    }
    if (isCampaignMode && pendingAttachmentReads > 0) {
      setNotice({ tone: 'info', text: 'Please wait for the selected attachments to finish uploading into the template.' });
      return null;
    }
    if (isCampaignMode && !String(editing.campaignSubject || '').trim()) {
      setNotice({ tone: 'error', text: 'Add an email subject before saving this campaign template.' });
      return null;
    }
    if (isCampaignMode && editing.customHtml === undefined && !String(editing.campaignBody || '').trim()) {
      setNotice({ tone: 'error', text: 'Add the campaign message before saving this Visual Builder template.' });
      return null;
    }
    if (isCampaignMode) {
      const htmlForValidation = editing.customHtml || renderEmailDesignHtml(editing, String(editing.campaignBody || ''), brandData);
      const unsupported = getUnsupportedEmailTemplateVariables({
        subject: [editing.campaignSubject, editing.campaignPreheader].join(' '),
        body: String(editing.campaignBody || ''),
        htmlBody: htmlForValidation.replace(/\{\{\s*content\s*\}\}/gi, ''),
      });
      if (unsupported.length) {
        setNotice({ tone: 'error', text: 'Unsupported personalization field(s): ' + unsupported.map((field) => '{{' + field + '}}').join(', ') + '. Use the supported fields shown in the message editor.' });
        return null;
      }
    }
    if (editing.customHtml !== undefined && !isCampaignMode) {
      const validation = validateEmailDesignHtml(editing.customHtml);
      if (!validation.valid) {
        setNotice({ tone: 'error', text: validation.error || 'Please fix the HTML before saving.' });
        return null;
      }
    }
    if (isCampaignMode) {
      setBusy(true);
      setNotice(null);
      try {
        const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        let htmlBody = renderEmailDesignHtml(editing, String(editing.campaignBody || ''), brandData);
        const preheader = String(editing.campaignPreheader || '').trim();
        if (preheader) {
          const hidden = '<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">' + escapeText(preheader) + '</div>';
          htmlBody = /<body\b[^>]*>/i.test(htmlBody) ? htmlBody.replace(/<body\b[^>]*>/i, (match) => match + hidden) : hidden + htmlBody;
        }
        const plainBody = String(editing.campaignBody || '').trim() || htmlBody.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
        const templateId = String(editing.campaignTemplateId || (editing.source === 'PREDEFINED' ? '' : editing.id) || '');
        const designSnapshot = { ...editing, id: '', source: 'CUSTOM' as const, campaignTemplateId: templateId };
        delete designSnapshot.campaignAttachments;
        delete designSnapshot.campaignBody;
        delete designSnapshot.campaignSubject;
        delete designSnapshot.campaignPreheader;
        const payload = {
          templateId,
          name,
          subject: String(editing.campaignSubject || '').trim(),
          preheader,
          body: plainBody,
          htmlBody,
          format: 'html' as const,
          isHtml: true,
          attachments: Array.isArray(editing.campaignAttachments) ? editing.campaignAttachments : [],
          designSnapshot,
        };
        const response = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success || !data.template) throw new Error(data.error || 'Could not save the campaign email template.');
        const saved = campaignEmailToDesign(data.template as EmailTemplate);
        setTemplates((current) => [...current.filter((item) => item.id !== saved.id), saved]);
        setEditing(saved);
        setNotice({ tone: 'success', text: makeDefault ? 'Campaign email saved. Campaign templates are selected when creating a campaign.' : 'Campaign email template saved and is available in Campaigns.' });
        return saved;
      } catch (error: any) {
        setNotice({ tone: 'error', text: error?.message || 'Could not save the campaign email template.' });
        return null;
      } finally {
        setBusy(false);
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
      const response = await fetch((isCampaignMode ? '/api/templates/' : '/api/email-design/') + encodeURIComponent(template.id), { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not delete this design.');
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (!isCampaignMode && defaultTemplateId === template.id) setDefaultTemplateId('modern-professional');
      setNotice({ tone: 'success', text: isCampaignMode ? 'Campaign email template deleted. Existing campaigns and sent emails are unchanged.' : 'Design deleted. Previously sent emails are unchanged.' });
    } catch (error: any) {
      setNotice({ tone: 'error', text: error?.message || 'Could not delete this design.' });
    } finally {
      setBusy(false);
    }
  };

  const duplicateTemplate = (template: EmailDesignTemplate) => {
    const copy = cloneTemplate(template);
    copy.id = '';
    if (isCampaignMode) copy.campaignTemplateId = '';
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
    setAiWarning('');
    setAiStep('website');
  };

  const buildWorkspaceBrandProfile = (rawUrl: string): EmailBrandProfile => {
    const trimmedUrl = rawUrl.trim();
    const normalizedUrl = !trimmedUrl ? String(brandData.websiteUrl || '') : /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : 'https://' + trimmedUrl;
    let guessedName = 'Your Company';
    try {
      if (!normalizedUrl) throw new Error('No website URL was provided.');
      const host = new URL(normalizedUrl).hostname.replace(/^www\./i, '');
      const firstLabel = host.split('.')[0].replace(/[-_]+/g, ' ').trim();
      guessedName = firstLabel.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || guessedName;
    } catch {
      // The user can correct the URL and company name in the verification step.
    }
    return {
      websiteUrl: normalizedUrl,
      companyName: String(brandData.companyName || guessedName),
      tagline: String(brandData.tagline || ''),
      description: String(brandData.industryDescription || ''),
      logoUrl: String(brandData.logoUrl || ''),
      contactEmail: String(brandData.salesEmail || brandData.email || ''),
      contactPhone: String(brandData.supportPhone || brandData.phone || ''),
      colors: [],
      socialLinks: {},
    };
  };

  const continueWithWorkspaceBrand = (rawUrl = websiteUrl || brandData.websiteUrl || '') => {
    const profile = buildWorkspaceBrandProfile(rawUrl);
    setWebsiteUrl(profile.websiteUrl);
    setBrandProfile(profile);
    setAiError('');
    setAiWarning('Website analysis was skipped. We prefilled your saved workspace details; review the company information, add your logo and brand colours, then generate the design.');
    setAiStep('verify');
  };

  const analyzeWebsite = async () => {
    setBusy(true);
    setAiError('');
    setAiWarning('');
    const normalizedUrl = /^https?:\/\//i.test(websiteUrl.trim()) ? websiteUrl.trim() : 'https://' + websiteUrl.trim();
    try {
      const response = await fetch('/api/email-design/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: normalizedUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const message = String(data.error || 'Could not analyse this website.');
        if (/\b403\b|forbidden|blocked.*automated|access denied/i.test(message)) {
          continueWithWorkspaceBrand(normalizedUrl);
          setAiWarning('The website blocks automated access (HTTP 403). We have filled in your saved workspace details instead. Review them below—AI design generation will still work.');
          return;
        }
        throw new Error(message);
      }
      setBrandProfile(data.brandProfile);
      setWebsiteUrl(normalizedUrl);
      setAiWarning('');
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
    const htmlValidation = isCampaignMode
      ? { valid: Boolean(String(editing.customHtml || '').trim()), error: 'Add your campaign email HTML before saving.', warnings: [] as string[] }
      : validateEmailDesignHtml(editing.customHtml ?? '');
    return (
      <div className={htmlExpanded ? "fixed inset-0 z-[100] h-screen w-screen flex flex-col bg-slate-50" : "h-full min-h-[760px] flex flex-col bg-slate-50 -m-4 lg:-m-6"}>
        <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
          <button onClick={() => { setEditing(null); setNotice(null); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Back to Email Design Studio">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-[170px] flex-1">
            <input value={editing.name} onChange={(event) => updateTemplate({ name: event.target.value })} className="w-full text-sm font-bold text-slate-900 outline-none border-b border-transparent focus:border-orange-400 py-1" placeholder="Name your email design" />
            <p className="text-[10px] text-slate-400">{isCampaignMode ? 'Campaign email · Full HTML controls the complete message layout and content' : 'Full HTML email design · Your message is inserted at the required content placeholder'}</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button onClick={() => void switchToVisualMode()} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5">
              <LayoutTemplate className="w-3.5 h-3.5" /> Visual Builder
            </button>
            <button className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white shadow-sm flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5" /> Full HTML
            </button>
          </div>
          {!htmlExpanded && <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setPreviewMode('desktop')} className={'p-2 rounded-md ' + (previewMode === 'desktop' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')} title="Desktop preview"><Monitor className="w-4 h-4" /></button>
            <button onClick={() => setPreviewMode('mobile')} className={'p-2 rounded-md ' + (previewMode === 'mobile' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')} title="Mobile preview"><Smartphone className="w-4 h-4" /></button>
          </div>}
          <button type="button" onClick={() => setHtmlExpanded((value) => !value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5" title={htmlExpanded ? "Restore split view" : "Expand code editor"}>
            {htmlExpanded ? <><Minimize2 className="w-3.5 h-3.5" /> Restore view</> : <><Maximize2 className="w-3.5 h-3.5" /> Expand editor</>}
          </button>
          <button disabled={busy || pendingAttachmentReads > 0 || !htmlValidation.valid} title={pendingAttachmentReads > 0 ? 'Wait for attachment reads to finish' : !htmlValidation.valid ? (isCampaignMode ? 'Add campaign email HTML before saving' : 'Add exactly one {{content}} placeholder before saving') : 'Save template'} onClick={() => void saveTemplate(false)} className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            <Save className="w-3.5 h-3.5" /> {isCampaignMode ? 'Save campaign template' : 'Save design'}
          </button>
          {!isCampaignMode && <button disabled={busy || !htmlValidation.valid} title={!htmlValidation.valid ? 'Add exactly one {{content}} placeholder before saving' : 'Save and set default'} onClick={() => void saveTemplate(true)} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
            <Star className="w-3.5 h-3.5" /> Save & set default
          </button>}
        </div>
        {notice && <div className={'px-5 py-2 text-xs border-b ' + (notice.tone === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : notice.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-700')}>{notice.text}</div>}
        <div className={htmlExpanded ? "flex-1 min-h-0 grid grid-cols-1" : "flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]"}>
          <section className={(htmlExpanded ? "h-full min-h-0" : "min-h-[580px] xl:min-h-0") + " bg-white border-r border-slate-200 flex flex-col overflow-hidden"}>
            {isCampaignMode && <div className="mb-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-2"><label className="text-[11px] font-semibold text-slate-600">Campaign subject *<input value={editing.campaignSubject || ''} onChange={(event) => updateTemplate({ campaignSubject: event.target.value })} maxLength={180} placeholder="Write your email subject" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label><label className="text-[11px] font-semibold text-slate-600">Preheader<input value={editing.campaignPreheader || ''} onChange={(event) => updateTemplate({ campaignPreheader: event.target.value })} maxLength={180} placeholder="Optional preview text" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label></div><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-semibold text-slate-600"><Paperclip className="mr-1 inline h-3.5 w-3.5" />Attachments ({(editing.campaignAttachments || []).length})</span><button type="button" onClick={() => campaignAttachmentInputRef.current?.click()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-orange-300">Add files</button><input ref={campaignAttachmentInputRef} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.zip" onChange={(event) => addCampaignAttachments(event.target.files)} /></div>{(editing.campaignAttachments || []).length > 0 && <div className="flex flex-wrap gap-2">{(editing.campaignAttachments || []).map((attachment: any) => <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-700"><span className="max-w-[220px] truncate">{attachment.filename || attachment.name}</span><button type="button" onClick={() => removeCampaignAttachment(attachment.id)} className="text-slate-400 hover:text-rose-600" aria-label="Remove attachment">×</button></span>)}</div>}</div>}
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold text-slate-800">HTML source</h2>
                <p className="text-[10px] text-slate-400">CodeMirror 6 · HTML syntax · clear contrast and line numbers</p>
              </div>
              <span className={'text-[10px] font-bold px-2.5 py-1 rounded-full ' + (htmlValidation.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
                {htmlValidation.valid ? (isCampaignMode ? 'HTML ready' : 'Message slot ready') : 'Needs attention'}
              </span>
            </div>
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2">
              <button type="button" onClick={formatCurrentHtml} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-orange-300 hover:text-orange-700 text-[11px] font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Format HTML
              </button>
              <button type="button" onClick={() => void copyCurrentHtml()} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-orange-300 hover:text-orange-700 text-[11px] font-semibold flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copy HTML
              </button>
              <button type="button" onClick={() => setHtmlWordWrap((value) => !value)} aria-pressed={htmlWordWrap} className={"px-3 py-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 " + (htmlWordWrap ? "border-sky-200 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600")} title="Toggle long-line wrapping">
                <WrapText className="w-3.5 h-3.5" /> Wrap {htmlWordWrap ? "On" : "Off"}
              </button>
              <div className="ml-auto flex items-center gap-1.5 min-w-[190px]">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input value={htmlFind} onChange={(event) => setHtmlFind(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') findNextHtmlMatch(); }} placeholder="Find in HTML..." className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] outline-none focus:border-orange-400" />
                <button type="button" onClick={findNextHtmlMatch} className="px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold hover:border-orange-300">Find</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <HtmlSourceEditor editorRef={htmlEditorRef} value={editing.customHtml ?? ''} onChange={(value) => updateTemplate({ customHtml: value })} wordWrap={htmlWordWrap} />
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-white space-y-1.5">
              {htmlValidation.valid ? (
                <p className="text-[11px] text-emerald-700 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> {isCampaignMode ? 'Campaign email HTML is ready to save.' : <>Exactly one {'{{content}}'} placeholder is present and survives email sanitization.</>}</p>
              ) : (
                <p className="text-[11px] text-rose-700 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> {htmlValidation.error}</p>
              )}
              {htmlValidation.warnings.map((warning) => <p key={warning} className="text-[10px] text-amber-700">• {warning}</p>)}
              <p className="text-[10px] text-slate-400">{isCampaignMode ? 'Write the complete campaign email in HTML. Personalization fields such as {{firstName}} are resolved when the campaign sends.' : <>Use <code className="font-mono">{'{{content}}'}</code> exactly once where the message should appear.</>} Format HTML is manual; typing never reformats your source.</p>
            </div>
          </section>
{!htmlExpanded && (
          <main className="min-h-[580px] xl:min-h-0 flex flex-col p-3 lg:p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div><h2 className="text-xs font-bold text-slate-700">Live email preview</h2><p className="text-[10px] text-slate-400">Sample recipient message is inserted where {'{{content}}'} appears.</p></div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{previewMode} view</span>
            </div>
            <EmailPreview template={editing} brand={brandData} mode={previewMode} content={isCampaignMode ? previewCampaignValue(editing.campaignBody || '') : undefined} />
          </main>
          )}
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
            <p className="text-[10px] text-slate-400">{isCampaignMode ? 'Campaign email template · Subject, preheader and message content are saved with this design' : (editing.source === 'AI' ? 'AI-generated design' : 'Custom email design') + ' · Message content is inserted automatically at the reserved content block'}</p>
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
          <button disabled={busy || (isCampaignMode && pendingAttachmentReads > 0)} onClick={() => saveTemplate(false)} className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {isCampaignMode ? 'Save campaign template' : 'Save design'}
          </button>
          {!isCampaignMode && <button disabled={busy} onClick={() => saveTemplate(true)} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50">
            <Star className="w-3.5 h-3.5" /> Save & set default
          </button>}
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
                        <span className="block text-xs font-semibold text-slate-700 capitalize">{item.type === 'content' ? (isCampaignMode ? 'Campaign message (editable)' : 'Message content (locked)') : item.type === 'logo' ? 'Brand header' : item.type === 'hero' ? 'Hero banner' : item.type}</span>
                        <span className="block text-[10px] text-slate-400 truncate">{item.type === 'content' ? (isCampaignMode ? (editing.campaignBody || 'Write the campaign message in the settings panel') : 'Original email text is inserted here') : (item.text || item.altText || 'Design block')}</span>
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
            <EmailPreview template={editing} brand={brandData} mode={previewMode} content={isCampaignMode ? editing.campaignBody : undefined} />
          </main>
          <aside className="bg-white border-l border-slate-200 p-4 overflow-y-auto max-h-[360px] xl:max-h-none">
            {isCampaignMode && <div className="mb-4 space-y-3 border-b border-slate-100 pb-4"><h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Campaign settings</h3><label className="block text-xs font-semibold text-slate-600">Email subject *<input value={editing.campaignSubject || ''} onChange={(event) => updateTemplate({ campaignSubject: event.target.value })} maxLength={180} placeholder="Write your subject line" className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" /></label><label className="block text-xs font-semibold text-slate-600">Preheader (optional)<input value={editing.campaignPreheader || ''} onChange={(event) => updateTemplate({ campaignPreheader: event.target.value })} maxLength={180} placeholder="Preview text shown beside the subject" className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" /></label><p className="text-[10px] text-slate-400">The subject and preheader support the same personalization fields as the message.</p><div className="space-y-2"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-600"><Paperclip className="mr-1 inline h-3.5 w-3.5" />Attachments ({(editing.campaignAttachments || []).length})</span><button type="button" onClick={() => campaignAttachmentInputRef.current?.click()} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:border-orange-300">Add files</button><input ref={campaignAttachmentInputRef} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.zip" onChange={(event) => addCampaignAttachments(event.target.files)} /></div>{(editing.campaignAttachments || []).map((attachment: any) => <div key={attachment.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px]"><span className="min-w-0 truncate">{attachment.filename || attachment.name}</span><button type="button" onClick={() => removeCampaignAttachment(attachment.id)} className="shrink-0 text-slate-400 hover:text-rose-600">Remove</button></div>)}</div></div>}
            {selectedBlock ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900 capitalize">{selectedBlock.type === 'content' ? 'Message content area' : selectedBlock.type + ' settings'}</h3><p className="text-[10px] text-slate-400">Selected block</p></div>{selectedBlock.type === 'content' && <span className="text-[9px] px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full font-bold">Required</span>}</div>
                {selectedBlock.type === 'content' ? (
                  isCampaignMode ? <div className="space-y-3"><label className="block text-xs font-semibold text-slate-600">Campaign message *<textarea rows={12} value={editing.campaignBody || ''} onChange={(event) => updateTemplate({ campaignBody: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-xs font-normal leading-relaxed" placeholder="Write your complete campaign message here. Add personalization fields where they belong." /></label><p className="text-[10px] text-slate-500">This content is rendered inside your selected email design. Personalization is resolved separately for each recipient.</p><div className="flex flex-wrap gap-1.5">{['name','firstName','lastName','company','companyName','designation','jobTitle','email'].map((field) => <button key={field} type="button" onClick={() => updateTemplate({ campaignBody: String(editing.campaignBody || '') + `{{${field}}}` })} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-mono text-slate-600 hover:border-orange-300 hover:text-orange-700">{`{{${field}}}`}</button>)}</div></div> : <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs leading-relaxed text-emerald-900">This is the reserved message area. Amaavigo inserts the original AI-generated, follow-up or manually composed email text here. It cannot be removed or rewritten by the template.</div>
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
                    {selectedBlock.type === 'logo' && <label className="block text-xs font-semibold text-slate-600">Brand name
                      <input value={selectedBlock.text || ''} onChange={(event) => updateBlock(selectedBlock.id, { text: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" placeholder={String(brandData.companyName || 'Your company name')} maxLength={120} />
                      <span className="mt-1 block text-[10px] font-normal text-slate-400">Shown as text when no logo image is selected. Leave blank to use your workspace company name.</span>
                    </label>}
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
              <p className="mt-3 text-[10px] text-slate-400">{isCampaignMode ? 'Reusable campaign email design. Its subject, preheader, content and attachments are stored together.' : `Template version ${editing.version || 1}. The selected design applies only to AI replies, AI auto follow-ups and manual emails sent from Unified Inbox.`}</p>
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
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{isCampaignMode ? 'Campaign Email Templates' : 'Conversation Email Designs'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{isCampaignMode ? 'Create complete campaign emails with subject lines, preheaders, recipient personalization and reusable branded layouts.' : 'Create a consistent, branded email experience for AI replies, AI auto follow-ups and manual Unified Inbox emails.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={startFromScratch} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-orange-300 text-slate-700 text-xs font-bold shadow-sm"><Plus className="w-4 h-4" />{isCampaignMode ? 'Create campaign email' : 'Create from scratch'}</button>
          <button onClick={openAiBuilder} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm"><Sparkles className="w-4 h-4" />Generate with AI</button>
        </div>
      </div>

      {!isCampaignMode && <div className="rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50 via-white to-amber-50 p-4 lg:p-5 flex flex-col md:flex-row md:items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-white border border-orange-100 flex items-center justify-center text-orange-600"><Star className="w-5 h-5" /></div>
        <div className="flex-1"><p className="text-xs font-bold text-slate-900">Default email design</p><p className="text-sm text-slate-600">{templates.find((item) => item.id === defaultTemplateId)?.name || 'Modern Professional'}</p><p className="text-[11px] text-slate-500 mt-0.5">This design is used for all AI-generated replies, AI auto follow-ups and manual replies from Unified Inbox. Outbound campaign templates remain separate.</p></div>
        <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] font-bold"><Check className="w-3.5 h-3.5" />Active default</span>
      </div>}

      {notice && <div className={'px-4 py-3 rounded-xl border text-xs ' + (notice.tone === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : notice.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-700')}>{notice.text}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          <button onClick={() => { setTab('gallery'); setSearch(''); }} className={'px-4 py-2 rounded-lg text-xs font-bold ' + (tab === 'gallery' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><LayoutTemplate className="inline w-3.5 h-3.5 mr-1.5" />{isCampaignMode ? 'Starter templates' : 'Predefined templates'}</button>
          <button onClick={() => { setTab('my-designs'); setSearch(''); }} className={'px-4 py-2 rounded-lg text-xs font-bold ' + (tab === 'my-designs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{isCampaignMode ? 'My campaign templates' : 'My designs'} <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-200 text-[10px]">{customTemplates.length}</span></button>
        </div>
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isCampaignMode ? 'Search campaign email templates...' : 'Search email designs...'} className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs outline-none focus:border-orange-400" /></div>
      </div>

      {tab === 'gallery' && <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((item) => <button key={item} onClick={() => setCategory(item)} className={'px-3 py-1.5 rounded-full text-[11px] font-semibold border ' + (category === item ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300')}>{item}</button>)}
      </div>}

      {loading ? <div className="py-20 flex items-center justify-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading designs...</div> : visibleTemplates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center"><LayoutTemplate className="w-8 h-8 mx-auto text-slate-300" /><h3 className="mt-3 text-sm font-bold text-slate-800">{filteredPredefined ? 'No templates match your search' : (isCampaignMode ? 'Your campaign email templates will appear here' : 'Your saved designs will appear here')}</h3><p className="mt-1 text-xs text-slate-500">{filteredPredefined ? 'Try another search or category.' : 'Start with a starter design or a blank canvas. Add a subject and campaign message, then save.'}</p><button onClick={startFromScratch} className="mt-4 text-xs font-bold text-orange-600">Create your first design</button></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5">
          {visibleTemplates.map((template) => {
            const isDefault = template.id === defaultTemplateId;
            return <article key={template.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow-md hover:border-slate-300 transition">
              <EmailPreview template={template} brand={brandData} compact content={isCampaignMode ? template.campaignBody : undefined} />
              <div className="px-1 pt-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-slate-900 truncate">{template.name}</h3>{isDefault && <span className="shrink-0 text-[9px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">DEFAULT</span>}</div><p className="mt-1 text-[11px] text-slate-500 line-clamp-2 min-h-[32px]">{template.description}</p></div><span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-400">{template.category}</span></div>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => { const copy = cloneTemplate(template); if (template.source === 'PREDEFINED') { copy.id = ''; if (isCampaignMode) copy.campaignTemplateId = ''; copy.source = 'CUSTOM'; } startEditing(copy); }} className="flex-1 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold"><Eye className="inline w-3.5 h-3.5 mr-1.5" />Customize</button>
                  {!isCampaignMode && <button disabled={busy || isDefault} onClick={() => setDefault(template.id)} className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-semibold disabled:opacity-40">{isDefault ? 'Selected' : 'Set default'}</button>}
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
        <div className="flex-1"><p className="text-xs font-bold text-slate-800">Company Assets are shared across email templates</p><p className="text-[11px] text-slate-500">Reuse approved logos, banners and images in conversation designs and campaign emails.</p></div>
        <button onClick={() => { setEditing(createBlankEmailDesignTemplate()); setSelectedBlockId(''); setShowAssets(true); }} className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700">Browse assets</button>
      </div>

      {aiStep && <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-3 lg:p-8">
        <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between"><div><div className="flex items-center gap-2 text-orange-600"><Sparkles className="w-4 h-4" /><span className="text-[10px] uppercase font-bold tracking-widest">AI design generator</span></div><h2 className="mt-1 text-lg font-extrabold text-slate-900">{aiStep === 'website' ? 'Start with your company website' : 'Verify your brand details'}</h2><p className="text-xs text-slate-500 mt-1">{aiStep === 'website' ? 'We will analyse your public website to identify your visual identity.' : 'Review the extracted information before asking AI to create the template.'}</p></div><button onClick={() => setAiStep(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button></div>
          <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto">
            {aiError && <div className="rounded-lg bg-rose-50 border border-rose-100 text-rose-700 text-xs px-3 py-2">{aiError}</div>}
            {aiWarning && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 leading-relaxed">{aiWarning}</div>}
            {aiStep === 'website' ? <>
              <label className="block text-xs font-bold text-slate-700">Company website URL
                <input type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://www.yourcompany.com" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal outline-none focus:border-orange-400" />
              </label>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 leading-relaxed"><strong>What we analyse:</strong> company identity, public logo and images, visible brand colours, page title and description, contact details and social links. You will review and correct the details before design generation.</div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><p className="text-xs font-semibold text-slate-800">Website blocks automated access?</p><p className="text-[11px] text-slate-500 mt-0.5">Continue using your saved company profile and fill in any missing details.</p></div><button type="button" onClick={() => continueWithWorkspaceBrand()} className="shrink-0 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-orange-300 hover:text-orange-700">Enter details manually</button></div>
            </> : brandProfile && <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-600">Company name<input value={brandProfile.companyName} onChange={(event) => updateProfile({ companyName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
                <label className="block text-xs font-semibold text-slate-600">Tagline<input value={brandProfile.tagline} onChange={(event) => updateProfile({ tagline: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
                <label className="block text-xs font-semibold text-slate-600">Contact email<input value={brandProfile.contactEmail} onChange={(event) => updateProfile({ contactEmail: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
                <label className="block text-xs font-semibold text-slate-600">Contact phone<input value={brandProfile.contactPhone} onChange={(event) => updateProfile({ contactPhone: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              </div>
              <label className="block text-xs font-semibold text-slate-600">Company description<textarea rows={3} value={brandProfile.description} onChange={(event) => updateProfile({ description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-600">Logo URL<input value={brandProfile.logoUrl} onChange={(event) => updateProfile({ logoUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal" /></label>
              <div><p className="text-xs font-semibold text-slate-600 mb-2">Extracted brand colours</p><div className="flex flex-wrap items-center gap-2">{profileColors.map((color, index) => <label key={color + index} className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1.5"><input type="color" value={color} onChange={(event) => updateProfile({ colors: profileColors.map((value, i) => i === index ? event.target.value : value) })} className="w-6 h-6" /><span className="text-[10px] font-mono text-slate-500">{color}</span></label>)}{profileColors.length === 0 && <span className="text-[11px] text-slate-400">No colours detected yet. Add your brand colours or let AI start with a neutral palette.</span>}</div><button type="button" onClick={() => updateProfile({ colors: [...profileColors, '#183B66'].slice(0, 6) })} disabled={profileColors.length >= 6} className="mt-2 text-[11px] font-semibold text-orange-700 disabled:opacity-40">+ Add brand colour</button></div>
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
            {aiStep === 'verify' ? <button disabled={busy} onClick={() => { setAiWarning(''); setAiStep('website'); }} className="px-3 py-2 text-xs font-semibold text-slate-600">Change website</button> : <span className="text-[10px] text-slate-400">Website analysis is optional</span>}
            {aiStep === 'website' ? <button disabled={busy || !websiteUrl.trim()} onClick={analyzeWebsite} className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50">{busy ? <><Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" />Analysing website...</> : 'Analyse website'}</button> : <button disabled={busy || !brandProfile?.companyName.trim()} onClick={generateWithAi} className="px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold disabled:opacity-50">{busy ? <><Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" />Creating your design...</> : <><Sparkles className="inline w-3.5 h-3.5 mr-1" />Generate email design</>}</button>}
          </div>
        </div>
      </div>}
    </div>
  );
};
