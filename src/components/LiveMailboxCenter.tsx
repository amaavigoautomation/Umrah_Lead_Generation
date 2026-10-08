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
  MessageSquare,
  Copy,
  X,
  Smartphone,
} from 'lucide-react';
import { INBOUND_MAILBOX } from '../services/emailInboundService';
import {
  WHATSAPP_BUSINESS_NUMBER,
  WHATSAPP_BUSINESS_NUMBER_FORMATTED,
} from '../services/whatsappInboundService';

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

  // SMTP Configuration Modal State
  const [showSmtpConfigModal, setShowSmtpConfigModal] = useState<boolean>(false);
  const [modalSmtpHost, setModalSmtpHost] = useState<string>('smtp.gmail.com');
  const [modalSmtpPort, setModalSmtpPort] = useState<number>(465);
  const [modalSmtpUser, setModalSmtpUser] = useState<string>('amaavigo@gmail.com');
  const [modalSmtpPass, setModalSmtpPass] = useState<string>('');
  const [modalSmtpFrom, setModalSmtpFrom] = useState<string>('Umrah360 Automation <amaavigo@gmail.com>');
  const [isSavingModalSmtp, setIsSavingModalSmtp] = useState<boolean>(false);
  const [modalSmtpSaveResult, setModalSmtpSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  const [isPollingImap, setIsPollingImap] = useState<boolean>(false);
  const [pollResult, setPollResult] = useState<{ success: boolean; count: number; message: string } | null>(null);

  const activeMailbox = smtpStatus?.user || imapStatus?.user || INBOUND_MAILBOX || 'amaavigo@gmail.com';

  const handleSaveModalSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingModalSmtp(true);
    setModalSmtpSaveResult(null);
    try {
      const res = await fetch('/api/smtp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: modalSmtpHost,
          port: modalSmtpPort,
          user: modalSmtpUser,
          pass: modalSmtpPass,
          from: modalSmtpFrom,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const verifyRes = await fetch('/api/smtp/verify', { method: 'POST' });
        const verifyData = await verifyRes.json();
        if (verifyRes.ok && verifyData.verified) {
          setModalSmtpSaveResult({
            success: true,
            message: `SMTP Connected and verified successfully! Outbound emails will be delivered live via ${modalSmtpHost}.`,
          });
        } else {
          setModalSmtpSaveResult({
            success: false,
            message: `Configuration saved, but verification reported: ${verifyData.error || 'Check password'}`,
          });
        }
        fetchStatus();
      } else {
        setModalSmtpSaveResult({
          success: false,
          message: data.error || 'Failed to save configuration',
        });
      }
    } catch (err: any) {
      setModalSmtpSaveResult({
        success: false,
        message: err?.message || 'Error saving SMTP configuration',
      });
    } finally {
      setIsSavingModalSmtp(false);
    }
  };

  // WhatsApp Gateway & Setup Modal State
  const [waGatewayStatus, setWaGatewayStatus] = useState<{
    configured: boolean;
    provider: string;
    phoneNumber: string;
    phoneNumberFormatted: string;
    phoneNumberId?: string;
    webhookUrl: string;
    verifyToken: string;
  } | null>(null);
  const [showWaModal, setShowWaModal] = useState<boolean>(false);
  const [waModalTestPhone, setWaModalTestPhone] = useState<string>('+919876543210');
  const [waModalTestName, setWaModalTestName] = useState<string>('Haji Farooq');
  const [waModalTestBody, setWaModalTestBody] = useState<string>('Hello, we need package pricing for 25 pilgrims in Shawwal 2026.');
  const [isSendingWaModalTest, setIsSendingWaModalTest] = useState<boolean>(false);
  const [waModalTestResult, setWaModalTestResult] = useState<any>(null);

  // Live test send form (Outbound direct test)
  const [testTo, setTestTo] = useState<string>('amaavigo@gmail.com');
  const [testSubject, setTestSubject] = useState<string>('Umrah360 Live SMTP Auto-Reply Test');
  const [testBody, setTestBody] = useState<string>(
    'Hello,\n\nThis is a live test email dispatched via Umrah360 SMTP connection to confirm live mail delivery.\n\nBest regards,\nUmrah360 Automation Team'
  );
  const [isSendingLiveTest, setIsSendingLiveTest] = useState<boolean>(false);
  const [liveSendResult, setLiveSendResult] = useState<{ success: boolean; messageId?: string; error?: string } | null>(null);

  // Inbound Pipeline Ingestion Simulator & Tester
  const [inboundSender, setInboundSender] = useState<string>('partner.tour@gmail.com');
  const [inboundSenderName, setInboundSenderName] = useState<string>('Al-Noor Pilgrimage Tours');
  const [inboundSubject, setInboundSubject] = useState<string>('Inquiry: B2B Portal & Hotel Allotments for Umrah 2026');
  const [inboundBody, setInboundBody] = useState<string>(
    'Hello,\n\nWe are a pilgrimage tour agency with 8 staff members in Hyderabad. Does Umrah360 support custom hotel allotments and sub-agent credit limits?\n\nRegards,\nAl-Noor Pilgrimage Operations'
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
      const safeJson = (r: Response) => (r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null);
      const [smtpRes, imapRes, historyRes, waRes] = await Promise.all([
        fetch('/api/smtp/status').then(safeJson).catch(() => null),
        fetch('/api/imap/status').then(safeJson).catch(() => null),
        fetch('/api/inbound/history').then(safeJson).catch(() => ({ history: [] })),
        fetch('/api/whatsapp/status').then(safeJson).catch(() => null),
      ]);

      if (smtpRes) setSmtpStatus(smtpRes);
      if (imapRes) setImapStatus(imapRes);
      if (historyRes?.history) setProcessedHistory(historyRes.history);
      if (waRes?.gateway) setWaGatewayStatus(waRes.gateway);
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
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-xl bg-[#fef6f3] border border-[#fed7aa] flex items-center justify-center text-[#ef741a]">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-extrabold text-slate-900 font-display">Live Inbound Email & SMTP Auto-Reply Hub</h1>
                <span className="flex items-center space-x-1 text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                  <Radio className="w-3 h-3 animate-pulse text-[#0848ef]" />
                  <span>Real Mailbox Connection</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Direct live synchronization with <strong className="text-slate-800">{INBOUND_MAILBOX}</strong> and SMTP delivery to personal mailboxes.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchStatus}
            disabled={isLoadingStatus}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>

          <button
            onClick={handlePollImap}
            disabled={isPollingImap}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#ef741a] to-[#f97316] hover:from-[#d9620b] hover:to-[#ea580c] text-white text-xs font-bold shadow-xs transition"
          >
            <Inbox className={`w-3.5 h-3.5 ${isPollingImap ? 'animate-bounce' : ''}`} />
            <span>{isPollingImap ? 'Checking Inbox...' : 'Check Inbox Now (IMAP Sync)'}</span>
          </button>
        </div>
      </div>

      {/* Status Cards (Omnichannel: Email & WhatsApp) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Mailbox Details */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Target Mailbox</span>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#0848ef] border border-blue-200">
              Email Line
            </span>
          </div>
          <div className="space-y-1">
            <div className="text-base font-bold text-slate-900 font-mono break-all">{activeMailbox}</div>
            <p className="text-xs text-slate-500">
              Pilgrim operators & agencies send their inquiries directly to this address.
            </p>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-400">Auto-Reply Sender:</span>
            <span className="font-mono text-slate-800 font-semibold">{activeMailbox}</span>
          </div>
        </div>

        {/* Card 2: WhatsApp Business Line */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">WhatsApp Line</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                waGatewayStatus?.configured
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {waGatewayStatus?.configured
                ? `${waGatewayStatus.provider === 'META_CLOUD_API' ? 'Meta Cloud API Live' : 'Twilio Live'}`
                : 'Webhook Active'}
            </span>
          </div>
          <div className="space-y-1">
            <div className="text-base font-bold text-emerald-600 font-mono break-all">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</div>
            <p className="text-xs text-slate-500">
              Direct live inbound channel for chat inquiries, quotes, and hotel allotments.
            </p>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <button
              onClick={() => setShowWaModal(true)}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-bold flex items-center space-x-1"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Connect Physical Phone</span>
            </button>
            <span className="font-mono text-emerald-600 flex items-center space-x-1 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>/api/inbound/whatsapp</span>
            </span>
          </div>
        </div>

        {/* Card 3: SMTP Outbound Auto-Reply */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">SMTP Connection</span>
            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setShowSmtpConfigModal(true)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-[#0848ef] border border-blue-200 hover:bg-blue-100 transition"
              >
                Configure
              </button>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                  smtpStatus?.configured
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {smtpStatus?.configured ? 'Configured' : 'Needs Password'}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs text-slate-700 font-mono">
              <Server className="w-3.5 h-3.5 text-[#0848ef]" />
              <span>{smtpStatus?.host || 'smtp.gmail.com'}</span>
              <span>:{smtpStatus?.port || 465}</span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <Key className="w-3.5 h-3.5 text-[#ef741a]" />
              <span>Auth User: {smtpStatus?.user || activeMailbox}</span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={handleVerifySmtp}
              disabled={isVerifyingSmtp}
              className="text-xs text-[#0848ef] hover:underline font-semibold flex items-center space-x-1"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isVerifyingSmtp ? 'Testing Auth...' : 'Test SMTP Connection'}</span>
            </button>
            {smtpStatus?.hasPassword ? (
              <span className="text-[11px] text-emerald-600 font-semibold flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Password set</span>
              </span>
            ) : (
              <button
                onClick={() => setShowSmtpConfigModal(true)}
                className="text-[11px] text-amber-600 hover:underline flex items-center space-x-1 font-semibold"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Add App Password</span>
              </button>
            )}
          </div>
        </div>

        {/* Card 4: IMAP Inbound Listener */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">IMAP Inbound Listener</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                imapStatus?.configured
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              {imapStatus?.configured ? 'Active Poller' : 'Needs Credentials'}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs text-slate-700 font-mono">
              <Inbox className="w-3.5 h-3.5 text-[#ef741a]" />
              <span>{imapStatus?.host || 'IMAP_HOST not set'}</span>
              <span>:{imapStatus?.port || 993}</span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Auto-poll: Every 30s background cycle</span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={handlePollImap}
              disabled={isPollingImap}
              className="text-xs text-[#ef741a] hover:underline font-semibold flex items-center space-x-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPollingImap ? 'animate-spin' : ''}`} />
              <span>Sync Unread Now</span>
            </button>
            <span className="text-[11px] text-slate-400 font-medium">
              {imapStatus?.configured ? 'Listening' : 'Waiting for host'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Alerts / Feedback */}
      {smtpVerifyResult && (
        <div
          className={`p-4 rounded-2xl border flex items-start space-x-3 text-xs shadow-xs ${
            smtpVerifyResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {smtpVerifyResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
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
          className={`p-4 rounded-2xl border flex items-start space-x-3 text-xs shadow-xs ${
            pollResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {pollResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
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
      <div className="bg-[#fef6f3] border border-[#fed7aa] rounded-2xl p-5 text-xs space-y-2.5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="flex items-center space-x-2 text-[#c2410c] font-bold">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#ef741a]" />
            <span className="text-sm font-display">Active Mailbox: {activeMailbox} (Gmail IMAP & SMTP)</span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white text-[#c2410c] border border-[#fed7aa] font-semibold w-fit">
            IMAP: imap.gmail.com:993 • SMTP: smtp.gmail.com:465
          </span>
        </div>
        <p className="text-slate-700 leading-relaxed text-xs">
          The automation system is connected directly to <strong>{activeMailbox}</strong> using Gmail SSL/TLS. Any customer or tour operator inquiries received at this address will be automatically polled every 30s, analyzed by Gemini, pushed into CRM & Unified Inbox, and replied to with a personalized auto-reply.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] pt-1">
          <div className="bg-white p-3 rounded-xl border border-[#fed7aa]/70 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">1. Send Live Test from Outside</span>
            <span className="text-slate-600">Send an email from another email account (e.g. personal Yahoo, Outlook, or another Gmail) to <code>{activeMailbox}</code>. Click "Check Inbox Now" or wait 30 seconds for automatic processing.</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-[#fed7aa]/70 shadow-2xs">
            <span className="font-bold text-[#ef741a] block mb-0.5">2. Live Inbound Simulator (Below)</span>
            <span className="text-slate-600">You can also trigger a simulated inbound customer inquiry below. It tests the complete end-to-end pipeline, AI generation, and live SMTP delivery to the sender.</span>
          </div>
        </div>
      </div>

      {/* Grid: 1. Ingest Inbound Customer Email & Test Pipeline, 2. Dispatch Live Outbound via SMTP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Box 1: Ingest Inbound Customer Email & Test Pipeline */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-xs flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Inbox className="w-4 h-4 text-[#ef741a]" />
                <h2 className="text-sm font-extrabold text-slate-900 font-display">Live Inbound Ingestion & Auto-Reply Pipeline</h2>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#fef6f3] text-[#ef741a] font-bold border border-[#fed7aa]">
                1-Reply Per Turn Guardrail
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Simulates receiving an email from your personal account into <strong className="text-slate-800">{INBOUND_MAILBOX}</strong>. Tests the complete pipeline: lead scoring, pushing contact/lead to CRM, thread to Unified Inbox, and <strong>sending a real SMTP auto-reply to your personal inbox</strong>.
            </p>

            <form onSubmit={handleIngestInboundTest} className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Customer Email (Your Address)
                  </label>
                  <input
                    type="email"
                    required
                    value={inboundSender}
                    onChange={(e) => setInboundSender(e.target.value)}
                    placeholder="amaavigo@gmail.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Customer Name / Agency
                  </label>
                  <input
                    type="text"
                    value={inboundSenderName}
                    onChange={(e) => setInboundSenderName(e.target.value)}
                    placeholder="Amaavigo Travel"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Subject Line
                </label>
                <input
                  type="text"
                  required
                  value={inboundSubject}
                  onChange={(e) => setInboundSubject(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Inquiry Message Body
                </label>
                <textarea
                  rows={3}
                  required
                  value={inboundBody}
                  onChange={(e) => setInboundBody(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition font-sans"
                />
              </div>

              {/* Turn Checkbox */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-start space-x-2.5">
                <input
                  type="checkbox"
                  id="followUpCheck"
                  checked={isCustomerFollowUp}
                  onChange={(e) => setIsCustomerFollowUp(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#ef741a] focus:ring-[#ef741a]"
                />
                <label htmlFor="followUpCheck" className="text-xs text-slate-700 cursor-pointer">
                  <span className="font-bold block text-slate-900">This is a customer follow-up reply</span>
                  <span className="text-[11px] text-slate-500">
                    Tests the rule: <em>"only reply once to mail then if got reply then again then only reply"</em>. When unchecked, subsequent identical emails are blocked from re-replying.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500">
                  Target: <strong className="text-slate-800">{INBOUND_MAILBOX}</strong>
                </span>

                <button
                  type="submit"
                  disabled={isIngestingInbound}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#ef741a] to-[#f97316] hover:from-[#d9620b] hover:to-[#ea580c] text-white text-xs font-bold shadow-xs transition disabled:opacity-50"
                >
                  <Inbox className={`w-3.5 h-3.5 ${isIngestingInbound ? 'animate-bounce' : ''}`} />
                  <span>{isIngestingInbound ? 'Processing Pipeline...' : 'Ingest & Trigger Real Auto-Reply'}</span>
                </button>
              </div>
            </form>

            {inboundIngestResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs shadow-2xs ${
                  inboundIngestResult.success
                    ? inboundIngestResult.replied
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-bold flex items-center space-x-1.5">
                    {inboundIngestResult.replied ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    )}
                    <span>
                      {inboundIngestResult.replied
                        ? 'Auto-Reply Generated & Dispatched via SMTP!'
                        : 'Inbound Ingested — Auto-Reply Filtered by Guardrail'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    <strong>Decision:</strong> {inboundIngestResult.reason}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    <strong>SMTP Delivery:</strong> {inboundIngestResult.smtpStatus}
                  </p>
                  <div className="flex items-center space-x-3 pt-1">
                    {onNavigateToThread && (
                      <button
                        onClick={() => onNavigateToThread('')}
                        className="text-[#ef741a] hover:underline font-bold flex items-center space-x-1 text-[11px]"
                      >
                        <span>Open in Unified Inbox</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    {onNavigateToCrm && (
                      <button
                        onClick={onNavigateToCrm}
                        className="text-[#0848ef] hover:underline font-bold flex items-center space-x-1 text-[11px]"
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
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-xs flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Send className="w-4 h-4 text-[#0848ef]" />
              <h2 className="text-sm font-extrabold text-slate-900 font-display">Direct Outbound SMTP Send Test</h2>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Dispatches an immediate outbound email through the live SMTP connection to verify direct delivery to your personal mailbox (e.g. <strong className="text-slate-800">amaavigo@gmail.com</strong>).
            </p>

            <form onSubmit={handleSendLiveTest} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Recipient Email (Your Personal Mailbox)
                </label>
                <input
                  type="email"
                  required
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="amaavigo@gmail.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={testSubject}
                  onChange={(e) => setTestSubject(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Message Body
                </label>
                <textarea
                  rows={3}
                  required
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#ef741a] focus:ring-2 focus:ring-[#ef741a]/20 transition font-sans"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500">
                  Sender: <strong className="text-slate-800">{INBOUND_MAILBOX}</strong>
                </span>

                <button
                  type="submit"
                  disabled={isSendingLiveTest}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-[#0848ef] hover:from-blue-700 hover:to-blue-800 text-white text-xs font-bold shadow-xs transition disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${isSendingLiveTest ? 'animate-pulse' : ''}`} />
                  <span>{isSendingLiveTest ? 'Dispatching over SMTP...' : 'Send Live Email via SMTP'}</span>
                </button>
              </div>
            </form>

            {liveSendResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs shadow-2xs ${
                  liveSendResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {liveSendResult.success ? (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center space-x-1.5 text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Email Successfully Dispatched via SMTP!</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Message ID: <span className="font-mono text-emerald-700 font-bold">{liveSendResult.messageId}</span>
                    </p>
                    <p className="text-[11px] text-slate-600">
                      Check your personal inbox at <strong className="text-slate-900">{testTo}</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center space-x-1.5 text-red-800">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span>SMTP Delivery Failed</span>
                    </div>
                    <p className="text-[11px] font-mono break-all text-red-700">{liveSendResult.error}</p>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Verify your SMTP credentials in Settings &gt; Secrets.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Mailbox Environment Credentials Checklist */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-xs">
        <div className="flex items-center space-x-2">
          <Key className="w-4 h-4 text-[#ef741a]" />
          <h2 className="text-sm font-extrabold text-slate-900 font-display">Live Connection Environment Setup</h2>
        </div>
        <p className="text-xs text-slate-500">
          To allow the application container to directly access your email host for <strong className="text-slate-800">{INBOUND_MAILBOX}</strong>, configure these variables in your project settings:
        </p>

        <div className="space-y-2 text-xs">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 font-mono space-y-1.5 text-slate-700">
            <div className="text-slate-400 font-semibold font-sans"># SMTP Configuration (For Outbound Auto-Replies)</div>
            <div className="flex justify-between">
              <span>SMTP_HOST=</span>
              <span className={smtpStatus?.host && smtpStatus.host !== '(not set)' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                {smtpStatus?.host && smtpStatus.host !== '(not set)' ? smtpStatus.host : 'smtp.yourdomain.com'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>SMTP_PORT=</span>
              <span className="text-slate-600">{smtpStatus?.port || 465}</span>
            </div>
            <div className="flex justify-between">
              <span>SMTP_USER=</span>
              <span className="text-emerald-700 font-bold">{INBOUND_MAILBOX}</span>
            </div>
            <div className="flex justify-between">
              <span>SMTP_PASS=</span>
              <span className={smtpStatus?.hasPassword ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                {smtpStatus?.hasPassword ? '••••••••' : '(your_mailbox_password)'}
              </span>
            </div>

            <div className="text-slate-400 font-semibold font-sans pt-2 border-t border-slate-200"># IMAP Configuration (For Reading Inbound Emails)</div>
            <div className="flex justify-between">
              <span>IMAP_HOST=</span>
              <span className={imapStatus?.host && imapStatus.host !== '(not set)' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                {imapStatus?.host && imapStatus.host !== '(not set)' ? imapStatus.host : 'imap.yourdomain.com'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>IMAP_PORT=</span>
              <span className="text-slate-600">{imapStatus?.port || 993}</span>
            </div>
            <div className="flex justify-between">
              <span>IMAP_USER=</span>
              <span className="text-emerald-700 font-bold">{INBOUND_MAILBOX}</span>
            </div>
            <div className="flex justify-between">
              <span>IMAP_PASS=</span>
              <span className={imapStatus?.configured ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                {imapStatus?.configured ? '••••••••' : '(your_mailbox_password)'}
              </span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-900 space-y-1">
            <div className="font-bold flex items-center space-x-1.5 text-[#0848ef]">
              <Info className="w-3.5 h-3.5" />
              <span>How to set credentials in Google AI Studio:</span>
            </div>
            <p className="text-slate-600">
              Open the <strong>Settings</strong> menu in AI Studio, go to <strong>Secrets / Environment Variables</strong>, and add the variables listed above. Once saved, click <strong>"Test SMTP Connection"</strong> or <strong>"Check Inbox Now"</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Inbound Email Activity & Auto-Reply Log */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-[#ef741a]" />
            <h2 className="text-sm font-extrabold text-slate-900 font-display">Live Inbound Emails & Auto-Reply Dispatch Log</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {processedHistory.length} email(s) recorded in current session
          </span>
        </div>

        {processedHistory.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <Inbox className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs text-slate-700 font-bold">No live inbound emails captured yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Once you send an email to <strong className="text-slate-700">{INBOUND_MAILBOX}</strong> and click "Check Inbox Now" (or let the 30-second background listener poll it), the email and its live SMTP auto-reply will appear here with full audit traces.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {processedHistory.map((item, idx) => (
              <div
                key={item.messageId || idx}
                className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-slate-900">{item.subject}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#fef6f3] text-[#ef741a] font-bold border border-[#fed7aa]">
                        Score: {item.leadScore}/100
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      From: <strong className="text-slate-800">{item.fromName}</strong> ({item.from}) → To: <span className="text-slate-700 font-mono">{item.to}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] text-slate-400 font-medium">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                        item.smtpDelivery?.success
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : item.shouldSendAutoReply === false
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
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
                  <div className="text-[11px] bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 flex items-center justify-between">
                    <span><strong>Turn Decision:</strong> {item.replyDecisionReason}</span>
                    <div className="flex items-center space-x-2">
                      {onNavigateToThread && (
                        <button
                          onClick={() => onNavigateToThread('')}
                          className="text-[#ef741a] hover:underline text-[10px] font-bold"
                        >
                          Inbox →
                        </button>
                      )}
                      {onNavigateToCrm && (
                        <button
                          onClick={onNavigateToCrm}
                          className="text-[#0848ef] hover:underline text-[10px] font-bold"
                        >
                          CRM →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Body and AI Reply */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                      Incoming Inquiry
                    </span>
                    <p className="text-slate-700 whitespace-pre-wrap line-clamp-4 font-sans leading-relaxed">
                      {item.incomingText}
                    </p>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-[#ef741a] flex items-center space-x-1">
                        <Bot className="w-3 h-3" />
                        <span>Dispatched Auto-Reply</span>
                      </span>
                      {item.handoffTriggered && (
                        <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                          Human Handoff
                        </span>
                      )}
                    </div>
                    <p className="text-slate-700 whitespace-pre-wrap line-clamp-4 font-sans leading-relaxed">
                      {item.replyText}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* WhatsApp Physical Phone Connection & Meta Setup Modal */}
      {showWaModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 sm:p-8 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setShowWaModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-100 pb-4">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 font-display">
                  WhatsApp Physical Line Connection ({WHATSAPP_BUSINESS_NUMBER_FORMATTED})
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Live Meta Cloud API webhook bridge for real-world phone messaging & automated AI replies
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-700">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="font-bold text-emerald-700 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>How Physical WhatsApp Inbound Works:</span>
                </div>
                <p className="text-slate-600 leading-relaxed text-xs">
                  When a customer or tour operator opens WhatsApp on their mobile phone and texts <strong>{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</strong>, Meta's global WhatsApp servers route the incoming chat to this app&apos;s webhook endpoint. The Umrah360 AI engine immediately extracts pilgrim requirements, calculates lead intent score, persists the contact and conversation to Firestore, and delivers an Islamic auto-reply back to the user&apos;s phone.
                </p>
              </div>

              {/* Meta Webhook Credentials Card */}
              <div className="space-y-2">
                <span className="font-bold text-slate-900 text-xs block">Meta WhatsApp Cloud API Webhook Parameters:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Callback URL</span>
                    <span className="text-emerald-700 font-semibold break-all select-all">
                      {typeof window !== 'undefined' ? `${window.location.origin}/api/inbound/whatsapp` : '/api/inbound/whatsapp'}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Verify Token</span>
                    <span className="text-[#ef741a] font-semibold break-all select-all">
                      {waGatewayStatus?.verifyToken || 'umrah360_webhook_token'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3 Step Setup Guide */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-900 text-xs block">To Connect Your Physical Number via Meta Cloud API:</span>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-600 text-xs">
                  <li>Log in to <strong className="text-slate-900">developers.facebook.com</strong> and select your WhatsApp App.</li>
                  <li>In WhatsApp &gt; Configuration &gt; Webhook, paste the Callback URL and Verify Token above.</li>
                  <li>Subscribe to the <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-emerald-700 font-mono">messages</code> field.</li>
                  <li>In app settings or environment, configure <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-800 font-mono">WHATSAPP_API_TOKEN</code> and <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-800 font-mono">WHATSAPP_PHONE_NUMBER_ID</code> to enable real-world outbound dispatch.</li>
                </ol>
              </div>

              {/* Test Simulator in Modal */}
              <div className="p-4 bg-[#fef6f3] border border-[#fed7aa] rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#c2410c] flex items-center space-x-1.5">
                    <Bot className="w-4 h-4 text-[#ef741a]" />
                    <span>Instant Live Inbound Test to {WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
                  </span>
                  <span className="text-[10px] text-slate-500">Tests exact AI parsing &amp; CRM storage</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Sender Phone</label>
                    <input
                      type="text"
                      value={waModalTestPhone}
                      onChange={(e) => setWaModalTestPhone(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2 text-slate-900 text-xs font-mono focus:outline-none focus:border-[#ef741a]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Sender Name</label>
                    <input
                      type="text"
                      value={waModalTestName}
                      onChange={(e) => setWaModalTestName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-2 text-slate-900 text-xs focus:outline-none focus:border-[#ef741a]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Incoming Message Body</label>
                  <textarea
                    rows={2}
                    value={waModalTestBody}
                    onChange={(e) => setWaModalTestBody(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-2 text-slate-900 text-xs focus:outline-none focus:border-[#ef741a]"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={async () => {
                      setIsSendingWaModalTest(true);
                      setWaModalTestResult(null);
                      try {
                        const res = await fetch('/api/inbound/whatsapp', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            from: waModalTestPhone,
                            fromName: waModalTestName,
                            to: '+919820252434',
                            body: waModalTestBody,
                            isTestSimulation: false,
                          }),
                        });
                        const data = await res.json();
                        setWaModalTestResult(data);
                        if (onSyncNow) onSyncNow();
                      } catch (err: any) {
                        setWaModalTestResult({ success: false, error: err.message });
                      } finally {
                        setIsSendingWaModalTest(false);
                      }
                    }}
                    disabled={isSendingWaModalTest}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#ef741a] to-[#f97316] hover:from-[#d9620b] hover:to-[#ea580c] text-white text-xs font-bold flex items-center space-x-2 transition disabled:opacity-50 shadow-xs"
                  >
                    {isSendingWaModalTest ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Processing with AI...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Send Test Inbound Message</span>
                      </>
                    )}
                  </button>
                </div>

                {waModalTestResult && (
                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2 mt-2 shadow-2xs">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-700 flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Inbound WhatsApp Processed &amp; Saved to CRM</span>
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        Score: {waModalTestResult.result?.leadScore || 85}/100
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded-lg text-slate-800 whitespace-pre-wrap font-sans text-xs">
                      {waModalTestResult.result?.replyText || 'Message ingested successfully.'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SMTP Configuration Modal */}
      {showSmtpConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 sm:p-8 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 rounded-xl bg-[#fef6f3] border border-[#fed7aa] flex items-center justify-center text-[#ef741a]">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 font-display">Outbound SMTP Mailbox Configuration</h3>
                  <p className="text-[11px] text-slate-500">Set up SMTP credentials for real outgoing auto-reply delivery.</p>
                </div>
              </div>
              <button
                onClick={() => setShowSmtpConfigModal(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModalSmtp} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-bold text-slate-700">SMTP Host</label>
                  <input
                    type="text"
                    required
                    value={modalSmtpHost}
                    onChange={(e) => setModalSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#ef741a] font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Port</label>
                  <input
                    type="number"
                    required
                    value={modalSmtpPort}
                    onChange={(e) => setModalSmtpPort(parseInt(e.target.value, 10) || 465)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#ef741a] font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">SMTP User / Email</label>
                <input
                  type="email"
                  required
                  value={modalSmtpUser}
                  onChange={(e) => setModalSmtpUser(e.target.value)}
                  placeholder="amaavigo@gmail.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#ef741a] font-mono"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">Gmail App Password (16 chars)</label>
                  <span className="text-[10px] text-[#0848ef] font-bold">Required for live delivery</span>
                </div>
                <input
                  type="password"
                  value={modalSmtpPass}
                  onChange={(e) => setModalSmtpPass(e.target.value)}
                  placeholder={smtpStatus?.hasPassword ? '•••••••••••••••• (Password saved)' : 'Enter 16-char Gmail App Password'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#ef741a] font-mono"
                />
                <p className="text-[10px] text-slate-500 leading-normal pt-0.5">
                  Go to <strong className="text-slate-800">myaccount.google.com/apppasswords</strong> &rarr; generate a 16-character App Password.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">From Header</label>
                <input
                  type="text"
                  value={modalSmtpFrom}
                  onChange={(e) => setModalSmtpFrom(e.target.value)}
                  placeholder="Umrah360 Automation <amaavigo@gmail.com>"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-[#ef741a] font-mono"
                />
              </div>

              {modalSmtpSaveResult && (
                <div
                  className={`p-3 rounded-xl border flex items-start space-x-2 text-xs ${
                    modalSmtpSaveResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  {modalSmtpSaveResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 font-medium">{modalSmtpSaveResult.message}</div>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSmtpConfigModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSavingModalSmtp}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#ef741a] to-[#f97316] hover:from-[#d9620b] hover:to-[#ea580c] text-white text-xs font-bold flex items-center space-x-1.5 transition disabled:opacity-50 shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSavingModalSmtp ? 'animate-spin' : ''}`} />
                  <span>{isSavingModalSmtp ? 'Verifying...' : 'Save & Verify Connection'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
