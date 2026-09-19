import React, { useState } from 'react';
import {
  Mail,
  Send,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Code,
  Copy,
  ExternalLink,
  ShieldCheck,
  X,
  Layers,
  Inbox,
  Flame,
} from 'lucide-react';
import {
  InboundEmailPayload,
  InboundProcessingResult,
  PRESET_INBOUND_EMAILS,
  INBOUND_MAILBOX,
} from '../services/emailInboundService';

interface InboundEmailFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProcessEmail: (payload: InboundEmailPayload) => Promise<InboundProcessingResult>;
  onNavigateToThread: (conversationId: string) => void;
  onNavigateToCrmLead: (leadId: string) => void;
}

export const InboundEmailFlowModal: React.FC<InboundEmailFlowModalProps> = ({
  isOpen,
  onClose,
  onProcessEmail,
  onNavigateToThread,
  onNavigateToCrmLead,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESET_INBOUND_EMAILS[0].id);
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [customFrom, setCustomFrom] = useState<string>('ahmed@alqudsatours.com');
  const [customName, setCustomName] = useState<string>('Ahmed Al-Qudsi');
  const [customCompany, setCustomCompany] = useState<string>('Al-Qudsi Travel');
  const [customSubject, setCustomSubject] = useState<string>('Umrah Group Costing & Visa Integration');
  const [customBody, setCustomBody] = useState<string>(
    'Assalamu Alaikum,\n\nWe organize group Umrah departures from Cairo and Dubai. Does Umrah360 support automated Saudi visa tracking and dynamic group costing with multi-currency SAR/USD?\n\nRegards,\nAhmed Al-Qudsi'
  );

  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<InboundProcessingResult | null>(null);
  const [smtpLiveResult, setSmtpLiveResult] = useState<{ success: boolean; messageId?: string; error?: string } | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentPreset = PRESET_INBOUND_EMAILS.find((p) => p.id === selectedPresetId);

  const activePayload: InboundEmailPayload = isCustom
    ? {
        from: customFrom,
        fromName: customName,
        companyName: customCompany,
        to: INBOUND_MAILBOX,
        subject: customSubject,
        body: customBody,
      }
    : currentPreset!.payload;

  const handleExecute = async () => {
    setIsExecuting(true);
    setExecutionResult(null);
    setSmtpLiveResult(null);
    try {
      // 1. Process internal application CRM state
      const res = await onProcessEmail(activePayload);
      setExecutionResult(res);

      // 2. Dispatch real live email over SMTP connection
      try {
        const liveRes = await fetch('/api/inbound/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(activePayload),
        });
        const liveData = await liveRes.json();
        if (liveData?.result?.smtpDelivery) {
          setSmtpLiveResult(liveData.result.smtpDelivery);
        }
      } catch (smtpErr) {
        console.warn('Live SMTP execution warning:', smtpErr);
      }
    } catch (err) {
      console.error('Inbound execution error:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  const sampleCurl = `curl -X POST "${window.location.origin}/api/inbound/email" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${activePayload.from}",
    "fromName": "${activePayload.fromName || ''}",
    "to": "${INBOUND_MAILBOX}",
    "companyName": "${activePayload.companyName || ''}",
    "subject": "${activePayload.subject}",
    "body": "${activePayload.body.replace(/\n/g, '\\n')}"
  }'`;

  const copyCurlToClipboard = () => {
    navigator.clipboard.writeText(sampleCurl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-white">Live Inbound Email Pipeline</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {INBOUND_MAILBOX}
                </span>
                <span className="flex items-center space-x-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Active Listener</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Simulates or receives real inbound emails sent to <strong className="text-slate-200">{INBOUND_MAILBOX}</strong> and executes the complete 8-step inbound mail flow.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Preset or Custom Selector */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
                Choose Email Scenario
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setIsCustom(false)}
                  className={`px-3 py-1 rounded-md transition font-medium ${
                    !isCustom ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Verified Agency Presets
                </button>
                <button
                  onClick={() => setIsCustom(true)}
                  className={`px-3 py-1 rounded-md transition font-medium ${
                    isCustom ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Custom Email Composer
                </button>
              </div>
            </div>

            {!isCustom ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {PRESET_INBOUND_EMAILS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      selectedPresetId === preset.id
                        ? 'bg-blue-950/40 border-blue-500/60 shadow-md ring-1 ring-blue-500/40'
                        : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {preset.badge}
                        </span>
                        {preset.id === 'preset-enterprise-handoff' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Handoff</span>
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-white text-xs mt-1">{preset.label}</h4>
                      <p className="text-slate-400 text-[11px] mt-1 line-clamp-2">{preset.description}</p>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-2 pt-2 border-t border-slate-700/40 truncate">
                      From: {preset.payload.from}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-400">Sender Email</label>
                    <input
                      type="email"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-400">Sender Name</label>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-400">Agency / Company</label>
                    <input
                      type="text"
                      value={customCompany}
                      onChange={(e) => setCustomCompany(e.target.value)}
                      className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-400">Email Subject</label>
                  <input
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-400">Email Body</label>
                  <textarea
                    rows={4}
                    value={customBody}
                    onChange={(e) => setCustomBody(e.target.value)}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Email Preview Card */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[11px] font-bold text-slate-300">Incoming Message Inspector</span>
              <span className="text-[10px] font-mono text-slate-400">To: {INBOUND_MAILBOX}</span>
            </div>

            <div className="space-y-1 text-slate-300">
              <div>
                <span className="text-slate-500">From:</span> {activePayload.fromName || 'Operator'} &lt;{activePayload.from}&gt;
              </div>
              <div>
                <span className="text-slate-500">Subject:</span> <strong className="text-white">{activePayload.subject}</strong>
              </div>
              <div className="pt-2 text-slate-200 whitespace-pre-wrap font-sans bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                {activePayload.body}
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center space-x-2 text-slate-400 text-[11px]">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Auto-detects duplicates, creates lead, retrieves RAG knowledge & replies in thread</span>
            </div>

            <button
              onClick={handleExecute}
              disabled={isExecuting}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition flex items-center justify-center space-x-2 shadow-lg disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Inbound Mail Flow...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send Inbound Mail to {INBOUND_MAILBOX}</span>
                </>
              )}
            </button>
          </div>

          {/* Execution Results & Step Trace */}
          {executionResult && (
            <div className="space-y-4 pt-4 border-t border-slate-800 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-sm flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Inbound Mail Flow Execution Trace (8 Steps Completed)</span>
                </h4>
                {executionResult.humanHandoffTriggered ? (
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center space-x-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Human Handoff Triggered (AI = OFF)</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold flex items-center space-x-1">
                    <Bot className="w-3.5 h-3.5" />
                    <span>Grounded AI Auto-Reply Dispatched</span>
                  </span>
                )}
              </div>

              {/* Step Timeline */}
              {/* SMTP Live Delivery Status */}
              {smtpLiveResult && (
                <div
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                    smtpLiveResult.success
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                      : 'bg-amber-950/50 border-amber-500/40 text-amber-200'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {smtpLiveResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                    <span>
                      {smtpLiveResult.success
                        ? `Live Email Dispatched via SMTP to ${activePayload.from}! Message ID: ${smtpLiveResult.messageId}`
                        : `Live SMTP Notice: ${smtpLiveResult.error || 'SMTP awaiting credentials in environment'}`}
                    </span>
                  </div>
                </div>
              )}

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                {executionResult.steps.map((step) => (
                  <div key={step.stepNumber} className="flex items-start space-x-3 text-xs">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-mono text-[10px] font-bold mt-0.5">
                      {step.stepNumber}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">{step.stepName}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(step.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Result Preview Cards: Inbound vs Outbound AI Reply */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Contact & Lead Card */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-slate-300 flex items-center space-x-1.5">
                      <User className="w-3.5 h-3.5 text-blue-400" />
                      <span>Contact & Lead Created/Updated</span>
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                      <Flame className="w-3 h-3 text-amber-400" />
                      <span>Score: {executionResult.lead.leadScore}/100</span>
                    </span>
                  </div>

                  <div className="space-y-1 text-slate-300">
                    <div>
                      <strong className="text-white">
                        {executionResult.contact.firstName} {executionResult.contact.lastName}
                      </strong>
                    </div>
                    <div className="text-slate-400">{executionResult.contact.companyName}</div>
                    <div className="text-slate-400">Email: {executionResult.contact.email}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                        Type: {executionResult.lead.leadType}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                        Status: {executionResult.lead.status}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px]">
                        Stage: {executionResult.lead.buyingStage}
                      </span>
                    </div>
                  </div>
                </div>

                {/* AI Reply Card */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-slate-300 flex items-center space-x-1.5">
                      <Bot className="w-3.5 h-3.5 text-emerald-400" />
                      <span>AI Dispatched Reply (From {INBOUND_MAILBOX})</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      In-Reply-To preserved
                    </span>
                  </div>

                  <div className="text-slate-300 text-[11px] whitespace-pre-wrap bg-slate-900/70 p-3 rounded-lg border border-slate-800 max-h-48 overflow-y-auto">
                    {executionResult.aiReplyMessage?.text}
                  </div>
                </div>
              </div>

              {/* Navigation Actions */}
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    onNavigateToThread(executionResult.conversation.conversationId);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition flex items-center space-x-2"
                >
                  <Inbox className="w-4 h-4" />
                  <span>Open Thread in Unified Inbox</span>
                </button>

                <button
                  onClick={() => {
                    onNavigateToCrmLead(executionResult.lead.leadId);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition flex items-center space-x-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Inspect Lead in CRM Pipeline</span>
                </button>
              </div>
            </div>
          )}

          {/* External Webhook Curl Information */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300 flex items-center space-x-1.5">
                <Code className="w-4 h-4 text-blue-400" />
                <span>External Inbound Webhook / Direct API Access</span>
              </span>
              <button
                onClick={copyCurlToClipboard}
                className="flex items-center space-x-1 text-slate-400 hover:text-white px-2.5 py-1 rounded bg-slate-800 border border-slate-700 transition"
              >
                {copiedCurl ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy cURL</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              You or an external mail forwarder (SendGrid, Mailgun, Postmark, AWS SES) can POST real emails to this endpoint:
            </p>
            <pre className="bg-slate-900 p-3 rounded-lg text-slate-300 font-mono text-[10px] overflow-x-auto border border-slate-800">
              {sampleCurl}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
