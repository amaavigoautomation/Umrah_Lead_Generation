import React, { useState } from 'react';
import {
  MessageSquare,
  Send,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Copy,
  ExternalLink,
  Bot,
  User,
  X,
  Phone,
} from 'lucide-react';
import {
  WHATSAPP_BUSINESS_NUMBER,
  WHATSAPP_BUSINESS_NUMBER_FORMATTED,
  PRESET_INBOUND_WHATSAPP,
  InboundWhatsAppPayload,
  InboundWhatsAppProcessingResult,
  processInboundWhatsAppMessage,
} from '../services/whatsappInboundService';
import {
  Contact,
  Lead,
  Conversation,
  Message,
  KnowledgeDocument,
  SystemSettings,
} from '../types';

interface InboundWhatsAppFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: Contact[];
  leads: Lead[];
  conversations: Conversation[];
  messages: Message[];
  knowledgeDocs: KnowledgeDocument[];
  settings: SystemSettings;
  onInboundComplete?: (result: InboundWhatsAppProcessingResult) => void;
  onNavigateToConversation?: (conversationId: string) => void;
  onNavigateToLead?: (leadId: string) => void;
}

export const InboundWhatsAppFlowModal: React.FC<InboundWhatsAppFlowModalProps> = ({
  isOpen,
  onClose,
  contacts,
  leads,
  conversations,
  messages,
  knowledgeDocs,
  settings,
  onInboundComplete,
  onNavigateToConversation,
  onNavigateToLead,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESET_INBOUND_WHATSAPP[0].id);
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [customPayload, setCustomPayload] = useState<InboundWhatsAppPayload>({
    from: '+919845011223',
    fromName: 'Tariq Khan',
    to: WHATSAPP_BUSINESS_NUMBER,
    companyName: 'Al Baraka Tours & Travels',
    body: 'Assalamu Alaikum, does Umrah360 provide a white-label B2B sub-agent portal and Makkah hotel offline allotments?',
  });

  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<InboundWhatsAppProcessingResult | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  if (!isOpen) return null;

  const activePreset = PRESET_INBOUND_WHATSAPP.find((p) => p.id === selectedPresetId) || PRESET_INBOUND_WHATSAPP[0];
  const activePayload = isCustom ? customPayload : activePreset.payload;

  const handleExecuteFlow = async () => {
    setIsExecuting(true);
    setExecutionResult(null);

    try {
      // 1. Client-side state pipeline
      const res = await processInboundWhatsAppMessage({
        payload: activePayload,
        contacts,
        leads,
        conversations,
        messages,
        knowledgeDocs,
        settings,
      });

      setExecutionResult(res);

      if (onInboundComplete) {
        onInboundComplete(res);
      }
    } catch (err) {
      console.error('Inbound WhatsApp execution error:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  const sampleCurl = `curl -X POST "${window.location.origin}/api/inbound/whatsapp" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${activePayload.from}",
    "fromName": "${activePayload.fromName || ''}",
    "to": "${WHATSAPP_BUSINESS_NUMBER}",
    "companyName": "${activePayload.companyName || ''}",
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
        <div className="p-6 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-white">Live Inbound WhatsApp Pipeline</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                  <Phone className="w-3 h-3 text-emerald-400 inline" />
                  <span>{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
                </span>
                <span className="flex items-center space-x-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Active Listener</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Simulates or receives real inbound WhatsApp messages sent to{' '}
                <strong className="text-emerald-300 font-mono">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</strong> and triggers immediate AI auto-reply, CRM entity sync, and deduplication.
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
                Choose WhatsApp Inquiry Scenario
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setIsCustom(false)}
                  className={`px-3 py-1 rounded-md transition font-medium ${
                    !isCustom ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Verified Agency Presets
                </button>
                <button
                  onClick={() => setIsCustom(true)}
                  className={`px-3 py-1 rounded-md transition font-medium ${
                    isCustom ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Custom Message Composer
                </button>
              </div>
            </div>

            {!isCustom ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PRESET_INBOUND_WHATSAPP.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      selectedPresetId === preset.id
                        ? 'bg-emerald-950/40 border-emerald-500/60 shadow-md ring-1 ring-emerald-500/40'
                        : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {preset.badge}
                        </span>
                        {preset.id === 'preset-wa-enterprise-handoff' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-1">
                            <AlertTriangle className="w-3 h-3 inline" />
                            <span>Guardrail Handoff</span>
                          </span>
                        )}
                      </div>
                      <h4 className="font-semibold text-white text-xs mb-1">{preset.label}</h4>
                      <p className="text-[11px] text-slate-400 line-clamp-2">{preset.description}</p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono text-emerald-400">{preset.payload.from}</span>
                      <span className="text-slate-400 font-medium">To: {WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Sender Phone Number</label>
                    <input
                      type="text"
                      value={customPayload.from}
                      onChange={(e) => setCustomPayload({ ...customPayload, from: e.target.value })}
                      placeholder="+91 98450 11223"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Sender Name</label>
                    <input
                      type="text"
                      value={customPayload.fromName}
                      onChange={(e) => setCustomPayload({ ...customPayload, fromName: e.target.value })}
                      placeholder="e.g. Tariq Khan"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Agency / Company Name</label>
                    <input
                      type="text"
                      value={customPayload.companyName}
                      onChange={(e) => setCustomPayload({ ...customPayload, companyName: e.target.value })}
                      placeholder="e.g. Al Baraka Tours & Travels"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Destination Number (Umrah360 WhatsApp)</label>
                    <input
                      type="text"
                      disabled
                      value={WHATSAPP_BUSINESS_NUMBER_FORMATTED}
                      className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 text-emerald-400 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">WhatsApp Message Body</label>
                  <textarea
                    rows={4}
                    value={customPayload.body}
                    onChange={(e) => setCustomPayload({ ...customPayload, body: e.target.value })}
                    placeholder="Type WhatsApp message inquiry here..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-slate-400 text-[11px]">
              Ready to send message from <strong className="text-white font-mono">{activePayload.from}</strong> to{' '}
              <strong className="text-emerald-400 font-mono">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</strong>.
            </div>

            <button
              onClick={handleExecuteFlow}
              disabled={isExecuting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl flex items-center space-x-2 transition shadow-lg shadow-emerald-600/20"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Pipeline...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send Inbound WhatsApp Message</span>
                </>
              )}
            </button>
          </div>

          {/* Execution Trace Results */}
          {executionResult && (
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <h4 className="font-bold text-white text-sm">Pipeline Execution Completed</h4>
                </div>

                {executionResult.humanHandoffTriggered ? (
                  <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-semibold flex items-center space-x-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Transferred to Human Agent</span>
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI WhatsApp Reply Dispatched</span>
                  </span>
                )}
              </div>

              {/* 8 Step Trace */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {executionResult.steps.map((step) => (
                  <div
                    key={step.stepNumber}
                    className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/40 flex items-start space-x-2.5"
                  >
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                      {step.stepNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 text-[11px]">{step.stepName}</span>
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Live WhatsApp Chat Bubble Preview */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-3 bg-emerald-950/40 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
                      WA
                    </div>
                    <div>
                      <div className="text-white font-semibold text-xs flex items-center space-x-1.5">
                        <span>{executionResult.contact.firstName} {executionResult.contact.lastName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">({executionResult.contact.phone})</span>
                      </div>
                      <span className="text-[10px] text-emerald-400">Business line: {WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {onNavigateToConversation && (
                      <button
                        onClick={() => {
                          onClose();
                          onNavigateToConversation(executionResult.conversation.conversationId);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center space-x-1 transition"
                      >
                        <span>Open in Unified Inbox</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    {onNavigateToLead && (
                      <button
                        onClick={() => {
                          onClose();
                          onNavigateToLead(executionResult.lead.leadId);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center space-x-1 transition"
                      >
                        <span>View Lead</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-4 bg-slate-950/80">
                  {/* Incoming Customer Bubble */}
                  <div className="flex items-start space-x-2.5">
                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 shrink-0 mt-1">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm p-3.5 bg-slate-800 text-slate-200 border border-slate-700/60 shadow-sm">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span className="font-semibold text-slate-300">{executionResult.contact.firstName}</span>
                        <span>Just now</span>
                      </div>
                      <p className="whitespace-pre-line text-[11px] leading-relaxed">{executionResult.incomingMessage.text}</p>
                    </div>
                  </div>

                  {/* Outbound AI Bubble */}
                  {executionResult.aiReplyMessage && (
                    <div className="flex items-start justify-end space-x-2.5">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm p-3.5 bg-emerald-950/70 text-emerald-100 border border-emerald-600/40 shadow-sm">
                        <div className="flex items-center justify-between text-[10px] text-emerald-400 mb-1">
                          <span className="font-semibold flex items-center space-x-1">
                            <Bot className="w-3 h-3" />
                            <span>Umrah360 AI ({WHATSAPP_BUSINESS_NUMBER_FORMATTED})</span>
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                            Automated
                          </span>
                        </div>
                        <p className="whitespace-pre-line text-[11px] leading-relaxed">
                          {executionResult.aiReplyMessage.text}
                        </p>
                      </div>
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 mt-1">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Webhook & cURL Integration Section */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Meta WhatsApp Cloud API / Direct Webhook Endpoint</span>
              </span>
              <button
                onClick={copyCurlToClipboard}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 transition font-medium"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedCurl ? 'Copied to Clipboard!' : 'Copy cURL Command'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              You can connect WhatsApp Cloud API, Twilio, or any webhook provider directly to{' '}
              <code className="text-emerald-300 bg-slate-900 px-1 py-0.5 rounded font-mono">
                /api/inbound/whatsapp
              </code>{' '}
              to ingest live messages for <strong className="text-white">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</strong>.
            </p>
            <pre className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg text-slate-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {sampleCurl}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
