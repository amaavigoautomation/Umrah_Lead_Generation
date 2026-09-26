import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
  Mail,
  Paperclip,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link2,
  Unlink,
  Code,
  Eye,
  Type,
  Trash2,
  Upload,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Smartphone,
  Monitor,
  Download,
  Layers,
  Palette,
  CheckCircle2,
} from 'lucide-react';
import { EmailTemplate, TemplateAttachment } from '../types/index.js';

interface EmailTemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: EmailTemplate) => Promise<void>;
  editingTemplate: EmailTemplate | null;
  isSaving: boolean;
  error?: string | null;
}

const PRESET_COLORS = [
  { label: 'White / Default', value: '#f8fafc' },
  { label: 'Emerald Green', value: '#34d399' },
  { label: 'Sky Blue', value: '#38bdf8' },
  { label: 'Amber Gold', value: '#fbbf24' },
  { label: 'Rose Red', value: '#f43f5e' },
  { label: 'Indigo Purple', value: '#818cf8' },
  { label: 'Slate Gray', value: '#94a3b8' },
];

const PRESET_HIGHLIGHTS = [
  { label: 'None', value: 'transparent' },
  { label: 'Yellow Tint', value: 'rgba(234, 179, 8, 0.25)' },
  { label: 'Emerald Tint', value: 'rgba(16, 185, 129, 0.25)' },
  { label: 'Sky Blue Tint', value: 'rgba(56, 189, 248, 0.25)' },
  { label: 'Dark Slate Box', value: 'rgba(30, 41, 59, 0.9)' },
];

export const EmailTemplateEditorModal: React.FC<EmailTemplateEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingTemplate,
  isSaving,
  error,
}) => {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [formatMode, setFormatMode] = useState<'VISUAL' | 'HTML' | 'PLAIN'>('VISUAL');
  const [htmlContent, setHtmlContent] = useState('');
  const [plainTextContent, setPlainTextContent] = useState('');
  const [attachments, setAttachments] = useState<TemplateAttachment[]>([]);
  const [previewDevice, setPreviewDevice] = useState<'DESKTOP' | 'MOBILE'>('DESKTOP');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [linkInputUrl, setLinkInputUrl] = useState('');
  const [isLinkPromptOpen, setIsLinkPromptOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const visualEditorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or populate form
  useEffect(() => {
    if (editingTemplate) {
      setName(editingTemplate.name || '');
      setSubject(editingTemplate.subject || '');
      const initialHtml = editingTemplate.htmlBody || (editingTemplate.isHtml ? editingTemplate.body : '');
      const initialPlain = editingTemplate.body || '';

      if (initialHtml) {
        setHtmlContent(initialHtml);
        setPlainTextContent(initialPlain || stripHtml(initialHtml));
        setFormatMode(editingTemplate.format === 'html' || editingTemplate.isHtml ? 'VISUAL' : 'PLAIN');
      } else {
        setPlainTextContent(initialPlain);
        setHtmlContent(plainToHtml(initialPlain));
        setFormatMode('VISUAL');
      }

      setAttachments(editingTemplate.attachments || []);
    } else {
      setName('');
      setSubject('Streamlining Pilgrimage Operations for {{company}}');
      const defaultHtml = `<p>Hi <strong>{{name}}</strong>,</p><p>I noticed you lead operations at <strong>{{company}}</strong>.</p><p>Umrah360 helps pilgrimage tour operators automate dynamic package pricing, manage sub-agent distribution, and streamline Makkah & Madinah hotel allotments in real-time.</p><p>Would you be open to a brief 10-minute walkthrough this week?</p><p>Best regards,<br/><strong>Umrah360 Team</strong></p>`;
      setHtmlContent(defaultHtml);
      setPlainTextContent(stripHtml(defaultHtml));
      setAttachments([]);
      setFormatMode('VISUAL');
    }
    setLocalError(null);
  }, [editingTemplate, isOpen]);

  // Sync visual editor innerHTML when mode changes or template opens
  useEffect(() => {
    if (formatMode === 'VISUAL' && visualEditorRef.current) {
      visualEditorRef.current.innerHTML = htmlContent || plainToHtml(plainTextContent);
    }
  }, [formatMode, isOpen]);

  if (!isOpen) return null;

  // Helper functions
  function stripHtml(html: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function plainToHtml(text: string): string {
    if (!text) return '<p></p>';
    const paragraphs = text.split(/\n\n+/);
    return paragraphs
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('');
  }

  const handleVisualInput = () => {
    if (visualEditorRef.current) {
      const html = visualEditorRef.current.innerHTML;
      setHtmlContent(html);
      setPlainTextContent(stripHtml(html));
    }
  };

  const handleHtmlCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setHtmlContent(val);
    setPlainTextContent(stripHtml(val));
    if (visualEditorRef.current) {
      visualEditorRef.current.innerHTML = val;
    }
  };

  const handlePlainTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPlainTextContent(val);
    const converted = plainToHtml(val);
    setHtmlContent(converted);
    if (visualEditorRef.current) {
      visualEditorRef.current.innerHTML = converted;
    }
  };

  // Rich Text Formatting Commands
  const executeCommand = (command: string, value: string | undefined = undefined) => {
    if (formatMode !== 'VISUAL') {
      setFormatMode('VISUAL');
    }
    setTimeout(() => {
      if (visualEditorRef.current) {
        visualEditorRef.current.focus();
        document.execCommand(command, false, value);
        handleVisualInput();
      }
    }, 10);
  };

  const applyFontSize = (sizeVal: string) => {
    if (formatMode !== 'VISUAL') setFormatMode('VISUAL');
    setTimeout(() => {
      if (visualEditorRef.current) {
        visualEditorRef.current.focus();
        document.execCommand('fontSize', false, sizeVal);
        handleVisualInput();
      }
    }, 10);
  };

  const applyFormatBlock = (tag: string) => {
    if (formatMode !== 'VISUAL') setFormatMode('VISUAL');
    setTimeout(() => {
      if (visualEditorRef.current) {
        visualEditorRef.current.focus();
        document.execCommand('formatBlock', false, tag);
        handleVisualInput();
      }
    }, 10);
  };

  const handleInsertLink = () => {
    if (!linkInputUrl.trim()) return;
    let url = linkInputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('mailto:')) {
      url = `https://${url}`;
    }
    executeCommand('createLink', url);
    setLinkInputUrl('');
    setIsLinkPromptOpen(false);
  };

  const insertVariableIntoContent = (varName: string) => {
    const tag = `{{${varName}}}`;
    if (formatMode === 'VISUAL' && visualEditorRef.current) {
      visualEditorRef.current.focus();
      document.execCommand('insertText', false, tag);
      handleVisualInput();
    } else if (formatMode === 'HTML') {
      setHtmlContent((prev) => `${prev} ${tag}`);
      setPlainTextContent((prev) => `${prev} ${tag}`);
    } else {
      setPlainTextContent((prev) => `${prev} ${tag}`);
      setHtmlContent((prev) => `${prev} ${tag}`);
    }
  };

  // Attachments Handling
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file: File) => {
      if (file.size > 15 * 1024 * 1024) {
        setLocalError(`File "${file.name}" exceeds 15MB size limit.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const newAttachment: TemplateAttachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          filename: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          contentType: file.type || 'application/octet-stream',
          dataUrl: result,
          base64: result.split(',')[1] || '',
        };

        setAttachments((prev) => [...prev, newAttachment]);
        setLocalError(null);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (filename: string, mimeType?: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['pdf'].includes(ext) || mimeType?.includes('pdf')) {
      return <FileText className="w-4 h-4 text-rose-400" />;
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || mimeType?.includes('image')) {
      return <ImageIcon className="w-4 h-4 text-amber-400" />;
    }
    if (['xlsx', 'xls', 'csv'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('csv')) {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    }
    return <File className="w-4 h-4 text-sky-400" />;
  };

  // Variable Sample Preview Replacer
  const renderPreviewWithSampleLead = (content: string) => {
    return content
      .replace(/\{\{\s*name\s*\}\}/gi, 'Mr. Tariq Farooq')
      .replace(/\{\{\s*firstName\s*\}\}/gi, 'Tariq')
      .replace(/\{\{\s*lastName\s*\}\}/gi, 'Farooq')
      .replace(/\{\{\s*company\s*\}\}/gi, 'Al-Bait Pilgrimage Tours')
      .replace(/\{\{\s*companyName\s*\}\}/gi, 'Al-Bait Pilgrimage Tours')
      .replace(/\{\{\s*designation\s*\}\}/gi, 'Managing Director')
      .replace(/\{\{\s*jobTitle\s*\}\}/gi, 'Managing Director')
      .replace(/\{\{\s*email\s*\}\}/gi, 'tariq@albait-tours.com');
  };

  // Save submission
  const handleSubmit = async () => {
    if (!name.trim()) {
      setLocalError('Please enter a Template Name.');
      return;
    }
    if (!subject.trim()) {
      setLocalError('Please enter a Subject Line.');
      return;
    }
    if (!htmlContent.trim() && !plainTextContent.trim()) {
      setLocalError('Please enter Email Body content.');
      return;
    }

    const templateId = editingTemplate?.templateId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const finalHtml = htmlContent || plainToHtml(plainTextContent);
    const finalPlain = plainTextContent || stripHtml(finalHtml);

    const payload: EmailTemplate = {
      templateId,
      name: name.trim(),
      subject: subject.trim(),
      body: finalPlain.trim(),
      htmlBody: finalHtml.trim(),
      format: formatMode === 'PLAIN' ? 'text' : 'html',
      isHtml: formatMode !== 'PLAIN' || finalHtml.includes('<') || attachments.length > 0,
      attachments: attachments,
      createdAt: editingTemplate?.createdAt || now,
      updatedAt: now,
    };

    try {
      await onSave(payload);
    } catch (err: any) {
      setLocalError(err.message || 'Failed to save template');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl max-h-[96vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        
        {/* MODAL HEADER */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-600">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>{editingTemplate ? 'Edit Email Template' : 'Create Email Template'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 border border-orange-200 font-mono font-medium">
                  Rich Text • HTML • Attachments
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Design styled emails with rich formatting, variable personalization, and persistent file attachments.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ERROR NOTIFICATION */}
        {(localError || error) && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{localError || error}</span>
          </div>
        )}

        {/* MAIN BODY: 2 COLUMN SPLIT (EDITOR & LIVE PREVIEW) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: TEMPLATE CONFIG & EDITOR (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            
            {/* Template Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Template Name *
              </label>
              <input
                type="text"
                placeholder="e.g. Ramadan B2B Operator Outreach"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setLocalError(null);
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 transition"
              />
            </div>

            {/* Subject Line with Quick Variable Tags */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Subject Line *
                </label>
                <div className="flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="text-slate-400 mr-1">Insert:</span>
                  {['name', 'company', 'designation'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSubject((prev) => `${prev} {{${v}}}`)}
                      className="px-1.5 py-0.5 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded font-mono border border-orange-200 transition"
                    >
                      +{`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                placeholder="e.g. Streamlining Pilgrimage Operations for {{company}}"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setLocalError(null);
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 transition"
              />
            </div>

            {/* EDITOR CONTROLS & STYLING PANEL */}
            <div className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-xs">
              
              {/* Top Mode Bar */}
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setFormatMode('VISUAL');
                      if (visualEditorRef.current) visualEditorRef.current.innerHTML = htmlContent;
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
                      formatMode === 'VISUAL'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Type className="w-3.5 h-3.5" />
                    <span>Visual Styled</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (formatMode === 'VISUAL' && visualEditorRef.current) {
                        setHtmlContent(visualEditorRef.current.innerHTML);
                      }
                      setFormatMode('HTML');
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
                      formatMode === 'HTML'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>HTML Code</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (formatMode === 'VISUAL' && visualEditorRef.current) {
                        setPlainTextContent(stripHtml(visualEditorRef.current.innerHTML));
                      }
                      setFormatMode('PLAIN');
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition flex items-center gap-1.5 ${
                      formatMode === 'PLAIN'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Plain Text</span>
                  </button>
                </div>

                {/* Variable Injector */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 uppercase font-semibold mr-1">Variables:</span>
                  {['name', 'firstName', 'company', 'designation', 'email'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVariableIntoContent(v)}
                      className="px-1.5 py-0.5 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-mono rounded border border-orange-200 transition"
                      title={`Insert {{${v}}} at cursor`}
                    >
                      +{v}
                    </button>
                  ))}
                </div>
              </div>

              {/* RICH TEXT STYLING TOOLBAR (Visible in Visual Mode) */}
              {formatMode === 'VISUAL' && (
                <div className="p-2 bg-slate-900/80 border-b border-slate-800/80 flex flex-wrap items-center gap-1 text-xs">
                  
                  {/* Headings & Text Size */}
                  <div className="flex items-center gap-1 pr-1.5 border-r border-slate-800">
                    <button
                      type="button"
                      onClick={() => applyFormatBlock('h1')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition font-bold text-xs"
                      title="Heading 1 (Large)"
                    >
                      H1
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormatBlock('h2')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition font-bold text-xs"
                      title="Heading 2 (Medium)"
                    >
                      H2
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormatBlock('p')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition text-xs"
                      title="Normal Paragraph"
                    >
                      Normal
                    </button>
                    <select
                      onChange={(e) => applyFontSize(e.target.value)}
                      defaultValue="3"
                      className="bg-slate-950 border border-slate-700 text-slate-200 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="2">Small (12px)</option>
                      <option value="3">Regular (14px)</option>
                      <option value="4">Medium (16px)</option>
                      <option value="5">Large (18px)</option>
                      <option value="6">X-Large (24px)</option>
                    </select>
                  </div>

                  {/* Basic Formatting: Bold, Italic, Underline, Strike */}
                  <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-800">
                    <button
                      type="button"
                      onClick={() => executeCommand('bold')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition font-bold"
                      title="Bold (Ctrl+B)"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('italic')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition italic"
                      title="Italic (Ctrl+I)"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('underline')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition underline"
                      title="Underline (Ctrl+U)"
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('strikeThrough')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Strikethrough"
                    >
                      <Strikethrough className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Alignment */}
                  <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-800">
                    <button
                      type="button"
                      onClick={() => executeCommand('justifyLeft')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Align Left"
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('justifyCenter')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Align Center"
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('justifyRight')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Align Right"
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('justifyFull')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Justify"
                    >
                      <AlignJustify className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Lists & Quotes */}
                  <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-800">
                    <button
                      type="button"
                      onClick={() => executeCommand('insertUnorderedList')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Bullet List"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('insertOrderedList')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Numbered List"
                    >
                      <ListOrdered className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormatBlock('blockquote')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Quote Block"
                    >
                      <Quote className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand('insertHorizontalRule')}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white rounded transition"
                      title="Horizontal Divider"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Text Color & Highlight Popovers */}
                  <div className="flex items-center gap-1 relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowColorPicker(!showColorPicker);
                        setShowHighlightPicker(false);
                      }}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-emerald-400 rounded transition flex items-center gap-1"
                      title="Text Color"
                    >
                      <Palette className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[10px]">Color</span>
                    </button>

                    {showColorPicker && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-slate-900 border border-slate-700 p-2 rounded-xl shadow-xl space-y-1.5 w-44">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase">Text Color</div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => {
                                executeCommand('foreColor', c.value);
                                setShowColorPicker(false);
                              }}
                              className="w-7 h-7 rounded-lg border border-slate-700 flex items-center justify-center transition hover:scale-110"
                              style={{ backgroundColor: c.value }}
                              title={c.label}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Links */}
                    <button
                      type="button"
                      onClick={() => setIsLinkPromptOpen(!isLinkPromptOpen)}
                      className="p-1.5 text-slate-300 hover:bg-slate-800 hover:text-sky-400 rounded transition flex items-center gap-1"
                      title="Insert Hyperlink"
                    >
                      <Link2 className="w-3.5 h-3.5 text-sky-400" />
                      <span className="text-[10px]">Link</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => executeCommand('removeFormat')}
                      className="p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 rounded transition text-[10px]"
                      title="Clear Formatting"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* LINK INJECTION PROMPT */}
              {isLinkPromptOpen && (
                <div className="p-2.5 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-sky-400 shrink-0" />
                  <input
                    type="url"
                    placeholder="https://umrah360.in/book-demo"
                    value={linkInputUrl}
                    onChange={(e) => setLinkInputUrl(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={handleInsertLink}
                    className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold"
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsLinkPromptOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* EDITOR INPUT VIEWPORTS */}
              <div className="p-3">
                {formatMode === 'VISUAL' && (
                  <div
                    ref={visualEditorRef}
                    contentEditable
                    onInput={handleVisualInput}
                    className="w-full min-h-[240px] max-h-[360px] overflow-y-auto px-4 py-3 bg-slate-950 rounded-xl text-slate-100 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-500/50 border border-slate-800/80 font-sans"
                    style={{
                      wordBreak: 'break-word',
                    }}
                  />
                )}

                {formatMode === 'HTML' && (
                  <textarea
                    rows={12}
                    placeholder="<p>Enter clean HTML with styling...</p>"
                    value={htmlContent}
                    onChange={handleHtmlCodeChange}
                    className="w-full min-h-[240px] max-h-[360px] px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 leading-relaxed focus:outline-none focus:border-emerald-500"
                  />
                )}

                {formatMode === 'PLAIN' && (
                  <textarea
                    rows={12}
                    placeholder="Enter standard plain-text email message..."
                    value={plainTextContent}
                    onChange={handlePlainTextChange}
                    className="w-full min-h-[240px] max-h-[360px] px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>
            </div>

            {/* ATTACHMENTS MANAGER */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Template Attachments
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {attachments.length} {attachments.length === 1 ? 'file' : 'files'}
                  </span>
                </div>

                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer border border-slate-700 transition">
                  <Upload className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Add Attachments</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.zip"
                  />
                </label>
              </div>

              {/* Uploaded Attachments List */}
              {attachments.length === 0 ? (
                <div className="p-4 border border-dashed border-slate-800 rounded-xl text-center text-slate-500 text-xs">
                  <p>No attachments uploaded. You can attach PDFs, brochures, rate cards, or images.</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Attachments will be saved in DB and automatically sent when campaigns use this template.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="p-1.5 bg-slate-950 rounded-lg shrink-0">
                          {getFileIcon(att.name, att.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-200 font-medium truncate" title={att.name}>
                            {att.name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {formatFileSize(att.size)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {att.dataUrl && (
                          <a
                            href={att.dataUrl}
                            download={att.name}
                            className="p-1 text-slate-400 hover:text-emerald-400 rounded transition"
                            title="Download / View file"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachment(att.id)}
                          className="p-1 text-slate-400 hover:text-rose-400 rounded transition"
                          title="Remove attachment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT COLUMN: LIVE RENDERED PREVIEW (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-emerald-400" />
                <span>Live Email Client Preview</span>
              </span>

              {/* Viewport switch: Desktop vs Mobile */}
              <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewDevice('DESKTOP')}
                  className={`p-1 rounded ${
                    previewDevice === 'DESKTOP' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-300'
                  }`}
                  title="Desktop Preview"
                >
                  <Monitor className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('MOBILE')}
                  className={`p-1 rounded ${
                    previewDevice === 'MOBILE' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-300'
                  }`}
                  title="Mobile Preview"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* SIMULATED EMAIL CLIENT CONTAINER */}
            <div
              className={`flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm ${
                previewDevice === 'MOBILE' ? 'max-w-[340px] mx-auto' : 'w-full'
              }`}
            >
              {/* Email Envelope Header */}
              <div className="p-3.5 bg-slate-50 border-b border-slate-200 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>To: <strong className="text-slate-800">Tariq Farooq</strong> &lt;tariq@albait-tours.com&gt;</span>
                  <span className="text-[10px] font-mono text-orange-600 font-semibold">Umrah360 Outbound</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  <span>From: <span className="text-slate-700 font-medium">Umrah360 Team</span> &lt;amaavigo@gmail.com&gt;</span>
                </div>
                <div className="pt-1 border-t border-slate-200 text-xs font-semibold text-slate-900">
                  <span className="text-slate-500 font-normal mr-1">Subject:</span>
                  {renderPreviewWithSampleLead(subject) || 'No Subject'}
                </div>
              </div>

              {/* Rendered Email Body */}
              <div className="flex-1 p-4 bg-white overflow-y-auto text-slate-800 text-xs leading-relaxed font-sans space-y-2">
                {formatMode === 'PLAIN' ? (
                  <div className="whitespace-pre-wrap font-mono text-slate-700">
                    {renderPreviewWithSampleLead(plainTextContent || 'Your email body will appear here.')}
                  </div>
                ) : (
                  <div
                    className="email-rendered-content prose max-w-none text-xs leading-relaxed text-slate-800"
                    dangerouslySetInnerHTML={{
                      __html: renderPreviewWithSampleLead(htmlContent || plainToHtml(plainTextContent) || '<p>Your email body will appear here.</p>'),
                    }}
                  />
                )}
              </div>

              {/* Rendered Attached Files Bar in Email Footer */}
              {attachments.length > 0 && (
                <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <Paperclip className="w-3 h-3 text-orange-500" />
                    <span>Attachments ({attachments.length}):</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[10px] text-slate-700 flex items-center gap-1.5 shadow-xs"
                      >
                        {getFileIcon(att.name, att.type)}
                        <span className="max-w-[120px] truncate font-medium">{att.name}</span>
                        <span className="text-slate-400 font-mono">({formatFileSize(att.size)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-400 text-center">
              * Variables like <code className="text-orange-600 font-mono">{"{{name}}"}</code> & <code className="text-orange-600 font-mono">{"{{company}}"}</code> are automatically substituted per lead.
            </div>
          </div>

        </div>

        {/* MODAL FOOTER ACTIONS */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {attachments.length > 0 && (
              <span className="flex items-center gap-1 text-orange-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{attachments.length} attachment(s) will be saved in DB and sent with this template</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 transition font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md transition"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving to DB...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>{editingTemplate ? 'Update Template in DB' : 'Save Template to DB'}</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
