import React, { useState } from 'react';
import {
  Search,
  Bot,
  User,
  Send,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  Mail,
  MessageCircle,
  Instagram,
  Facebook,
  Linkedin,
  Globe,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Building,
  UserCheck,
  Zap,
  Layers,
  Smartphone,
  Share2,
  X,
  MessageSquare,
  RefreshCw,
  Key,
  Settings,
  ExternalLink,
} from 'lucide-react';
import {
  Conversation,
  Message,
  Contact,
  Lead,
  Channel,
  KnowledgeDocument,
} from '../types';
import { generateOmnichannelResponse } from '../services/aiService';
import { InboundEmailFlowModal } from './InboundEmailFlowModal';
import { InboundWhatsAppFlowModal } from './InboundWhatsAppFlowModal';
import {
  InboundEmailPayload,
  InboundProcessingResult,
  INBOUND_MAILBOX,
} from '../services/emailInboundService';
import {
  InboundWhatsAppPayload,
  InboundWhatsAppProcessingResult,
  WHATSAPP_BUSINESS_NUMBER,
  WHATSAPP_BUSINESS_NUMBER_FORMATTED,
} from '../services/whatsappInboundService';

interface UnifiedInboxProps {
  conversations: Conversation[];
  messages: Message[];
  contacts: Contact[];
  leads: Lead[];
  knowledgeDocs: KnowledgeDocument[];
  onSendMessage: (conversationId: string, text: string, senderType: 'AGENT' | 'AI' | 'CUSTOMER' | 'PROSPECT') => void;
  onToggleAi: (conversationId: string, enabled: boolean) => void;
  onMarkAsRead?: (conversationId: string) => void;
  onApproveDraft?: (conversationId: string) => void;
  onUpdateLeadScore: (leadId: string, delta: number) => void;
  onViewLeadInCrm: (leadId: string) => void;
  onProcessInboundEmail?: (payload: InboundEmailPayload) => Promise<InboundProcessingResult>;
  onProcessInboundWhatsApp?: (payload: InboundWhatsAppPayload) => Promise<InboundWhatsAppProcessingResult>;
  onSyncNow?: () => void;
}

export const UnifiedInbox: React.FC<UnifiedInboxProps> = ({
  conversations,
  messages,
  contacts,
  leads,
  knowledgeDocs,
  onSendMessage,
  onToggleAi,
  onMarkAsRead,
  onApproveDraft,
  onUpdateLeadScore,
  onViewLeadInCrm,
  onProcessInboundEmail,
  onProcessInboundWhatsApp,
  onSyncNow,
}) => {
  const [selectedConversationId, setSelectedConversationId] = useState<string>(
    conversations[0]?.conversationId || ''
  );
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [replyText, setReplyText] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [isUnifiedAllPlatforms, setIsUnifiedAllPlatforms] = useState<boolean>(false);
  const [replyChannelOverride, setReplyChannelOverride] = useState<Channel | ''>('');
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [showInboundFlowModal, setShowInboundFlowModal] = useState<boolean>(false);
  const [showInboundWhatsAppModal, setShowInboundWhatsAppModal] = useState<boolean>(false);
  const [simulatedPlatform, setSimulatedPlatform] = useState<Channel>('WHATSAPP');
  const [simulatedText, setSimulatedText] = useState<string>('Hi, can you send us your B2B package cost breakdown for 5-star Makkah hotels?');

  // SMTP Configuration & Delivery State
  const [smtpStatus, setSmtpStatus] = useState<{
    configured: boolean;
    host: string;
    port: number;
    user: string;
    from: string;
    hasPassword: boolean;
  } | null>(null);
  const [showSmtpModal, setShowSmtpModal] = useState<boolean>(false);
  const [smtpHostInput, setSmtpHostInput] = useState<string>('smtp.gmail.com');
  const [smtpPortInput, setSmtpPortInput] = useState<number>(465);
  const [smtpUserInput, setSmtpUserInput] = useState<string>('amaavigo@gmail.com');
  const [smtpPassInput, setSmtpPassInput] = useState<string>('');
  const [smtpFromInput, setSmtpFromInput] = useState<string>('Umrah360 Automation <amaavigo@gmail.com>');
  const [isSavingSmtp, setIsSavingSmtp] = useState<boolean>(false);
  const [smtpSaveMessage, setSmtpSaveMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);

  // Fetch SMTP status on load
  const fetchSmtpConfig = async () => {
    try {
      const res = await fetch('/api/smtp/config');
      if (res.ok) {
        const data = await res.json();
        setSmtpStatus(data);
        if (data.host) setSmtpHostInput(data.host);
        if (data.port) setSmtpPortInput(data.port);
        if (data.user) setSmtpUserInput(data.user);
        if (data.from) setSmtpFromInput(data.from);
      }
    } catch {}
  };

  React.useEffect(() => {
    fetchSmtpConfig();
  }, []);

  // Save & Test SMTP credentials directly from Unified Inbox
  const handleSaveSmtpConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSmtp(true);
    setSmtpSaveMessage(null);
    try {
      const res = await fetch('/api/smtp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHostInput,
          port: smtpPortInput,
          user: smtpUserInput,
          pass: smtpPassInput,
          from: smtpFromInput,
        }),
      });
      let data: any = {};
      try {
        const rawText = await res.text();
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { error: `Server returned non-JSON response (${res.status})` };
      }

      if (res.ok && data.success) {
        // Now verify connection
        const verifyRes = await fetch('/api/smtp/verify', { method: 'POST' });
        let verifyData: any = {};
        try {
          const rawVerify = await verifyRes.text();
          verifyData = rawVerify ? JSON.parse(rawVerify) : {};
        } catch {
          verifyData = { error: `Verification failed (${verifyRes.status})` };
        }

        if (verifyRes.ok && verifyData.verified) {
          setSmtpSaveMessage({
            success: true,
            text: `SMTP Connected successfully to ${smtpHostInput}! Auto-retrying any pending outbound emails now...`,
          });
          // Auto retry any failed outbound messages in current active conversation
          const failedOutbound = activeMessages.filter(
            (m) => m.channel === 'EMAIL' && m.direction === 'OUTBOUND' && m.smtpStatus !== 'DELIVERED'
          );
          for (const m of failedOutbound) {
            await handleRetrySendEmail(m);
          }
        } else {
          setSmtpSaveMessage({
            success: false,
            text: `Settings saved, but connection test reported: ${verifyData.error || 'Check username & App Password'}`,
          });
        }
        fetchSmtpConfig();
        if (onSyncNow) {
          onSyncNow();
        }
      } else {
        setSmtpSaveMessage({
          success: false,
          text: data.error || 'Failed to save SMTP configuration',
        });
      }
    } catch (err: any) {
      setSmtpSaveMessage({
        success: false,
        text: err?.message || 'Network error saving SMTP config',
      });
    } finally {
      setIsSavingSmtp(false);
    }
  };

  // Retry sending an email message over SMTP
  const handleRetrySendEmail = async (msg: Message) => {
    const toEmail = activeContact.email || msg.emailMeta?.to || msg.senderEmail;
    if (!toEmail) return;
    setRetryingMessageId(msg.messageId);

    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject: msg.emailMeta?.subject || 'Re: Umrah360 Inquiry',
          text: msg.text,
          inReplyTo: msg.emailMeta?.inReplyTo,
          conversationId: msg.conversationId,
          senderName: msg.senderName || 'Umrah360 AI Automation',
        }),
      });
      let data: any = {};
      try {
        const rawText = await res.text();
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { error: `Server returned non-JSON response (${res.status})` };
      }

      if (res.ok && data.success) {
        msg.smtpStatus = 'DELIVERED';
        msg.smtpError = undefined;
        if (data.messageId) {
          msg.gmailMessageId = data.messageId;
          if (msg.emailMeta) msg.emailMeta.messageId = data.messageId;
        }
        if (onSyncNow) onSyncNow();
      } else {
        msg.smtpStatus = 'DELIVERY_FAILED';
        msg.smtpError = data.error || `Failed to dispatch via SMTP (HTTP ${res.status})`;
        setShowSmtpModal(true);
      }
    } catch (err: any) {
      msg.smtpStatus = 'DELIVERY_FAILED';
      msg.smtpError = err?.message || 'SMTP Network Failure';
    } finally {
      setRetryingMessageId(null);
    }
  };

  // Active conversation and linked objects
  const activeConversation =
    conversations.find((c) => c.conversationId === selectedConversationId) || conversations[0];
  const foundContact = contacts.find((c) => c.contactId === activeConversation?.contactId);
  const activeContact: Contact = foundContact || {
    contactId: activeConversation?.contactId || 'unknown',
    firstName: 'Tour',
    lastName: 'Operator',
    email: '',
    phone: '',
    companyName: 'Umrah Travel Agency',
    jobTitle: 'Tour Operator',
    tags: ['WEBSITE_DEMO_FORM'],
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const activeLead = leads.find((l) => l.leadId === activeConversation?.leadId);

  // All conversations for this active contact across different platforms (Section 55 Unified Customer View)
  const contactConversations = activeContact
    ? conversations.filter((c) => c.contactId === activeContact.contactId)
    : activeConversation ? [activeConversation] : [];

  // Messages to display: strictly sorted chronologically (customer email first, then reply, then followups)
  const getMsgTime = (m: Message) => new Date(m.sentAt || m.timestamp || m.createdAt || 0).getTime();
  const sortMsgs = (a: Message, b: Message) => {
    const diff = getMsgTime(a) - getMsgTime(b);
    if (diff !== 0) return diff;
    // Inbound customer message ordered before outbound reply if timestamp is identical
    if (a.direction === 'INBOUND' && b.direction === 'OUTBOUND') return -1;
    if (a.direction === 'OUTBOUND' && b.direction === 'INBOUND') return 1;
    return 0;
  };

  const activeMessages = messages
    .filter((m) => m.conversationId === activeConversation?.conversationId)
    .sort(sortMsgs);

  const unifiedAllMessages = activeContact
    ? messages
        .filter((m) => contactConversations.some((c) => c.conversationId === m.conversationId))
        .sort(sortMsgs)
    : activeMessages;

  const displayMessages = isUnifiedAllPlatforms ? unifiedAllMessages : activeMessages;

  // Helper for channel icon
  const renderChannelIcon = (channel: Channel, size = 4) => {
    const cls = `w-${size} h-${size}`;
    switch (channel) {
      case 'WHATSAPP':
        return <MessageCircle className={`${cls} text-emerald-500`} />;
      case 'EMAIL':
        return <Mail className={`${cls} text-blue-500`} />;
      case 'INSTAGRAM':
        return <Instagram className={`${cls} text-pink-500`} />;
      case 'FACEBOOK':
        return <Facebook className={`${cls} text-indigo-500`} />;
      case 'LINKEDIN':
        return <Linkedin className={`${cls} text-sky-600`} />;
      default:
        return <Globe className={`${cls} text-teal-500`} />;
    }
  };

  const getChannelColor = (channel: Channel) => {
    switch (channel) {
      case 'WHATSAPP':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'EMAIL':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'INSTAGRAM':
        return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
      case 'FACEBOOK':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
      case 'LINKEDIN':
        return 'bg-sky-500/20 text-sky-300 border-sky-500/30';
      default:
        return 'bg-teal-500/20 text-teal-300 border-teal-500/30';
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((conv) => {
    const contact = contacts.find((c) => c.contactId === conv.contactId);
    const lead = leads.find((l) => l.leadId === conv.leadId);

    // Channel filter
    if (channelFilter !== 'ALL' && conv.channel !== channelFilter) return false;

    // Status / Mode filter
    if (statusFilter === 'UNREAD' && !conv.unread && conv.isRead !== false && (conv.unreadCount || 0) === 0) return false;
    if (statusFilter === 'AI_ACTIVE' && !conv.aiEnabled) return false;
    if (statusFilter === 'HUMAN_HANDOFF' && !conv.humanHandoff) return false;
    if (statusFilter === 'HIGH_INTENT' && lead?.intent !== 'HIGH') return false;
    if (statusFilter === 'INBOUND' && conv.direction !== 'INBOUND') return false;
    if (statusFilter === 'OUTBOUND' && conv.direction !== 'OUTBOUND') return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = `${contact?.firstName} ${contact?.lastName}`.toLowerCase().includes(q);
      const matchCompany = contact?.companyName?.toLowerCase().includes(q);
      const matchText = conv.lastMessageText?.toLowerCase().includes(q);
      if (!matchName && !matchCompany && !matchText) return false;
    }

    return true;
  }).sort((a, b) => {
    const timeA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  // Handle manual send
  const handleSendReply = () => {
    if (!replyText.trim() || !activeConversation) return;
    let targetConvId = activeConversation.conversationId;

    if (isUnifiedAllPlatforms && replyChannelOverride) {
      const matched = contactConversations.find((c) => c.channel === replyChannelOverride);
      if (matched) targetConvId = matched.conversationId;
    }

    onSendMessage(targetConvId, replyText, 'AGENT');
    setReplyText('');
  };

  // Handle simulating customer message on specific platform
  const handleSimulateInbound = () => {
    if (!simulatedText.trim()) return;
    const targetConv = contactConversations.find((c) => c.channel === simulatedPlatform) || activeConversation;
    if (!targetConv) return;
    onSendMessage(targetConv.conversationId, simulatedText, 'CUSTOMER');
    setShowSimulateModal(false);
  };

  // Handle AI Auto-generate button
  const handleAiAutoGenerate = async () => {
    if (!activeConversation || !activeContact) return;
    setIsGeneratingAi(true);

    try {
      const lastCustomerMsg = [...displayMessages]
        .reverse()
        .find((m) => m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT');

      const incomingText = lastCustomerMsg ? lastCustomerMsg.text : 'Can you provide more information regarding Umrah360?';

      const result = await generateOmnichannelResponse({
        incomingMessage: incomingText,
        contact: activeContact,
        lead: activeLead,
        conversation: activeConversation,
        recentMessages: displayMessages,
        knowledgeDocs,
      });

      setReplyText(result.responseText);
    } catch (error) {
      console.error('Error generating AI response:', error);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-8rem)] bg-white text-slate-900 overflow-hidden border border-slate-200/90 rounded-2xl m-2 sm:m-4 shadow-xl relative font-sans">
      {/* 1. LEFT COLUMN: Conversation List & Filters (Width: 340px) */}
      <div className="w-full lg:w-84 border-r border-slate-200 flex flex-col bg-slate-50/80">
        {/* Search Header */}
        <div className="p-3 border-b border-slate-200 bg-white space-y-2">
          {/* Live Inbound Mailbox & WhatsApp Triggers */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setShowInboundFlowModal(true)}
                className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100/80 border border-orange-200 text-orange-900 transition text-left group"
              >
                <div className="flex items-center space-x-2 truncate">
                  <Mail className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                  <div className="truncate">
                    <span className="text-[11px] font-bold block truncate">{INBOUND_MAILBOX}</span>
                  </div>
                </div>
                <span className="flex items-center space-x-1 text-[10px] text-orange-700 bg-orange-200/50 px-1.5 py-0.5 rounded-full shrink-0 border border-orange-300/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                  <span>Email</span>
                </span>
              </button>

              {onSyncNow && (
                <button
                  onClick={onSyncNow}
                  title="Sync Inbound Mailbox with Live Server"
                  className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                </button>
              )}
            </div>

            <button
              onClick={() => setShowInboundWhatsAppModal(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-900 transition text-left group"
            >
              <div className="flex items-center space-x-2 truncate">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <div className="truncate">
                  <span className="text-[11px] font-bold block truncate font-mono">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
                </div>
              </div>
              <span className="flex items-center space-x-1 text-[10px] text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-full shrink-0 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>WhatsApp Flow</span>
              </span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search conversations, contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition"
            />
          </div>

          {/* Channel Pills */}
          <div className="flex space-x-1 overflow-x-auto pb-1 scrollbar-none text-xs">
            {['ALL', 'EMAIL', 'WHATSAPP', 'INSTAGRAM', 'LINKEDIN'].map((ch) => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-2.5 py-1 rounded-lg whitespace-nowrap font-bold transition ${
                  channelFilter === ch
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Status Filters */}
          <div className="flex items-center space-x-1 text-[11px] overflow-x-auto pb-1">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2 py-0.5 rounded transition whitespace-nowrap ${
                statusFilter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({conversations.length})
            </button>
            <button
              onClick={() => setStatusFilter('UNREAD')}
              className={`px-2 py-0.5 rounded-md font-semibold transition whitespace-nowrap ${
                statusFilter === 'UNREAD' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Unread
            </button>
            <button
              onClick={() => setStatusFilter('AI_ACTIVE')}
              className={`px-2 py-0.5 rounded-md font-semibold transition whitespace-nowrap ${
                statusFilter === 'AI_ACTIVE' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              AI Active
            </button>
            <button
              onClick={() => setStatusFilter('HUMAN_HANDOFF')}
              className={`px-2 py-0.5 rounded-md font-semibold transition whitespace-nowrap ${
                statusFilter === 'HUMAN_HANDOFF'
                  ? 'bg-amber-500 text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Handoff
            </button>
            <button
              onClick={() => setStatusFilter('HIGH_INTENT')}
              className={`px-2 py-0.5 rounded-md font-semibold transition whitespace-nowrap ${
                statusFilter === 'HIGH_INTENT'
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              High Intent
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-medium">
              No conversations found matching filters.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const contact = contacts.find((c) => c.contactId === conv.contactId);
              const lead = leads.find((l) => l.leadId === conv.leadId);
              const isSelected = conv.conversationId === activeConversation?.conversationId;
              const isUnread = conv.unread || conv.isRead === false || ((conv.unreadCount || 0) > 0);
              const hasPendingDraft = conv.draftReply && conv.draftReply.status === 'PENDING';

              return (
                <div
                  key={conv.conversationId}
                  onClick={() => {
                    setSelectedConversationId(conv.conversationId);
                    setIsUnifiedAllPlatforms(false);
                    if (isUnread) {
                      onMarkAsRead?.(conv.conversationId);
                    }
                  }}
                  className={`p-3.5 cursor-pointer transition relative ${
                    isSelected
                      ? 'bg-orange-50/80 border-l-4 border-orange-500'
                      : isUnread
                      ? 'bg-slate-50 hover:bg-slate-100/80 font-bold'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      {renderChannelIcon(conv.channel, 4)}
                      <span className={`text-xs ${isUnread ? 'font-black text-slate-900' : 'font-bold text-slate-800'}`}>
                        {contact?.firstName} {contact?.lastName}
                      </span>
                      {isUnread && (
                        <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="Unread Message" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {new Date(conv.lastMessageAt || conv.createdAt || 0).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                    {contact?.companyName}
                  </p>

                  <p className={`text-xs mt-1 line-clamp-2 leading-relaxed ${isUnread ? 'text-slate-900 font-semibold' : 'text-slate-600'}`}>
                    {conv.lastMessageText || 'New conversation started'}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100 text-[10px]">
                    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                      {conv.direction === 'OUTBOUND' ? (
                        <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white font-bold">
                          Outbound
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold border border-orange-200">
                          Inbound
                        </span>
                      )}

                      {lead?.intent === 'HIGH' && (
                        <span className="px-2 py-0.5 rounded-full bg-orange-500 text-white font-bold">
                          High Intent
                        </span>
                      )}

                      {hasPendingDraft && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold border border-amber-200">
                          Draft Ready
                        </span>
                      )}

                      {conv.managementMode && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-[9px] border border-slate-200">
                          {conv.managementMode}
                        </span>
                      )}
                    </div>

                    <div>
                      {conv.humanHandoff ? (
                        <span className="flex items-center space-x-1 text-orange-600 font-bold">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Handoff</span>
                        </span>
                      ) : conv.aiEnabled ? (
                        <span className="flex items-center space-x-1 text-slate-900 font-bold">
                          <Bot className="w-3 h-3 text-orange-500" />
                          <span>AI On</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium">Manual</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 2. MIDDLE COLUMN: Conversation & Message Thread UI */}
      <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
        {/* Active Conversation Header */}
        {activeConversation && activeContact ? (
          <>
            <div className="p-3.5 border-b border-slate-200 bg-white flex items-center justify-between shadow-2xs">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                  {activeContact.firstName?.[0]}
                  {activeContact.lastName?.[0]}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-extrabold text-sm text-slate-900">
                      {activeContact.firstName} {activeContact.lastName}
                    </h3>
                    <div className="flex items-center space-x-1 text-xs text-slate-500 font-medium">
                      {renderChannelIcon(activeConversation.channel, 3.5)}
                      <span className="capitalize">{activeConversation.channel.toLowerCase()}</span>
                    </div>
                    {(activeLead?.demoStatus === 'BOOKED' || activeLead?.status === 'DEMO_BOOKED') && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-200 flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-orange-600" />
                        <span>Demo Booked</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    {activeContact.jobTitle || 'Decision Maker'} at{' '}
                    <span className="text-slate-900 font-bold">{activeContact.companyName}</span> •{' '}
                    {activeContact.email}
                  </p>
                </div>
              </div>

              {/* AI vs Human Takeover Toggle & SMTP Settings */}
              <div className="flex items-center space-x-2">
                {activeConversation.channel === 'EMAIL' && (
                  <button
                    onClick={() => setShowSmtpModal(true)}
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-bold border transition ${
                      smtpStatus?.configured
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-orange-500 text-white border-orange-500 animate-pulse'
                    }`}
                    title="Configure SMTP Delivery & Gmail App Password"
                  >
                    <Key className="w-3 h-3" />
                    <span>{smtpStatus?.configured ? 'SMTP Live' : 'Configure SMTP'}</span>
                  </button>
                )}

                {activeConversation.humanHandoff ? (
                  <button
                    onClick={() => onToggleAi(activeConversation.conversationId, true)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition shadow-xs"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Resume AI</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleAi(activeConversation.conversationId, false)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition shadow-xs"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Take Over (Human)</span>
                  </button>
                )}

                <div
                  className={`px-3 py-1 rounded-xl text-xs font-extrabold flex items-center space-x-1 border ${
                    activeConversation.aiEnabled && !activeConversation.humanHandoff
                      ? 'bg-orange-50 text-orange-700 border-orange-200'
                      : 'bg-slate-100 text-slate-800 border-slate-200'
                  }`}
                >
                  {activeConversation.aiEnabled && !activeConversation.humanHandoff ? (
                    <>
                      <Zap className="w-3.5 h-3.5 text-orange-500" />
                      <span>AI AUTO-REPLY ON</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-3.5 h-3.5 text-slate-700" />
                      <span>HUMAN MANAGED</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Omnichannel Platform Navigation Tabs */}
            <div className="px-3.5 py-2 bg-white border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto">
              <div className="flex items-center space-x-1.5 overflow-x-auto text-xs scrollbar-none">
                <span className="text-[11px] text-slate-500 font-bold mr-1 flex items-center space-x-1 whitespace-nowrap">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span>Platforms:</span>
                </span>

                {/* All Platforms Unified Stream Tab */}
                <button
                  onClick={() => setIsUnifiedAllPlatforms(true)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition whitespace-nowrap ${
                    isUnifiedAllPlatforms
                      ? 'bg-orange-500 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>All Platforms Stream</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                      isUnifiedAllPlatforms ? 'bg-white text-orange-600' : 'bg-slate-200 text-slate-800'
                    }`}
                  >
                    {unifiedAllMessages.length}
                  </span>
                </button>

                {/* Individual Platform Tabs for This Contact */}
                {contactConversations.map((conv) => {
                  const convMsgs = messages.filter((m) => m.conversationId === conv.conversationId);
                  const isSelected = !isUnifiedAllPlatforms && conv.conversationId === activeConversation?.conversationId;

                  return (
                    <button
                      key={conv.conversationId}
                      onClick={() => {
                        setIsUnifiedAllPlatforms(false);
                        setSelectedConversationId(conv.conversationId);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition whitespace-nowrap ${
                        isSelected
                          ? 'bg-orange-500 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {renderChannelIcon(conv.channel, 3.5)}
                      <span className="capitalize">{conv.channel.toLowerCase()}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                          isSelected ? 'bg-white text-orange-600' : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {convMsgs.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Simulate Inbound Button */}
              <button
                onClick={() => setShowSimulateModal(true)}
                className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-bold transition whitespace-nowrap"
                title="Simulate receiving an inbound message from another platform"
              >
                <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                <span>Simulate Inbound Platform Msg</span>
              </button>
            </div>

            {/* Email Metadata banner if email channel */}
            {!isUnifiedAllPlatforms && activeConversation.channel === 'EMAIL' && (
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-700 flex items-center justify-between font-medium">
                <div className="flex items-center space-x-2 truncate">
                  <span className="font-bold text-slate-500">Subject:</span>
                  <span className="font-bold text-slate-900 truncate">
                    {activeMessages[0]?.emailMeta?.subject || activeConversation.conversationSummary || 'Umrah360 Inquiry'}
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-[11px] text-slate-500 font-mono">
                  {activeConversation.gmailThreadId && (
                    <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-bold">
                      Gmail Thread: {activeConversation.gmailThreadId.slice(0, 16)}...
                    </span>
                  )}
                  {activeConversation.managementMode && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-bold uppercase bg-orange-100 text-orange-800 border border-orange-200">
                      {activeConversation.managementMode} MODE
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Unified Stream Notification Banner */}
            {isUnifiedAllPlatforms && (
              <div className="px-4 py-1.5 bg-orange-50 border-b border-orange-200 text-[11px] text-orange-900 flex items-center justify-between font-medium">
                <div className="flex items-center space-x-2">
                  <Globe className="w-3.5 h-3.5 text-orange-600" />
                  <span>
                    Unified Stream active: Showing complete chronological history across{' '}
                    <strong>{contactConversations.length} connected platforms</strong> (
                    {contactConversations.map((c) => c.channel).join(', ')}).
                  </span>
                </div>
                <span className="text-orange-700 font-bold">All Interactions Linked</span>
              </div>
            )}

            {/* Message Thread Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
              {displayMessages.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs font-medium">
                  No messages on this platform yet. Use &ldquo;Simulate Inbound Platform Msg&rdquo; or dispatch cold outreach.
                </div>
              ) : (
                displayMessages.map((msg) => {
                  const isIncoming = msg.senderType === 'CUSTOMER' || msg.senderType === 'PROSPECT';
                  const isAi = msg.senderType === 'AI';

                  return (
                    <div
                      key={msg.messageId}
                      className={`flex flex-col ${isIncoming ? 'items-start' : 'items-end'}`}
                    >
                      {/* Sender label & Platform Badge */}
                      <div className="flex items-center space-x-2 text-[11px] text-slate-500 font-medium mb-1 px-1">
                        {/* Channel Badge */}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center space-x-1 bg-white text-slate-800 border-slate-200 shadow-2xs`}
                        >
                          {renderChannelIcon(msg.channel, 2.5)}
                          <span className="uppercase">{msg.channel}</span>
                        </span>

                        <span className="font-bold text-slate-800">
                          {msg.senderName || (isIncoming ? activeContact.firstName : 'Umrah360 Agent')}
                        </span>
                        {isAi && (
                          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold border border-orange-200 flex items-center space-x-1 text-[10px]">
                            <Bot className="w-2.5 h-2.5 text-orange-600" />
                            <span>AI Grounded</span>
                          </span>
                        )}
                        <span>•</span>
                        <span>
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={`max-w-xl p-4 rounded-2xl text-xs leading-relaxed ${
                          isIncoming
                            ? 'bg-white text-slate-900 rounded-tl-xs border border-slate-200/90 shadow-2xs'
                            : isAi
                            ? 'bg-slate-900 text-white rounded-tr-xs shadow-xs'
                            : 'bg-orange-500 text-white rounded-tr-xs shadow-xs'
                        }`}
                      >
                        <div className="whitespace-pre-wrap font-medium">{msg.text}</div>

                        {/* RAG sources indicator */}
                        {msg.knowledgeSources && msg.knowledgeSources.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-blue-800/40 text-[10px] text-blue-300/80 flex items-center space-x-1.5">
                            <ShieldCheck className="w-3 h-3 text-blue-400" />
                            <span>Knowledge Sources: {msg.knowledgeSources.join(', ')}</span>
                          </div>
                        )}

                        {/* Email Live Delivery Status Badge (Outbound) */}
                        {!isIncoming && (msg.channel === 'EMAIL' || msg.emailMeta) && (
                          <div className="mt-2.5 pt-2 border-t border-slate-700/60 flex items-center justify-between text-[10px]">
                            {msg.smtpStatus === 'DELIVERED' ? (
                              <span className="flex items-center space-x-1 text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                <span>Delivered via SMTP to {msg.emailMeta?.to || activeContact.email}</span>
                              </span>
                            ) : msg.smtpStatus === 'DELIVERY_FAILED' ? (
                              <div className="flex items-center justify-between w-full">
                                <span className="flex items-center space-x-1 text-amber-300 font-medium">
                                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                  <span className="truncate max-w-[260px]">
                                    Not delivered: {msg.smtpError || 'SMTP connection required'}
                                  </span>
                                </span>
                                <div className="flex items-center space-x-1.5 ml-2">
                                  <button
                                    onClick={() => setShowSmtpModal(true)}
                                    className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold transition"
                                  >
                                    Setup SMTP
                                  </button>
                                  <button
                                    onClick={() => handleRetrySendEmail(msg)}
                                    disabled={retryingMessageId === msg.messageId}
                                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition flex items-center space-x-1"
                                  >
                                    <RefreshCw className={`w-2.5 h-2.5 ${retryingMessageId === msg.messageId ? 'animate-spin' : ''}`} />
                                    <span>Retry</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="flex items-center space-x-1 text-blue-300">
                                <Mail className="w-3 h-3 text-blue-400 shrink-0" />
                                <span>Sent to {msg.emailMeta?.to || activeContact.email}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Actions & AI Draft generation bar */}
            <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none">
                <span className="text-slate-500 font-medium text-[11px] mr-1">Quick Prompts:</span>
                <button
                  onClick={() =>
                    setReplyText(
                      `Yes! Umrah360 provides a complete white-label B2B Sub-Agent Portal with custom markups, credit limits, and instant PDF vouchers with their agency logo.`
                    )
                  }
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition whitespace-nowrap"
                >
                  B2B Agent Specs
                </button>
                <button
                  onClick={() =>
                    setReplyText(
                      `Starter: $199/mo (up to 3 users) | Growth: $499/mo (up to 10 users). For 20+ users, an Enterprise custom quote is prepared by our senior solutions team.`
                    )
                  }
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition whitespace-nowrap"
                >
                  Approved Pricing
                </button>
                <button
                  onClick={() =>
                    setReplyText(
                      `We would be delighted to schedule a 20-minute live demonstration tailored to your pilgrimage operations. What time works best for you this week?`
                    )
                  }
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition whitespace-nowrap"
                >
                  Schedule Demo
                </button>
              </div>

              <button
                onClick={handleAiAutoGenerate}
                disabled={isGeneratingAi}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition disabled:opacity-50 shadow-sm whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isGeneratingAi ? 'Consulting KB...' : 'AI Auto-Draft'}</span>
              </button>
            </div>

            {/* AI Draft Reply Awaiting Verification Card (REVIEW Mode) */}
            {activeConversation.draftReply && activeConversation.draftReply.status === 'PENDING' && (
              <div className="p-3.5 bg-amber-950/40 border-t border-b border-amber-800/60 flex flex-col space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center space-x-1.5 font-semibold text-amber-300">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>AI Drafted Auto-Reply Awaiting Human Review</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase font-mono font-semibold">
                    REVIEW MODE
                  </span>
                </div>
                <div className="p-2.5 rounded bg-slate-900/90 border border-amber-900/50 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {activeConversation.draftReply.text}
                </div>
                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    onClick={() => setReplyText(activeConversation.draftReply!.text)}
                    className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                  >
                    Edit in Composer
                  </button>
                  <button
                    onClick={() => onApproveDraft?.(activeConversation.conversationId)}
                    className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Approve &amp; Send Live Email</span>
                  </button>
                </div>
              </div>
            )}

            {/* Message Reply Box */}
            <div className="p-3 bg-slate-900 border-t border-slate-800">
              {/* Channel Selector for Unified Mode */}
              {isUnifiedAllPlatforms && (
                <div className="flex items-center space-x-2 mb-2 text-xs">
                  <span className="text-slate-400 text-[11px] font-medium">Send reply via:</span>
                  <div className="flex items-center space-x-1">
                    {contactConversations.map((c) => {
                      const isTarget =
                        (replyChannelOverride || activeConversation.channel) === c.channel;
                      return (
                        <button
                          key={c.channel}
                          onClick={() => setReplyChannelOverride(c.channel)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1 border transition ${
                            isTarget
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          {renderChannelIcon(c.channel, 3)}
                          <span className="capitalize">{c.channel.toLowerCase()}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-end space-x-2">
                <textarea
                  rows={2}
                  placeholder={`Reply to ${activeContact.firstName} via ${(
                    (isUnifiedAllPlatforms ? replyChannelOverride : null) || activeConversation.channel
                  ).toLowerCase()}...`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                  className="flex-1 bg-slate-800/90 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 resize-none transition"
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim()}
                  className="h-14 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center transition disabled:opacity-40 shadow-sm"
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
            Select a conversation from the left to view thread
          </div>
        )}
      </div>

      {/* 3. RIGHT COLUMN: Lead Profile 360 & Conversation Memory (Width: 320px) */}
      {activeConversation && activeContact && (
        <div className="w-full lg:w-80 border-l border-slate-200 bg-white p-5 overflow-y-auto space-y-4 font-sans">
          {/* Customer Card Header */}
          <div className="border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                Lead Profile 360
              </span>
              {activeLead && (
                <button
                  onClick={() => onViewLeadInCrm(activeLead.leadId)}
                  className="text-[11px] font-bold text-orange-600 hover:text-orange-700 flex items-center space-x-0.5"
                >
                  <span>Open CRM</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
            <h4 className="font-extrabold text-sm text-slate-900 mt-2">
              {activeContact.firstName} {activeContact.lastName}
            </h4>
            <div className="flex items-center space-x-1.5 text-xs text-slate-600 mt-0.5 font-medium">
              <Building className="w-3.5 h-3.5 text-slate-400" />
              <span>{activeContact.companyName}</span>
            </div>
          </div>

          {/* Connected Channels & Platform Streams */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/90 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-900 font-bold flex items-center space-x-1.5">
                <Smartphone className="w-3.5 h-3.5 text-orange-500" />
                <span>Connected Platforms</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono font-bold">
                {contactConversations.length} Active
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              {contactConversations.map((conv) => {
                const convMsgs = messages.filter((m) => m.conversationId === conv.conversationId);
                const isSelected =
                  !isUnifiedAllPlatforms && conv.conversationId === activeConversation.conversationId;

                return (
                  <div
                    key={conv.conversationId}
                    onClick={() => {
                      setIsUnifiedAllPlatforms(false);
                      setSelectedConversationId(conv.conversationId);
                    }}
                    className={`p-2.5 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-orange-50 border-orange-300 text-orange-900 font-bold'
                        : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 font-medium'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {renderChannelIcon(conv.channel, 3.5)}
                      <span className="capitalize font-bold">{conv.channel.toLowerCase()}</span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] text-slate-500 font-bold">
                        {convMsgs.length} msgs
                      </span>
                      {conv.humanHandoff ? (
                        <span className="w-2 h-2 rounded-full bg-amber-500" title="Human Handoff" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-orange-500" title="AI Active" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setIsUnifiedAllPlatforms(true)}
              className={`w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 border transition ${
                isUnifiedAllPlatforms
                  ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-orange-500" />
              <span>Open All-Platform Timeline</span>
            </button>
          </div>

          {/* Lead Qualification Score & Intent */}
          {activeLead && (
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/90 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-bold">Lead Score</span>
                <span className="font-extrabold text-orange-600 text-sm">
                  {activeLead.leadScore} / 100
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-orange-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${activeLead.leadScore}%` }}
                />
              </div>
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="text-slate-500 font-bold">Intent:</span>
                <span
                  className={`px-2 py-0.5 rounded-full font-bold ${
                    activeLead.intent === 'HIGH'
                      ? 'bg-orange-500 text-white'
                      : 'bg-amber-100 text-amber-900 border border-amber-200'
                  }`}
                >
                  {activeLead.intent}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-bold">Buying Stage:</span>
                <span className="text-slate-900 font-extrabold">{activeLead.buyingStage}</span>
              </div>
            </div>
          )}

          {/* Demo Booking */}
          {activeLead && (
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/90 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                  <span>Demo Status</span>
                </span>
                <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
                  {activeLead.demoStatus === 'BOOKED' || activeLead.status === 'DEMO_BOOKED'
                    ? `Booked (${activeLead.demoSource || 'Manual'})`
                    : 'Not Booked'}
                </span>
              </div>
              <button
                onClick={async () => {
                  const isBooked = activeLead.demoStatus === 'BOOKED' || activeLead.status === 'DEMO_BOOKED';
                  const nextStatus = isBooked ? 'NOT_BOOKED' : 'BOOKED';
                  try {
                    await fetch(`/api/campaigns/lead/${activeLead.leadId}/demo-status`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        demoStatus: nextStatus,
                        demoSource: 'MANUAL',
                      }),
                    });
                    onUpdateLeadScore(activeLead.leadId, 0);
                  } catch (e) {
                    console.error('Error toggling demo status:', e);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition ${
                  activeLead.demoStatus === 'BOOKED' || activeLead.status === 'DEMO_BOOKED'
                    ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
                    : 'bg-slate-900 text-white border-slate-900 hover:bg-black'
                }`}
              >
                <span>
                  {activeLead.demoStatus === 'BOOKED' || activeLead.status === 'DEMO_BOOKED'
                    ? 'Booked ✓'
                    : 'Book Demo'}
                </span>
              </button>
            </div>
          )}

          {/* Conversation Memory */}
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-slate-900 flex items-center space-x-1">
              <Bot className="w-3.5 h-3.5 text-orange-500" />
              <span>Conversation Memory</span>
            </h5>

            {/* Requirements */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/90 text-xs space-y-1.5">
              <span className="text-[11px] text-slate-500 font-bold">Extracted Needs:</span>
              <div className="flex flex-wrap gap-1">
                {(Array.isArray(activeLead?.requirements)
                  ? activeLead.requirements
                  : typeof activeLead?.requirements === 'string'
                  ? (activeLead.requirements as string).split('|').map((s) => s.trim())
                  : ['Umrah Packages', 'Costing Engine']
                ).map((req, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-900 border border-orange-200 text-[10px] font-bold"
                  >
                    {req}
                  </span>
                ))}
              </div>
            </div>

            {/* Customer Facts */}
            {activeConversation.memory?.customerFacts && (
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/90 text-xs space-y-1">
                <span className="text-[11px] text-slate-500 font-bold">Customer Facts:</span>
                <ul className="space-y-1 text-[11px] text-slate-800 font-medium">
                  {activeConversation.memory.customerFacts.map((fact, i) => (
                    <li key={i} className="flex items-start space-x-1.5">
                      <span className="text-orange-500 font-bold mt-0.5">•</span>
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI Recommendation */}
            {activeLead?.aiRecommendation && (
              <div className="p-2.5 bg-emerald-950/40 rounded-lg border border-emerald-800/50 text-xs space-y-1">
                <span className="text-[11px] text-emerald-400 font-semibold flex items-center space-x-1">
                  <CheckCircle className="w-3 h-3" />
                  <span>Next Recommended Action:</span>
                </span>
                <p className="text-[11px] text-emerald-200/90 leading-relaxed">
                  {activeLead.aiRecommendation}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. MODAL: Simulate Inbound Customer Message from Any Platform */}
      {showSimulateModal && activeContact && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-sm text-slate-100">
                  Simulate Inbound Platform Message
                </h3>
              </div>
              <button
                onClick={() => setShowSimulateModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Simulate an incoming message from <strong>{activeContact.firstName} {activeContact.lastName}</strong> across different external platforms to verify omnichannel ingestion and AI grounding.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Select Platform Channel
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['WHATSAPP', 'INSTAGRAM', 'EMAIL', 'LINKEDIN'] as Channel[]).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setSimulatedPlatform(ch)}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-medium flex items-center justify-center space-x-1.5 transition ${
                      simulatedPlatform === ch
                        ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                    }`}
                  >
                    {renderChannelIcon(ch, 3.5)}
                    <span className="capitalize">{ch.toLowerCase()}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Customer Message Text
              </label>
              <textarea
                rows={3}
                value={simulatedText}
                onChange={(e) => setSimulatedText(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500 resize-none transition"
              />
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Quick Prompts:</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSimulatedText('Can you send the dynamic costing sheet for 4-star packages?')}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700 transition"
                >
                  Dynamic Costing Inquiry
                </button>
                <button
                  type="button"
                  onClick={() => setSimulatedText('Do you support white-label PDF vouchers for sub-agents?')}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700 transition"
                >
                  B2B Vouchers Inquiry
                </button>
                <button
                  type="button"
                  onClick={() => setSimulatedText('What are your monthly subscription charges and user limits?')}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700 transition"
                >
                  Pricing Inquiry
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSimulateModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSimulateInbound}
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Inject Message</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inbound Email Flow Simulator Modal for automation@amaavigo.com */}
      {showInboundFlowModal && (
        <InboundEmailFlowModal
          isOpen={showInboundFlowModal}
          onClose={() => setShowInboundFlowModal(false)}
          onProcessEmail={async (payload) => {
            if (onProcessInboundEmail) {
              const res = await onProcessInboundEmail(payload);
              if (res.conversation) {
                setSelectedConversationId(res.conversation.conversationId);
              }
              return res;
            }
            throw new Error('Inbound processor not configured');
          }}
          onNavigateToThread={(convId) => {
            setSelectedConversationId(convId);
          }}
          onNavigateToCrmLead={(leadId) => {
            onViewLeadInCrm(leadId);
          }}
        />
      )}

      {/* Inbound WhatsApp Flow Simulator Modal for +919820252434 */}
      {showInboundWhatsAppModal && (
        <InboundWhatsAppFlowModal
          isOpen={showInboundWhatsAppModal}
          onClose={() => setShowInboundWhatsAppModal(false)}
          contacts={contacts}
          leads={leads}
          conversations={conversations}
          messages={messages}
          knowledgeDocs={knowledgeDocs}
          settings={{
            autoPilot: true,
            defaultTone: 'PROFESSIONAL',
            humanHandoffThreshold: 0.7,
            officeHoursOnly: false,
            maxAutoRepliesPerLead: 5,
          } as any}
          onInboundComplete={(res) => {
            if (onProcessInboundWhatsApp && res.incomingMessage) {
              onProcessInboundWhatsApp({
                from: res.contact.phone || '',
                fromName: `${res.contact.firstName} ${res.contact.lastName}`,
                to: WHATSAPP_BUSINESS_NUMBER,
                body: res.incomingMessage.text,
                companyName: res.contact.companyName,
              }).catch(() => {});
            }
            if (res.conversation) {
              setSelectedConversationId(res.conversation.conversationId);
            }
          }}
          onNavigateToConversation={(convId) => {
            setSelectedConversationId(convId);
          }}
          onNavigateToLead={(leadId) => {
            onViewLeadInCrm(leadId);
          }}
        />
      )}

      {/* SMTP & Live Outbound Mail Delivery Settings Modal */}
      {showSmtpModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Live Outbound SMTP Delivery Settings</h3>
                  <p className="text-[11px] text-slate-400">Configure email delivery to send real responses to leads.</p>
                </div>
              </div>
              <button
                onClick={() => setShowSmtpModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSmtpConfig} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-300">SMTP Host</label>
                  <input
                    type="text"
                    required
                    value={smtpHostInput}
                    onChange={(e) => setSmtpHostInput(e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Port</label>
                  <input
                    type="number"
                    required
                    value={smtpPortInput}
                    onChange={(e) => setSmtpPortInput(parseInt(e.target.value, 10) || 465)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">SMTP User / Email</label>
                <input
                  type="email"
                  required
                  value={smtpUserInput}
                  onChange={(e) => setSmtpUserInput(e.target.value)}
                  placeholder="amaavigo@gmail.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Gmail App Password (16 chars) / SMTP Password</label>
                  <span className="text-[10px] text-blue-400">Required for live sending</span>
                </div>
                <input
                  type="password"
                  value={smtpPassInput}
                  onChange={(e) => setSmtpPassInput(e.target.value)}
                  placeholder={smtpStatus?.hasPassword ? '•••••••••••••••• (Password configured)' : 'Enter 16-character Gmail App Password'}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 leading-normal pt-0.5">
                  For Gmail: Go to <strong className="text-slate-200">myaccount.google.com/apppasswords</strong> &rarr; generate 16-character password (e.g. <code>abcd efgh ijkl mnop</code>).
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">From Name &amp; Header</label>
                <input
                  type="text"
                  value={smtpFromInput}
                  onChange={(e) => setSmtpFromInput(e.target.value)}
                  placeholder="Umrah360 Automation <amaavigo@gmail.com>"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {smtpSaveMessage && (
                <div
                  className={`p-3 rounded-xl border flex items-start space-x-2 text-xs ${
                    smtpSaveMessage.success
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  }`}
                >
                  {smtpSaveMessage.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">{smtpSaveMessage.text}</div>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSmtpModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSavingSmtp}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 shadow-md"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSavingSmtp ? 'animate-spin' : ''}`} />
                  <span>{isSavingSmtp ? 'Verifying & Saving...' : 'Save & Verify Connection'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
