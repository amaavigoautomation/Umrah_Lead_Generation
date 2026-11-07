import React, { useCallback, useEffect, useState } from 'react';
import { useBrand } from '../context/BrandContext';
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
  Save,
  RefreshCw,
  Trash2,
  Edit3,
  CheckCircle2,
  X,
  MessageSquarePlus,
} from 'lucide-react';
import { Channel, KnowledgeDocument, Contact, Lead, Conversation } from '../types';
import { authFetch } from '../services/authService';

interface AiTestingPlaygroundProps {
  knowledgeDocs: KnowledgeDocument[];
}

interface AiFeedbackItem {
  feedbackId: string;
  channel: Channel;
  category: 'STYLE' | 'LENGTH' | 'MISSING_INFO' | 'FACTUAL' | 'FORMAT' | 'OTHER';
  scope: 'SIMILAR' | 'CHANNEL';
  instruction: string;
  exampleQuestion?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdByName?: string;
  updatedAt?: string;
}

export const AiTestingPlayground: React.FC<AiTestingPlaygroundProps> = () => {
  const [selectedChannel, setSelectedChannel] = useState<Channel>('EMAIL');
  const { brand } = useBrand();
  const isUmrah = brand.playbook === 'umrah360';
  const [customerMessage, setCustomerMessage] = useState<string>(
    isUmrah ? 'What is the pricing for 20 users? Does it include the B2B agent portal?' : `What does ${brand.companyName} offer and how much does it cost?`
  );
  const [prospectName, setProspectName] = useState<string>('Rahul Sharma');
  const [companyName, setCompanyName] = useState<string>(isUmrah ? 'ABC Travels' : 'Example Co.');
  const [jobTitle, setJobTitle] = useState<string>('Founder');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationResult, setEvaluationResult] = useState<any>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [feedbackItems, setFeedbackItems] = useState<AiFeedbackItem[]>([]);
  const [feedbackCategory, setFeedbackCategory] = useState<AiFeedbackItem['category']>('STYLE');
  const [feedbackScope, setFeedbackScope] = useState<AiFeedbackItem['scope']>('SIMILAR');
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [editingFeedbackId, setEditingFeedbackId] = useState<string | null>(null);
  const [isSavingFeedback, setIsSavingFeedback] = useState<boolean>(false);
  const [feedbackError, setFeedbackError] = useState<string>('');
  const [feedbackNotice, setFeedbackNotice] = useState<string>('');
  const [testError, setTestError] = useState<string>('');

  // Preset quick scenarios
  const presets = [
    {
      label: isUmrah ? 'Pricing for 20 Users (Triggers Human Handoff)' : 'Pricing Question',
      channel: 'EMAIL' as Channel,
      message: isUmrah ? 'What is the pricing for 20 users? Does it include the B2B agent portal?' : `What are the pricing options for ${brand.companyName}?`,
    },
    {
      label: isUmrah ? 'B2B Sub-Agent Capability Question' : 'Product Capability Question',
      channel: 'WHATSAPP' as Channel,
      message: isUmrah ? 'Does Umrah360 support B2B sub-agents with white-label PDF vouchers and wallet credits?' : `What can ${brand.companyName} do for my business?`,
    },
    {
      label: isUmrah ? 'Dynamic Package Builder Inquiry' : 'Setup & Onboarding Inquiry',
      channel: 'WEBSITE' as Channel,
      message: isUmrah ? 'Can we build custom day-by-day itineraries with Makkah Clock tower hotels and Haramain trains?' : 'How long does onboarding take and what support do you provide?',
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
      source: selectedChannel,
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
      const response = await authFetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: customerMessage,
          contact: mockContact,
          lead: mockLead,
          conversation: mockConv,
        }),
      });
      const result = await response.json();
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || 'AI test generation failed.');
      }

      setEvaluationResult(result);
      setTestError('');
    } catch (err: any) {
      console.error('Test simulation error:', err);
      setTestError(err?.message || 'Could not run the AI test. Please try again.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const refreshFeedback = useCallback(async () => {
    try {
      const response = await authFetch('/api/ai/feedback');
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Could not load saved feedback.');
      }
      setFeedbackItems(Array.isArray(payload.feedback) ? payload.feedback : []);
      setFeedbackError('');
    } catch (error: any) {
      setFeedbackError(error?.message || 'Could not load saved feedback.');
    }
  }, []);

  useEffect(() => {
    void refreshFeedback();
  }, [refreshFeedback]);

  const handleSaveFeedback = async (regenerate: boolean) => {
    if (!feedbackText.trim()) {
      setFeedbackError('Enter an instruction before saving feedback.');
      return;
    }
    setIsSavingFeedback(true);
    setFeedbackError('');
    setFeedbackNotice('');
    try {
      const isEditing = Boolean(editingFeedbackId);
      const response = await authFetch(isEditing ? '/api/ai/feedback/' + editingFeedbackId : '/api/ai/feedback', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: selectedChannel,
          category: feedbackCategory,
          scope: feedbackScope,
          instruction: feedbackText.trim(),
          exampleQuestion: customerMessage,
          status: 'ACTIVE',
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Could not save feedback.');
      }
      setFeedbackText('');
      setEditingFeedbackId(null);
      setFeedbackNotice(isEditing ? 'Feedback updated and available to matching live responses.' : 'Feedback saved and available to matching live responses.');
      await refreshFeedback();
      if (regenerate) await handleRunTest();
    } catch (error: any) {
      setFeedbackError(error?.message || 'Could not save feedback.');
    } finally {
      setIsSavingFeedback(false);
    }
  };

  const handleEditFeedback = (item: AiFeedbackItem) => {
    setEditingFeedbackId(item.feedbackId);
    setFeedbackCategory(item.category);
    setFeedbackScope(item.scope);
    setFeedbackText(item.instruction);
    setFeedbackError('');
    setFeedbackNotice('Editing saved feedback for ' + item.channel + '.');
  };

  const handleToggleFeedback = async (item: AiFeedbackItem) => {
    try {
      const response = await authFetch('/api/ai/feedback/' + item.feedbackId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Could not update feedback status.');
      await refreshFeedback();
    } catch (error: any) {
      setFeedbackError(error?.message || 'Could not update feedback status.');
    }
  };

  const handleDeleteFeedback = async (item: AiFeedbackItem) => {
    try {
      const response = await authFetch('/api/ai/feedback/' + item.feedbackId, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Could not delete feedback.');
      if (editingFeedbackId === item.feedbackId) {
        setEditingFeedbackId(null);
        setFeedbackText('');
      }
      await refreshFeedback();
    } catch (error: any) {
      setFeedbackError(error?.message || 'Could not delete feedback.');
    }
  };

  const channelFeedback = feedbackItems.filter((item) => item.channel === selectedChannel);

  return (
    <div data-umrah360-module="playground" className="max-w-7xl mx-auto p-4 space-y-6 font-sans">
      {/* Title & Scope */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-6 h-6 text-orange-500" />
          <h2 className="text-xl font-extrabold text-slate-900">AI Testing & Evaluation Sandbox</h2>
        </div>
        <p className="text-xs text-slate-500 mt-1 max-w-3xl font-medium">
          Simulate any incoming customer prompt or reply across channels. Inspect the Gemini generated response,
          intent classification, lead score, grounded RAG chunks, and human handoff determination{' '}
          <span className="text-slate-900 font-bold">WITHOUT sending anything to real customers.</span>
        </p>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
          <span className="text-[11px] text-slate-500 font-bold self-center mr-1">Quick Presets:</span>
          {presets.map((p, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCustomerMessage(p.message);
                setSelectedChannel(p.channel);
              }}
              className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200 text-slate-700 text-xs font-semibold border border-slate-200 transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid: Test Input vs Evaluation Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Simulation Inputs */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="font-extrabold text-sm text-slate-900 flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-orange-500" />
            <span>Simulation Parameters</span>
          </h3>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <label className="text-slate-700 font-bold block mb-1">Contact Name</label>
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-medium focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-slate-700 font-bold block mb-1">Company</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-medium focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-slate-700 font-bold block mb-1">Channel</label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value as Channel)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-bold focus:outline-none focus:border-orange-500"
              >
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="FACEBOOK">Facebook Messenger</option>
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
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 font-medium leading-relaxed resize-none focus:outline-none focus:border-orange-500"
            />
          </div>

          {testError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{testError}</div>}

          <button
            onClick={handleRunTest}
            disabled={isEvaluating || !customerMessage.trim()}
            className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs transition flex items-center justify-center space-x-2 shadow-md shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-4 h-4" />
            <span>{isEvaluating ? 'Evaluating with OpenAI (gpt-4o-mini)...' : 'Execute AI Test'}</span>
          </button>
        </div>

        {/* Right Column: AI Output & Qualification Output */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center space-x-2">
              <Bot className="w-4 h-4 text-orange-500" />
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

              {typeof evaluationResult.feedbackAppliedCount === 'number' && evaluationResult.feedbackAppliedCount > 0 && (
                <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-800/50 rounded-lg px-3 py-2">
                  {evaluationResult.feedbackAppliedCount} saved feedback instruction(s) were applied to this test.
                </div>
              )}


              {/* Persistent AI Feedback */}
              <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                      <MessageSquarePlus className="w-4 h-4 text-orange-600" />
                      Improve future AI responses
                    </h4>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Saved feedback can guide this workspace's live {selectedChannel.toLowerCase()} responses when relevant.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-orange-700 bg-orange-100 rounded-full px-2 py-1">
                    {channelFeedback.filter((item) => item.status === 'ACTIVE').length} active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Feedback category</label>
                    <select value={feedbackCategory} onChange={(e) => setFeedbackCategory(e.target.value as AiFeedbackItem['category'])}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
                      <option value="STYLE">Style and tone</option>
                      <option value="LENGTH">Response length</option>
                      <option value="MISSING_INFO">Missing information</option>
                      <option value="FACTUAL">Factual correction (verify in Knowledge Base)</option>
                      <option value="FORMAT">Channel formatting</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Apply this feedback to</label>
                    <select value={feedbackScope} onChange={(e) => setFeedbackScope(e.target.value as AiFeedbackItem['scope'])}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
                      <option value="SIMILAR">Similar questions in this channel</option>
                      <option value="CHANNEL">All future responses in this channel</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">What should the AI do differently?</label>
                  <textarea rows={3} value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Example: For pricing emails, keep the reply concise, explain the relevant plans and inclusions, and avoid adding unsupported prices."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-orange-400" />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Keep factual corrections in the approved Knowledge Base. Feedback changes response guidance, not company facts or safety rules.
                  </p>
                </div>

                {feedbackError && <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{feedbackError}</p>}
                {feedbackNotice && <p className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{feedbackNotice}</p>}

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleSaveFeedback(false)} disabled={isSavingFeedback || !feedbackText.trim()}
                    className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-white px-3 py-2 text-xs font-bold text-orange-800 hover:bg-orange-100 disabled:opacity-50">
                    <Save className="w-3.5 h-3.5" />{isSavingFeedback ? 'Saving...' : editingFeedbackId ? 'Update feedback' : 'Save feedback'}
                  </button>
                  <button onClick={() => handleSaveFeedback(true)} disabled={isSavingFeedback || !feedbackText.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50">
                    <RefreshCw className="w-3.5 h-3.5" />Save & regenerate
                  </button>
                  {editingFeedbackId && (
                    <button onClick={() => { setEditingFeedbackId(null); setFeedbackText(''); }}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                      <X className="w-3.5 h-3.5" />Cancel edit
                    </button>
                  )}
                </div>

                <div className="border-t border-orange-200 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[11px] font-extrabold text-slate-800">Saved {selectedChannel} feedback</h5>
                    <button onClick={() => void refreshFeedback()} className="text-[10px] font-semibold text-orange-700 hover:underline">Refresh</button>
                  </div>
                  {channelFeedback.length === 0 ? (
                    <p className="text-[11px] text-slate-500">No feedback saved for this channel yet.</p>
                  ) : channelFeedback.map((item) => (
                    <div key={item.feedbackId} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-700">{item.category.replace('_', ' ')}</span>
                            <span className="text-[10px] text-slate-500">· {item.scope === 'CHANNEL' ? 'All channel responses' : 'Similar questions'}</span>
                            <span className={'text-[9px] font-bold rounded-full px-1.5 py-0.5 ' + (item.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                              {item.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap break-words">{item.instruction}</p>
                          {item.scope === 'SIMILAR' && item.exampleQuestion && (
                            <p className="text-[10px] text-slate-500 mt-1">Matched against: {item.exampleQuestion}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button onClick={() => handleEditFeedback(item)} className="text-[10px] font-bold text-blue-700 hover:underline inline-flex items-center gap-1">
                          <Edit3 className="w-3 h-3" />Edit
                        </button>
                        <button onClick={() => handleToggleFeedback(item)} className="text-[10px] font-bold text-slate-600 hover:underline">
                          {item.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => handleDeleteFeedback(item)} className="text-[10px] font-bold text-red-600 hover:underline inline-flex items-center gap-1">
                          <Trash2 className="w-3 h-3" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
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
