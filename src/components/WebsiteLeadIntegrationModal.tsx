import React, { useState } from 'react';
import {
  Globe,
  X,
  Copy,
  Check,
  Send,
  Sparkles,
  Database,
  Building,
  Mail,
  Phone,
  User,
  MapPin,
  ExternalLink,
  Code,
  Layers,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface WebsiteLeadIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeadCreated?: (leadId: string) => void;
}

export const WebsiteLeadIntegrationModal: React.FC<WebsiteLeadIntegrationModalProps> = ({
  isOpen,
  onClose,
  onLeadCreated,
}) => {
  const [activeTab, setActiveTab] = useState<'SIMULATOR' | 'JS_SNIPPET' | 'WORDPRESS' | 'CURL'>('SIMULATOR');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: any;
  } | null>(null);

  // Form state matching umrah360.in/request-demo
  const [fullName, setFullName] = useState('Mohammad Al-Bakhla');
  const [email, setEmail] = useState('demo@bakhlatours.com');
  const [designation, setDesignation] = useState('Managing Director');
  const [country, setCountry] = useState('India');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('9820252434');
  const [city, setCity] = useState('Mumbai');
  const [companyName, setCompanyName] = useState('Bakhla Tours & Travels Pvt. Ltd.');
  const [website, setWebsite] = useState('https://bakhlatours.com');
  const [branches, setBranches] = useState<'Yes' | 'No'>('Yes');
  const [product, setProduct] = useState('Umrah ERP & B2B Sub-Agent Portal');
  const [teamSize, setTeamSize] = useState('10-20');
  const [message, setMessage] = useState(
    'We manage 3,500 pilgrims annually across Mumbai and Gujarat branches. Need dynamic Saudi hotel costing, group visa allotments, and sub-agent B2B portal.'
  );

  const [customOrigin, setCustomOrigin] = useState<string>('');
  
  if (!isOpen) return null;

  const detectedOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const currentOrigin = customOrigin.trim() || detectedOrigin || 'https://leadgeneration-sable.vercel.app';
  const cleanOrigin = currentOrigin.replace(/\/+$/, '');
  const webhookUrl = `${cleanOrigin}/api/webhooks/umrah-demo`;
  const alternateUrl = `${cleanOrigin}/api/leads/inbound`;

  const copyToClipboard = (text: string, type: 'url' | 'snippet') => {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } else {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2500);
    }
  };

  const handleTestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmissionFeedback(null);

    const payload = {
      fullName,
      email,
      designation,
      country,
      countryCode,
      phone: `${countryCode} ${phone}`.trim(),
      city,
      companyName,
      companyWebsite: website,
      branches,
      product,
      teamSize,
      message,
      sourceUrl: 'https://umrah360.in/request-demo',
    };

    try {
      const res = await fetch('/api/webhooks/umrah-demo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSubmissionFeedback({
          type: 'success',
          message: `Success! Lead for "${data.contact?.companyName || companyName}" was pushed directly to your CRM & Firestore DB.`,
          details: data,
        });

        if (onLeadCreated && data.lead?.leadId) {
          onLeadCreated(data.lead.leadId);
        }
      } else {
        setSubmissionFeedback({
          type: 'error',
          message: data.error || 'Failed to push lead. Please check the fields.',
        });
      }
    } catch (err: any) {
      setSubmissionFeedback({
        type: 'error',
        message: err?.message || 'Network error communicating with webhook endpoint.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const jsEmbedSnippet = `<!-- Umrah360 CRM Direct Webhook Integration for https://umrah360.in/request-demo -->
<script>
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    // Select the demo form on your website
    var form = document.querySelector('form') || document.querySelector('button[type="submit"]')?.closest('form');
    if (!form) return;

    form.addEventListener('submit', function(e) {
      // Collect form fields
      var formData = new FormData(form);
      var payload = {};
      formData.forEach(function(val, key) {
        payload[key] = val;
      });
      payload.sourceUrl = window.location.href;

      // Asynchronously push to your Umrah360 CRM
      fetch('${webhookUrl}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors'
      }).then(function(res) {
        return res.json();
      }).then(function(data) {
        console.log('[Umrah360 CRM] Lead successfully pushed:', data);
      }).catch(function(err) {
        console.warn('[Umrah360 CRM] Webhook notice:', err);
      });
    });
  });
})();
</script>`;

  const curlSnippet = `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "fullName": "Mohammad Al-Bakhla",
    "email": "demo@bakhlatours.com",
    "designation": "Managing Director",
    "country": "India",
    "phone": "+91 9820252434",
    "city": "Mumbai",
    "companyName": "Bakhla Tours & Travels Pvt. Ltd.",
    "website": "https://bakhlatours.com",
    "branches": "Yes",
    "product": "Umrah ERP & B2B Sub-Agent Portal",
    "teamSize": "10-20",
    "message": "We manage 3,500 pilgrims annually. Need dynamic Saudi hotel costing and sub-agent booking portal."
  }'`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Website Form Lead Ingestion
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Webhook Live</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                  <Database className="w-3 h-3" />
                  <span>Firestore Synced</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically push demo requests from <code className="text-emerald-400">umrah360.in/request-demo</code> into your CRM
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Webhook Endpoint Banner with Vercel Domain Selector */}
        <div className="px-6 py-3 bg-slate-950 border-b border-slate-800 flex flex-col gap-2.5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-hidden flex-1">
              <span className="text-slate-400 font-semibold whitespace-nowrap">Live Webhook URL:</span>
              <code className="text-emerald-400 font-mono bg-slate-900 px-2.5 py-1 rounded border border-slate-800 truncate select-all flex-1">
                {webhookUrl}
              </code>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => copyToClipboard(webhookUrl, 'url')}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? 'Copied!' : 'Copy Webhook URL'}</span>
              </button>
            </div>
          </div>

          {/* Vercel Host Override */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-900 text-[11px] text-slate-400">
            <span className="text-slate-400 font-medium">Deploying to Vercel?</span>
            <span className="text-slate-400">Set base URL:</span>
            <input
              type="text"
              value={customOrigin}
              onChange={(e) => setCustomOrigin(e.target.value)}
              placeholder={detectedOrigin || "https://your-crm-name.vercel.app"}
              className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-emerald-400 font-mono text-[11px] w-64 focus:outline-none focus:border-emerald-500"
            />
            {detectedOrigin && customOrigin !== detectedOrigin && (
              <button
                type="button"
                onClick={() => setCustomOrigin(detectedOrigin)}
                className="text-[10px] text-slate-400 hover:text-slate-200 underline"
              >
                Reset to Current Origin
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 gap-2 pt-2">
          <button
            onClick={() => setActiveTab('SIMULATOR')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'SIMULATOR'
                ? 'border-emerald-500 text-emerald-400 bg-slate-900/60 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Interactive Form Simulator</span>
          </button>

          <button
            onClick={() => setActiveTab('JS_SNIPPET')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'JS_SNIPPET'
                ? 'border-emerald-500 text-emerald-400 bg-slate-900/60 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>HTML / JavaScript Embed</span>
          </button>

          <button
            onClick={() => setActiveTab('WORDPRESS')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'WORDPRESS'
                ? 'border-emerald-500 text-emerald-400 bg-slate-900/60 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>WordPress / Elementor Guide</span>
          </button>

          <button
            onClick={() => setActiveTab('CURL')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'CURL'
                ? 'border-emerald-500 text-emerald-400 bg-slate-900/60 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>cURL & REST API</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: INTERACTIVE FORM SIMULATOR */}
          {activeTab === 'SIMULATOR' && (
            <div className="space-y-6">
              {/* Notification banner */}
              {submissionFeedback && (
                <div
                  className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
                    submissionFeedback.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {submissionFeedback.type === 'success' ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">{submissionFeedback.message}</p>
                    {submissionFeedback.details && (
                      <div className="text-[11px] text-slate-300 space-y-0.5 font-mono">
                        <div>Lead ID: {submissionFeedback.details.lead?.leadId}</div>
                        <div>Contact: {submissionFeedback.details.contact?.firstName} {submissionFeedback.details.contact?.lastName} ({submissionFeedback.details.contact?.email})</div>
                        <div>Company: {submissionFeedback.details.contact?.companyName} • Score: {submissionFeedback.details.lead?.leadScore} / 100</div>
                        <div>Demo Status: {submissionFeedback.details.lead?.demoStatus} (Auto-Scheduled)</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Simulate Website Form: umrah360.in/request-demo
                  </h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  This preview replicates the exact fields from your live website form. Click <strong>"Schedule my Free Demo & Push to CRM"</strong> below to test live lead ingestion into your CRM and Firestore database.
                </p>
              </div>

              <form onSubmit={handleTestSubmit} className="space-y-6">
                {/* Section 1: Your Details */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-1.5">
                    <User className="w-4 h-4" />
                    <span>Your Details</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Your Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Your Email *
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Designation
                      </label>
                      <input
                        type="text"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        placeholder="e.g. Managing Director"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Select Country
                      </label>
                      <select
                        value={country}
                        onChange={(e) => {
                          setCountry(e.target.value);
                          if (e.target.value === 'India') setCountryCode('+91');
                          else if (e.target.value === 'Saudi Arabia') setCountryCode('+966');
                          else if (e.target.value === 'United Arab Emirates') setCountryCode('+971');
                          else if (e.target.value === 'United Kingdom') setCountryCode('+44');
                          else if (e.target.value === 'United States') setCountryCode('+1');
                        }}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="India">India</option>
                        <option value="Saudi Arabia">Saudi Arabia</option>
                        <option value="United Arab Emirates">United Arab Emirates</option>
                        <option value="United Kingdom">United Kingdom</option>
                        <option value="United States">United States</option>
                        <option value="Egypt">Egypt</option>
                        <option value="Indonesia">Indonesia</option>
                        <option value="Pakistan">Pakistan</option>
                        <option value="Turkey">Turkey</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Phone Number
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={countryCode}
                          onChange={(e) => setCountryCode(e.target.value)}
                          className="w-16 px-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono text-center focus:outline-none focus:border-emerald-500"
                        />
                        <input
                          type="text"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="Phone Number"
                          className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Your City
                      </label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Mumbai"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: About Your Company */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-1.5">
                    <Building className="w-4 h-4" />
                    <span>About Your Company</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Company Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="e.g. Bakhla Tours & Travels"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Company Website
                      </label>
                      <input
                        type="url"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Branches
                      </label>
                      <div className="flex items-center gap-4 pt-2 text-xs text-slate-200">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="branches"
                            checked={branches === 'Yes'}
                            onChange={() => setBranches('Yes')}
                            className="text-emerald-500 focus:ring-emerald-500"
                          />
                          <span>Yes</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="branches"
                            checked={branches === 'No'}
                            onChange={() => setBranches('No')}
                            className="text-emerald-500 focus:ring-emerald-500"
                          />
                          <span>No</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3: Product */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-1.5">
                    <Sparkles className="w-4 h-4" />
                    <span>Product & Requirements</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Select Products
                      </label>
                      <select
                        value={product}
                        onChange={(e) => setProduct(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="Umrah ERP & B2B Sub-Agent Portal">Umrah ERP & B2B Sub-Agent Portal</option>
                        <option value="Saudi Umrah Visa & Hotel Allotments">Saudi Umrah Visa & Hotel Allotments</option>
                        <option value="Pilgrimage Dynamic Costing & Voucher Engine">Pilgrimage Dynamic Costing & Voucher Engine</option>
                        <option value="Complete Enterprise Pilgrimage Suite">Complete Enterprise Pilgrimage Suite (20+ Users)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Team Size
                      </label>
                      <select
                        value={teamSize}
                        onChange={(e) => setTeamSize(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="1-5 Users">1-5 Users</option>
                        <option value="5-10 Users">5-10 Users</option>
                        <option value="10-20 Users">10-20 Users</option>
                        <option value="20+ Users (Enterprise)">20+ Users (Enterprise)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 4: Message / Query */}
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-slate-300">
                    Message / Query
                  </label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Message here..."
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                {/* Submit Action */}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-slate-400">
                    Target: <code className="text-emerald-400">/api/webhooks/umrah-demo</code>
                  </span>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950/60 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Pushing to CRM...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Schedule my Free Demo & Push to CRM</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: HTML / JAVASCRIPT EMBED */}
          {activeTab === 'JS_SNIPPET' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  How to embed on umrah360.in/request-demo
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Add this small script right before the closing <code className="text-emerald-400">&lt;/body&gt;</code> tag on your website page. It intercepts the "Schedule my Free Demo" submit event, captures all filled fields, and delivers the lead directly into this CRM with zero server reload needed!
                </p>
              </div>

              <div className="relative">
                <button
                  onClick={() => copyToClipboard(jsEmbedSnippet, 'snippet')}
                  className="absolute right-3 top-3 flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition"
                >
                  {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSnippet ? 'Copied!' : 'Copy Code'}</span>
                </button>
                <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-emerald-300 font-mono text-xs overflow-x-auto leading-relaxed">
                  {jsEmbedSnippet}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 3: WORDPRESS / ELEMENTOR */}
          {activeTab === 'WORDPRESS' && (
            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Connecting WordPress / Elementor Form
                </h3>
                <p className="text-slate-300 leading-relaxed">
                  If your website <code className="text-emerald-400">umrah360.in</code> is built with WordPress + Elementor Pro, you can connect the form in 2 minutes:
                </p>
              </div>

              <div className="space-y-3 p-4 bg-slate-950/60 border border-slate-800 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">1</div>
                  <div>
                    <strong className="text-white block">Edit Form in Elementor:</strong>
                    Open your <code>/request-demo</code> page in Elementor and click to select the form widget.
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">2</div>
                  <div>
                    <strong className="text-white block">Add Webhook Action:</strong>
                    Under <strong>Actions After Submit</strong>, add <strong>Webhook</strong>.
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">3</div>
                  <div>
                    <strong className="text-white block">Paste Webhook URL:</strong>
                    In the Webhook settings tab, paste:
                    <div className="mt-1 font-mono text-emerald-400 bg-slate-900 p-2 rounded border border-slate-800 select-all">
                      {webhookUrl}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">4</div>
                  <div>
                    <strong className="text-white block">Field Mapping:</strong>
                    Elementor form field IDs map automatically:
                    <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[11px]">
                      <div className="bg-slate-900 p-1.5 rounded text-slate-300">fullName: your name field</div>
                      <div className="bg-slate-900 p-1.5 rounded text-slate-300">email: your email field</div>
                      <div className="bg-slate-900 p-1.5 rounded text-slate-300">phone: your phone field</div>
                      <div className="bg-slate-900 p-1.5 rounded text-slate-300">companyName: your company field</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CURL & REST API */}
          {activeTab === 'CURL' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Direct REST API Endpoint
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Send a standard <code className="text-emerald-400">POST</code> request with <code className="text-emerald-400">Content-Type: application/json</code> or <code className="text-emerald-400">application/x-www-form-urlencoded</code>. CORS is enabled globally.
                </p>
              </div>

              <div className="relative">
                <button
                  onClick={() => copyToClipboard(curlSnippet, 'snippet')}
                  className="absolute right-3 top-3 flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition"
                >
                  {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSnippet ? 'Copied!' : 'Copy cURL'}</span>
                </button>
                <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-emerald-300 font-mono text-xs overflow-x-auto leading-relaxed">
                  {curlSnippet}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Database className="w-4 h-4 text-emerald-400" />
            <span>Target Collection: <strong className="text-slate-200 font-mono">leads</strong> &amp; <strong className="text-slate-200 font-mono">contacts</strong> in Firestore</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
