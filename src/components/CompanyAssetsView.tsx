import React, { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { Copy, Image as ImageIcon, Film, FolderOpen, Link2, Loader2, Search, Upload, X, Check, ExternalLink } from 'lucide-react';
import { db } from '../firebase/config';

export interface CompanyAsset {
  id: string;
  name: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  url: string;
  publicKey: string;
  createdAt: string;
}
interface Props {
  tenantId: string;
  pickerMode?: boolean;
  onSelectAsset?: (asset: CompanyAsset) => void;
  onClose?: () => void;
}
const MAX_STORED_BYTES = 600 * 1024;
const MAX_DIMENSION = 1600;
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const CompanyAssetsView: React.FC<Props> = ({ tenantId, pickerMode = false, onSelectAsset, onClose }) => {
  const [assets, setAssets] = useState<CompanyAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);


  const loadAssets = useCallback(async () => {
    if (!tenantId) { setAssets([]); setLoading(false); return; }
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'tenants', tenantId, 'company_assets'), orderBy('createdAt', 'desc')));
      setAssets(snap.docs.map((item) => ({ id: item.id, ...item.data() } as CompanyAsset)));
      setError('');
    } catch (e: any) { setError(e?.message || 'Could not load company assets.'); }
    finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  const compressImage = (file: File): Promise<{ dataUrl: string; mimeType: string; sizeBytes: number }> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('This image format could not be processed. Please use JPG, PNG or WebP.'));
      image.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Image compression is unavailable in this browser.')); return; }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.82, dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length * 0.75 > MAX_STORED_BYTES && quality > 0.35) { quality -= 0.1; dataUrl = canvas.toDataURL('image/jpeg', quality); }
        const sizeBytes = Math.floor(dataUrl.length * 0.75);
        if (sizeBytes > MAX_STORED_BYTES) { reject(new Error('Image is still too large after compression. Choose a smaller image.')); return; }
        resolve({ dataUrl, mimeType: 'image/jpeg', sizeBytes });
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length) return;
    setError(''); setNotice('');
    const unsupported = files.find((file) => !file.type.startsWith('image/'));
    if (unsupported) { setError('Firestore-only mode supports images only. Videos require separate file storage.'); return; }
    if (!tenantId) { setError('Workspace is not ready. Please reload and try again.'); return; }
    setUploading(true);
    try {
      for (const file of files) {
        const compressed = await compressImage(file);
        const id = 'asset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        const publicKey = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((n) => n.toString(16).padStart(2, '0')).join('');
        const asset = {
          id, name: file.name, type: 'image', mimeType: compressed.mimeType, sizeBytes: compressed.sizeBytes,
          url: window.location.origin + '/api/company-assets/public/' + encodeURIComponent(tenantId) + '/' + encodeURIComponent(id) + '?key=' + publicKey,
          publicKey, storagePath: '', createdAt: new Date().toISOString(), imageData: compressed.dataUrl
        };
        await setDoc(doc(db, 'tenants', tenantId, 'company_assets', id), asset);
      }
      setNotice(files.length + ' image' + (files.length === 1 ? '' : 's') + ' saved to Firestore.');
      await loadAssets();
    } catch (e: any) { setError(e?.message || 'Upload failed. Check Firestore permissions and document-size limits.'); }
    finally { setUploading(false); }
  };

  const copyText = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(label + ' copied to clipboard.'); }
    catch { setError('Clipboard access was blocked by your browser. Select and copy the URL manually.'); }
  };
  const filtered = assets.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase()));
  const htmlFor = (asset: CompanyAsset) => '<img src="' + asset.url + '" alt="' + escapeHtml(asset.name) + '" width="600" style="display:block;max-width:100%;height:auto;border:0;" />';

  const content = (
    <div className={pickerMode ? 'flex flex-col min-h-0' : 'max-w-7xl mx-auto p-4 sm:p-6 space-y-6'}>
      <div className={pickerMode ? 'px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3' : 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600"><FolderOpen className="w-5 h-5" /></div>
          <div><h2 className="text-lg font-bold text-slate-900">{pickerMode ? 'Insert company asset' : 'Company Assets'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{pickerMode ? 'Choose an image to insert into your email.' : 'One shared library for images and videos used across email templates and campaigns.'}</p>
          </div>
        </div>
        {pickerMode ? <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Close asset picker"><X className="w-4 h-4" /></button> :
          <button onClick={() => inputRef.current?.click()} disabled={uploading || !tenantId} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold"><Upload className="w-4 h-4" />{uploading ? 'Uploading…' : 'Upload assets'}</button>}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={handleUpload} />
      <div className={pickerMode ? 'px-5 pt-4' : ''}>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by file name…" className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-200" /></div>
          {pickerMode && <button onClick={() => inputRef.current?.click()} disabled={uploading} className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"><Upload className="w-3.5 h-3.5" />Upload new</button>}
          <span className="text-xs text-slate-500">{filtered.length} asset{filtered.length === 1 ? '' : 's'} · 600 KB max after compression</span>
        </div>
        {error && <div role="alert" className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
        {notice && <div role="status" className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">{notice}</div>}
        {!pickerMode && <div className="mt-4 p-3 rounded-xl border border-blue-100 bg-blue-50 text-xs text-blue-800">Images are compressed and stored in Firestore. Copy the public image URL into email HTML. Videos are disabled in Firestore-only mode.</div>}
      </div>
      <div className={pickerMode ? 'p-5 pt-4 overflow-y-auto max-h-[55vh]' : ''}>
        {loading ? <div className="py-14 text-center text-sm text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading assets…</div> :
          filtered.length === 0 ? <div className="py-14 text-center rounded-2xl border border-dashed border-slate-300 bg-slate-50"><div className="mx-auto w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400"><ImageIcon className="w-5 h-5" /></div><p className="mt-3 text-sm font-semibold text-slate-700">{search ? 'No matching assets' : 'Your media library is empty'}</p><p className="mt-1 text-xs text-slate-500">{search ? 'Try a different search.' : 'Upload a logo, campaign banner, product photo or video to get started.'}</p>{!pickerMode && <button onClick={() => inputRef.current?.click()} className="mt-4 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700">Upload your first asset</button>}</div> :
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{filtered.map((asset) => (
            <div key={asset.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-white hover:border-orange-200 hover:shadow-sm transition">
              <div className="h-36 bg-slate-50 flex items-center justify-center overflow-hidden">
                <img src={asset.url} alt={asset.name} className="w-full h-full object-contain" loading="lazy" />
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-start gap-2"><div className="mt-0.5 text-orange-500">{asset.type === 'image' ? <ImageIcon className="w-4 h-4" /> : <Film className="w-4 h-4" />}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800 truncate" title={asset.name}>{asset.name}</p><p className="text-[10px] text-slate-500 mt-0.5">{formatBytes(asset.sizeBytes)} · image</p></div></div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void copyText(asset.url, 'Asset URL')} className="flex-1 px-2 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1"><Copy className="w-3 h-3" />Copy URL</button>
                  <button onClick={() => void copyText(htmlFor(asset), 'HTML')} className="flex-1 px-2 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1"><Link2 className="w-3 h-3" />Copy HTML</button>
                </div>
                {pickerMode && onSelectAsset && <button onClick={() => onSelectAsset(asset)} className="w-full px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2"><Check className="w-3.5 h-3.5" />Insert image</button>}
                <a href={asset.url} target="_blank" rel="noreferrer" className="text-[10px] text-orange-600 hover:text-orange-700 inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" />Open hosted file</a>
              </div>
            </div>
          ))}</div>}
      </div>
      {!pickerMode && <p className="text-[11px] text-slate-400">Assets are scoped to this workspace. Keep URLs stable after using them in emails; deleting or replacing hosted files can break images in older messages.</p>}
    </div>
  );
  if (!pickerMode) return content;
  return <div className="fixed inset-0 z-[80] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"><div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col">{content}</div></div>;
};
