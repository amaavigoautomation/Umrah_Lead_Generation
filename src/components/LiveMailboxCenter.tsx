import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  Inbox,
  ShieldCheck,
  ExternalLink,
  Bot,
  User,
  ArrowRight,
  Clock,
  Key,
  Info,
  ChevronRight,
  Radio,
} from 'lucide-react';
import { INBOUND_MAILBOX } from '../services/emailInboundService';

interface SmtpStatus {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  verified?: boolean;
  lastChecked?: string;
  lastError?: string;
}

interface ImapStatus {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  verified: boolean;
  error?: string;
}

interface ProcessedEmail {
  messageId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  incomingText: string;
  replySubject: string;
  replyText: string;
  shouldSendAutoReply?: boolean;
  replyDecisionReason?: string;
  smtpDelivery: {
    success: boolean;
    messageId?: string;
    recipient?: string;
    error?: string;
  };
  handoffTriggered: boolean;
  handoffReason?: string;
  leadScore: number;
  intent: string;
  buyingStage: string;
  timestamp: string;
}

interface LiveMailboxCenterProps {
  onNavigateToThread?: (conversationId: string) => void;
  onNavigateToCrm?: () => void;
  onSyncNow?: () => void;
}

export const LiveMailboxCenter: React.FC<LiveMailboxCenterProps> = ({
  onNavigateToThread,
  onNavigateToCrm,
  onSyncNow,
}) => {
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [imapStatus, setImapStatus] = useState<ImapStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [isVerifyingSmtp, setIsVerifyingSmtp] = useState<boolean>(false);
  const [smtpVerifyResult, setSmtpVerifyResult] = useState<{ success: boolean; message: string } | null>(null);

  const [isPollingImap, setIsPollingImap] = useState<boolean>(false);
  const [pollResult, setPollResult] = useState<{ success: boolean; count: number; message: string } | null>(null);

  const activeMailbox = smtpStatus?.user || imapStatus?.user || INBOUND_MAILBOX || 'amaavigo@gmail.com';

  // Live test send form (Outbound direct test)
  const [testTo, setTestTo] = useState<string>('amaavigo@gmail.com');
  const [testSubject, setTestSubject] = useState<string>('Umrah360 Live SMTP Auto-Reply Test');
  const [testBody, setTestBody] = useState<string>(
    'Assalamu Alaikum,\n\nThis is a live test email dispatched via Umrah360 SMTP connection to confirm live mail delivery.\n\nBest regards,\nUmrah360 Automation Team'
  );
  const [isSendingLiveTest, setIsSendingLiveTest] = useState<boolean>(false);
  const [liveSendResult, setLiveSendResult] = useState<{ success: boolean; messageId?: string; error?: string } | null>(null);

  // Inbound Pipeline Ingestion Simulator & Tester
  const [inboundSender, setInboundSender] = useState<string>('partner.tour@gmail.com');
  const [inboundSenderName, setInboundSenderName] = useState<string>('Al-Noor Pilgrimage Tours');
  const [inboundSubject, setInboundSubject] = useState<string>('Inquiry: B2B Portal & Hotel Allotments for Umrah 2026');
  const [inboundBody, setInboundBody] = useState<string>(
    'Assalamu Alaikum,\n\nWe are a pilgrimage tour agency with 8 staff members in Hyderabad. Does Umrah360 support custom hotel allotments and sub-agent credit limits?\n\nRegards,\nAl-Noor Pilgrimage Operations'
  );
  const [isCustomerFollowUp, setIsCustomerFollowUp] = useState<boolean>(false);
  const [isIngestingInbound, setIsIngestingInbound] = useState<boolean>(false);
  const [inboundIngestResult, setInboundIngestResult] = useState<{
    success: boolean;
    replied: boolean;
    reason: string;
    smtpStatus?: string;
  } | null>(null);

  // Live processed history
  const [processedHistory, setProcessedHistory] = useState<ProcessedEmail[]>([]);

  // Refresh status
  const fetchStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const [smtpRes, imapRes, historyRes] = await Promise.all([
        fetch('/api/smtp/status').then((r) => r.json()).catch(() => null),
        fetch('/api/imap/status').then((r) => r.json()).catch(() => null),
        fetch('/api/inbound/history').then((r) => r.json()).catch(() => ({ history: [] })),
      ]);

      if (smtpRes) setSmtpStatus(smtpRes);
      if (imapRes) setImapStatus(imapRes);
      if (historyRes?.history) setProcessedHistory(historyRes.history);
    } catch (e) {
      console.error('Error fetching live mail status:', e);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Verify SMTP
  const handleVerifySmtp = async () => {
    setIsVerifyingSmtp(true);
    setSmtpVerifyResult(null);
    try {
      const res = await fetch('/api/smtp/verify', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.verified) {
        setSmtpVerifyResult({ success: true, message: `SMTP connection established successfully to ${data.host}:${data.port}` });
      } else {
        setSmtpVerifyResult({ success: false, message: data.error || 'Failed to authenticate with SMTP server' });
      }
      fetchStatus();
    } catch (err: any) {
      setSmtpVerifyResult({ success: false, message: err.message || 'SMTP verification network error' });
    } finally {
      setIsVerifyingSmtp(false);
    }
  };

  // Poll IMAP Inbox
  const handlePollImap = async () => {
    setIsPollingImap(true);
    setPollResult(null);
    try {
      const res = await fetch('/api/inbound/poll', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setPollResult({
          success: true,
          count: data.polledCount || 0,
          message: data.polledCount > 0
            ? `Successfully ingested ${data.polledCount} new email(s) from ${activeMailbox} and dispatched live SMTP auto-replies!`
            : `Inbox ${activeMailbox} checked: IMAP connection active. No pending unread emails found right now. Ready for incoming mail.`,
        });
        if (onSyncNow) {
          onSyncNow();
        }
      } else {
        setPollResult({
          success: false,
          count: 0,
          message: data.error || 'IMAP polling failed',
        });
      }
      fetchStatus();
    } catch (err: any) {
      setPollResult({
        success: false,
        count: 0,
        message: err.message || 'IMAP polling network error',
      });
    } finally {
      setIsPollingImap(false);
    }
  };

  // Send Live Test via SMTP
  const handleSendLiveTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTo || !testSubject || !testBody) return;

    setIsSendingLiveTest(true);
    setLiveSendResult(null);
    try {
      const res = await fetch('/api/smtp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testTo,
          subject: testSubject,
          text: testBody,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLiveSendResult({
          success: true,
          messageId: data.messageId,
        });
      } else {
        setLiveSendResult({
          success: false,
          error: data.error || 'Failed to deliver live email via SMTP',
        });
      }
      fetchStatus();
    } catch (err: any) {
      setLiveSendResult({
        success: false,
        error: err.message || 'SMTP live send network error',
      });
    } finally {
      setIsSendingLiveTest(false);
    }
  };

  // Ingest & Test Real Inbound Pipeline from Customer Email (e.g. amaavigo@gmail.com)
  const handleIngestInboundTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboundSender || !inboundBody) return;

    setIsIngestingInbound(true);
    setInboundIngestResult(null);
    try {
      const uniqueMsgId = `<inbound-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@gmail.com>`;
      const res = await fetch('/api/inbound/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: inboundSender,
          fromName: inboundSenderName,
          to: activeMailbox,
          subject: inboundSubject,
          body: isCustomerFollowUp
            ? `${inboundBody}\n\n[Customer follow-up turn sent at ${new Date().toLocaleTimeString()}]`
            : inboundBody,
          messageId: uniqueMsgId,
          isTestSimulation: true,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.result) {
        const r = data.result;
        setInboundIngestResult({
          success: true,
          replied: r.shouldSendAutoReply,
          reason: r.replyDecisionReason,
          smtpStatus: r.smtpDelivery?.success
            ? `SMTP Dispatched (${r.smtpDelivery.messageId || 'Success'})`
            : r.smtpDelivery?.error || 'No SMTP sent',
        });

        if (onSyncNow) {
          onSyncNow();
        }
      } else {
        setInboundIngestResult({
          success: false,
          replied: false,
          reason: data.error || 'Failed to ingest inbound email',
        });
      }
      fetchStatus();
      if (onSyncNow) {
        setTimeout(onSyncNow, 400);
      }
    } catch (err: any) {
      setInboundIngestResult({
        success: false,
        replied: false,
        reason: err.message || 'Inbound test network error',
      });
    } finally {
      setIsIngestingInbound(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold text-white">Live Inbound Email & SMTP Auto-Reply Hub</h1>
                <span className="flex items-center space-x-1 text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  <Radio className="w-3 h-3 animate-pulse text-blue-400" />
                  <span>Real Mailbox Connection</span>
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Direct live synchronization with <strong className="text-slate-200">{INBOUND_MAILBOX}</strong> and SMTP delivery to personal mailboxes.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchStatus}
            disabled={isLoadingStatus}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>

          <button
            onClick={handlePollImap}
            disabled={isPollingImap}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md shadow-emerald-900/30 transition"
          >
            <Inbox className={`w-3.5 h-3.5 ${isPollingImap ? 'animate-bounce' : ''}`} />
            <span>{isPollingImap ? 'Checking Inbox...' : 'Check Inbox Now (IMAP Sync)'}</span>
          </button>
        </div>
      </div>

      {/* 3 Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Mailbox Details */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Target Mailbox</span>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Live Address
            </span>
          </div>
          <div className="space-y-1">
            <div className="text-base font-bold text-white font-mono break-all">{activeMailbox}</div>
            <p className="text-xs text-slate-400">
              Pilgrim operators & agencies send their inquiries directly to this address.
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Auto-Reply Sender:</span>
            <span className="font-mono text-slate-300">{activeMailbox}</span>
          </div>
        </div>

        {/* Card 2: SMTP Outbound Auto-Reply */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">SMTP Connection</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                smtpStatus?.configured
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}
            >
              {smtpStatus?.configured ? 'Configured' : 'Needs Credentials'}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs text-slate-300 font-mono">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              <span>{smtpStatus?.host || 'SMTP_HOST not set'}</span>
              <span>:{smtpStatus?.port || 465}</span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Auth User: {smtpStatus?.user || activeMailbox}</span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
            <button
              onClick={handleVerifySmtp}
              disabled={isVerifyingSmtp}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center space-x-1"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isVerifyingSmtp ? 'Testing Auth...' : 'Test SMTP Connection'}</span>
            </button>
            {smtpStatus?.hasPassword ? (
              <span className="text-[11px] text-emerald-400 flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Password set</span>
              </span>
            ) : (
              <span className="text-[11px] text-amber-400 flex items-center space-x-1">
                <AlertTriangle className="w-3 h-3" />
                <span>No password in .env</span>
              </span>
            )}
          </div>
        </div>

        {/* Card 3: IMAP Inbound Poller */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">IMAP Inbound Listener</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                imapStatus?.configured
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}
            >
              {imapStatus?.configured ? 'Active Poller' : 'Needs Credentials'}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs text-slate-300 font-mono">
              <Inbox className="w-3.5 h-3.5 text-emerald-400" />
              <span>{imapStatus?.host || 'IMAP_HOST not set'}</span>
              <span>:{imapStatus?.port || 993}</span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>Auto-poll: Every 30s background cycle</span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
            <button
              onClick={handlePollImap}
              disabled={isPollingImap}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center space-x-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPollingImap ? 'animate-spin' : ''}`} />
              <span>Sync Unread Now</span>
            </button>
            <span className="text-[11px] text-slate-400">
              {imapStatus?.configured ? 'Listening' : 'Waiting for host'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Alerts / Feedback */}
      {smtpVerifyResult && (
        <div
          className={`p-3.5 rounded-xl border flex items-start space-x-3 text-xs ${
            smtpVerifyResult.success
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
          }`}
        >
          {smtpVerifyResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <span className="font-bold block">
              {smtpVerifyResult.success ? 'SMTP Connection Succeeded' : 'SMTP Connection Notice'}
            </span>
            <p className="mt-0.5">{smtpVerifyResult.message}</p>
          </div>
        </div>
      )}

      {pollResult && (
        <div
          className={`p-3.5 rounded-xl border flex items-start space-x-3 text-xs ${
            pollResult.success
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
          }`}
        >
          {pollResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <span className="font-bold block">
              {pollResult.success ? 'IMAP Mailbox Check Completed' : 'IMAP Mailbox Notice'}
            </span>
            <p className="mt-0.5">{pollResult.message}</p>
          </div>
        </div>
      )}

      {/* Active Mailbox & Routing Notice */}
      <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-4 text-xs space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Active Mailbox: {activeMailbox} (Gmail IMAP & SMTP)</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 w-fit">
            IMAP: imap.gmail.com:993 • SMTP: smtp.gmail.com:465
          </span>
        </div>
        <p className="text-slate-300 leading-relaxed text-xs">
          The automation system is connected directly to <strong>{activeMailbox}</strong> using Gmail SSL/TLS. Any customer or tour operator inquiries received at this address will be automatically polled every 30s, analyzed by Gemini, pushed into CRM & Unified Inbox, and replied to with a personalized auto-reply.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] pt-1">
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <span className="font-semibold text-white block mb-0.5">1. Send Live Test from Outside</span>
            <span className="text-slate-400">Send an email from another email account (e.g. personal Yahoo, Outlook, or another Gmail) to <code>{activeMailbox}</code>. Click "Check Inbox Now" or wait 30 seconds for automatic processing.</span>
          </div>
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <span className="font-semibold text-emerald-400 block mb-0.5">2. Live Inbound Simulator (Below)</span>
            <span className="text-slate-400">You can also trigger a simulated inbound customer inquiry below. It tests the complete end-to-end pipeline, AI generation, and live SMTP delivery to the sender.</span>
          </div>
        </div>
      </div>

      {/* Grid: 1. Ingest Inbound Customer Email & Test Pipeline, 2. Dispatch Live Outbound via SMTP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Box 1: Ingest Inbound Customer Email & Test Pipeline */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Inbox className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-white">Live Inbound Ingestion & Auto-Reply Pipeline</h2>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
                1-Reply Per Turn Guardrail
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Simulates receiving an email from your personal account into <strong className="text-slate-200">{INBOUND_MAILBOX}</strong>. Tests the complete pipeline: lead scoring, pushing contact/lead to CRM, thread to Unified Inbox, and <strong>sending a real SMTP auto-reply to your personal inbox</strong>.
            </p>

            <form onSubmit={handleIngestInboundTest} className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Customer Email (Your Address)
                  </label>
                  <input
                    type="email"
                    required
                    value={inboundSender}
                    onChange={(e) => setInboundSender(e.target.value)}
                    placeholder="amaavigo@gmail.com"
                    className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Customer Name / Agency
                  </label>
                  <input
                    type="text"
                    value={inboundSenderName}
                    onChange={(e) => setInboundSenderName(e.target.value)}
                    placeholder="Amaavigo Travel"
                    className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Subject Line
                </label>
                <input
                  type="text"
                  required
                  value={inboundSubject}
                  onChange={(e) => setInboundSubject(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Inquiry Message Body
                </label>
                <textarea
                  rows={3}
                  required
                  value={inboundBody}
                  onChange={(e) => setInboundBody(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition font-sans"
                />
              </div>

              {/* Turn Checkbox */}
              <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 flex items-start space-x-2.5">
                <input
                  type="checkbox"
                  id="followUpCheck"
                  checked={isCustomerFollowUp}
                  onChange={(e) => setIsCustomerFollowUp(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                />
                <label htmlFor="followUpCheck" className="text-xs text-slate-300 cursor-pointer">
                  <span className="font-semibold block text-slate-200">This is a customer follow-up reply</span>
                  <span className="text-[11px] text-slate-400">
                    Tests the rule: <em>"only reply once to mail then if got reply then again then only reply"</em>. When unchecked, subsequent identical emails are blocked from re-replying.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">
                  Target: <strong className="text-slate-300">{INBOUND_MAILBOX}</strong>
                </span>

                <button
                  type="submit"
                  disabled={isIngestingInbound}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md shadow-emerald-900/30 transition disabled:opacity-50"
                >
                  <Inbox className={`w-3.5 h-3.5 ${isIngestingInbound ? 'animate-bounce' : ''}`} />
                  <span>{isIngestingInbound ? 'Processing Pipeline...' : 'Ingest & Trigger Real Auto-Reply'}</span>
                </button>
              </div>
            </form>

            {inboundIngestResult && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  inboundIngestResult.success
                    ? inboundIngestResult.replied
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                      : 'bg-amber-950/50 border-amber-500/40 text-amber-200'
                    : 'bg-red-950/50 border-red-500/40 text-red-200'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-bold flex items-center space-x-1.5">
                    {inboundIngestResult.replied ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span>
                      {inboundIngestResult.replied
                        ? 'Auto-Reply Generated & Dispatched via SMTP!'
                        : 'Inbound Ingested — Auto-Reply Filtered by Guardrail'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    <strong>Decision:</strong> {inboundIngestResult.reason}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    <strong>SMTP Delivery:</strong> {inboundIngestResult.smtpStatus}
                  </p>
                  <div className="flex items-center space-x-3 pt-1">
                    {onNavigateToThread && (
                      <button
                        onClick={() => onNavigateToThread('')}
                        className="text-emerald-400 hover:underline flex items-center space-x-1 text-[11px]"
                      >
                        <span>Open in Unified Inbox</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    {onNavigateToCrm && (
                      <button
                        onClick={onNavigateToCrm}
                        className="text-blue-400 hover:underline flex items-center space-x-1 text-[11px]"
                      >
                        <span>View in CRM Pipeline</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Box 2: Dispatch Live Test Email via SMTP */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Send className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white">Direct Outbound SMTP Send Test</h2>
            </div>
            <p className="text-xs text-slate-400">
              Dispatches an immediate outbound email through the live SMTP connection to verify direct delivery to your personal mailbox (e.g. <strong className="text-slate-200">amaavigo@gmail.com</strong>).
            </p>

            <form onSubmit={handleSendLiveTest} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Recipient Email (Your Personal Mailbox)
                </label>
                <input
                  type="email"
                  required
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="amaavigo@gmail.com"
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={testSubject}
                  onChange={(e) => setTestSubject(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Message Body
                </label>
                <textarea
                  rows={3}
                  required
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition font-sans"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">
                  Sender: <strong className="text-slate-300">{INBOUND_MAILBOX}</strong>
                </span>

                <button
                  type="submit"
                  disabled={isSendingLiveTest}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-900/30 transition disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${isSendingLiveTest ? 'animate-pulse' : ''}`} />
                  <span>{isSendingLiveTest ? 'Dispatching over SMTP...' : 'Send Live Email via SMTP'}</span>
                </button>
              </div>
            </form>

            {liveSendResult && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  liveSendResult.success
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                    : 'bg-red-950/50 border-red-500/40 text-red-200'
                }`}
              >
                {liveSendResult.success ? (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center space-x-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Email Successfully Dispatched via SMTP!</span>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      Message ID: <span className="font-mono text-emerald-300">{liveSendResult.messageId}</span>
                    </p>
                    <p className="text-[11px] text-slate-300">
                      Check your personal inbox at <strong className="text-white">{testTo}</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center space-x-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span>SMTP Delivery Failed</span>
                    </div>
                    <p className="text-[11px] font-mono break-all">{liveSendResult.error}</p>
                    <p className="text-[11px] text-slate-300 mt-1">
                      Verify your SMTP credentials in Settings &gt; Secrets.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Box 2: Live Mailbox Environment Credentials Checklist */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
          <div className="flex items-center space-x-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Live Connection Environment Setup</h2>
          </div>
          <p className="text-xs text-slate-400">
            To allow the application container to directly access your email host for <strong className="text-slate-200">{INBOUND_MAILBOX}</strong>, configure these variables in your project settings:
          </p>

          <div className="space-y-2 text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono space-y-1.5 text-slate-300">
              <div className="text-slate-500"># SMTP Configuration (For Outbound Auto-Replies)</div>
              <div className="flex justify-between">
                <span>SMTP_HOST=</span>
                <span className={smtpStatus?.host && smtpStatus.host !== '(not set)' ? 'text-emerald-400' : 'text-amber-400'}>
                  {smtpStatus?.host && smtpStatus.host !== '(not set)' ? smtpStatus.host : 'smtp.yourdomain.com'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>SMTP_PORT=</span>
                <span className="text-slate-400">{smtpStatus?.port || 465}</span>
              </div>
              <div className="flex justify-between">
                <span>SMTP_USER=</span>
                <span className="text-emerald-400">{INBOUND_MAILBOX}</span>
              </div>
              <div className="flex justify-between">
                <span>SMTP_PASS=</span>
                <span className={smtpStatus?.hasPassword ? 'text-emerald-400' : 'text-amber-400'}>
                  {smtpStatus?.hasPassword ? '••••••••' : '(your_mailbox_password)'}
                </span>
              </div>

              <div className="text-slate-500 pt-2 border-t border-slate-800/80"># IMAP Configuration (For Reading Inbound Emails)</div>
              <div className="flex justify-between">
                <span>IMAP_HOST=</span>
                <span className={imapStatus?.host && imapStatus.host !== '(not set)' ? 'text-emerald-400' : 'text-amber-400'}>
                  {imapStatus?.host && imapStatus.host !== '(not set)' ? imapStatus.host : 'imap.yourdomain.com'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>IMAP_PORT=</span>
                <span className="text-slate-400">{imapStatus?.port || 993}</span>
              </div>
              <div className="flex justify-between">
                <span>IMAP_USER=</span>
                <span className="text-emerald-400">{INBOUND_MAILBOX}</span>
              </div>
              <div className="flex justify-between">
                <span>IMAP_PASS=</span>
                <span className={imapStatus?.configured ? 'text-emerald-400' : 'text-amber-400'}>
                  {imapStatus?.configured ? '••••••••' : '(your_mailbox_password)'}
                </span>
              </div>
            </div>

            <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-3 text-[11px] text-blue-300 space-y-1">
              <div className="font-semibold flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <span>How to set credentials in Google AI Studio:</span>
              </div>
              <p>
                Open the <strong>Settings</strong> menu in AI Studio, go to <strong>Secrets / Environment Variables</strong>, and add the variables listed above. Once saved, click <strong>"Test SMTP Connection"</strong> or <strong>"Check Inbox Now"</strong>.
              </p>
            </div>
          </div>
        </div>

      {/* Inbound Email Activity & Auto-Reply Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Live Inbound Emails & Auto-Reply Dispatch Log</h2>
          </div>
          <span className="text-xs text-slate-400">
            {processedHistory.length} email(s) recorded in current session
          </span>
        </div>

        {processedHistory.length === 0 ? (
          <div className="p-8 text-center bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
            <Inbox className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-300 font-medium">No live inbound emails captured yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Once you send an email to <strong className="text-slate-400">{INBOUND_MAILBOX}</strong> and click "Check Inbox Now" (or let the 30-second background listener poll it), the email and its live SMTP auto-reply will appear here with full audit traces.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {processedHistory.map((item, idx) => (
              <div
                key={item.messageId || idx}
                className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-white">{item.subject}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30">
                        Score: {item.leadScore}/100
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      From: <strong className="text-slate-200">{item.fromName}</strong> ({item.from}) → To: <span className="text-slate-300 font-mono">{item.to}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] text-slate-500">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                        item.smtpDelivery?.success
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : item.shouldSendAutoReply === false
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {item.smtpDelivery?.success
                        ? 'SMTP Sent'
                        : item.shouldSendAutoReply === false
                        ? 'Turn Guard: Waiting Customer'
                        : 'SMTP Pending/Simulated'}
                    </span>
                  </div>
                </div>

                {item.replyDecisionReason && (
                  <div className="text-[11px] bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400 flex items-center justify-between">
                    <span><strong>Turn Decision:</strong> {item.replyDecisionReason}</span>
                    <div className="flex items-center space-x-2">
                      {onNavigateToThread && (
                        <button
                          onClick={() => onNavigateToThread('')}
                          className="text-emerald-400 hover:underline text-[10px]"
                        >
                          Inbox →
                        </button>
                      )}
                      {onNavigateToCrm && (
                        <button
                          onClick={onNavigateToCrm}
                          className="text-blue-400 hover:underline text-[10px]"
                        >
                          CRM →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Body and AI Reply */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800/80 space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
                      Incoming Inquiry
                    </span>
                    <p className="text-slate-300 whitespace-pre-wrap line-clamp-4 font-sans">
                      {item.incomingText}
                    </p>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 flex items-center space-x-1">
                        <Bot className="w-3 h-3" />
                        <span>Dispatched Auto-Reply</span>
                      </span>
                      {item.handoffTriggered && (
                        <span className="text-[10px] text-amber-400 font-bold">
                          Human Handoff
                        </span>
                      )}
                    </div>
                    <p className="text-slate-300 whitespace-pre-wrap line-clamp-4 font-sans">
                      {item.replyText}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
