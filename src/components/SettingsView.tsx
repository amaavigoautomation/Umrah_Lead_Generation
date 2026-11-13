import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle,
  CheckCircle2,
  Clock3,
  Building2,
  CreditCard,
  ExternalLink,
  Globe,
  Mail,
  Plug,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react';
import { SystemSettings, Channel, ChannelMode, AppUser, AuditLog } from '../types';
import { UserManagementView } from './UserManagementView';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { InboundMailboxPanel } from './InboundMailboxPanel';
import { WebsiteWebhookPanel } from './WebsiteWebhookPanel';
import { ChatbotIntegrationPanel } from './ChatbotIntegrationPanel';
import { BillingView } from './BillingView';
import { ConnectedChannelsPanel } from './ConnectedChannelsPanel';
import { normalizeChannelMode } from '../shared/channelModes';

const CompanyProfilePanel = React.lazy(() => import('./BrandSettingsPanel').then((module) => ({ default: module.BrandSettingsPanel })));
const WorkspaceAuditLogs = React.lazy(() => import('./AuditLogsView').then((module) => ({ default: module.AuditLogsView })));

export type WorkspaceSection = 'overview' | 'company' | 'channels' | 'ai' | 'team' | 'billing' | 'audit';

interface SettingsViewProps {
  settings: SystemSettings;
  onSaveSettings: (settings: SystemSettings) => void | Promise<void>;
  users?: AppUser[];
  usersLoading?: boolean;
  usersError?: string | null;
  onSaveUser?: (user: AppUser) => Promise<void>;
  onDeleteUser?: (userId: string) => Promise<void>;
  tenantId?: string;
  canEditEmail?: boolean;
  timezone?: string;
  workspaceName?: string;
  unreadCount?: number;
  handoffCount?: number;
  knowledgeDocumentCount?: number;
  currentUserEmail?: string;
  canAccessSettings?: boolean;
  canAccessAuditLogs?: boolean;
  initialSection?: WorkspaceSection;
  onSectionChange?: (section: WorkspaceSection) => void;
}

export const WorkspaceView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  users,
  usersLoading,
  usersError,
  onSaveUser,
  onDeleteUser,
  tenantId,
  canEditEmail,
  timezone,
  workspaceName,
  unreadCount = 0,
  handoffCount = 0,
  knowledgeDocumentCount = 0,
  currentUserEmail,
  canAccessSettings = false,
  canAccessAuditLogs = false,
  initialSection = 'overview',
  onSectionChange,
}) => {
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(initialSection);
  const [notificationPermissionError, setNotificationPermissionError] = useState<string | null>(null);
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [overviewData, setOverviewData] = useState<{
    loading: boolean;
    loadedAt: string | null;
    health: any | null;
    channels: any | null;
    email: any | null;
    brand: any | null;
    activity: AuditLog[];
    errors: string[];
  }>({
    loading: false,
    loadedAt: null,
    health: null,
    channels: null,
    email: null,
    brand: null,
    activity: [],
    errors: [],
  });
  const [handoffKeywordsText, setHandoffKeywordsText] = useState((settings.humanHandoffKeywords || []).join('\n'));
  const handoffRules = formData.humanHandoffRules || { explicitRequest: true, frustration: true, aiUnableToResolve: true, failureThreshold: 2 };

  React.useEffect(() => {
    setFormData(settings);
    setHandoffKeywordsText((settings.humanHandoffKeywords || []).join('\n'));
  }, [settings]);

  React.useEffect(() => {
    setActiveSection(initialSection || 'overview');
  }, [initialSection]);

  React.useEffect(() => {
    if (activeSection !== 'overview' || !tenantId) return;
    const controller = new AbortController();
    let active = true;
    const fetchJson = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
      return data;
    };

    setOverviewData((current) => ({ ...current, loading: true, errors: [] }));
    const activityUrl = `/api/audit-logs?limit=6&tenantId=${encodeURIComponent(tenantId)}`;
    const auditRequest = canAccessAuditLogs ? fetchJson(activityUrl) : Promise.resolve({ logs: [] });
    void Promise.allSettled([
      fetchJson('/api/health'),
      fetchJson('/api/channels/status'),
      fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}/email`),
      fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}/brand`),
      auditRequest,
    ]).then((results) => {
      if (!active) return;
      const valueAt = (index: number) => results[index].status === 'fulfilled' ? results[index].value : null;
      const errors = results.flatMap((result, index) => result.status === 'rejected'
        ? [['health', 'channels', 'email', 'company profile', 'recent activity'][index]]
        : []);
      const auditPayload = valueAt(4);
      setOverviewData({
        loading: false,
        loadedAt: new Date().toISOString(),
        health: valueAt(0),
        channels: valueAt(1),
        email: valueAt(2),
        brand: valueAt(3),
        activity: Array.isArray(auditPayload?.logs) ? auditPayload.logs.slice(0, 6) : [],
        errors,
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activeSection, tenantId, overviewRefreshKey, canAccessAuditLogs]);

  const channels: Channel[] = ['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'WEBSITE'];

  const handleModeChange = (channel: Channel, mode: ChannelMode) => {
    setFormData({
      ...formData,
      channelModes: {
        ...formData.channelModes,
        [channel]: mode,
      },
    });
  };

  const handleSave = async () => {
    setIsSavingSettings(true);
    setSaveError(null);
    setIsSaved(false);
    try {
      await onSaveSettings({
        ...formData,
        humanHandoffEnabled: true,
        humanHandoffCustomPhrasesEnabled: formData.humanHandoffCustomPhrasesEnabled ?? true,
        humanHandoffKeywords: handoffKeywordsText.split('\n').map((v) => v.trim()).filter(Boolean),
        humanHandoffRules: {
          explicitRequest: Boolean(handoffRules.explicitRequest),
          frustration: Boolean(handoffRules.frustration),
          aiUnableToResolve: Boolean(handoffRules.aiUnableToResolve),
          failureThreshold: Number(handoffRules.failureThreshold) || 2,
        },
        notificationPreferences: {
          newMessages: formData.notificationPreferences?.newMessages === true,
          humanHandoff: formData.notificationPreferences?.humanHandoff === true,
          agentTaskCompletion: formData.notificationPreferences?.agentTaskCompletion === true,
        },
        workspacePreferences: {
          defaultLandingPage: formData.workspacePreferences?.defaultLandingPage || 'dashboard',
        },
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || 'Settings could not be saved. Please try again.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const notificationPreferences = formData.notificationPreferences || { newMessages: false, humanHandoff: false, agentTaskCompletion: false };
  const workspacePreferences = formData.workspacePreferences || { defaultLandingPage: 'dashboard' as const };

  const handleNotificationPreferenceChange = async (key: 'newMessages' | 'humanHandoff' | 'agentTaskCompletion', enabled: boolean) => {
    setNotificationPermissionError(null);
    if (enabled) {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        setNotificationPermissionError('This browser does not support desktop notifications.');
        return;
      }
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNotificationPermissionError(permission === 'denied'
          ? 'Browser notifications are blocked. Allow notifications for this site in your browser settings.'
          : 'Notification permission was not granted.');
        return;
      }
    }
    setFormData((current) => ({
      ...current,
      notificationPreferences: {
        newMessages: current.notificationPreferences?.newMessages === true,
        humanHandoff: current.notificationPreferences?.humanHandoff === true,
        agentTaskCompletion: current.notificationPreferences?.agentTaskCompletion === true,
        [key]: enabled,
      },
    }));
  };

  const sectionItems = [
    { id: 'overview' as const, label: 'Overview', description: 'Workspace health and operational readiness', icon: <Activity className="h-4 w-4" /> },
    { id: 'company' as const, label: 'Company Profile', description: 'Business identity, website, branding and assets', icon: <Building2 className="h-4 w-4" /> },
    ...(canAccessSettings ? [
      { id: 'channels' as const, label: 'Channels & Messaging', description: 'Connected channels, email and website integrations', icon: <Plug className="h-4 w-4" /> },
      { id: 'ai' as const, label: 'AI & Automation', description: 'Channel modes, handoff and runtime settings', icon: <Bot className="h-4 w-4" /> },
    ] : []),
    ...(canEditEmail ? [
      { id: 'team' as const, label: 'Team & Permissions', description: 'Workspace users, roles and module access', icon: <Users className="h-4 w-4" /> },
      { id: 'billing' as const, label: 'Billing & Plan', description: 'Subscription, plan and workspace usage', icon: <CreditCard className="h-4 w-4" /> },
    ] : []),
    ...(canAccessAuditLogs ? [
      { id: 'audit' as const, label: 'Audit & Security', description: 'Activity records, compliance and security events', icon: <ShieldCheck className="h-4 w-4" /> },
    ] : []),
  ];
  const activeSectionMeta = sectionItems.find((item) => item.id === activeSection) || sectionItems[0];
  const activeSectionVisible = sectionItems.some((item) => item.id === activeSection);
  const changeSection = (section: WorkspaceSection) => {
    if (!sectionItems.some((item) => item.id === section)) return;
    setActiveSection(section);
    onSectionChange?.(section);
  };
  React.useEffect(() => {
    if (!activeSectionVisible) {
      setActiveSection('overview');
      onSectionChange?.('overview');
    }
  }, [activeSectionVisible, onSectionChange]);
  const modeCounts = channels.reduce((counts, channel) => {
    const mode = normalizeChannelMode(formData.channelModes?.[channel]);
    counts[mode] += 1;
    return counts;
  }, { AUTO: 0, REVIEW: 0, OFF: 0 });

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 font-sans">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-orange-600">
              <Building2 className="h-5 w-5" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Workspace management</span>
            </div>
            <h1 className="mt-1 text-xl font-extrabold text-slate-950 sm:text-2xl">Workspace</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              Manage company identity, channels, AI operations, your team, billing and security.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
            {(activeSection === 'overview' || activeSection === 'ai' || activeSection === 'channels') && canEditEmail && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSavingSettings || !canEditEmail}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                title={!canEditEmail ? 'Only workspace admins can save these settings' : 'Save AI, handoff, channel, email signature and runtime settings'}
              >
                {isSaved ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                <span>{isSavingSettings ? 'Saving changes…' : isSaved ? 'Changes saved' : 'Save settings'}</span>
              </button>
            )}
            {saveError ? <span role="alert" className="text-[11px] text-rose-600">{saveError}</span> : (
              (activeSection === 'overview' || activeSection === 'ai' || activeSection === 'channels') && canEditEmail && <span className="text-[10px] text-slate-400">Save changes made in this Workspace area</span>
            )}
          </div>
        </div>
      </header>

      <nav aria-label="Workspace sections" className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {sectionItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => changeSection(item.id)}
            aria-current={activeSection === item.id ? 'page' : undefined}
            title={item.description}
            className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${activeSection === item.id ? 'border-orange-200 bg-orange-50 text-orange-800 shadow-sm' : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'}`}
          >
            <span className={`shrink-0 ${activeSection === item.id ? 'text-orange-600' : 'text-slate-400'}`}>{item.icon}</span>
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        ))}
      </nav>

      <main className="min-w-0 w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {activeSection !== 'company' && activeSection !== 'audit' && (
            <div className="mb-5 flex flex-col gap-1 border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-950">{activeSectionMeta.label}</h2>
              <p className="text-xs text-slate-500">{activeSectionMeta.description}</p>
            </div>
          )}

          {activeSection === 'overview' && (() => {
            const health = overviewData.health;
            const channelStatus = overviewData.channels;
            const email = overviewData.email;
            const brand = overviewData.brand?.brand || null;
            const defaultLandingPage = workspacePreferences.defaultLandingPage || 'dashboard';
            const landingPageLabel = defaultLandingPage === 'inbox' ? 'Unified Inbox' : defaultLandingPage === 'campaigns' ? 'Campaigns' : 'Dashboard';
            const rules = formData.humanHandoffRules || { explicitRequest: true, frustration: true, aiUnableToResolve: true, failureThreshold: 2 };
            const activeHandoffRules = [rules.explicitRequest, rules.frustration, rules.aiUnableToResolve].filter(Boolean).length;

            const metaState = (key: 'whatsapp' | 'instagram' | 'messenger') => channelStatus?.[key];
            const metaLabel = (key: 'whatsapp' | 'instagram' | 'messenger') => {
              const state = metaState(key);
              if (!state) return 'Not checked';
              if (state.error) return 'Status unavailable';
              if (state.connected) return 'Connected';
              if (state.available === false) return 'Setup incomplete';
              return 'Not connected';
            };
            const metaTone = (key: 'whatsapp' | 'instagram' | 'messenger') => {
              const state = metaState(key);
              if (state?.connected && !state.error) return 'success';
              if (state?.error) return 'danger';
              if (state && state.available === false) return 'warning';
              return 'muted';
            };
            const emailLabel = !email
              ? 'Not checked'
              : email.canSend
                ? 'Ready to send'
                : email.domain
                  ? email.status === 'verified' ? 'Sender setup needed' : 'Domain verification pending'
                  : email.resendConfigured === false ? 'Provider unavailable' : 'Not configured';
            const emailTone = !email ? 'muted' : email.canSend ? 'success' : email.domain ? 'warning' : email.resendConfigured === false ? 'danger' : 'muted';
            const websiteWebhook = health?.websiteWebhook;
            const websiteReady = websiteWebhook?.available === true || websiteWebhook?.status === 'ready';
            const websiteLabel = !health || !websiteWebhook ? 'Status not available' : websiteReady ? 'Endpoint available' : 'Needs review';
            const websiteTone = !health || !websiteWebhook ? 'muted' : websiteReady ? 'success' : 'warning';

            const monitoredConnected = [
              Boolean(channelStatus?.whatsapp?.connected && !channelStatus?.whatsapp?.error),
              Boolean(channelStatus?.instagram?.connected && !channelStatus?.instagram?.error),
              Boolean(channelStatus?.messenger?.connected && !channelStatus?.messenger?.error),
              Boolean(email?.canSend),
            ].filter(Boolean).length;
            const monitoredCount = 4;

            const issues: Array<{ title: string; detail: string; section: 'ai' | 'channels' }> = [];
            if (!overviewData.loading && overviewData.errors.includes('health')) {
              issues.push({ title: 'Core health check unavailable', detail: 'The application could not retrieve its current server health status.', section: 'ai' });
            }
            if (!overviewData.loading && overviewData.errors.includes('channels')) {
              issues.push({ title: 'Channel status could not be loaded', detail: 'The workspace connection check failed. Open Channels to retry.', section: 'channels' });
            }
            if (!overviewData.loading && overviewData.errors.includes('email')) {
              issues.push({ title: 'Email readiness could not be checked', detail: 'The email settings service did not return a status.', section: 'channels' });
            }
            if (email?.resendConfigured === false) {
              issues.push({ title: 'Email sending provider is unavailable', detail: 'The platform email provider is not configured for this workspace.', section: 'channels' });
            } else if (email?.domain && email.status !== 'verified') {
              issues.push({ title: 'Email domain verification is incomplete', detail: `${email.domain} is not verified yet. Complete the DNS checks before sending from this domain.`, section: 'channels' });
            } else if (email?.domain && email.status === 'verified' && !email.canSend) {
              issues.push({ title: 'Email sender is not ready', detail: 'The domain is verified, but a usable sender address is not enabled yet.', section: 'channels' });
            }
            if (channelStatus && ['whatsapp', 'instagram', 'messenger'].some((key) => channelStatus[key]?.error)) {
              issues.push({ title: 'A channel connection check failed', detail: 'One or more Meta channel statuses could not be verified. Review Channels for details.', section: 'channels' });
            }
            if (websiteWebhook && !websiteReady) {
              issues.push({ title: 'Website webhook endpoint needs review', detail: 'The health endpoint explicitly reported that the website webhook route is not ready.', section: 'channels' });
            }
            const checkedCount = [health, channelStatus, email, brand].filter(Boolean).length;
            const healthLabel = overviewData.loading ? 'Checking' : issues.length > 0 ? 'Needs attention' : checkedCount > 0 ? 'Operational' : 'Unavailable';
            const healthTone = overviewData.loading ? 'muted' : issues.length > 0 ? 'warning' : checkedCount > 0 ? 'success' : 'danger';

            const channelRows = [
              { name: 'WhatsApp', channel: 'WHATSAPP' as Channel, label: metaLabel('whatsapp'), tone: metaTone('whatsapp'), destination: 'channels' as const, note: channelStatus?.whatsapp?.connection?.displayPhoneNumber || 'Meta WhatsApp connection' },
              { name: 'Instagram', channel: 'INSTAGRAM' as Channel, label: metaLabel('instagram'), tone: metaTone('instagram'), destination: 'channels' as const, note: channelStatus?.instagram?.connection?.username || 'Instagram business account' },
              { name: 'Facebook Messenger', channel: 'FACEBOOK' as Channel, label: metaLabel('messenger'), tone: metaTone('messenger'), destination: 'channels' as const, note: channelStatus?.messenger?.connection?.pageName || 'Facebook Page connection' },
              { name: 'Email', channel: 'EMAIL' as Channel, label: emailLabel, tone: emailTone, destination: 'channels' as const, note: email?.fromAddress || email?.domain || 'Sending domain and sender' },
              { name: 'Website', channel: 'WEBSITE' as Channel, label: websiteLabel, tone: websiteTone, destination: 'channels' as const, note: 'Inbound webhook endpoint' },
              { name: 'LinkedIn', channel: 'LINKEDIN' as Channel, label: 'Connection status not monitored', tone: 'muted', destination: 'channels' as const, note: 'Operating mode shown; no live connection check is exposed yet' },
            ];

            const toneClass = (tone: string) => tone === 'success'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
              : tone === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-100'
                : tone === 'danger'
                  ? 'bg-rose-50 text-rose-700 border-rose-100'
                  : 'bg-slate-100 text-slate-600 border-slate-200';
            const companyName = brand?.companyName || workspaceName || tenantId || 'Workspace';

            return (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-950">Workspace Control Center</h3>
                    <p className="mt-1 text-xs text-slate-500">A live view of configuration health, integrations and workspace readiness.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">{overviewData.loadedAt ? `Updated ${new Date(overviewData.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live status checks'}</span>
                    <button type="button" onClick={() => setOverviewRefreshKey((value) => value + 1)} disabled={overviewData.loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50" title="Refresh workspace checks">
                      <RefreshCw className={overviewData.loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">Workspace health</span>
                      <Activity className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${healthTone === 'success' ? 'bg-emerald-500' : healthTone === 'warning' ? 'bg-amber-500' : healthTone === 'danger' ? 'bg-rose-500' : 'bg-slate-400'}`} />
                      <span className="text-xl font-extrabold text-slate-950">{healthLabel}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{overviewData.loading ? 'Checking workspace services…' : `${issues.length} item(s) need review`}</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">Connected integrations</span>
                      <Plug className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="mt-3 text-2xl font-extrabold tabular-nums text-slate-950">{channelStatus && email ? `${monitoredConnected}/${monitoredCount}` : '—'}</div>
                    <p className="mt-1 text-[11px] text-slate-500">WhatsApp, Instagram, Messenger and Email</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">AI service</span>
                      <Bot className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="mt-3 text-xl font-extrabold text-slate-950">Platform managed</div>
                    <p className="mt-1 text-[11px] text-slate-500">AI model and credentials are managed by Amaavigo.</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">Workspace team</span>
                      <Users className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="mt-3 text-2xl font-extrabold tabular-nums text-slate-950">{usersLoading ? '…' : users?.length ?? '—'}</div>
                    <p className="mt-1 text-[11px] text-slate-500">{handoffCount} handoffs waiting · {unreadCount} unread conversations</p>
                  </div>
                </div>

                {issues.length > 0 ? (
                  <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/70 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <h4 className="text-sm font-bold text-slate-900">Needs attention</h4>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{issues.length} items</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {issues.map((issue, index) => (
                        <button key={`${issue.title}-${index}`} type="button" onClick={() => changeSection(issue.section)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-slate-900">{issue.title}</span>
                            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{issue.detail}</span>
                          </span>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        </button>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-xs text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {overviewData.loading ? 'Running workspace checks…' : 'No configuration issues detected by the available checks.'}
                  </div>
                )}

                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Channel overview</h4>
                        <p className="mt-0.5 text-[11px] text-slate-500">Connection status and operating mode</p>
                      </div>
                      <button type="button" onClick={() => changeSection('channels')} className="text-[11px] font-semibold text-orange-700 hover:text-orange-800">Manage channels</button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {channelRows.map((row) => (
                        <button key={row.channel} type="button" onClick={() => changeSection(row.destination)} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                            {row.channel === 'EMAIL' ? <Mail className="h-4 w-4" /> : row.channel === 'WEBSITE' ? <Globe className="h-4 w-4" /> : row.channel === 'LINKEDIN' ? <ExternalLink className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-slate-900">{row.name}</span>
                            <span className="block truncate text-[10px] text-slate-400">{row.note}</span>
                          </span>
                          <span className={`hidden rounded-full border px-2 py-1 text-[10px] font-semibold sm:inline-flex ${toneClass(row.tone)}`}>{row.label}</span>
                          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{normalizeChannelMode(formData.channelModes?.[row.channel])}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">AI & automation health</h4>
                        <p className="mt-0.5 text-[11px] text-slate-500">Runtime and knowledge readiness</p>
                      </div>
                      <button type="button" onClick={() => changeSection('ai')} className="text-[11px] font-semibold text-orange-700 hover:text-orange-800">Configure</button>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-[10px] text-slate-500">AI runtime</span>
                        <p className="mt-1 text-sm font-bold text-slate-900">Managed by Amaavigo</p>
                        <p className="mt-1 text-[10px] text-slate-400">Model selection and credentials are centrally managed</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-[10px] text-slate-500">Knowledge base</span>
                        <p className="mt-1 text-sm font-bold text-slate-900">{knowledgeDocumentCount}</p>
                        <p className="mt-1 text-[10px] text-slate-400">Documents in workspace</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-[10px] text-slate-500">Human handoff</span>
                        <p className="mt-1 text-sm font-bold text-slate-900">{formData.humanHandoffEnabled === false ? 'Disabled' : 'Enabled'}</p>
                        <p className="mt-1 text-[10px] text-slate-400">{activeHandoffRules} built-in rules enabled</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-[10px] text-slate-500">Response modes</span>
                        <p className="mt-1 text-sm font-bold text-slate-900">{modeCounts.AUTO} Auto · {modeCounts.REVIEW} Review</p>
                        <p className="mt-1 text-[10px] text-slate-400">{modeCounts.OFF} channels off</p>
                      </div>
                    </div>
                    {knowledgeDocumentCount === 0 && <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">No knowledge documents are currently loaded. Add and publish content in Knowledge Base to ground AI responses.</p>}
                  </section>

                  <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Email readiness</h4>
                        <p className="mt-0.5 text-[11px] text-slate-500">Sending domain and sender configuration</p>
                      </div>
                      <button type="button" onClick={() => changeSection('channels')} className="text-[11px] font-semibold text-orange-700 hover:text-orange-800">Open email settings</button>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${toneClass(emailTone)}`}>{emailLabel}</span>
                      {email?.trackingEnabled !== undefined && <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Open/click tracking {email.trackingEnabled ? 'on' : 'off'}</span>}
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <span className="text-[10px] text-slate-500">Sending domain</span>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-900">{email?.domain || 'Not configured'}</p>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] text-slate-500">Sender address</span>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-900">{email?.fromAddress || 'Not configured'}</p>
                      </div>
                    </div>
                    {email?.usingPlatformSender && <p className="mt-3 text-[11px] text-slate-500">Email is currently sent through the platform shared sender.</p>}
                    {!email && <p className="mt-3 text-[11px] text-slate-500">Email status has not been verified yet.</p>}
                  </section>

                  <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Workspace information</h4>
                        <p className="mt-0.5 text-[11px] text-slate-500">Company, regional and team defaults</p>
                      </div>
                      <button type="button" onClick={() => changeSection('overview')} className="text-[11px] font-semibold text-orange-700 hover:text-orange-800">Preferences</button>
                    </div>
                    <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-[10px] text-slate-500">Company</dt>
                        <dd className="mt-1 truncate text-xs font-semibold text-slate-900">{companyName}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] text-slate-500">Timezone</dt>
                        <dd className="mt-1 truncate text-xs font-semibold text-slate-900">{timezone || 'Managed in Company Profile'}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] text-slate-500">Default landing page</dt>
                        <dd className="mt-1 truncate text-xs font-semibold text-slate-900">{landingPageLabel}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] text-slate-500">Browser alerts</dt>
                        <dd className="mt-1 truncate text-xs font-semibold text-slate-900">{notificationPreferences.newMessages || notificationPreferences.humanHandoff || notificationPreferences.agentTaskCompletion ? 'Enabled' : 'Off'}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">{users?.length ?? 0} team members</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">{handoffCount} active handoffs</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">{unreadCount} unread conversations</span>
                    </div>
                  </section>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Workspace preferences & notifications</h4>
                      <p className="mt-1 text-[11px] text-slate-500">Set the default entry point and choose which in-browser alerts the workspace receives.</p>
                    </div>
                    <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{canEditEmail ? 'Admin managed' : 'Read only'}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">Default landing page</span>
                      <select
                        value={workspacePreferences.defaultLandingPage}
                        disabled={!canEditEmail}
                        onChange={(event) => setFormData((current) => ({
                          ...current,
                          workspacePreferences: {
                            ...current.workspacePreferences,
                            defaultLandingPage: event.target.value as 'dashboard' | 'inbox' | 'campaigns',
                          },
                        }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none transition focus:border-orange-400 disabled:bg-slate-50"
                      >
                        <option value="dashboard">Dashboard</option>
                        <option value="inbox">Unified Inbox</option>
                        <option value="campaigns">Campaigns</option>
                      </select>
                      <span className="mt-1 block text-[10px] text-slate-400">Used on a fresh workspace session unless a direct module link is opened.</span>
                    </label>
                    <div className="min-w-0">
                      <span className="mb-2 block text-xs font-semibold text-slate-700">Browser alerts</span>
                      <div className="space-y-2">
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-slate-800">New incoming conversations</span>
                            <span className="block text-[10px] text-slate-400">Unread customer messages</span>
                          </span>
                          <input type="checkbox" checked={notificationPreferences.newMessages} disabled={!canEditEmail} onChange={(event) => void handleNotificationPreferenceChange('newMessages', event.target.checked)} className="h-4 w-4 shrink-0 accent-orange-500" />
                        </label>
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-slate-800">Human handoff alerts</span>
                            <span className="block text-[10px] text-slate-400">Conversations needing a team member</span>
                          </span>
                          <input type="checkbox" checked={notificationPreferences.humanHandoff} disabled={!canEditEmail} onChange={(event) => void handleNotificationPreferenceChange('humanHandoff', event.target.checked)} className="h-4 w-4 shrink-0 accent-orange-500" />
                        </label>
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-slate-800">AI Agent task completions</span>
                            <span className="block text-[10px] text-slate-400">When a draft, artwork or other Agent task finishes</span>
                          </span>
                          <input type="checkbox" checked={notificationPreferences.agentTaskCompletion === true} disabled={!canEditEmail} onChange={(event) => void handleNotificationPreferenceChange('agentTaskCompletion', event.target.checked)} className="h-4 w-4 shrink-0 accent-orange-500" />
                        </label>
                      </div>
                      {notificationPermissionError && <p role="alert" className="mt-2 text-[10px] text-amber-700">{notificationPermissionError}</p>}
                      <p className="mt-2 text-[10px] text-slate-400">{typeof window !== 'undefined' && 'Notification' in window ? (Notification.permission === 'granted' ? 'Browser permission granted' : Notification.permission === 'denied' ? 'Browser permission blocked' : 'Permission requested when an alert is enabled') : 'Browser notifications are unavailable in this browser.'}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[10px] text-slate-400">Timezone is managed from Company Profile: {timezone || 'not set'}.</p>
                    {canEditEmail && <button type="button" onClick={handleSave} disabled={isSavingSettings} className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-3.5 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50">{isSavingSettings ? 'Saving…' : isSaved ? 'Preferences saved' : 'Save preferences'}</button>}
                  </div>
                </section>

                {canAccessAuditLogs && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Recent workspace activity</h4>
                      <p className="mt-0.5 text-[11px] text-slate-500">Latest events recorded in Audit Logs</p>
                    </div>
                    {canAccessAuditLogs && <button type="button" onClick={() => changeSection('audit')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-700 hover:text-orange-800">View Audit & Security <ExternalLink className="h-3.5 w-3.5" /></button>}
                  </div>
                  {overviewData.activity.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {overviewData.activity.map((log) => (
                        <div key={log.id} className="flex min-w-0 items-start gap-3 px-4 py-3">
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${log.severity === 'CRITICAL' || log.severity === 'SECURITY' ? 'bg-rose-50 text-rose-600' : log.severity === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500'}`}>
                            {log.severity === 'CRITICAL' || log.severity === 'SECURITY' || log.severity === 'WARNING' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-xs font-semibold text-slate-900">{log.description || log.action}</span>
                            <span className="mt-1 block text-[10px] text-slate-500">{log.actor?.name || 'Workspace'} · {log.module || 'SYSTEM'}</span>
                          </span>
                          <time className="shrink-0 text-[10px] text-slate-400">{log.timestamp ? new Date(log.timestamp).toLocaleDateString() : '—'}</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center text-xs text-slate-500">{overviewData.loading ? 'Loading recent activity…' : overviewData.errors.includes('recent activity') ? 'Recent activity could not be loaded.' : 'No workspace activity has been recorded yet.'}</div>
                  )}
                </section>}
              </div>
            );
          })()}

          {activeSection === 'ai' && (
            <div className="space-y-5">
      {/* Human Handoff configuration */}
      <div className="bg-white border border-amber-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-amber-600" /><h3 className="font-extrabold text-sm text-slate-900">Human Handoff</h3></div>
        <p className="text-xs text-slate-600 leading-relaxed">Built-in rules run independently. A handoff is silent, pauses AI replies and follow-ups for that conversation, and remains active until a person manually resumes AI.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([['explicitRequest','Explicit request for a human','Detect a clear request to speak to a person, representative, or support team.'],['frustration','Customer frustration','Escalate clear frustration and repeated complaints.'],] as const).map(([key,title,description]) => <div key={key} className="rounded-xl border border-slate-200 p-3 text-xs space-y-2">
            <label className="flex items-start gap-2"><input type="checkbox" checked={Boolean(handoffRules[key])} disabled={!canEditEmail} onChange={(e) => setFormData({ ...formData, humanHandoffRules: { ...handoffRules, [key]: e.target.checked } })} className="mt-0.5" /><span><strong className="block text-slate-800">{title}</strong>{description && <span className="text-slate-500">{description}</span>}</span></label>

          </div>)}
        </div>
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <label className="flex items-start gap-2 text-xs font-semibold text-slate-800"><input type="checkbox" checked={formData.humanHandoffCustomPhrasesEnabled ?? true} disabled={!canEditEmail} onChange={(e) => setFormData({ ...formData, humanHandoffCustomPhrasesEnabled: e.target.checked })} className="mt-0.5" /><span>Enable custom trigger phrases<span className="block mt-1 font-normal text-slate-500">Turn this off to ignore the phrases below without disabling built-in rules.</span></span></label>
          <label className="block text-xs font-semibold text-slate-700">Custom trigger phrases (one per line)</label>
          <textarea rows={4} value={handoffKeywordsText} disabled={!canEditEmail || formData.humanHandoffCustomPhrasesEnabled === false} onChange={(e) => { setHandoffKeywordsText(e.target.value); setFormData({ ...formData, humanHandoffKeywords: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) }); }} placeholder={'speak with the sales desk\ncall me about pricing'} className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-orange-500 disabled:bg-slate-50" />
          <p className="text-[11px] text-slate-500">Matching is case-insensitive and phrase-based. Only admins can edit these settings.</p>
        </div>
      </div>

      {/* Production Channel Modes */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="font-extrabold text-sm text-slate-900 flex items-center space-x-2">
          <Zap className="w-4 h-4 text-orange-500" />
          <span>Channel Operational Modes</span>
        </h3>
        <p className="text-xs text-slate-500 font-medium leading-relaxed">
          • <span className="text-orange-600 font-bold">AUTO:</span> Automatically generate,
          validate with RAG, and send replies.
          <br />• <span className="text-slate-900 font-bold">REVIEW:</span> Generate AI drafts
          requiring human verification prior to dispatch.
          <br />• <span className="text-slate-500 font-bold">OFF:</span> Do not generate, send, or
          create AI reply drafts. Incoming messages remain available in Unified Inbox.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {channels.map((ch) => {
            const currentMode = normalizeChannelMode(formData.channelModes?.[ch]);

            return (
              <div
                key={ch}
                className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900 capitalize">
                    {ch.toLowerCase()}
                  </span>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                      currentMode === 'AUTO'
                        ? 'bg-orange-100 text-orange-800 border border-orange-200'
                        : currentMode === 'REVIEW'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {currentMode}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 text-[11px]">
                  {(['AUTO', 'REVIEW', 'OFF'] as ChannelMode[]).map((m) => (
                    <button
                      key={m}
                      disabled={!canEditEmail}
                      onClick={() => handleModeChange(ch, m)}
                      className={`py-1 rounded-lg text-center font-bold transition ${
                        currentMode === m
                          ? 'bg-orange-500 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 46 & 47: Debouncing, Idempotency & Webhooks */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 text-slate-900">
        <h3 className="font-bold text-sm text-slate-900 font-display flex items-center space-x-2">
          <Shield className="w-4 h-4 text-orange-500" />
          <span>Idempotency & Debounce Engine (Section 46, 47 & 68)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-600 block mb-1 font-semibold">
              Debounce Waiting Window (seconds)
            </label>
            <input
              type="number"
              disabled={!canEditEmail}
              min={1}
              max={30}
              value={formData.debounceSeconds}
              onChange={(e) =>
                setFormData({ ...formData, debounceSeconds: parseInt(e.target.value) || 3 })
              }
              className="w-full bg-white border border-slate-200 rounded-xl p-2 text-slate-800 focus:outline-none focus:border-orange-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Batches bursts of messages arriving within this window into a single unified AI context.
            </span>
          </div>

          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Webhook Endpoint URL</label>
            <input
              type="text"
              readOnly
              value={formData.webhookEndpoint}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-slate-600 font-mono"
            />
            <span className="text-[11px] text-emerald-600 mt-1 block flex items-center space-x-1 font-medium">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span>Idempotency hash verification active for Meta, Apollo, & Email webhooks</span>
            </span>
          </div>
        </div>
      </div>


            </div>
          )}

          {activeSection === 'channels' && (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-bold text-slate-900">Channels & Messaging</h3>
                <p className="mt-1 text-xs text-slate-500">Manage connected channels, email delivery, inbound mailboxes, website webhooks and chatbot integrations.</p>
              </section>

      <ConnectedChannelsPanel tenantId={tenantId} canEdit={canEditEmail} />

      {tenantId && canEditEmail && <WebsiteWebhookPanel tenantId={tenantId} canEdit />}
      {tenantId && canEditEmail && <ChatbotIntegrationPanel tenantId={tenantId} canEdit />}

            

      {/* Section 41: Email Identities & Signature */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 text-slate-900">
        <h3 className="font-bold text-sm text-slate-900 font-display flex items-center space-x-2">
          <Mail className="w-4 h-4 text-orange-500" />
          <span>Email Sending Identity & Signature (Section 41 & 44)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Approved Sending Mailboxes</label>
            <div className="space-y-2">
              {(formData?.sendingAccounts || []).length === 0 ? (
                <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-center">
                  No dedicated sending mailbox configured yet.
                </div>
              ) : (
                (formData?.sendingAccounts || []).map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 block">{acc.name}</span>
                      <span className="text-slate-500 font-mono text-[11px]">{acc.email}</span>
                    </div>
                    {acc.isDefault && (
                      <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 text-[10px] font-bold">
                        Default
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Configurable Outbound Email Signature</label>
            <textarea
              rows={4}
              disabled={!canEditEmail}
              value={formData?.emailSignature || ''}
              onChange={(e) => setFormData({ ...formData, emailSignature: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 resize-none font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>
      </div>

      {tenantId && <EmailSettingsPanel tenantId={tenantId} canEdit={Boolean(canEditEmail)} />}
      {tenantId && canEditEmail && <InboundMailboxPanel tenantId={tenantId} canEdit />}

            
            </div>
          )}

          {activeSection === 'company' && tenantId && (
            <React.Suspense fallback={<div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading Company Profile…</div>}>
              <CompanyProfilePanel tenantId={tenantId} canEdit={Boolean(canEditEmail)} />
            </React.Suspense>
          )}

          {activeSection === 'team' && canEditEmail && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Team & Permissions</h3>
                <p className="mt-1 text-xs text-slate-500">Manage workspace members, roles and module-level access.</p>
              </div>
              {tenantId && users && onSaveUser && onDeleteUser && (
                <UserManagementView
                  users={users}
                  usersLoading={usersLoading}
                  usersError={usersError}
                  onSaveUser={onSaveUser}
                  onDeleteUser={onDeleteUser}
                />
              )}
            </section>
          )}

          {activeSection === 'billing' && canEditEmail && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Billing & Plan</h3>
                <p className="mt-1 text-xs text-slate-500">Manage the subscription, plan status, invoices and workspace usage.</p>
              </div>
              {tenantId && <BillingView tenantId={tenantId} />}
            </section>
          )}

          {activeSection === 'audit' && canAccessAuditLogs && tenantId && (
            <React.Suspense fallback={<div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading Audit & Security…</div>}>
              <WorkspaceAuditLogs tenantId={tenantId} currentUserEmail={currentUserEmail} canCreateTestLog={Boolean(canEditEmail)} />
            </React.Suspense>
          )}

        </main>
    </div>
  );
};

// Backwards-compatible export for existing imports while navigation is consolidated.
export const SettingsView = WorkspaceView;
