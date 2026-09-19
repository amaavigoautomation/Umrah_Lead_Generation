import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  ShieldCheck,
  AlertTriangle,
  Play,
  Copy,
  Check,
  Sliders,
  Code,
  Flame,
} from 'lucide-react';
import { Channel, KnowledgeDocument, Contact, Lead, Conversation } from '../types';
import { generateOmnichannelResponse } from '../services/aiService';

interface AiTestingPlaygroundProps {
  knowledgeDocs: KnowledgeDocument[];
}

export const AiTestingPlayground: React.FC<AiTestingPlaygroundProps> = ({ knowledgeDocs }) => {
  const [selectedChannel, setSelectedChannel] = useState<Channel>('EMAIL');
  const [customerMessage, setCustomerMessage] = useState<string>(
    'What is the pricing for 20 users? Does it include the B2B agent portal?'
  );
  const [prospectName, setProspectName] = useState<string>('Rahul Sharma');
  const [companyName, setCompanyName] = useState<string>('ABC Travels');
  const [jobTitle, setJobTitle] = useState<string>('Founder');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationResult, setEvaluationResult] = useState<any>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Preset quick scenarios
  const presets = [
    {
      label: 'Pricing for 20 Users (Triggers Human Handoff)',
      channel: 'EMAIL' as Channel,
      message: 'What is the pricing for 20 users? Does it include the B2B agent portal?',
    },
    {
      label: 'B2B Sub-Agent Capability Question',
      channel: 'WHATSAPP' as Channel,
      message: 'Does Umrah360 support B2B sub-agents with white-label PDF vouchers and wallet credits?',
    },
    {
      label: 'Dynamic Package Builder Inquiry',
      channel: 'WEBSITE' as Channel,
      message: 'Can we build custom day-by-day itineraries with Makkah Clock tower hotels and Haramain trains?',
    },
    {
      label: 'Unsubscribe / Stop Outreach',
      channel: 'EMAIL' as Channel,
      message: 'Please unsubscribe me and stop emailing.',
    },
    {
      label: 'Dissatisfied / Complaint Escalation',
      channel: 'INSTAGRAM' as Channel,
      message: 'I am unhappy with the delayed response from your team, I need to talk to a manager immediately.',
    },
  ];

  const handleRunTest = async () => {
    if (!customerMessage.trim()) return;
    setIsEvaluating(true);

    const mockContact: Contact = {
      contactId: 'test-contact',
      firstName: prospectName.split(' ')[0] || 'Rahul',
      lastName: prospectName.split(' ')[1] || 'Sharma',
      email: 'rahul@abctravels.in',
      companyName,
      jobTitle,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    const mockLead: Lead = {
      leadId: 'test-lead',
      contactId: 'test-contact',
      source: selectedChannel === 'EMAIL' ? 'APOLLO' : 'WHATSAPP',
      leadType: selectedChannel === 'EMAIL' ? 'OUTBOUND' : 'INBOUND',
      status: 'ENGAGED',
      leadScore: 78,
      intent: 'HIGH',
      buyingStage: 'CONSIDERATION',
      requirements: ['B2B Sub-Agents'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    const mockConv: Conversation = {
      conversationId: 'test-conv',
      contactId: 'test-contact',
      channel: selectedChannel,
      direction: 'INBOUND',
      status: 'ACTIVE',
      aiEnabled: true,
      humanHandoff: false,
      startedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const result = await generateOmnichannelResponse({
        incomingMessage: customerMessage,
        contact: mockContact,
        lead: mockLead,
        conversation: mockConv,
        recentMessages: [],
        knowledgeDocs,
      });

      setEvaluationResult(result);
    } catch (err) {
      console.error('Test simulation error:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Title & Scope */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">Section 59: AI Testing & Evaluation Sandbox</h2>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Simulate any incoming customer prompt or reply across channels. Inspect the Gemini generated response,
          intent classification, lead score, grounded RAG chunks, and human handoff determination{' '}
          <span className="text-white font-semibold">WITHOUT sending anything to real customers.</span>
        </p>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-800">
          <span className="text-[11px] text-slate-400 self-center mr-1">Quick Presets:</span>
          {presets.map((p, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCustomerMessage(p.message);
                setSelectedChannel(p.channel);
              }}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid: Test Input vs Evaluation Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Simulation Inputs */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <h3 className="font-semibold text-sm text-white flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Simulation Parameters</span>
          </h3>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Contact Name</label>
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Company</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Channel</label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value as Channel)}
                className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
              >
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="LINKEDIN">LinkedIn</option>
                <option value="WEBSITE">Website</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-slate-400 text-xs block mb-1 font-medium">
              Simulated Customer Message
            </label>
            <textarea
              rows={4}
              value={customerMessage}
              onChange={(e) => setCustomerMessage(e.target.value)}
              placeholder="Enter customer message to test..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 leading-relaxed resize-none focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            onClick={handleRunTest}
            disabled={isEvaluating || !customerMessage.trim()}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center justify-center space-x-2 shadow-md disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            <span>{isEvaluating ? 'Evaluating with Gemini 2.5 Flash...' : 'Execute AI Test'}</span>
          </button>
        </div>

        {/* Right Column: AI Output & Qualification Output */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-semibold text-sm text-white flex items-center space-x-2">
              <Bot className="w-4 h-4 text-blue-400" />
              <span>Evaluated AI Output (Sandbox Mode)</span>
            </h3>

            {evaluationResult && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(evaluationResult.responseText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-slate-400 hover:text-white text-xs flex items-center space-x-1"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>

          {evaluationResult ? (
            <div className="space-y-4 flex-1 flex flex-col">
              {/* Human Handoff Status Banner */}
              {evaluationResult.humanHandoffTriggered ? (
                <div className="p-3.5 bg-amber-950/60 border border-amber-800/80 rounded-lg text-amber-200 text-xs flex items-start space-x-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold block text-amber-300">
                      HUMAN HANDOFF TRIGGERED (AI = OFF)
                    </span>
                    <span className="text-[11px] text-amber-300/90">
                      Reason: {evaluationResult.handoffReason || 'Pricing for 20+ users / Enterprise volume required'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-emerald-200 text-xs flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="font-medium">
                    AI Auto-Reply Approved (Grounded in Verified Knowledge Base)
                  </span>
                </div>
              )}

              {/* Generated Response Text */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs leading-relaxed text-slate-100 whitespace-pre-wrap flex-1">
                {evaluationResult.responseText}
              </div>

              {/* Structured JSON Qualification (Section 33) */}
              <div className="p-3.5 bg-slate-800/80 rounded-xl border border-slate-700/80 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center space-x-1">
                    <Code className="w-3.5 h-3.5 text-purple-400" />
                    <span>Lead Qualification JSON (Section 33)</span>
                  </span>
                  <div className="flex items-center space-x-1 text-emerald-400 font-bold">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>Score: {evaluationResult.leadQualification.leadScore}/100</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-300">
                  <div>
                    <span className="text-slate-500">Intent: </span>
                    <span className="font-bold text-emerald-400">
                      {evaluationResult.leadQualification.intent}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Stage: </span>
                    <span className="font-medium text-slate-200">
                      {evaluationResult.leadQualification.buyingStage}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">Next Action: </span>
                    <span className="text-slate-200">
                      {evaluationResult.leadQualification.nextAction}
                    </span>
                  </div>
                </div>

                {evaluationResult.knowledgeSources && evaluationResult.knowledgeSources.length > 0 && (
                  <div className="pt-2 border-t border-slate-700/60 text-[10px] text-blue-300">
                    <span className="text-slate-400">Knowledge Sources: </span>
                    {evaluationResult.knowledgeSources.join(', ')}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center p-8 text-slate-500 text-xs">
              Click &quot;Execute AI Test&quot; to inspect real-time response generation, RAG sources, and lead scoring.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
