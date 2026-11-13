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
    <div data-umrah360-module="ai-testing" className="ai-testing-workspace">
      <header className="ai-testing-page-header">
        <div><div className="ai-testing-eyebrow">AI &amp; AUTOMATION / TEST ENVIRONMENT</div><h1>AI Testing</h1><p>Test and evaluate your AI agent with realistic customer scenarios before responses reach live conversations.</p></div>
        <div className="ai-testing-sandbox-badge"><ShieldCheck className="h-4 w-4" /><span>Sandbox mode · no live messages sent</span></div>
      </header>
      <div className="ai-testing-main-grid">
        <section className="ai-testing-card ai-testing-conversation-card">
          <div className="ai-testing-card-header">
            <div className="ai-testing-card-title"><span className="ai-testing-title-icon"><Bot className="h-4 w-4" /></span><div><h2>Test conversation</h2><p>Preview the customer message and generated AI response</p></div></div>
            <div className="ai-testing-card-actions">
              <span className="ai-testing-channel-pill">{selectedChannel.replace('_', ' ')}</span>
              {evaluationResult && <button type="button" onClick={() => { navigator.clipboard.writeText(evaluationResult.responseText || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="ai-testing-utility-button">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy response'}</button>}
            </div>
          </div>
          <div className="ai-testing-chat-history">
            <div className="ai-testing-chat-date">TEST SCENARIO · {prospectName || 'Prospect'} · {companyName || 'Company'}</div>
            <div className="ai-testing-user-message"><span className="ai-testing-message-author">{prospectName || 'Customer'}</span><p>{customerMessage || 'Enter a customer message to begin testing.'}</p></div>
            {evaluationResult ? (
              <div className="ai-testing-assistant-message">
                <div className="ai-testing-assistant-avatar"><Sparkles className="h-4 w-4" /></div>
                <div className="ai-testing-assistant-body">
                  {evaluationResult.humanHandoffTriggered ? <div className="ai-testing-result-banner handoff"><AlertTriangle className="h-4 w-4" /><div><strong>Human handoff triggered</strong><span>Reason: {evaluationResult.handoffReason || 'This request requires a team member.'}</span></div></div> : <div className="ai-testing-result-banner approved"><ShieldCheck className="h-4 w-4" /><span>AI auto-reply approved · grounded in workspace knowledge</span></div>}
                  <div className="ai-testing-response-text">{evaluationResult.responseText}</div>
                  {typeof evaluationResult.feedbackAppliedCount === 'number' && evaluationResult.feedbackAppliedCount > 0 && <div className="ai-testing-feedback-applied">{evaluationResult.feedbackAppliedCount} saved feedback instruction(s) applied to this test.</div>}
                </div>
              </div>
            ) : <div className="ai-testing-empty-state"><span><Sparkles className="h-5 w-5" /></span><strong>Your AI response will appear here</strong><p>Send a test message to inspect the generated reply, handoff decision and lead qualification.</p></div>}
            {testError && <div className="ai-testing-error" role="alert">{testError}</div>}
          </div>
          <div className="ai-testing-composer">
            <textarea rows={2} value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} placeholder="Type a customer message to test the AI agent…" />
            <button type="button" onClick={handleRunTest} disabled={isEvaluating || !customerMessage.trim()} className="ai-testing-run-button">{isEvaluating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{isEvaluating ? 'Running test…' : 'Run test'}</button>
          </div>
          <div className="ai-testing-conversation-footnote">Tests use the current workspace AI configuration and do not send messages to customers.</div>
        </section>
        <aside className="ai-testing-card ai-testing-settings-card">
          <div className="ai-testing-card-header">
            <div className="ai-testing-card-title"><span className="ai-testing-title-icon"><Sliders className="h-4 w-4" /></span><div><h2>Test settings</h2><p>Set the context for this simulation</p></div></div><span className="ai-testing-config-label">Configuration</span>
          </div>
          <div className="ai-testing-settings-fields">
            <label><span>Contact name</span><input type="text" value={prospectName} onChange={(event) => setProspectName(event.target.value)} placeholder="Customer name" /></label>
            <label><span>Company</span><input type="text" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Company or agency" /></label>
            <label><span>Job title</span><input type="text" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Role or designation" /></label>
            <label><span>Test channel</span><select value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value as Channel)}><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook Messenger</option><option value="LINKEDIN">LinkedIn</option><option value="WEBSITE">Website</option></select></label>
          </div>
          <div className="ai-testing-presets"><div className="ai-testing-section-label">Quick scenarios</div>
            <div className="ai-testing-preset-list">{presets.map((preset, index) => <button type="button" key={index} onClick={() => { setCustomerMessage(preset.message); setSelectedChannel(preset.channel); setTestError(''); }}>{preset.label}</button>)}</div>
          </div>
          <div className="ai-testing-config-note"><ShieldCheck className="h-4 w-4" /><span>Uses the current workspace knowledge, business rules and response safeguards configured for your live AI agent.</span></div>
        </aside>
      </div>
      {evaluationResult && (
        <div className="ai-testing-results-grid">
          <section className="ai-testing-card ai-testing-feedback-card">
            <div className="ai-testing-card-header"><div className="ai-testing-card-title"><span className="ai-testing-title-icon"><MessageSquarePlus className="h-4 w-4" /></span><div><h2>Improve future AI responses</h2><p>Saved feedback can guide relevant live {selectedChannel.toLowerCase()} responses.</p></div></div><span className="ai-testing-config-label">{channelFeedback.filter((item) => item.status === 'ACTIVE').length} active</span></div>
            <div className="ai-testing-feedback-form">
              <div className="ai-testing-feedback-fields">
                <label><span>Feedback category</span><select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value as AiFeedbackItem['category'])}><option value="STYLE">Style and tone</option><option value="LENGTH">Response length</option><option value="MISSING_INFO">Missing information</option><option value="FACTUAL">Factual correction (verify in Knowledge Base)</option><option value="FORMAT">Channel formatting</option><option value="OTHER">Other</option></select></label>
                <label><span>Apply this feedback to</span><select value={feedbackScope} onChange={(event) => setFeedbackScope(event.target.value as AiFeedbackItem['scope'])}><option value="SIMILAR">Similar questions in this channel</option><option value="CHANNEL">All future responses in this channel</option></select></label>
              </div>
              <label className="ai-testing-feedback-instruction"><span>What should the AI do differently?</span><textarea rows={3} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="Example: Keep pricing replies concise and only use verified plan details." /></label>
              <p className="ai-testing-helper-text">Factual corrections belong in the approved Knowledge Base. Feedback changes response guidance, not company facts or safety rules.</p>
              {feedbackError && <p className="ai-testing-error" role="alert">{feedbackError}</p>}
              {feedbackNotice && <p className="ai-testing-success"><CheckCircle2 className="h-3.5 w-3.5" />{feedbackNotice}</p>}
              <div className="ai-testing-feedback-actions">
                <button type="button" onClick={() => handleSaveFeedback(false)} disabled={isSavingFeedback || !feedbackText.trim()} className="ai-testing-secondary-button"><Save className="h-3.5 w-3.5" />{isSavingFeedback ? 'Saving…' : editingFeedbackId ? 'Update feedback' : 'Save feedback'}</button>
                <button type="button" onClick={() => handleSaveFeedback(true)} disabled={isSavingFeedback || !feedbackText.trim()} className="ai-testing-run-button"><RefreshCw className="h-3.5 w-3.5" />Save &amp; regenerate</button>
                {editingFeedbackId && <button type="button" onClick={() => { setEditingFeedbackId(null); setFeedbackText(''); }} className="ai-testing-text-button"><X className="h-3.5 w-3.5" />Cancel edit</button>}
              </div>
            </div>
            <div className="ai-testing-saved-feedback">
              <div className="ai-testing-saved-feedback-header"><strong>Saved {selectedChannel} feedback</strong><button type="button" onClick={() => void refreshFeedback()}>Refresh</button></div>
              {channelFeedback.length === 0 ? <p className="ai-testing-helper-text">No feedback saved for this channel yet.</p> : channelFeedback.map((item) => (
                <article key={item.feedbackId} className="ai-testing-saved-feedback-item">
                  <div className="ai-testing-saved-feedback-copy"><div className="ai-testing-feedback-meta"><strong>{item.category.replace('_', ' ')}</strong><span>{item.scope === 'CHANNEL' ? 'All channel responses' : 'Similar questions'}</span><em className={item.status === 'ACTIVE' ? 'is-active' : ''}>{item.status}</em></div><p>{item.instruction}</p>{item.scope === 'SIMILAR' && item.exampleQuestion && <small>Matched against: {item.exampleQuestion}</small>}</div>
                  <div className="ai-testing-saved-feedback-actions"><button type="button" onClick={() => handleEditFeedback(item)}><Edit3 className="h-3 w-3" />Edit</button><button type="button" onClick={() => handleToggleFeedback(item)}>{item.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button><button type="button" onClick={() => handleDeleteFeedback(item)}><Trash2 className="h-3 w-3" />Delete</button></div>
                </article>
              ))}
            </div>
          </section>
          <section className="ai-testing-card ai-testing-qualification-card">
            <div className="ai-testing-card-header"><div className="ai-testing-card-title"><span className="ai-testing-title-icon"><Code className="h-4 w-4" /></span><div><h2>Lead qualification</h2><p>Structured result from this sandbox run</p></div></div>{evaluationResult.leadQualification && <span className="ai-testing-score">Score {evaluationResult.leadQualification.leadScore}/100</span>}</div>
            {evaluationResult.leadQualification ? <div className="ai-testing-qualification-details"><div><span>Intent</span><strong>{evaluationResult.leadQualification.intent}</strong></div><div><span>Buying stage</span><strong>{evaluationResult.leadQualification.buyingStage}</strong></div><div className="ai-testing-next-action"><span>Next action</span><strong>{evaluationResult.leadQualification.nextAction}</strong></div></div> : <p className="ai-testing-helper-text">No structured qualification data was returned for this test.</p>}
            {evaluationResult.knowledgeSources && evaluationResult.knowledgeSources.length > 0 && <div className="ai-testing-knowledge-sources"><strong>Knowledge sources</strong><p>{evaluationResult.knowledgeSources.join(', ')}</p></div>}
          </section>
        </div>
      )}
    </div>  );
};
