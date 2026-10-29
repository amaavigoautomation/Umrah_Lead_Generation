import React, { useState, useEffect, useRef } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Search,
  Filter,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Film,
  Plus,
  RefreshCw,
  Sparkles,
  Info,
  Maximize2,
  X,
  Tag,
  Eye,
  FileCode,
} from 'lucide-react';
import type { CompanyAsset, AssetCategory } from '../types';
import {
  fetchCompanyAssets,
  uploadCompanyAsset,
  deleteCompanyAsset,
  fileToDataUrl,
  getImageDimensions,
  generateImageHtmlSnippet,
  generateVideoCardHtmlSnippet,
} from '../services/assetClientService';
import { useBrand } from '../context/BrandContext';

interface CompanyAssetsPanelProps {
  onInsertIntoTemplate?: (htmlSnippet: string) => void;
  isDrawerMode?: boolean;
}

const CATEGORIES: { label: string; value: AssetCategory | 'ALL' }[] = [
  { label: 'All Media', value: 'ALL' },
  { label: 'Logos & Badges', value: 'LOGO' },
  { label: 'Banners & Headers', value: 'BANNER' },
  { label: 'Video Cards', value: 'VIDEO' },
  { label: 'Other Media', value: 'OTHER' },
];

export const CompanyAssetsPanel: React.FC<CompanyAssetsPanelProps> = ({
  onInsertIntoTemplate,
  isDrawerMode = false,
}) => {
  const { brand } = useBrand();
  const [assets, setAssets] = useState<CompanyAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'html' | 'video' | null>(null);
  const [previewAsset, setPreviewAsset] = useState<CompanyAsset | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Upload modal form state
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState<AssetCategory>('BANNER');
  const [uploadDataUrl, setUploadDataUrl] = useState<string>('');
  const [uploadMimeType, setUploadMimeType] = useState<string>('image/jpeg');
  const [uploadSize, setUploadSize] = useState<number>(0);
  const [uploadDimensions, setUploadDimensions] = useState<{ width: number; height: number }>({ width: 600, height: 400 });
  const [uploadVideoUrl, setUploadVideoUrl] = useState('');
  const [uploadVideoDuration, setUploadVideoDuration] = useState('');
  const [uploadAltText, setUploadAltText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAssets = async () => {
    setIsLoading(true);
    try {
      const data = await fetchCompanyAssets();
      setAssets(data);
    } catch (err) {
      console.warn('Failed to load assets', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAssets();
  }, []);

  const handleCopy = async (text: string, id: string, type: 'url' | 'html' | 'video') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setCopiedType(type);
      setTimeout(() => {
        setCopiedId(null);
        setCopiedType(null);
      }, 2000);
    } catch (err) {
      console.warn('Clipboard write failed', err);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setUploadError(null);
      const dataUrl = await fileToDataUrl(file);
      setUploadDataUrl(dataUrl);
      setUploadMimeType(file.type || 'image/jpeg');
      setUploadSize(file.size);

      // Auto-name
      if (!uploadName) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setUploadName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
      }

      // Auto category detection
      if (file.name.toLowerCase().includes('logo')) {
        setUploadCategory('LOGO');
      } else if (file.name.toLowerCase().includes('banner') || file.name.toLowerCase().includes('header')) {
        setUploadCategory('BANNER');
      }

      const dims = await getImageDimensions(dataUrl);
      setUploadDimensions(dims);
      setIsUploadModalOpen(true);
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to read file');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveUpload = async () => {
    if (!uploadDataUrl) {
      setUploadError('Please select an image file');
      return;
    }
    if (!uploadName.trim()) {
      setUploadError('Please provide an asset title');
      return;
    }

    try {
      setIsUploading(true);
      setUploadError(null);
      const newAsset = await uploadCompanyAsset({
        name: uploadName.trim(),
        category: uploadCategory,
        mimeType: uploadMimeType,
        dataUrl: uploadDataUrl,
        size: uploadSize,
        dimensions: uploadDimensions,
        videoUrl: uploadCategory === 'VIDEO' ? uploadVideoUrl.trim() : undefined,
        videoDuration: uploadCategory === 'VIDEO' ? uploadVideoDuration.trim() : undefined,
        altText: uploadAltText.trim() || uploadName.trim(),
      });

      setAssets((prev) => [newAsset, ...prev]);
      setIsUploadModalOpen(false);
      resetUploadForm();
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload asset');
    } finally {
      setIsUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadName('');
    setUploadCategory('BANNER');
    setUploadDataUrl('');
    setUploadVideoUrl('');
    setUploadVideoDuration('');
    setUploadAltText('');
    setUploadError(null);
  };

  const [assetToDelete, setAssetToDelete] = useState<CompanyAsset | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);

  const openDeleteModal = (asset: CompanyAsset) => {
    setAssetToDelete(asset);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!assetToDelete) return;
    setIsDeletingAsset(true);
    const targetId = assetToDelete.id;

    // Optimistically remove from state for instant feedback
    setAssets((prev) => prev.filter((a) => a.id !== targetId));
    if (previewAsset?.id === targetId) setPreviewAsset(null);

    try {
      await deleteCompanyAsset(targetId);
    } catch (err: any) {
      console.error('Failed to delete asset from server:', err);
      loadAssets();
    } finally {
      setIsDeletingAsset(false);
      setIsDeleteModalOpen(false);
      setAssetToDelete(null);
    }
  };

  const filteredAssets = assets.filter((asset) => {
    const matchesCategory =
      selectedCategory === 'ALL' ||
      asset.category === selectedCategory ||
      (selectedCategory === 'LOGO' && asset.category === 'BADGE');
    const matchesSearch =
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.altText && asset.altText.toLowerCase().includes(searchQuery.toLowerCase())) ||
      asset.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className={`space-y-6 ${isDrawerMode ? 'p-1' : ''}`}>
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Header bar & actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-orange-600" />
            Company Brand & Media Assets
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Store and manage company logos, promotional banners, hotel photos, and video cards.
            Assets are stored in the database and served with high-deliverability URLs for your email campaigns.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={loadAssets}
            disabled={isLoading}
            className="p-2 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200"
            title="Refresh Assets"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white font-semibold text-xs rounded-lg transition-all shadow-md shadow-orange-600/10 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Upload Asset
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setSelectedCategory(cat.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors border ${
                selectedCategory === cat.value
                  ? 'bg-orange-50 text-orange-600 border-orange-200 shadow-xs'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search assets by name or tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 focus:border-orange-500 rounded-lg text-xs text-slate-900 placeholder-slate-500 outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Asset Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 py-12">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-56 bg-slate-50 border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-12 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600 mb-4">
            <ImageIcon className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">No assets found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-6">
            {searchQuery
              ? `No media items matching "${searchQuery}". Try a different keyword or category.`
              : 'Upload your company logo, package banners, and video cards to reuse seamlessly in email templates.'}
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Upload First Asset
          </button>
        </div>
      ) : (
        <div
          className={`grid gap-4 ${
            isDrawerMode
              ? 'grid-cols-1'
              : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
          }`}
        >
          {filteredAssets.map((asset) => {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const fullUrl = asset.url.startsWith('http') ? asset.url : `${origin}${asset.url}`;
            const imageHtmlSnippet = generateImageHtmlSnippet(asset);
            const videoCardSnippet = asset.category === 'VIDEO' ? generateVideoCardHtmlSnippet(asset) : '';

            return (
              <div
                key={asset.id}
                className="group bg-white border border-slate-200 hover:border-orange-300 rounded-xl overflow-hidden flex flex-col transition-all hover:shadow-lg hover:shadow-amber-500/5"
              >
                {/* Thumbnail Preview Area */}
                <div
                  className="relative aspect-video bg-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-200 cursor-pointer"
                  onClick={() => setPreviewAsset(asset)}
                >
                  <img
                    src={asset.dataUrl || asset.url}
                    alt={asset.name}
                    className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />

                  {/* Video Play Badge overlay */}
                  {asset.category === 'VIDEO' && (
                    <div className="absolute inset-0 bg-white/10 flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                        <Film className="w-5 h-5 ml-0.5" />
                      </div>
                      {asset.videoDuration && (
                        <span className="absolute bottom-2 right-2 bg-white/95 text-slate-900 font-mono text-[10px] px-1.5 py-0.5 rounded">
                          {asset.videoDuration}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Category Pill */}
                  <span className="absolute top-2 left-2 bg-white/95 backdrop-blur-xs text-orange-600 border border-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    {asset.category}
                  </span>

                  {/* Dimensions / Size info */}
                  <span className="absolute bottom-2 left-2 bg-white/95 text-slate-500 text-[10px] px-1.5 py-0.5 rounded">
                    {asset.sizeFormatted}
                  </span>

                  {/* Hover Quick View Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewAsset(asset);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-white/80 text-slate-600 hover:text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Preview Full Image"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Details & Actions */}
                <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 line-clamp-1 group-hover:text-orange-600 transition-colors">
                      {asset.name}
                    </h4>
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                      {asset.dimensions ? `${asset.dimensions.width}×${asset.dimensions.height}px` : asset.mimeType}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="space-y-2 pt-1">
                    {/* Copy URL button only */}
                    <button
                      onClick={() => handleCopy(fullUrl, asset.id, 'url')}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-medium rounded-lg transition-colors border border-slate-200"
                      title="Copy direct image URL"
                    >
                      {copiedId === asset.id && copiedType === 'url' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-600 font-semibold">URL Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-slate-500" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>

                    {/* If inside Template Editor, show 1-click Insert button */}
                    {onInsertIntoTemplate && (
                      <button
                        onClick={() => {
                          const snippet = asset.category === 'VIDEO' ? videoCardSnippet : imageHtmlSnippet;
                          onInsertIntoTemplate(snippet);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Insert Into Email
                      </button>
                    )}

                    {/* Delete button */}
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => openDeleteModal(asset)}
                        className="text-[11px] text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors px-1 py-0.5 cursor-pointer"
                        title="Delete asset"
                      >
                        <Trash2 className="w-3 h-3 text-slate-500 hover:text-rose-600" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Asset Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-white/95 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-orange-600" />
                Upload Brand Asset
              </h3>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {uploadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-600">
                  {uploadError}
                </div>
              )}

              {/* Preview */}
              {uploadDataUrl && (
                <div className="aspect-video bg-slate-50 rounded-xl overflow-hidden border border-slate-200 flex items-center justify-center relative">
                  <img src={uploadDataUrl} alt="Upload preview" className="max-h-full object-contain p-2" />
                  <div className="absolute bottom-2 right-2 bg-white/90 text-[10px] text-slate-500 px-2 py-0.5 rounded">
                    {uploadDimensions.width} × {uploadDimensions.height} px
                  </div>
                </div>
              )}

              {/* Asset Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Asset Title <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="e.g. Umrah360 Header Banner"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-500 focus:border-amber-500 outline-none"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Category
                </label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value as AssetCategory)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:border-amber-500 outline-none"
                >
                  <option value="BANNER">Banner & Header</option>
                  <option value="LOGO">Brand Logo</option>
                  <option value="BADGE">Verified Badge / Stamp</option>
                  <option value="VIDEO">Video Card (With Play Overlay)</option>
                  <option value="OTHER">Other Media</option>
                </select>
              </div>

              {/* Conditional Video fields */}
              {uploadCategory === 'VIDEO' && (
                <div className="p-3.5 bg-orange-600/5 border border-amber-500/20 rounded-xl space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-600">
                    <Film className="w-3.5 h-3.5" />
                    Video Destination Link (Email-Safe Video Card)
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Email clients do not support inline &lt;video&gt; tags. This asset will render as a video card with a play button linking to your destination video.
                  </p>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Video URL (YouTube, Vimeo, or hosted video)
                    </label>
                    <input
                      type="url"
                      value={uploadVideoUrl}
                      onChange={(e) => setUploadVideoUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-500 focus:border-amber-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Video Duration (optional badge)
                    </label>
                    <input
                      type="text"
                      value={uploadVideoDuration}
                      onChange={(e) => setUploadVideoDuration(e.target.value)}
                      placeholder="e.g. 02:45"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-500 focus:border-amber-500 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Alt text */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Alt Text (Screen Readers & Fallback)
                </label>
                <input
                  type="text"
                  value={uploadAltText}
                  onChange={(e) => setUploadAltText(e.target.value)}
                  placeholder="Description of the image content"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-500 focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="px-3.5 py-1.5 text-xs text-slate-500 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUpload}
                disabled={isUploading}
                className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Saving to DB...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Save Asset
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Resolution Preview Modal */}
      {previewAsset && (
        <div className="fixed inset-0 z-50 bg-slate-50/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{previewAsset.name}</h3>
                <p className="text-[11px] text-slate-500">
                  {previewAsset.category} • {previewAsset.sizeFormatted} • {previewAsset.dimensions?.width}×{previewAsset.dimensions?.height}px
                </p>
              </div>
              <button
                onClick={() => setPreviewAsset(null)}
                className="text-slate-500 hover:text-slate-900 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 bg-white/95 flex items-center justify-center max-h-[60vh] overflow-hidden">
              <img
                src={previewAsset.dataUrl || previewAsset.url}
                alt={previewAsset.name}
                className="max-h-[55vh] max-w-full object-contain rounded-lg shadow-lg"
              />
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <span className="font-mono text-[11px] bg-white px-2 py-1 rounded border border-slate-200">
                  {previewAsset.url}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const origin = typeof window !== 'undefined' ? window.location.origin : '';
                    const fullUrl = previewAsset.url.startsWith('http') ? previewAsset.url : `${origin}${previewAsset.url}`;
                    handleCopy(fullUrl, previewAsset.id, 'url');
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE ASSET CONFIRMATION MODAL */}
      {isDeleteModalOpen && assetToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl text-slate-900">
            <div className="p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-500/20 flex items-center justify-center text-rose-500">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Asset</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Are you sure you want to delete <strong className="text-slate-700">"{assetToDelete.name}"</strong>?
                  This will permanently remove the asset from the Firestore database.
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 font-mono truncate">
                Category: {assetToDelete.category}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setAssetToDelete(null);
                }}
                disabled={isDeletingAsset}
                className="px-4 py-2 text-xs text-slate-500 hover:text-slate-900 transition font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeletingAsset}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-slate-900 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
              >
                {isDeletingAsset ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
