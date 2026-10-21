import React, { useState, useEffect } from 'react';
import {
  Clock,
  Send,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Filter,
  RefreshCw,
  Settings,
  Bot,
  User,
  ShieldCheck,
  Zap,
  MessageCircle,
  Mail,
  Instagram,
  Facebook,
  Globe,
  Sliders,
  Play,
  FileText,
  Calendar,
} from 'lucide-react';
import { Channel, Lead, Conversation, Message } from '../types';

interface AutoFollowUpDashboardProps {
  leads: Lead[];
  conversations: Conversation[];
  messages: Message[];
  onSelectConversation?: (conversationId: string) => void;
  onRefresh?: () => void;
}

export const AutoFollowUpDashboard: React.FC<AutoFollowUpDashboardProps> = ({
  leads,
  conversations,
  messages,
  onSelectConversation,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'JOBS' | 'SETTINGS' | 'LOGS'>('JOBS');
  const [loading, setLoading] = useState<boolean>(false);
  const [dashboardData, setDashboardData] = useState<{
    metrics: {
      scheduled: number;
      sentToday: number;
      cancelled: number;
      skipped: number;
      humanReview: number;
      failed: number;
      completed: number;
    };
    jobs: any[];
    logs: any[];
    config: any;
  } | null>(null);

  // Filters
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Settings state
  const [whatsappDelayVal, setWhatsappDelayVal] = useState<number>(1);
  const [whatsappDelayUnit, setWhatsappDelayUnit] = useState<'minute' | 'hour' | 'day'>('hour');

  const [instagramDelayVal, setInstagramDelayVal] = useState<number>(4);
  const [instagramDelayUnit, setInstagramDelayUnit] = useState<'minute' | 'hour' | 'day'>('hour');

  const [facebookDelayVal, setFacebookDelayVal] = useState<number>(1);
  const [facebookDelayUnit, setFacebookDelayUnit] = useState<'minute' | 'hour' | 'day'>('day');

  const [emailDelayVal, setEmailDelayVal] = useState<number>(2);
  const [emailDelayUnit, setEmailDelayUnit] = useState<'minute' | 'hour' | 'day'>('day');

  const [maxFollowUps, setMaxFollowUps] = useState<number>(3);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState<boolean>(true);
  const [quietStart, setQuietStart] = useState<string>('22:00');
  const [quietEnd, setQuietEnd] = useState<string>('08:00');
  const [sequenceMode, setSequenceMode] = useState<'SIMPLE' | 'SEQUENCE'>('SIMPLE');

  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [triggeringJobId, setTriggeringJobId] = useState<string | null>(null);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auto-followup/dashboard');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDashboardData(data);
          if (data.config) {
            const cfg = data.config;
            if (cfg.channels?.WHATSAPP) {
              setWhatsappDelayVal(cfg.channels.WHATSAPP.defaultDelayValue || 1);
              setWhatsappDelayUnit(cfg.channels.WHATSAPP.defaultDelayUnit || 'hour');
            }
            if (cfg.channels?.INSTAGRAM) {
              setInstagramDelayVal(cfg.channels.INSTAGRAM.defaultDelayValue || 4);
              setInstagramDelayUnit(cfg.channels.INSTAGRAM.defaultDelayUnit || 'hour');
            }
            if (cfg.channels?.FACEBOOK) {
              setFacebookDelayVal(cfg.channels.FACEBOOK.defaultDelayValue || 1);
              setFacebookDelayUnit(cfg.channels.FACEBOOK.defaultDelayUnit || 'day');
            }
            if (cfg.channels?.EMAIL) {
              setEmailDelayVal(cfg.channels.EMAIL.defaultDelayValue || 2);
              setEmailDelayUnit(cfg.channels.EMAIL.defaultDelayUnit || 'day');
            }
            if (cfg.quietHours) {
              setQuietHoursEnabled(cfg.quietHours.enabled ?? true);
              setQuietStart(cfg.quietHours.start || '22:00');
              setQuietEnd(cfg.quietHours.end || '08:00');
            }
            if (cfg.mode) {
              setSequenceMode(cfg.mode);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading auto follow-up dashboard:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setSaveSuccessMsg(null);
    try {
      const res = await fetch('/api/auto-followup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: {
            WHATSAPP: { enabled: true, defaultDelayValue: whatsappDelayVal, defaultDelayUnit: whatsappDelayUnit, maxFollowUps },
            INSTAGRAM: { enabled: true, defaultDelayValue: instagramDelayVal, defaultDelayUnit: instagramDelayUnit, maxFollowUps },
            FACEBOOK: { enabled: true, defaultDelayValue: facebookDelayVal, defaultDelayUnit: facebookDelayUnit, maxFollowUps },
            EMAIL: { enabled: true, defaultDelayValue: emailDelayVal, defaultDelayUnit: emailDelayUnit, maxFollowUps },
          },
          mode: sequenceMode,
          quietHours: {
            enabled: quietHoursEnabled,
            start: quietStart,
            end: quietEnd,
          },
        }),
      });
      if (res.ok) {
        setSaveSuccessMsg('Global Auto Follow-Up channel timings successfully updated!');
        setTimeout(() => setSaveSuccessMsg(null), 4000);
        fetchDashboard();
      }
    } catch (e) {
      console.error('Error saving config:', e);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleManualTriggerNow = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auto-followup/trigger-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchDashboard();
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      console.error('Trigger now error:', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredJobs = (dashboardData?.jobs || []).filter((j) => {
    if (channelFilter !== 'ALL' && j.channel !== channelFilter) return false;
    if (statusFilter !== 'ALL' && j.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const lead = leads.find((l) => l.leadId === j.leadId);
      const leadName = lead?.queryMessage || lead?.serviceInterest || j.leadId;
      const match =
        j.id.toLowerCase().includes(q) ||
        j.conversationId.toLowerCase().includes(q) ||
        j.channel.toLowerCase().includes(q) ||
        leadName.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const getChannelBadge = (ch: Channel | string) => {
    switch (ch) {
      case 'WHATSAPP':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><MessageCircle className="w-3 h-3 mr-1" /> WhatsApp</span>;
      case 'EMAIL':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"><Mail className="w-3 h-3 mr-1" /> Email</span>;
      case 'INSTAGRAM':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300"><Instagram className="w-3 h-3 mr-1" /> Instagram</span>;
      case 'FACEBOOK':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"><Facebook className="w-3 h-3 mr-1" /> Facebook</span>;
      case 'WEBSITE':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300"><Globe className="w-3 h-3 mr-1" /> Website</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">{ch}</span>;
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'scheduled':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300"><Clock className="w-3 h-3 mr-1 animate-pulse" /> Scheduled</span>;
      case 'sent':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3 mr-1" /> Sent</span>;
      case 'cancelled':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"><XCircle className="w-3 h-3 mr-1" /> Cancelled</span>;
      case 'skipped':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300"><Bot className="w-3 h-3 mr-1" /> Skipped (No-Op)</span>;
      case 'human_review':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300"><AlertTriangle className="w-3 h-3 mr-1" /> Human Review</span>;
      case 'failed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300"><XCircle className="w-3 h-3 mr-1" /> Failed</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">{st}</span>;
    }
  };

  return (
    <div className="flex-1 p-6 bg-slate-50 min-h-screen text-slate-900 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900 font-display">AI Auto Follow-Up Agent</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200">
              <Zap className="w-3 h-3 mr-1 text-orange-500" /> Operational Control Active
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Dynamic, context-aware follow-up engine for your inbound leads. Reads actual thread context and generates personalized replies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleManualTriggerNow}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-xs transition-all disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 mr-1.5" />
            Trigger Poller Cycle Now
          </button>
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="inline-flex items-center p-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all shadow-2xs"
            title="Refresh Dashboard"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-orange-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Scheduled</p>
          <p className="text-xl font-bold text-amber-600 mt-1 font-display">
            {dashboardData?.metrics.scheduled ?? 0}
          </p>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Sent Today</p>
          <p className="text-xl font-bold text-orange-600 mt-1 font-display">
            {dashboardData?.metrics.sentToday ?? 0}
          </p>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Human Review</p>
          <p className="text-xl font-bold text-indigo-600 mt-1 font-display">
            {dashboardData?.metrics.humanReview ?? 0}
          </p>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Skipped (No-Op)</p>
          <p className="text-xl font-bold text-slate-600 mt-1 font-display">
            {dashboardData?.metrics.skipped ?? 0}
          </p>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Cancelled</p>
          <p className="text-xl font-bold text-slate-600 mt-1 font-display">
            {dashboardData?.metrics.cancelled ?? 0}
          </p>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Failed</p>
          <p className="text-xl font-bold text-rose-600 mt-1 font-display">
            {dashboardData?.metrics.failed ?? 0}
          </p>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-slate-500">Completed</p>
          <p className="text-xl font-bold text-emerald-600 mt-1 font-display">
            {dashboardData?.metrics.completed ?? 0}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6 bg-white rounded-t-xl px-4 pt-2 shadow-2xs">
        <button
          onClick={() => setActiveTab('JOBS')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'JOBS'
              ? 'border-orange-500 text-orange-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4" />
          Follow-Up Queue & History ({dashboardData?.jobs?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('SETTINGS')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'SETTINGS'
              ? 'border-orange-500 text-orange-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Channel Timing & Global Rules
        </button>
        <button
          onClick={() => setActiveTab('LOGS')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all ${
            activeTab === 'LOGS'
              ? 'border-orange-500 text-orange-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          Operational Activity Feed ({dashboardData?.logs?.length || 0})
        </button>
      </div>

      {/* TAB 1: JOBS TABLE */}
      {activeTab === 'JOBS' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4">
          {/* Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Channel:</span>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-orange-500"
              >
                <option value="ALL">All Channels</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="FACEBOOK">Facebook</option>
                <option value="WEBSITE">Website</option>
              </select>

              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-2">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-orange-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="sent">Sent</option>
                <option value="human_review">Human Review</option>
                <option value="skipped">Skipped</option>
                <option value="cancelled">Cancelled</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            <div className="relative w-full md:w-64">
              <input
                type="text"
                placeholder="Search lead or conversation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-orange-500"
              />
              <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-3">Lead / Company</th>
                  <th className="py-3 px-3">Channel</th>
                  <th className="py-3 px-3">Attempt</th>
                  <th className="py-3 px-3">Scheduled / Processed</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">AI Decision & Operational Reason</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-500">
                      No follow-up jobs match the active filters.
                    </td>
                  </tr>
                ) : (
                  filteredJobs.map((j) => {
                    const lead = leads.find((l) => l.leadId === j.leadId);
                    const conversation = conversations.find((c) => c.conversationId === j.conversationId);
                    const leadName = lead?.serviceInterest || lead?.queryMessage?.slice(0, 30) || j.leadId;

                    return (
                      <tr key={j.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 font-medium text-slate-900">
                          <div>
                            <p className="font-semibold text-slate-900">{leadName}</p>
                            <p className="text-[11px] text-slate-500 font-mono">
                              {j.conversationId}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-3">{getChannelBadge(j.channel)}</td>
                        <td className="py-3 px-3 font-semibold text-slate-700">
                          #{j.attempt}
                        </td>
                        <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                          {j.status === 'scheduled' ? (
                            <span className="font-medium text-amber-700">
                              {new Date(j.scheduledAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </span>
                          ) : (
                            <span>
                              {j.processedAt
                                ? new Date(j.processedAt).toLocaleString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    hour12: true,
                                  })
                                : '—'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">{getStatusBadge(j.status)}</td>
                        <td className="py-3 px-3 max-w-xs">
                          {j.audit ? (
                            <div>
                              <p className="font-medium text-slate-800 line-clamp-1">
                                Objective: {j.audit.objective || j.audit.reason}
                              </p>
                              {j.audit.generatedMessage && (
                                <p className="text-[11px] text-slate-500 line-clamp-2 italic mt-0.5">
                                  "{j.audit.generatedMessage}"
                                </p>
                              )}
                              {j.audit.humanReviewReason && (
                                <p className="text-[11px] text-purple-600 font-semibold mt-0.5">
                                  Flag: {j.audit.humanReviewReason}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">
                              {j.cancelReason ? `Reason: ${j.cancelReason}` : 'Awaiting send-time evaluation'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {onSelectConversation && (
                            <button
                              onClick={() => onSelectConversation(j.conversationId)}
                              className="text-xs font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                            >
                              Open Thread →
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SETTINGS */}
      {activeTab === 'SETTINGS' && (
        <form onSubmit={handleSaveConfig} className="bg-white rounded-xl border border-slate-200 shadow-2xs p-6 max-w-4xl text-slate-900">
          <h2 className="text-lg font-bold text-slate-900 mb-1 font-display">Channel-Specific Timing Configuration</h2>
          <p className="text-xs text-slate-500 mb-6">
            Define independent follow-up delays for each communication channel. The team member enables Auto Follow-Up on a lead, and the agent uses these channel timings.
          </p>

          {saveSuccessMsg && (
            <div className="mb-6 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {saveSuccessMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* WhatsApp */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">WhatsApp Timing</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">Default delay for WhatsApp inbound conversations</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={whatsappDelayVal}
                  onChange={(e) => setWhatsappDelayVal(parseInt(e.target.value, 10) || 1)}
                  className="w-20 text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                />
                <select
                  value={whatsappDelayUnit}
                  onChange={(e) => setWhatsappDelayUnit(e.target.value as any)}
                  className="text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                >
                  <option value="minute">Minutes (Testing / Rapid)</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </div>
            </div>

            {/* Instagram */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2 mb-3">
                <Instagram className="w-5 h-5 text-pink-600" />
                <h3 className="font-bold text-sm text-slate-900">Instagram Timing</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">Default delay for Instagram Direct Messages</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={instagramDelayVal}
                  onChange={(e) => setInstagramDelayVal(parseInt(e.target.value, 10) || 1)}
                  className="w-20 text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                />
                <select
                  value={instagramDelayUnit}
                  onChange={(e) => setInstagramDelayUnit(e.target.value as any)}
                  className="text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                >
                  <option value="minute">Minutes</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </div>
            </div>

            {/* Facebook */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2 mb-3">
                <Facebook className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Facebook Timing</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">Default delay for Facebook Messenger</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={facebookDelayVal}
                  onChange={(e) => setFacebookDelayVal(parseInt(e.target.value, 10) || 1)}
                  className="w-20 text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                />
                <select
                  value={facebookDelayUnit}
                  onChange={(e) => setFacebookDelayUnit(e.target.value as any)}
                  className="text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                >
                  <option value="minute">Minutes</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </div>
            </div>

            {/* Email */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-5 h-5 text-orange-600" />
                <h3 className="font-bold text-sm text-slate-900">Email Timing</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">Default delay for Email threads</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={emailDelayVal}
                  onChange={(e) => setEmailDelayVal(parseInt(e.target.value, 10) || 1)}
                  className="w-20 text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                />
                <select
                  value={emailDelayUnit}
                  onChange={(e) => setEmailDelayUnit(e.target.value as any)}
                  className="text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                >
                  <option value="minute">Minutes</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </div>
            </div>
          </div>

          <hr className="border-slate-200 mb-6" />

          {/* Sequence & Limits */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Maximum Follow-Up Attempts per Sequence
              </label>
              <p className="text-xs text-slate-500 mb-2">Default is 3 follow-ups before sequence completes</p>
              <input
                type="number"
                min="1"
                max="10"
                value={maxFollowUps}
                onChange={(e) => setMaxFollowUps(parseInt(e.target.value, 10) || 3)}
                className="w-32 text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1">
                Sequence Mode vs Simple Mode
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Simple uses uniform delay. Sequence increases delay for each attempt (1hr, 1day, 3days).
              </p>
              <select
                value={sequenceMode}
                onChange={(e) => setSequenceMode(e.target.value as any)}
                className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
              >
                <option value="SIMPLE">Simple Mode (Configured Channel Interval)</option>
                <option value="SEQUENCE">Sequence Mode (1hr → 1day → 3days)</option>
              </select>
            </div>
          </div>

          {/* Quiet Hours */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Quiet Hours Protection</h3>
                <p className="text-xs text-slate-500">Prevent sending automated messages late at night. Automatically queues until morning.</p>
              </div>
              <input
                type="checkbox"
                checked={quietHoursEnabled}
                onChange={(e) => setQuietHoursEnabled(e.target.checked)}
                className="w-4 h-4 accent-orange-500 rounded"
              />
            </div>

            {quietHoursEnabled && (
              <div className="flex items-center gap-3 mt-3">
                <div>
                  <span className="text-xs text-slate-500">Start (e.g. 10:00 PM):</span>
                  <input
                    type="time"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                    className="ml-2 text-xs p-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-500">End (e.g. 8:00 AM):</span>
                  <input
                    type="time"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                    className="ml-2 text-xs p-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSavingConfig}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white transition-all shadow-xs disabled:opacity-50"
          >
            {isSavingConfig ? 'Saving Settings...' : 'Save Global Channel Rules'}
          </button>
        </form>
      )}

      {/* TAB 3: AUDIT LOGS */}
      {activeTab === 'LOGS' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4">
          <h2 className="text-sm font-bold text-slate-900 mb-3 font-display">Operational Activity Feed & Audit Trail</h2>
          <div className="space-y-3">
            {(dashboardData?.logs || []).length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No activity logs recorded yet.</p>
            ) : (
              dashboardData?.logs.map((log: any) => (
                <div
                  key={log.id}
                  className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 flex items-start gap-3"
                >
                  <div className="mt-0.5">
                    {log.type === 'SENT' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    {log.type === 'SCHEDULED' && <Clock className="w-4 h-4 text-amber-500" />}
                    {log.type === 'CANCELLED' && <XCircle className="w-4 h-4 text-slate-400" />}
                    {log.type === 'HUMAN_REVIEW' && <AlertTriangle className="w-4 h-4 text-purple-600" />}
                    {log.type === 'ENABLED' && <Zap className="w-4 h-4 text-orange-500" />}
                    {log.type === 'DISABLED' && <XCircle className="w-4 h-4 text-rose-500" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-900">{log.title}</p>
                      <span className="text-[11px] text-slate-400">
                        {new Date(log.timestamp).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{log.description}</p>
                    {log.user && (
                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">Actor: {log.user}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
