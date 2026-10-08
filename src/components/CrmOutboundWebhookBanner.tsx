import React, { useState, useEffect } from 'react';
import {
  Share2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Eye,
  EyeOff,
  Code,
  ShieldCheck,
  ExternalLink,
  Zap,
} from 'lucide-react';

interface CrmOutboundWebhookBannerProps {
  tenantId?: string;
}

interface WebhookConfig {
  webhookUrl: string;
  enabled: boolean;
  secret?: string;
  description?: string;
  lastTriggeredAt?: string;
  lastStatus?: number;
  lastStatusText?: string;
  lastError?: string;
  lastLeadName?: string;
  lastLeadCompany?: string;
  totalForwardedCount?: number;
  updatedAt?: string;
}

interface TestResult {
  success: boolean;
  statusCode: number;
  statusText: string;
  latencyMs: number;
  responseSnippet?: string;
  sentPayload?: any;
  error?: string;
}

export const CrmOutboundWebhookBanner: React.FC<CrmOutboundWebhookBannerProps> = ({
  tenantId = 'umrah360',
}) => {
  const [config, setConfig] = useState<WebhookConfig>({
    webhookUrl: '',
    enabled: false,
    secret: '',
    totalForwardedCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Fetch tenant-specific outbound webhook configuration
  const fetchConfig = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/crm-webhook`);
      if (res.ok) {
        const data = await res.json();
        setConfig({
          webhookUrl: data.webhookUrl || '',
          enabled: data.enabled ?? false,
          secret: data.secret || '',
          description: data.description || '',
          lastTriggeredAt: data.lastTriggeredAt,
          lastStatus: data.lastStatus,
          lastStatusText: data.lastStatusText,
          lastError: data.lastError,
          lastLeadName: data.lastLeadName,
          lastLeadCompany: data.lastLeadCompany,
          totalForwardedCount: data.totalForwardedCount || 0,
          updatedAt: data.updatedAt,
        });
      }
    } catch (err) {
      console.warn('[CRM Webhook Banner] Notice loading config:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, [tenantId]);

  // Handle Save
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/crm-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: config.webhookUrl,
          enabled: config.enabled,
          secret: config.secret,
          description: config.description,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save webhook settings');
      }

      setFeedback({ type: 'success', message: 'Webhook configuration saved successfully!' });
      if (data.config) {
        setConfig((prev) => ({ ...prev, ...data.config }));
      }
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error saving webhook configuration' });
    } finally {
      setSaving(false);
    }
  };

  // Handle Test Webhook
  const handleTest = async () => {
    if (!config.webhookUrl) {
      setFeedback({ type: 'error', message: 'Please enter a webhook URL first to test.' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/crm-webhook/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: config.webhookUrl,
          secret: config.secret,
        }),
      });

      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        setFeedback({
          type: 'success',
          message: `Webhook Test Successful! Received HTTP ${data.statusCode} in ${data.latencyMs}ms`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: `Test Failed: ${data.error || `HTTP ${data.statusCode}`}`,
        });
      }
      // Refresh to reflect last status
      fetchConfig();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to dispatch test payload' });
    } finally {
      setTesting(false);
    }
  };

  const samplePayloadJson = JSON.stringify(
    {
      event: 'lead.created',
      eventVersion: '1.0',
      timestamp: new Date().toISOString(),
      tenantId: tenantId,
      lead: {
        leadId: 'lead-inbound-74829',
        source: 'EMAIL',
        leadType: 'INBOUND',
        status: 'QUALIFIED',
        intent: 'HIGH',
        leadScore: 92,
        buyingStage: 'EVALUATING',
        serviceInterest: 'Custom B2B Pilgrimage Package & Portal Integration',
        requirements: ['Multi-currency bookings', '10 user seats', 'API CRM Sync'],
        budget: '$15,000 - $25,000',
        aiSummary: 'Qualified customer inquiry received via email pipeline.',
        createdAt: new Date().toISOString(),
      },
      contact: {
        contactId: 'cnt-49201',
        firstName: 'Tariq',
        lastName: 'Al-Mansoor',
        email: 'tariq.mansoor@example-travels.com',
        phone: '+91 98201 12345',
        companyName: 'Al-Mansoor Holidays & Tours Pvt Ltd',
        jobTitle: 'Managing Director',
        city: 'Mumbai',
        country: 'India',
      },
      meta: {
        forwardedFrom: 'AI Studio Omnichannel CRM',
        clientWorkspace: tenantId,
        dispatchedAt: new Date().toISOString(),
      },
    },
    null,
    2
  );

  const isConfigured = Boolean(config.webhookUrl);
  const isActive = isConfigured && config.enabled;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden transition-all duration-200">
      {/* Top Banner Header Row */}
      <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-gradient-to-r from-slate-50/70 via-white to-orange-50/30 border-b border-slate-100">
        <div className="flex items-start sm:items-center gap-3">
          <div className={`p-2.5 rounded-xl border flex-shrink-0 transition-colors ${
            isActive
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200/80 shadow-2xs'
              : isConfigured
              ? 'bg-amber-50 text-amber-600 border-amber-200/80'
              : 'bg-orange-50 text-orange-600 border-orange-200/80'
          }`}>
            <Share2 className="w-5 h-5" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                External CRM Lead Webhook
              </h2>

              {/* Status Badge */}
              {isActive ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Sync Active
                </span>
              ) : isConfigured ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Sync Paused
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200/80">
                  Not Configured
                </span>
              )}

              {/* Unique Client Badge */}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                Workspace: <span className="text-orange-600 font-bold">{tenantId}</span>
              </span>
            </div>

            <p className="text-xs text-slate-500 mt-1">
              Automatically stream qualified leads in real time into your private CRM (HubSpot, Salesforce, Zoho, Zapier, custom API) as they land in this workspace.
            </p>
          </div>
        </div>

        {/* Action Controls & Toggle */}
        <div className="flex items-center gap-2 self-end md:self-center">
          {/* Active Lead Counter badge */}
          {config.totalForwardedCount !== undefined && config.totalForwardedCount > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200" title="Total leads forwarded to external webhook">
              <Zap className="w-3.5 h-3.5 text-orange-500" />
              <span>{config.totalForwardedCount} leads synced</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 shadow-2xs transition-all"
          >
            <span>{isExpanded ? 'Hide Settings' : isConfigured ? 'Edit Webhook' : 'Configure Webhook'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </button>
        </div>
      </div>

      {/* Quick Summary Pill when collapsed but configured */}
      {!isExpanded && isConfigured && (
        <div className="px-5 py-2.5 bg-slate-50/50 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
          <div className="flex items-center gap-2 font-mono truncate max-w-md">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Target Endpoint:</span>
            <span className="text-slate-700 truncate font-medium bg-white px-2 py-0.5 rounded border border-slate-200/80">
              {config.webhookUrl}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            {config.lastTriggeredAt && (
              <span className="flex items-center gap-1 text-slate-500">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>Last sent: {new Date(config.lastTriggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {config.lastStatus !== undefined && (
                  <span className={`font-bold ml-0.5 ${config.lastStatus >= 200 && config.lastStatus < 300 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    ({config.lastStatus} {config.lastStatusText || ''})
                  </span>
                )}
              </span>
            )}
            <button
              onClick={() => setIsExpanded(true)}
              className="text-orange-600 hover:text-orange-700 font-semibold text-xs transition"
            >
              Manage &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Expanded Configuration Form */}
      {isExpanded && (
        <div className="p-5 border-t border-slate-100 space-y-4 bg-slate-50/30">
          {/* Notification Feedback */}
          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
              <button
                onClick={() => setFeedback(null)}
                className="text-slate-400 hover:text-slate-600 text-xs ml-3"
              >
                &times;
              </button>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
              {/* Webhook URL Input */}
              <div className="lg:col-span-8">
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Target Webhook Endpoint URL *</span>
                  <span className="text-[10px] font-normal text-slate-400">HTTP POST • Content-Type: application/json</span>
                </label>
                <div className="relative">
                  <input
                    type="url"
                    placeholder="https://your-crm.example.com/api/webhooks/leads"
                    value={config.webhookUrl}
                    onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                    required
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                  {config.webhookUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(config.webhookUrl);
                        setCopiedUrl(true);
                        setTimeout(() => setCopiedUrl(false), 2000);
                      }}
                      className="absolute right-2 top-2 p-1 text-slate-400 hover:text-slate-600 rounded transition"
                      title="Copy URL"
                    >
                      {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Unique to workspace <strong className="text-slate-600">{tenantId}</strong>. Each client configures their own destination endpoint.
                </p>
              </div>

              {/* Secret Key Input */}
              <div className="lg:col-span-4">
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Secret / Token (Optional)</span>
                  <span className="text-[10px] font-normal text-slate-400">HMAC-SHA256 signature</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    placeholder="e.g. whsec_abc123"
                    value={config.secret || ''}
                    onChange={(e) => setConfig({ ...config, secret: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 pr-9 text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    title={showSecret ? 'Hide Secret' : 'Show Secret'}
                  >
                    {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Sent via <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">X-Webhook-Secret</code> header.
                </p>
              </div>
            </div>

            {/* Toggle & Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                />
                <span className="text-xs font-bold text-slate-700">
                  Enable automatic outbound forwarding for all newly qualified leads
                </span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSchemaModal(true)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 shadow-2xs transition flex items-center gap-1.5"
                >
                  <Code className="w-3.5 h-3.5 text-slate-400" />
                  <span>Payload Schema</span>
                </button>

                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !config.webhookUrl}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200/80 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  {testing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                  )}
                  <span>{testing ? 'Testing...' : '⚡ Test Webhook'}</span>
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-2xs hover:shadow transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>{saving ? 'Saving...' : 'Save Settings'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Test Result Inspector Banner */}
          {testResult && (
            <div className={`p-4 rounded-xl border space-y-2 text-xs transition-all ${
              testResult.success ? 'bg-emerald-50/70 border-emerald-200' : 'bg-rose-50/70 border-rose-200'
            }`}>
              <div className="flex items-center justify-between font-bold">
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                  )}
                  <span className={testResult.success ? 'text-emerald-900' : 'text-rose-900'}>
                    Test Result: HTTP {testResult.statusCode} {testResult.statusText} ({testResult.latencyMs}ms)
                  </span>
                </div>
                <button
                  onClick={() => setTestResult(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  &times;
                </button>
              </div>

              {testResult.responseSnippet && (
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                    Server Response Snippet:
                  </span>
                  <pre className="p-2 bg-white/80 rounded border border-slate-200/80 font-mono text-[11px] text-slate-700 max-h-24 overflow-y-auto">
                    {testResult.responseSnippet}
                  </pre>
                </div>
              )}

              {testResult.error && (
                <p className="text-xs text-rose-700 font-medium">
                  Error Details: {testResult.error}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payload Schema Modal */}
      {showSchemaModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl text-slate-900">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Code className="w-4 h-4 text-orange-500" />
                  <span>Outbound CRM Webhook Payload Specification</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Standard JSON payload dispatched to your external CRM whenever a lead qualifies.
                </p>
              </div>
              <button
                onClick={() => setShowSchemaModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                &times;
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-900">HTTP Headers sent:</p>
                <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px]">
                  <li><code>Content-Type: application/json</code></li>
                  <li><code>X-Tenant-ID: {tenantId}</code></li>
                  <li><code>X-Webhook-Event: lead.created</code></li>
                  <li><code>X-Webhook-Secret: &lt;configured_secret&gt;</code> (if set)</li>
                  <li><code>X-Signature-SHA256: &lt;hmac_sha256_hex&gt;</code> (if secret set)</li>
                </ul>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-700">Sample JSON Payload:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(samplePayloadJson);
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                    className="text-xs text-orange-600 hover:text-orange-700 font-semibold flex items-center gap-1"
                  >
                    {copiedUrl ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedUrl ? 'Copied!' : 'Copy JSON'}</span>
                  </button>
                </div>
                <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-xl font-mono text-xs overflow-x-auto max-h-72">
                  {samplePayloadJson}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowSchemaModal(false)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
