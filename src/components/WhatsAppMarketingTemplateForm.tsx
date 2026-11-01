import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Film,
  FileText,
  Gift,
  ImagePlus,
  Loader2,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

type Props = {
  onCancel: () => void;
  onBack: () => void;
  onSubmitted: (message: string) => void;
};

type TemplateFormat = 'STANDARD' | 'CAROUSEL' | 'COUPON' | 'LIMITED_TIME_OFFER';
type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
type MarketingButtonType = 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY';

type ButtonDraft = {
  id: number;
  type: MarketingButtonType;
  text: string;
  url: string;
  phoneNumber: string;
};

type CarouselCardDraft = {
  id: number;
  fileName: string;
  mediaHandle: string;
  body: string;
  url: string;
  uploading: boolean;
  progress: number;
};

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600';
const CHUNK_BYTES = 1024 * 1024;

function findVariables(value: string): number[] {
  return Array.from(new Set(Array.from(value.matchAll(/\{\{(\d+)\}\}/g)).map((match) => Number(match[1])))).sort((a, b) => a - b);
}

function fileMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'pdf') return 'application/pdf';
  return '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileLimit(mimeType: string): number {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') return 5 * 1024 * 1024;
  if (mimeType === 'video/mp4') return 16 * 1024 * 1024;
  if (mimeType === 'application/pdf') return 25 * 1024 * 1024;
  return 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function uploadMetaMedia(file: File, onProgress: (progress: number) => void): Promise<string> {
  const mimeType = fileMime(file);
  const maxSize = fileLimit(mimeType);
  if (!maxSize) throw new Error('Use JPG, PNG, MP4, or PDF files only.');
  if (file.size < 1 || file.size > maxSize) {
    throw new Error('File is too large. Maximum sizes: image 5 MB, video 16 MB, PDF 25 MB.');
  }

  const sessionResponse = await fetch('/api/whatsapp/templates/media-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType, fileLength: file.size }),
  });
  const sessionData = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok) throw new Error(sessionData?.error || 'Could not start the Meta media upload.');
  const uploadKey = String(sessionData.uploadKey || '');
  if (!uploadKey) throw new Error('Meta did not return a media upload session.');

  let fileHandle = '';
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const chunk = new Uint8Array(await file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size)).arrayBuffer());
    const response = await fetch('/api/whatsapp/templates/media-chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadKey, offset, base64: toBase64(chunk) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || 'Meta media upload failed.');
    onProgress(Math.round((Number(result.uploadedBytes || 0) / file.size) * 100));
    if (result.fileHandle) fileHandle = String(result.fileHandle);
  }
  if (!fileHandle) throw new Error('The media upload finished without a Meta file handle. Please try again.');
  return fileHandle;
}

const newCard = (id: number): CarouselCardDraft => ({
  id,
  fileName: '',
  mediaHandle: '',
  body: '',
  url: '',
  uploading: false,
  progress: 0,
});

const newButton = (id: number): ButtonDraft => ({
  id,
  type: 'URL',
  text: 'View packages',
  url: '',
  phoneNumber: '',
});

export const WhatsAppMarketingTemplateForm: React.FC<Props> = ({ onCancel, onBack, onSubmitted }) => {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [templateFormat, setTemplateFormat] = useState<TemplateFormat>('STANDARD');
  const [body, setBody] = useState('Hello {{1}}! Explore our latest Umrah packages and special offers. Reply to speak with our travel team.');
  const [footer, setFooter] = useState('');
  const [samples, setSamples] = useState<Record<number, string>>({ 1: 'Aisha' });
  const variables = useMemo(() => findVariables(body), [body]);

  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>('TEXT');
  const [headerText, setHeaderText] = useState('');
  const [headerFileName, setHeaderFileName] = useState('');
  const [headerFileHandle, setHeaderFileHandle] = useState('');
  const [headerUploading, setHeaderUploading] = useState(false);
  const [headerProgress, setHeaderProgress] = useState(0);

  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [couponCodeExample, setCouponCodeExample] = useState('UMRAH25');
  const [offerText, setOfferText] = useState('Offer ends soon');
  const [offerHasExpiration, setOfferHasExpiration] = useState(true);
  const [offerUrl, setOfferUrl] = useState('');
  const [offerUrlText, setOfferUrlText] = useState('View offer');

  const [carouselMediaFormat, setCarouselMediaFormat] = useState<'IMAGE' | 'VIDEO'>('IMAGE');
  const [carouselButtonText, setCarouselButtonText] = useState('View details');
  const [cards, setCards] = useState<CarouselCardDraft[]>([newCard(1), newCard(2)]);
  const [nextCardId, setNextCardId] = useState(3);
  const [uploadingCardId, setUploadingCardId] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSamples((previous) => {
      const next: Record<number, string> = {};
      variables.forEach((index) => { next[index] = previous[index] || ('Example ' + index); });
      return next;
    });
  }, [variables.join(',')]);

  const maxBodyLength = templateFormat === 'LIMITED_TIME_OFFER' ? 600 : 1024;
  const hasHeaderMedia = headerFormat !== 'TEXT';
  const mediaAccept = headerFormat === 'IMAGE' ? 'image/jpeg,image/png' : headerFormat === 'VIDEO' ? 'video/mp4' : headerFormat === 'DOCUMENT' ? 'application/pdf' : '';
  const cardAccept = carouselMediaFormat === 'IMAGE' ? 'image/jpeg,image/png' : 'video/mp4';

  const updateCard = (id: number, patch: Partial<CarouselCardDraft>) => {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...patch } : card));
  };

  const handleHeaderFile = async (file?: File) => {
    if (!file) return;
    const expected = headerFormat === 'IMAGE'
      ? ['image/jpeg', 'image/png']
      : headerFormat === 'VIDEO'
        ? ['video/mp4']
        : ['application/pdf'];
    if (!expected.includes(fileMime(file))) {
      setError(headerFormat === 'IMAGE' ? 'Choose a JPG or PNG image.' : headerFormat === 'VIDEO' ? 'Choose an MP4 video.' : 'Choose a PDF document.');
      return;
    }
    setError(null);
    setHeaderFileName(file.name);
    setHeaderFileHandle('');
    setHeaderUploading(true);
    setHeaderProgress(0);
    try {
      const handle = await uploadMetaMedia(file, setHeaderProgress);
      setHeaderFileHandle(handle);
    } catch (e: any) {
      setError(e?.message || 'Header media upload failed.');
      setHeaderFileName('');
    } finally {
      setHeaderUploading(false);
    }
  };

  const handleCardFile = async (cardId: number, file?: File) => {
    if (!file) return;
    const expected = carouselMediaFormat === 'IMAGE' ? ['image/jpeg', 'image/png'] : ['video/mp4'];
    if (!expected.includes(fileMime(file))) {
      setError(carouselMediaFormat === 'IMAGE' ? 'Choose a JPG or PNG image for this carousel.' : 'Choose an MP4 video for this carousel.');
      return;
    }
    setError(null);
    setUploadingCardId(cardId);
    updateCard(cardId, { fileName: file.name, mediaHandle: '', uploading: true, progress: 0 });
    try {
      const handle = await uploadMetaMedia(file, (progress) => updateCard(cardId, { progress }));
      updateCard(cardId, { mediaHandle: handle, uploading: false, progress: 100 });
    } catch (e: any) {
      updateCard(cardId, { fileName: '', mediaHandle: '', uploading: false, progress: 0 });
      setError(e?.message || 'Carousel media upload failed.');
    } finally {
      setUploadingCardId(null);
    }
  };

  const addButton = () => {
    setButtons((current) => current.length >= 3 ? current : [...current, newButton(Date.now())]);
  };

  const updateButton = (id: number, patch: Partial<ButtonDraft>) => {
    setButtons((current) => current.map((button) => button.id === id ? { ...button, ...patch } : button));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (variables.some((index) => !String(samples[index] || '').trim())) {
      setError('Add an example value for every body variable.');
      return;
    }
    if (headerUploading || uploadingCardId !== null) {
      setError('Wait for media uploads to finish before submitting.');
      return;
    }
    if (hasHeaderMedia && !headerFileHandle && templateFormat !== 'CAROUSEL' && templateFormat !== 'LIMITED_TIME_OFFER') {
      setError('Upload the selected header media before submitting.');
      return;
    }
    if (templateFormat === 'CAROUSEL') {
      if (cards.length < 2 || cards.length > 10) {
        setError('A carousel needs between 2 and 10 cards.');
        return;
      }
      if (cards.some((card) => !card.mediaHandle || !card.url.trim())) {
        setError('Upload media and add a website URL for every carousel card.');
        return;
      }
      if (cards.some((card) => card.body.trim()) && cards.some((card) => !card.body.trim())) {
        setError('Either add card text to every card or leave card text empty on all cards.');
        return;
      }
    }
    if (templateFormat === 'LIMITED_TIME_OFFER' && (!offerUrl.trim() || !couponCodeExample.trim())) {
      setError('A limited-time offer needs an example coupon code and a website URL.');
      return;
    }
    if (templateFormat === 'COUPON' && !couponCodeExample.trim()) {
      setError('Add an example coupon code.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim().toLowerCase(),
        language,
        category: 'MARKETING',
        templateType: templateFormat,
        headerFormat,
        headerText: headerFormat === 'TEXT' ? headerText.trim() : '',
        headerMediaHandle: hasHeaderMedia ? headerFileHandle : '',
        body: body.trim(),
        footer: templateFormat === 'LIMITED_TIME_OFFER' || templateFormat === 'CAROUSEL' ? '' : footer.trim(),
        samples: variables.map((index) => String(samples[index] || '').trim()),
        buttons: templateFormat === 'STANDARD' ? buttons.map((button) => ({
          type: button.type,
          text: button.text.trim(),
          url: button.url.trim(),
          phoneNumber: button.phoneNumber.trim(),
        })) : [],
        couponCodeExample: couponCodeExample.trim(),
        offerText: offerText.trim(),
        offerHasExpiration,
        offerUrl: offerUrl.trim(),
        offerUrlText: offerUrlText.trim(),
        carouselButtonText: carouselButtonText.trim(),
        carouselCards: templateFormat === 'CAROUSEL' ? cards.map((card) => ({
          mediaFormat: carouselMediaFormat,
          mediaHandle: card.mediaHandle,
          body: card.body.trim(),
          url: card.url.trim(),
        })) : [],
      };
      const response = await fetch('/api/whatsapp/templates/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || 'Meta could not accept the template submission.');
      const status = String(result?.template?.status || 'PENDING').toUpperCase();
      onSubmitted('Submitted to Meta. Current status: ' + status.replace(/_/g, ' ') + '. The template can only be used after Meta approves it.');
    } catch (e: any) {
      setError(e?.message || 'Template submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const previewBody = body.replace(/\{\{(\d+)\}\}/g, (_match, index) => samples[Number(index)] || 'Example ' + index);
  const formatLabel: Record<TemplateFormat, string> = {
    STANDARD: 'Standard promotion',
    CAROUSEL: 'Media carousel',
    COUPON: 'Coupon code',
    LIMITED_TIME_OFFER: 'Limited-time offer',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Create WhatsApp marketing template">
      <form onSubmit={handleSubmit} className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Back to Utility template"><ChevronLeft className="h-5 w-5" /></button>
            <div>
              <h3 className="text-base font-bold text-slate-900">Create WhatsApp Marketing Template</h3>
              <p className="mt-0.5 text-xs text-slate-500">Choose a format, add content and submit it to Meta for approval.</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Template name *</label>
              <input className={inputClass} required value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_'))} maxLength={128} placeholder="umrah_special_offer" />
              <p className="mt-1 text-[11px] text-slate-500">Use lowercase letters, numbers and underscores. Must be unique in the connected WhatsApp Business Account for this language.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Language *</label>
                <select className={inputClass} value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="en_US">English (US)</option><option value="en_GB">English (UK)</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="ur">Urdu</option><option value="fr">French</option><option value="es">Spanish</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Marketing format *</label>
                <select className={inputClass} value={templateFormat} onChange={(event) => { const next = event.target.value as TemplateFormat; setTemplateFormat(next); if (next === 'LIMITED_TIME_OFFER' && headerFormat !== 'IMAGE' && headerFormat !== 'VIDEO') { setHeaderFormat('IMAGE'); setHeaderFileName(''); setHeaderFileHandle(''); } setError(null); }}>
                  <option value="STANDARD">Standard promotion</option>
                  <option value="CAROUSEL">Media carousel</option>
                  <option value="COUPON">Coupon code</option>
                  <option value="LIMITED_TIME_OFFER">Limited-time offer</option>
                </select>
              </div>
            </div>

            {templateFormat !== 'CAROUSEL' && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <label className={labelClass}>Header (optional)</label>
                <select className={inputClass} value={headerFormat} onChange={(event) => {
                  const next = event.target.value as HeaderFormat;
                  setHeaderFormat(next);
                  setHeaderFileName('');
                  setHeaderFileHandle('');
                  setHeaderText('');
                  setError(null);
                }}>
                  {templateFormat === 'LIMITED_TIME_OFFER' ? <><option value="IMAGE">Image header (optional)</option><option value="VIDEO">Video header (optional)</option></> : <><option value="TEXT">Text header</option><option value="IMAGE">Image header</option><option value="VIDEO">Video header</option><option value="DOCUMENT">PDF document header</option></>}
                </select>
                {headerFormat === 'TEXT' ? (
                  <input className={inputClass} value={headerText} onChange={(event) => setHeaderText(event.target.value)} maxLength={60} placeholder="Special Umrah packages" />
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                      <Upload className="h-4 w-4 text-orange-500" /> {headerFileName ? 'Change media' : 'Choose ' + headerFormat.toLowerCase() + ' file'}
                      <input className="hidden" type="file" accept={mediaAccept} onChange={(event) => void handleHeaderFile(event.target.files?.[0])} disabled={headerUploading} />
                    </label>
                    {headerFileName && <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600"><span className="truncate">{headerFileName}</span>{headerFileHandle ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Uploaded</span> : <span>{headerProgress}%</span>}</div>}
                    {headerUploading && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: headerProgress + '%' }} /></div>}
                    <p className="mt-2 text-[11px] text-slate-500">JPG/PNG up to 5 MB · MP4 up to 16 MB · PDF up to 25 MB.</p>
                  </div>
                )}
              </div>
            )}

            {templateFormat === 'CAROUSEL' && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>Card media *</label><select className={inputClass} value={carouselMediaFormat} onChange={(event) => { setCarouselMediaFormat(event.target.value as 'IMAGE' | 'VIDEO'); setCards((current) => current.map((card) => ({ ...card, fileName: '', mediaHandle: '', uploading: false, progress: 0 }))); }}><option value="IMAGE">Images</option><option value="VIDEO">Videos</option></select></div>
                  <div><label className={labelClass}>Card button label *</label><input className={inputClass} value={carouselButtonText} onChange={(event) => setCarouselButtonText(event.target.value)} maxLength={25} placeholder="View details" /></div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">Carousel cards ({cards.length}/10)</p>
                  <button type="button" onClick={() => { setCards((current) => current.length >= 10 ? current : [...current, newCard(nextCardId)]); setNextCardId((value) => value + 1); }} disabled={cards.length >= 10} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add card</button>
                </div>
                {cards.map((card, index) => (
                  <div key={card.id} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-700">Card {index + 1}</span><button type="button" onClick={() => setCards((current) => current.length <= 2 ? current : current.filter((item) => item.id !== card.id))} disabled={cards.length <= 2} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" title="Remove card"><Trash2 className="h-4 w-4" /></button></div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700"><ImagePlus className="h-4 w-4 text-orange-500" /> {card.fileName || 'Upload card ' + carouselMediaFormat.toLowerCase()}<input className="hidden" type="file" accept={cardAccept} onChange={(event) => void handleCardFile(card.id, event.target.files?.[0])} disabled={uploadingCardId !== null} /></label>
                    {card.uploading && <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-orange-500" style={{ width: card.progress + '%' }} /></div>}
                    {card.mediaHandle && <p className="text-[11px] text-emerald-700">Media uploaded to Meta</p>}
                    <input className={inputClass} value={card.body} onChange={(event) => updateCard(card.id, { body: event.target.value })} maxLength={160} placeholder="Optional card description (max 160 characters)" />
                    <input className={inputClass} type="url" value={card.url} onChange={(event) => updateCard(card.id, { url: event.target.value })} placeholder="https://example.com/package" />
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">Meta carousel cards use the same media type and button layout. Add 2–10 cards. Every card needs media and a website URL.</p>
              </div>
            )}

            <div>
              <label className={labelClass}>Message body *</label>
              <textarea className={inputClass + ' min-h-[125px]'} required value={body} onChange={(event) => setBody(event.target.value)} maxLength={maxBodyLength} placeholder="Write your promotional message. Use {{1}} for customer-specific values." />
              <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>Use numbered variables like {'{{1}}'} and {'{{2}}'}.</span><span>{body.length}/{maxBodyLength}</span></div>
            </div>

            {variables.length > 0 && (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700">Example values required by Meta</p>
                {variables.map((index) => <div key={index}><label className="mb-1 block text-[11px] text-slate-600">{'Example for {{' + index + '}}'}</label><input className={inputClass} value={samples[index] || ''} onChange={(event) => setSamples((previous) => ({ ...previous, [index]: event.target.value }))} placeholder={'Example ' + index} /></div>)}
              </div>
            )}

            {templateFormat === 'STANDARD' && (
              <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between"><label className={labelClass}>Buttons (optional)</label><button type="button" onClick={addButton} disabled={buttons.length >= 3} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add button</button></div>
                {buttons.map((button, index) => (
                  <div key={button.id} className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                    <div className="flex items-center gap-2"><span className="flex-1 text-xs font-semibold text-slate-600">Button {index + 1}</span><button type="button" onClick={() => setButtons((current) => current.filter((item) => item.id !== button.id))} className="rounded p-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button></div>
                    <select className={inputClass} value={button.type} onChange={(event) => updateButton(button.id, { type: event.target.value as MarketingButtonType })}><option value="URL">Website URL</option><option value="PHONE_NUMBER">Call phone number</option><option value="QUICK_REPLY">Quick reply</option></select>
                    <input className={inputClass} value={button.text} onChange={(event) => updateButton(button.id, { text: event.target.value })} maxLength={25} placeholder="Button label" />
                    {button.type === 'URL' && <input className={inputClass} type="url" value={button.url} onChange={(event) => updateButton(button.id, { url: event.target.value })} placeholder="https://example.com" />}
                    {button.type === 'PHONE_NUMBER' && <input className={inputClass} value={button.phoneNumber} onChange={(event) => updateButton(button.id, { phoneNumber: event.target.value })} placeholder="+919876543210" />}
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">Up to 3 buttons in this builder; up to 2 can be website/call actions.</p>
              </div>
            )}

            {templateFormat === 'COUPON' && (
              <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/40 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Gift className="h-4 w-4 text-orange-500" /> Coupon code button</div>
                <label className={labelClass}>Example coupon code *</label>
                <input className={inputClass} value={couponCodeExample} onChange={(event) => setCouponCodeExample(event.target.value.toUpperCase())} maxLength={20} placeholder="UMRAH25" />
                <p className="text-[11px] text-slate-500">Meta reviews this example. The actual coupon value is supplied when the template is sent.</p>
              </div>
            )}

            {templateFormat === 'LIMITED_TIME_OFFER' && (
              <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50/40 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Clock3 className="h-4 w-4 text-orange-500" /> Limited-time offer settings</div>
                <div><label className={labelClass}>Offer title * (up to 16 characters)</label><input className={inputClass} value={offerText} onChange={(event) => setOfferText(event.target.value)} maxLength={16} placeholder="Offer ends soon" /></div>
                <div><label className={labelClass}>Example coupon code * (up to 15 characters)</label><input className={inputClass} value={couponCodeExample} onChange={(event) => setCouponCodeExample(event.target.value.toUpperCase())} maxLength={15} placeholder="UMRAH25" /></div>
                <div><label className={labelClass}>Offer page URL *</label><input className={inputClass} type="url" value={offerUrl} onChange={(event) => setOfferUrl(event.target.value)} placeholder="https://example.com/offer" /></div>
                <div><label className={labelClass}>Website button label *</label><input className={inputClass} value={offerUrlText} onChange={(event) => setOfferUrlText(event.target.value)} maxLength={25} placeholder="View offer" /></div>
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={offerHasExpiration} onChange={(event) => setOfferHasExpiration(event.target.checked)} className="rounded border-slate-300 text-orange-500 focus:ring-orange-400" /> Show expiry countdown when sending the offer</label>
                <p className="text-[11px] text-slate-500">Meta requires the actual expiry timestamp when you send this template. The countdown is shown on supported WhatsApp mobile clients; footers are not supported.</p>
              </div>
            )}

            {templateFormat !== 'CAROUSEL' && templateFormat !== 'LIMITED_TIME_OFFER' && (
              <div><label className={labelClass}>Footer (optional)</label><input className={inputClass} value={footer} onChange={(event) => setFooter(event.target.value)} maxLength={60} placeholder="Reply STOP to opt out." /></div>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Message preview</p><span className="text-[10px] text-slate-400">Illustrative</span></div>
              <div className="ml-auto max-w-[360px] space-y-3 rounded-2xl rounded-tr-sm bg-emerald-50 p-3 shadow-sm">
                {templateFormat === 'LIMITED_TIME_OFFER' && <div className="rounded-lg bg-amber-100 px-3 py-2 text-center text-xs font-bold text-amber-900">{offerText}{offerHasExpiration ? ' · Countdown shown when sent' : ''}</div>}
                {headerText && headerFormat === 'TEXT' && templateFormat !== 'CAROUSEL' && <p className="text-sm font-bold text-slate-900">{headerText}</p>}
                {headerFileName && <div className="rounded-lg border border-emerald-200 bg-white/80 p-3 text-xs text-slate-600">{headerFormat === 'IMAGE' ? <ImagePlus className="mb-1 h-5 w-5" /> : headerFormat === 'VIDEO' ? <Film className="mb-1 h-5 w-5" /> : <FileText className="mb-1 h-5 w-5" />}{headerFileName}</div>}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{previewBody}</p>
                {templateFormat === 'CAROUSEL' && <div className="space-y-2">{cards.map((card, index) => <div key={card.id} className="rounded-lg border border-emerald-200 bg-white p-2"><p className="text-[11px] font-semibold text-slate-500">Card {index + 1} · {card.fileName || 'Media not selected'}</p>{card.body && <p className="mt-1 text-xs text-slate-800">{card.body}</p>}<p className="mt-1 text-[11px] font-semibold text-blue-700">{carouselButtonText}</p></div>)}</div>}
                {templateFormat === 'COUPON' && <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-center text-xs font-bold text-slate-800">Copy code: {couponCodeExample}</div>}
                {templateFormat === 'LIMITED_TIME_OFFER' && <div className="space-y-1 rounded-lg border border-emerald-200 bg-white p-2 text-center text-xs font-semibold"><p>Copy code: {couponCodeExample}</p><p className="text-blue-700">{offerUrlText}</p></div>}
                {templateFormat === 'STANDARD' && buttons.map((button) => <div key={button.id} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-center text-xs font-semibold text-blue-700">{button.text || 'Button'}</div>)}
                {footer && templateFormat !== 'LIMITED_TIME_OFFER' && templateFormat !== 'CAROUSEL' && <p className="text-[11px] text-slate-500">{footer}</p>}
                <p className="text-right text-[10px] text-slate-400">Just now</p>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Preview only. Meta validates the submitted components and decides whether the template is approved or recategorized.</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs leading-relaxed text-blue-900">
              <p className="font-semibold">Before submitting</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>Use promotional content only for Marketing.</li>
                <li>Use media that you have permission to share.</li>
                <li>Send marketing messages only to contacts who opted in.</li>
                <li>Meta approval is not guaranteed; review status after submission.</li>
              </ul>
            </div>
            {error && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <p className="text-[11px] text-slate-500">Format: {formatLabel[templateFormat]} · Media is uploaded to Meta for template review.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} disabled={submitting} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting || !name.trim() || !body.trim() || headerUploading || uploadingCardId !== null} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for Meta approval
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
