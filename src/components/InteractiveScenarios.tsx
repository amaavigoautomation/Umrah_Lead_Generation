import React, { useState } from 'react';
import {
  Play,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Bot,
  Mail,
  MessageCircle,
  Users,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Send,
  RefreshCw,
  Inbox,
  Flame,
} from 'lucide-react';
import {
  InboundEmailPayload,
  InboundProcessingResult,
  PRESET_INBOUND_EMAILS,
  INBOUND_MAILBOX,
} from '../services/emailInboundService';

interface InteractiveScenariosProps {
  onNavigateToInbox: () => void;
  onNavigateToCrm: () => void;
  onProcessInboundEmail?: (payload: InboundEmailPayload) => Promise<InboundProcessingResult>;
  onNavigateToThread?: (conversationId: string) => void;
  onNavigateToCrmLead?: (leadId: string) => void;
}

export const InteractiveScenarios: React.FC<InteractiveScenariosProps> = ({
  onNavigateToInbox,
  onNavigateToCrm,
  onProcessInboundEmail,
  onNavigateToThread,
  onNavigateToCrmLead,
}) => {
  const [activeScenario, setActiveScenario] = useState<'outbound' | 'whatsapp' | 'inbound'>('inbound');
  const [outboundStep, setOutboundStep] = useState<number>(1);
  const [whatsappStep, setWhatsappStep] = useState<number>(1);
  const [inboundStep, setInboundStep] = useState<number>(1);

  // Live Inbound simulation state
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(0);
  const [isExecutingLive, setIsExecutingLive] = useState<boolean>(false);
  const [liveResult, setLiveResult] = useState<InboundProcessingResult | null>(null);

  // Section 74 Inbound Email steps definition
  const inboundSteps = [
    {
      step: 1,
      title: 'Inbound Email Arrives at automation@amaavigo.com',
      desc: 'Tariq Khan (MD at Al Baraka Tours, Mumbai) emails automation@amaavigo.com: "Inquiry: B2B Sub-Agent Portal & Hotel Allotments for Umrah 2026".',
      badge: `To: ${INBOUND_MAILBOX}`,
    },
    {
      step: 2,
      title: 'Automated Contact Resolution & Duplicate Check',
      desc: 'System queries existing contacts by email (tariq@albarakatours.com) and phone (+91 98450 11223). Resolves duplicate contact or auto-creates contact profile.',
      badge: 'Duplicate Check: RESOLVED',
    },
    {
      step: 3,
      title: 'Inbound Lead Registered in CRM Pipeline',
      desc: 'Inbound lead created with source: EMAIL, type: INBOUND, intent: HIGH, serviceInterest: "B2B Sub-Agent Portal & Allotments". Initial lead score calculated: 88/100.',
      badge: 'Score: 88/100',
    },
    {
      step: 4,
      title: 'Email Thread & Omnichannel Conversation Linked',
      desc: 'Thread ID and Conversation record instantiated. Preserves In-Reply-To and References RFC headers for email threading integrity.',
      badge: 'Thread Linked',
    },
    {
      step: 5,
      title: 'Message Ingested with Full Headers',
      desc: 'Customer message stored with senderType: CUSTOMER, verified senderEmail, timestamp, and body text in the Unified Inbox.',
      badge: 'Message Persisted',
    },
    {
      step: 6,
      title: 'RAG Knowledge Retrieval & Guardrail Check',
      desc: 'RAG extracts verified excerpts from "B2B Sub-Agent Portal & Reseller Distribution Engine". Evaluates guardrails: no enterprise 20+ user trigger detected -> AI auto-reply approved.',
      badge: 'RAG Grounded: Approved',
    },
    {
      step: 7,
      title: 'AI Auto-Reply Dispatched in the SAME Thread',
      desc: 'Auto-reply sent from automation@amaavigo.com in the SAME thread (Re: Inquiry). Explains B2B sub-agent markup tiers, credit wallets, and Makkah hotel allotment uploads with 96% confidence.',
      badge: `From: ${INBOUND_MAILBOX}`,
    },
    {
      step: 8,
      title: 'CRM Timeline Synchronized & Memory Updated',
      desc: 'Lead activities logged (PROSPECT_REPLIED and AI_REPLIED). Conversation memory captures sub-agent requirements and sets next action to schedule platform demo.',
      badge: 'CRM Synced',
    },
  ];

  // Section 72 Outbound steps definition
  const outboundSteps = [
    {
      step: 1,
      title: 'Admin creates Outbound Campaign',
      desc: 'Campaign "Indian Umrah Operators" established targeting Owners / Founders / Directors in India.',
      badge: 'Campaign: Indian Umrah Operators',
    },
    {
      step: 2,
      title: 'Apollo Search Execution',
      desc: 'System queries Apollo API for decision makers at Umrah/Hajj travel agencies.',
      badge: 'Apollo API',
    },
    {
      step: 3,
      title: 'Prospect Discovered: Rahul Sharma',
      desc: 'Found: Rahul Sharma, Founder & MD at ABC Travels (New Delhi, 25 employees).',
      badge: 'rahul@abctravels.in',
    },
    {
      step: 4,
      title: 'Automated Duplicate Detection (Section 9)',
      desc: 'Duplicate check against existing contacts, emails, phones, and Apollo Person ID passed clean.',
      badge: 'Duplicate Check: PASS',
    },
    {
      step: 5,
      title: 'AI Prospect Qualification (Section 10)',
      desc: 'Gemini evaluates ICP fit: Company Fit (100%), Title Fit (100%), Geo (India). Score: 92/100 -> QUALIFIED.',
      badge: 'Score: 92/100',
    },
    {
      step: 6,
      title: 'Cold Outreach Email Sent',
      desc: 'Personalized cold email dispatched with variables {{firstName}}=Rahul, {{companyName}}=ABC Travels.',
      badge: 'From: sales@umrah360.in',
    },
    {
      step: 7,
      title: 'Email Thread & Conversation Created',
      desc: 'Thread thread-rahul-sharma and Conversation conv-rahul-sharma created before reply is received.',
      badge: 'Thread ID Assigned',
    },
    {
      step: 8,
      title: 'Prospect Replies: "What does it do?"',
      desc: 'Rahul replies: "Hi, can you explain what the software does? We manage packages across Delhi and Lucknow."',
      badge: 'Incoming Reply',
    },
    {
      step: 9,
      title: 'Identify Existing Thread & Contact',
      desc: 'System matches Message-ID and In-Reply-To headers to existing thread-rahul-sharma.',
      badge: 'Thread Reconstructed',
    },
    {
      step: 10,
      title: 'Retrieve Complete Context & RAG Knowledge',
      desc: 'Context retrieved: Cold email + Rahul reply + Contact Profile + Knowledge Doc "Umrah360 Architecture Overview".',
      badge: 'RAG Context Built',
    },
    {
      step: 11,
      title: 'Gemini Generates Grounded Reply',
      desc: 'Gemini generates concise, professional overview highlighting FIT packages, dynamic costing, and Saudi visas.',
      badge: 'Gemini 2.5 Flash',
    },
    {
      step: 12,
      title: 'AI Replies in the SAME Thread',
      desc: 'Auto-reply delivered preserving In-Reply-To header. AI confidence: 96%.',
      badge: 'Same Email Thread',
    },
    {
      step: 13,
      title: 'Prospect Replies: "Does it support B2B?"',
      desc: 'Rahul replies: "Does it support B2B agents? We have around 40 local sub-agents who book through us."',
      badge: 'B2B Inquiry',
    },
    {
      step: 14,
      title: 'AI Conversation Memory Verification',
      desc: 'Memory maintains: Delhi agency, 40 sub-agents, previously explained core ERP capabilities.',
      badge: 'Conversation Memory',
    },
    {
      step: 15,
      title: 'AI Answers from Knowledge Base',
      desc: 'AI explains B2B Sub-Agent Portal, custom markups, credit wallets, and instant white-label PDF vouchers.',
      badge: 'Knowledge Doc: B2B Portal',
    },
    {
      step: 16,
      title: 'Prospect Replies: "What is pricing for 20 users?"',
      desc: 'Rahul asks for pricing for a 20-seat team deployment.',
      badge: '20 Users Pricing Inquiry',
    },
    {
      step: 17,
      title: 'AI Checks Approved Pricing Knowledge',
      desc: 'Verified KB states: Starter ($199/mo, 3 users), Growth ($499/mo, 10 users). For 20+ users, custom enterprise quote is required. AI must NOT guess arbitrary numbers.',
      badge: 'Pricing Guardrail Triggered',
    },
    {
      step: 18,
      title: 'HUMAN HANDOFF TRIGGERED! (AI = OFF)',
      desc: 'AI states that 20-user Enterprise quotes require tailored volume assessment, hands off to Senior Solutions Specialist, and sets AI = OFF to prevent automated hallucination.',
      badge: 'AI = OFF • HUMAN_HANDOFF',
      isHandoff: true,
    },
    {
      step: 19,
      title: 'Centralized CRM Displays Complete Record',
      desc: 'CRM shows Rahul Sharma, ABC Travels, Source: Apollo, Type: OUTBOUND, Campaign: Indian Umrah Operators, Status: QUALIFIED, Full Email Thread visible, AI: OFF, Summary: Complete.',
      badge: 'CRM Complete 360',
      isFinal: true,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Sparkles className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">
              End-to-End Walkthroughs (Sections 72, 73, 74)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Interactive verification of the complete specification. Step through the exact 19-step
            outbound cold outreach flow from Apollo to Human Handoff, or verify WhatsApp & Inbound Email
            scenarios.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setActiveScenario('inbound')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center space-x-1.5 ${
              activeScenario === 'inbound'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Section 74: Inbound Email ({INBOUND_MAILBOX})</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>
          <button
            onClick={() => setActiveScenario('outbound')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeScenario === 'outbound'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Section 72: Apollo Outbound (19 Steps)
          </button>
          <button
            onClick={() => setActiveScenario('whatsapp')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeScenario === 'whatsapp'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Section 73: WhatsApp Inbound
          </button>
        </div>
      </div>

      {/* Scenario 1: Section 72 Apollo Outbound */}
      {activeScenario === 'outbound' && (
        <div className="space-y-6">
          {/* Step Progress Bar & Actions */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                  Outbound Lifecycle Progression
                </span>
                <h3 className="text-lg font-bold text-white mt-1">
                  Step {outboundStep} of 19:{' '}
                  {outboundSteps.find((s) => s.step === outboundStep)?.title}
                </h3>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setOutboundStep(1)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition flex items-center space-x-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restart Flow</span>
                </button>

                <button
                  onClick={() => setOutboundStep((prev) => Math.min(19, prev + 1))}
                  disabled={outboundStep === 19}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center space-x-1.5 shadow-md disabled:opacity-40"
                >
                  <span>Next Step ({outboundStep + 1}/19)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {outboundStep === 19 && (
                  <button
                    onClick={onNavigateToCrm}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition flex items-center space-x-1.5 shadow-md"
                  >
                    <span>View Rahul in CRM</span>
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Visual Step Timeline Scroller */}
            <div className="flex space-x-1.5 overflow-x-auto py-2 scrollbar-none">
              {outboundSteps.map((s) => (
                <button
                  key={s.step}
                  onClick={() => setOutboundStep(s.step)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition flex items-center space-x-1.5 ${
                    outboundStep === s.step
                      ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400'
                      : outboundStep > s.step
                      ? 'bg-slate-800 text-emerald-400'
                      : 'bg-slate-800/40 text-slate-500'
                  }`}
                >
                  <span>{s.step}</span>
                  {outboundStep > s.step && <CheckCircle2 className="w-3 h-3" />}
                </button>
              ))}
            </div>
          </div>

          {/* Current Step Spotlight Card */}
          {(() => {
            const current = outboundSteps.find((s) => s.step === outboundStep)!;
            return (
              <div
                className={`bg-slate-900 border rounded-xl p-6 shadow-xl space-y-4 ${
                  current.isHandoff
                    ? 'border-amber-500/80 bg-amber-950/20'
                    : current.isFinal
                    ? 'border-emerald-500/80 bg-emerald-950/20'
                    : 'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700">
                    {current.badge}
                  </span>

                  {current.isHandoff && (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center space-x-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>CRITICAL RULE: AI = OFF</span>
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-xl font-bold text-white">{current.title}</h4>
                  <p className="text-sm text-slate-300 mt-2 leading-relaxed max-w-4xl">
                    {current.desc}
                  </p>
                </div>

                {/* Scenario details inspection */}
                {outboundStep === 6 && (
                  <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 space-y-2">
                    <div className="text-slate-400">
                      Subject: Umrah360 for ABC Travels - Automate B2B Packages & Visa Operations
                    </div>
                    <div className="whitespace-pre-wrap text-[11px] leading-relaxed">
                      Hi Rahul,{'\n\n'}We work with Umrah operators across India to automate their
                      dynamic package costing, Makkah/Madinah room allotments, and sub-agent B2B
                      voucher distribution.{'\n\n'}Most operators we speak with were spending 15+
                      hours weekly updating manual spreadsheets. Umrah360 gives your agency an
                      automated B2B portal with live supplier costs.{'\n\n'}Would you be open to
                      exploring how this could streamline your upcoming season?
                    </div>
                  </div>
                )}

                {outboundStep === 18 && (
                  <div className="p-4 bg-amber-950/40 rounded-xl border border-amber-800/60 text-xs space-y-2 text-amber-200">
                    <div className="font-bold flex items-center space-x-1.5 text-amber-300">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Section 18 & 32 Compliance: Custom Enterprise Pricing</span>
                    </div>
                    <p className="text-xs leading-relaxed">
                      Rahul asked: &quot;What is the pricing for 20 users?&quot; Since 20+ users requires an
                      Enterprise plan with dedicated hosting and SLA guarantees, the AI does NOT
                      hallucinate or fabricate a price. It informs him of the custom volume quote,
                      assigns the conversation to a Senior Solutions Specialist, and immediately sets{' '}
                      <span className="font-bold underline">aiEnabled = false</span> and{' '}
                      <span className="font-bold underline">humanHandoff = true</span>.
                    </p>
                  </div>
                )}

                {outboundStep === 19 && (
                  <div className="p-4 bg-emerald-950/40 rounded-xl border border-emerald-800/60 text-xs space-y-2 text-emerald-200">
                    <div className="font-bold flex items-center space-x-1.5 text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Section 72 Step 19 Verified: Complete CRM Synchronization</span>
                    </div>
                    <ul className="space-y-1 text-xs text-emerald-100/90 list-disc list-inside">
                      <li>Contact: Rahul Sharma (Founder, ABC Travels)</li>
                      <li>Lead Source: APOLLO • Lead Type: OUTBOUND</li>
                      <li>Campaign: Indian Umrah Operators</li>
                      <li>Status: QUALIFIED • Lead Score: 89/100</li>
                      <li>Email Thread: Reconstructed and visible in Unified Inbox</li>
                      <li>AI Status: OFF (Human Takeover in Progress)</li>
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Scenario 2: Section 73 WhatsApp Inbound */}
      {activeScenario === 'whatsapp' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
          <div className="flex items-center space-x-2">
            <MessageCircle className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">
              Section 73: WhatsApp Inbound Lead Simulation
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Customer reaches out via WhatsApp Business API: &quot;Hi, I want to know about Umrah360&quot;.
          </p>

          <div className="space-y-3 pt-2">
            <div className="p-3 bg-slate-800 rounded-lg text-xs space-y-1 text-slate-200 max-w-lg">
              <span className="font-bold text-emerald-400 block">Customer (WhatsApp):</span>
              <p>&quot;Hi, I want to know about Umrah360 for my UK travel agency.&quot;</p>
            </div>

            <div className="p-3 bg-blue-950/80 rounded-lg text-xs space-y-1 text-blue-100 max-w-lg ml-auto border border-blue-800">
              <span className="font-bold text-blue-300 flex items-center space-x-1">
                <Bot className="w-3.5 h-3.5" />
                <span>Umrah360 AI (Grounded):</span>
              </span>
              <p>
                &quot;Umrah360 is an all-in-one cloud ERP and CRM platform purpose-built for Hajj and Umrah
                tour operators. It streamlines FIT package generation, Makkah/Madinah hotel room blocks,
                multi-currency invoicing, and B2B sub-agent distribution. Are you looking to upgrade from
                spreadsheets?&quot;
              </p>
            </div>

            <div className="p-3 bg-slate-800 rounded-lg text-xs space-y-1 text-slate-200 max-w-lg">
              <span className="font-bold text-emerald-400 block">Customer (WhatsApp):</span>
              <p>&quot;Can we calculate multi-currency exchange buffers between GBP and SAR?&quot;</p>
            </div>

            <div className="p-3 bg-blue-950/80 rounded-lg text-xs space-y-1 text-blue-100 max-w-lg ml-auto border border-blue-800">
              <span className="font-bold text-blue-300 flex items-center space-x-1">
                <Bot className="w-3.5 h-3.5" />
                <span>Umrah360 AI (Conversation Memory):</span>
              </span>
              <p>
                &quot;Yes! Our live Forex engine auto-converts supplier costs in Saudi Riyal (SAR) to British
                Pounds (GBP) with configurable hedge buffers, and outputs compliant VAT invoices. Would you
                like to see a sample itinerary and costing sheet?&quot;
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              onClick={onNavigateToInbox}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
            >
              Open Live in WhatsApp Inbox
            </button>
          </div>
        </div>
      )}

      {/* Scenario 3: Section 74 Inbound Email Flow (automation@amaavigo.com) */}
      {activeScenario === 'inbound' && (
        <div className="space-y-6">
          {/* Step Progress Bar & Actions */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-blue-400 font-bold">
                    Section 74 Inbound Mail Flow
                  </span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {INBOUND_MAILBOX}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mt-1">
                  Step {inboundStep} of {inboundSteps.length}: {inboundSteps[inboundStep - 1]?.title}
                </h3>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setInboundStep((prev) => Math.max(1, prev - 1))}
                  disabled={inboundStep === 1}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 text-xs font-semibold transition"
                >
                  Previous
                </button>
                <button
                  onClick={() => setInboundStep((prev) => Math.min(inboundSteps.length, prev + 1))}
                  disabled={inboundStep === inboundSteps.length}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 text-xs font-semibold transition flex items-center space-x-1"
                >
                  <span>Next Step</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setInboundStep(1)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                  title="Reset to Step 1"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Stepper Progress Indicator */}
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-2">
              {inboundSteps.map((s) => (
                <button
                  key={s.step}
                  onClick={() => setInboundStep(s.step)}
                  className={`h-2 rounded-full transition-all ${
                    s.step === inboundStep
                      ? 'bg-blue-400 ring-2 ring-blue-500/50'
                      : s.step < inboundStep
                      ? 'bg-emerald-500'
                      : 'bg-slate-800'
                  }`}
                  title={`Step ${s.step}: ${s.title}`}
                />
              ))}
            </div>
          </div>

          {/* Current Step Explanation & Visual Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {inboundSteps[inboundStep - 1]?.badge}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                Pipeline Stage {inboundStep} / {inboundSteps.length}
              </span>
            </div>

            <p className="text-sm text-slate-200 leading-relaxed font-sans">
              {inboundSteps[inboundStep - 1]?.desc}
            </p>

            {/* Step specific interactive previews */}
            {inboundStep === 1 && (
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2 font-mono">
                <div className="text-slate-400">
                  <span className="text-slate-600">To:</span> {INBOUND_MAILBOX}
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-600">From:</span> Tariq Khan &lt;tariq@albarakatours.com&gt;
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-600">Subject:</span> Inquiry: B2B Sub-Agent Portal & Hotel Allotments for Umrah 2026
                </div>
                <div className="pt-2 text-slate-300 font-sans border-t border-slate-800/80 whitespace-pre-wrap">
                  Assalamu Alaikum,{'\n\n'}We are a wholesale tour operator based in Mumbai with 35 sub-agents across Maharashtra. Does Umrah360 provide a white-label B2B sub-agent portal where our agents can issue branded vouchers with their own agency logo and credit wallets? Also, can we upload our own offline negotiated Makkah hotel allotments with blackout dates?{'\n\n'}Regards,{'\n'}Tariq Khan (MD, Al Baraka Tours)
                </div>
              </div>
            )}

            {inboundStep === 2 && (
              <div className="p-4 bg-emerald-950/40 rounded-xl border border-emerald-800/60 text-xs space-y-2 text-emerald-200">
                <div className="font-bold flex items-center space-x-1.5 text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Duplicate Contact Algorithm: Zero Loss of History</span>
                </div>
                <p className="text-xs leading-relaxed text-emerald-100">
                  The system scans existing contacts using email exact match (tariq@albarakatours.com) and phone number normalization. If the contact already exists, it preserves the contact ID and enriches the record. If it is new, it generates a contact profile and establishes the audit timeline.
                </p>
              </div>
            )}

            {inboundStep === 6 && (
              <div className="p-4 bg-blue-950/40 rounded-xl border border-blue-800/60 text-xs space-y-2 text-blue-200">
                <div className="font-bold flex items-center space-x-1.5 text-blue-300">
                  <ShieldCheck className="w-4 h-4" />
                  <span>RAG Knowledge Grounding & Human Handoff Guardrails</span>
                </div>
                <p className="text-xs leading-relaxed text-blue-100">
                  Query parsed: &quot;B2B sub-agent portal, custom markups, hotel allotments&quot;. Retrieved approved knowledge doc: <strong>B2B Sub-Agent Portal & Reseller Distribution Engine</strong>. Checked pricing guardrail: inquiry is for sub-agent management, not enterprise 20+ seats. Auto-reply generated with 96% confidence score.
                </p>
              </div>
            )}

            {inboundStep === 7 && (
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-emerald-400 flex items-center space-x-1.5">
                    <Bot className="w-4 h-4" />
                    <span>Dispatched AI Reply (From: {INBOUND_MAILBOX})</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    Header: In-Reply-To preserved
                  </span>
                </div>
                <div className="text-slate-300 whitespace-pre-wrap font-sans">
                  Assalamu Alaikum Tariq,{'\n\n'}Thank you for contacting Umrah360!{'\n\n'}Yes, Umrah360 provides a complete white-label B2B Sub-Agent Portal built specifically for tour operators like Al Baraka Tours & Travels. With the B2B portal, you can:{'\n'}• Set custom markup & commission tiers per sub-agent category{'\n'}• Manage live credit limits, wallets, and ledger deposits{'\n'}• Allow sub-agents to search contracted inventory and instantly issue branded PDF vouchers with their own agency logo{'\n'}• Upload custom negotiated hotel blocks and transport contracts with blackout dates alongside online inventory{'\n\n'}Would you like to schedule a 15-minute live platform walkthrough to see how sub-agent allotments and credit limits are managed?{'\n\n'}Regards,{'\n'}Umrah360 Automation Team{'\n'}automation@amaavigo.com
                </div>
              </div>
            )}

            {inboundStep === 8 && (
              <div className="p-4 bg-emerald-950/40 rounded-xl border border-emerald-800/60 text-xs space-y-3 text-emerald-200">
                <div className="font-bold flex items-center space-x-1.5 text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Complete Inbound Email Flow Verified & Synchronized</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-emerald-100 text-xs">
                  <div>• Contact: Tariq Khan (Al Baraka Tours)</div>
                  <div>• Lead Source: EMAIL (INBOUND)</div>
                  <div>• Lead Score: 88/100 (HIGH Intent)</div>
                  <div>• Buying Stage: CONSIDERATION</div>
                  <div>• In-Reply-To Threading: Preserved in SAME thread</div>
                  <div>• Memory: Sub-agent portal & Makkah allotments logged</div>
                </div>

                <div className="flex items-center space-x-3 pt-2">
                  <button
                    onClick={onNavigateToInbox}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
                  >
                    Open in Unified Inbox
                  </button>
                  <button
                    onClick={onNavigateToCrm}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
                  >
                    View in CRM Pipeline
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Live Inbound Mail Simulator Widget */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Send className="w-4 h-4 text-blue-400" />
                <h4 className="font-bold text-white text-sm">
                  Run Live Inbound Email Test to {INBOUND_MAILBOX}
                </h4>
              </div>
              <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Live Listener</span>
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Select any real-world pilgrimage tour operator inquiry and click &quot;Dispatch Inbound Email&quot; to execute the live 8-step pipeline with real AI response and CRM synchronization.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {PRESET_INBOUND_EMAILS.map((preset, idx) => (
                <button
                  key={preset.id}
                  onClick={() => setSelectedPresetIndex(idx)}
                  className={`p-3 rounded-xl border text-left transition ${
                    selectedPresetIndex === idx
                      ? 'bg-blue-950/40 border-blue-500/60 ring-1 ring-blue-500/40'
                      : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 inline-block mb-1">
                    {preset.badge}
                  </div>
                  <h5 className="font-bold text-white text-xs mt-1">{preset.label}</h5>
                  <p className="text-slate-400 text-[11px] mt-1 line-clamp-2">{preset.description}</p>
                </button>
              ))}
            </div>

            <div className="pt-2 flex items-center justify-between">
              <div className="text-xs text-slate-400 font-mono">
                Selected: {PRESET_INBOUND_EMAILS[selectedPresetIndex]?.payload.from} → {INBOUND_MAILBOX}
              </div>

              <button
                onClick={async () => {
                  if (!onProcessInboundEmail) return;
                  setIsExecutingLive(true);
                  setLiveResult(null);
                  try {
                    const payload = PRESET_INBOUND_EMAILS[selectedPresetIndex].payload;
                    const res = await onProcessInboundEmail(payload);
                    setLiveResult(res);

                    // Also dispatch live SMTP reply via backend endpoint
                    try {
                      await fetch('/api/inbound/email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                    } catch (e) {
                      console.warn('Backend SMTP trigger warning:', e);
                    }
                  } catch (err) {
                    console.error('Inbound execution error:', err);
                  } finally {
                    setIsExecutingLive(false);
                  }
                }}
                disabled={isExecutingLive}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition flex items-center space-x-2 shadow-lg disabled:opacity-50"
              >
                {isExecutingLive ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing Inbound Mail Flow...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Inbound Email</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Result Card */}
            {liveResult && (
              <div className="mt-4 p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-white text-xs flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Inbound Mail Flow Execution Complete</span>
                  </span>
                  {liveResult.humanHandoffTriggered ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Human Takeover Triggered
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      AI Auto-Replied (In-Reply-To preserved)
                    </span>
                  )}
                </div>

                <div className="text-xs space-y-1 text-slate-300">
                  <div>
                    <span className="text-slate-500">Contact:</span> <strong className="text-white">{liveResult.contact.firstName} {liveResult.contact.lastName}</strong> ({liveResult.contact.companyName})
                  </div>
                  <div>
                    <span className="text-slate-500">Lead Score:</span> <strong className="text-emerald-400">{liveResult.lead.leadScore}/100</strong> • Stage: {liveResult.lead.buyingStage}
                  </div>
                  <div className="pt-2 text-slate-300 whitespace-pre-wrap bg-slate-900 p-3 rounded-lg border border-slate-800 text-[11px] font-sans">
                    {liveResult.aiReplyMessage?.text}
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    onClick={() => {
                      if (onNavigateToThread && liveResult.conversation) {
                        onNavigateToThread(liveResult.conversation.conversationId);
                      } else {
                        onNavigateToInbox();
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition flex items-center space-x-1.5"
                  >
                    <Inbox className="w-3.5 h-3.5" />
                    <span>Open in Unified Inbox</span>
                  </button>
                  <button
                    onClick={() => {
                      if (onNavigateToCrmLead && liveResult.lead) {
                        onNavigateToCrmLead(liveResult.lead.leadId);
                      } else {
                        onNavigateToCrm();
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center space-x-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Inspect in CRM</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
