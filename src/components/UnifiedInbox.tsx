import React, { useState } from 'react';
import {
  Search,
  Bot,
  User,
  Send,
  AlertTriangle,
  CheckCircle,
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
  Loader2,
  AlertCircle,
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

  // Helper to deduplicate messages in thread (e.g. preventing duplicate outbound confirmation emails)
  const deduplicateThreadMessages = (rawMsgs: Message[]) => {
    const sorted = [...rawMsgs].sort(sortMsgs);
    const result: Message[] = [];

    // Check if there is already a verified delivered outbound Thank You email
    const hasDeliveredThankYou = sorted.some(
      (m) =>
        m.direction === 'OUTBOUND' &&
        (m.deliveryStatus === 'DELIVERED' || Boolean(m.smtpMessageId && m.smtpMessageId.startsWith('<'))) &&
        (m.text?.includes('Thank you for requesting') ||
          m.text?.includes('We have received your requirements') ||
          m.text?.includes('As-salamu alaykum'))
    );

    let seenThankYou = false;

    for (const msg of sorted) {
      const isThankYou =
        msg.direction === 'OUTBOUND' &&
        (msg.text?.includes('Thank you for requesting') ||
          msg.text?.includes('We have received your requirements') ||
          msg.text?.includes('As-salamu alaykum'));

      if (isThankYou) {
        // If there is already a delivered version, drop any pending/unverified version
        if (hasDeliveredThankYou && msg.deliveryStatus !== 'DELIVERED' && !msg.smtpMessageId) {
          continue;
        }
        // Only allow one Thank You confirmation email in the thread
        if (seenThankYou) {
          continue;
        }
        seenThankYou = true;
      }

      result.push(msg);
    }

    return result;
  };

  const activeMessages = deduplicateThreadMessages(
    messages.filter((m) => m.conversationId === activeConversation?.conversationId)
  );

  const unifiedAllMessages = activeContact
    ? deduplicateThreadMessages(
        messages.filter((m) => contactConversations.some((c) => c.conversationId === m.conversationId))
      )
    : activeMessages;

  const displayMessages = isUnifiedAllPlatforms ? unifiedAllMessages : activeMessages;

  // Resolve the authoritative email address for the active lead/contact
  const inboundCustomerMsg = [...activeMessages].find(
    (m) => m.direction === 'INBOUND' && m.text && m.text.includes('• Email:')
  );
  const emailFromInboundText = inboundCustomerMsg?.text
    ?.match(/•\s*Email:\s*([^\s\n\r]+@[^\s\n\r]+)/i)?.[1]
    ?.trim();

  const effectiveEmail =
    activeContact?.email && activeContact.email.includes('@') && !activeContact.email.endsWith('@umrah360.in')
      ? activeContact.email
      : activeConversation?.customerEmail ||
        emailFromInboundText ||
        (activeContact?.email?.includes('@') ? activeContact.email : '');

  const isThankYouDelivered =
    Boolean(activeConversation?.thankYouEmailSent && activeConversation?.thankYouSmtpMessageId) ||
    activeMessages.some(
      (m) =>
        m.direction === 'OUTBOUND' &&
        (m.deliveryStatus === 'DELIVERED' || Boolean(m.smtpMessageId && m.smtpMessageId.startsWith('<')))
    );

  const [isSendingThankYou, setIsSendingThankYou] = useState<boolean>(false);
  const [thankYouStatusMsg, setThankYouStatusMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleDispatchThankYou = async () => {
    if (!activeConversation) return;
    setIsSendingThankYou(true);
    setThankYouStatusMsg(null);
    try {
      const res = await fetch('/api/leads/send-thank-you', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversation.conversationId }),
      });
      const data = await res.json();
      if (data.success) {
        setThankYouStatusMsg({
          type: 'success',
          text: `Thank You email delivered live to ${data.email || effectiveEmail}! (Message ID: ${data.messageId})`,
        });
      } else {
        setThankYouStatusMsg({
          type: 'error',
          text: data.error || 'Failed to dispatch email over SMTP',
        });
      }
    } catch (err: any) {
      setThankYouStatusMsg({
        type: 'error',
        text: err?.message || 'Network error dispatching email',
      });
    } finally {
      setIsSendingThankYou(false);
    }
  };

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
    <div className="flex flex-col lg:flex-row h-[calc(100vh-8rem)] bg-slate-950 text-slate-100 overflow-hidden border border-slate-800 rounded-xl m-2 sm:m-4 shadow-2xl relative">
      {/* 1. LEFT COLUMN: Conversation List & Filters (Width: 340px) */}
      <div className="w-full lg:w-84 border-r border-slate-800 flex flex-col bg-slate-900/90">
        {/* Search Header */}
        <div className="p-3 border-b border-slate-800 space-y-2">
          {/* Live Inbound Mailbox & WhatsApp Triggers */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setShowInboundFlowModal(true)}
                className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-blue-950/40 hover:bg-blue-900/50 border border-blue-500/30 text-blue-200 transition text-left group"
              >
                <div className="flex items-center space-x-2 truncate">
                  <Mail className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <div className="truncate">
                    <span className="text-[11px] font-bold block truncate">{INBOUND_MAILBOX}</span>
                  </div>
                </div>
                <span className="flex items-center space-x-1 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded shrink-0 border border-blue-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                  <span>Email</span>
                </span>
              </button>

              {onSyncNow && (
                <button
                  onClick={onSyncNow}
                  title="Sync Inbound Mailbox with Live Server"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={() => setShowInboundWhatsAppModal(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-200 transition text-left group"
            >
              <div className="flex items-center space-x-2 truncate">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <div className="truncate">
                  <span className="text-[11px] font-bold block truncate font-mono">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
                </div>
              </div>
              <span className="flex items-center space-x-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
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
              className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Channel Pills */}
          <div className="flex space-x-1 overflow-x-auto pb-1 scrollbar-none text-xs">
            {['ALL', 'EMAIL', 'WHATSAPP', 'INSTAGRAM', 'LINKEDIN'].map((ch) => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-2 py-1 rounded-md whitespace-nowrap font-medium transition ${
                  channelFilter === ch
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
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
              className={`px-2 py-0.5 rounded transition whitespace-nowrap ${
                statusFilter === 'UNREAD' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Unread
            </button>
            <button
              onClick={() => setStatusFilter('AI_ACTIVE')}
              className={`px-2 py-0.5 rounded transition whitespace-nowrap ${
                statusFilter === 'AI_ACTIVE' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              AI Active
            </button>
            <button
              onClick={() => setStatusFilter('HUMAN_HANDOFF')}
              className={`px-2 py-0.5 rounded transition whitespace-nowrap ${
                statusFilter === 'HUMAN_HANDOFF'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Handoff
            </button>
            <button
              onClick={() => setStatusFilter('HIGH_INTENT')}
              className={`px-2 py-0.5 rounded transition whitespace-nowrap ${
                statusFilter === 'HIGH_INTENT'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              High Intent
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
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
                  className={`p-3 cursor-pointer transition relative ${
                    isSelected
                      ? 'bg-slate-800/90 border-l-4 border-emerald-500'
                      : isUnread
                      ? 'bg-slate-800/50 hover:bg-slate-800/70'
                      : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      {renderChannelIcon(conv.channel, 4)}
                      <span className={`text-xs ${isUnread ? 'font-bold text-white' : 'font-semibold text-slate-200'}`}>
                        {contact?.firstName} {contact?.lastName}
                      </span>
                      {isUnread && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" title="Unread Message" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500">
                      {new Date(conv.lastMessageAt || conv.createdAt || 0).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">
                    {contact?.companyName}
                  </p>

                  <p className={`text-xs mt-1 line-clamp-2 leading-relaxed ${isUnread ? 'text-slate-200 font-medium' : 'text-slate-400'}`}>
                    {conv.lastMessageText || 'New conversation started'}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/40 text-[10px]">
                    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                      {conv.direction === 'OUTBOUND' ? (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-medium">
                          Outbound
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 font-medium">
                          Inbound
                        </span>
                      )}

                      {lead?.intent === 'HIGH' && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                          High Intent
                        </span>
                      )}

                      {hasPendingDraft && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                          Draft Ready
                        </span>
                      )}

                      {conv.managementMode && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono text-[9px]">
                          {conv.managementMode}
                        </span>
                      )}
                    </div>

                    <div>
                      {conv.humanHandoff ? (
                        <span className="flex items-center space-x-1 text-amber-400 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Handoff</span>
                        </span>
                      ) : conv.aiEnabled ? (
                        <span className="flex items-center space-x-1 text-blue-400 font-medium">
                          <Bot className="w-3 h-3" />
                          <span>AI On</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Manual</span>
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
      <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
        {/* Active Conversation Header */}
        {activeConversation && activeContact ? (
          <>
            <div className="p-3.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-300 text-sm">
                  {activeContact.firstName?.[0]}
                  {activeContact.lastName?.[0]}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-sm text-slate-100">
                      {activeContact.firstName} {activeContact.lastName}
                    </h3>
                    <div className="flex items-center space-x-1 text-xs text-slate-400">
                      {renderChannelIcon(activeConversation.channel, 3.5)}
                      <span className="capitalize">{activeConversation.channel.toLowerCase()}</span>
                    </div>
                    {(activeLead?.demoStatus === 'BOOKED' || activeLead?.status === 'DEMO_BOOKED') && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                        <span>Demo Booked</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                    <span>
                      {activeContact.jobTitle || 'Decision Maker'} at{' '}
                      <span className="text-slate-300 font-medium">{activeContact.companyName}</span>
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 font-mono text-blue-300 bg-blue-950/40 px-1.5 py-0.2 rounded border border-blue-800/40">
                      <Mail className="w-3 h-3 text-blue-400" />
                      {effectiveEmail || 'No email'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Actions & Takeover Toggle */}
              <div className="flex items-center space-x-2">
                {/* 1-Click Send / Resend Thank-You Email */}
                {effectiveEmail ? (
                  isThankYouDelivered ? (
                    <span
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 flex items-center gap-1.5"
                      title={`Delivered via Gmail SMTP to ${effectiveEmail}`}
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Thank-You Sent</span>
                    </span>
                  ) : (
                    <button
                      onClick={handleDispatchThankYou}
                      disabled={isSendingThankYou}
                      className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm disabled:opacity-50"
                      title={`Send live walkthrough and demo confirmation email to ${effectiveEmail}`}
                    >
                      {isSendingThankYou ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Send Thank-You Email</span>
                    </button>
                  )
                ) : null}

                {activeConversation.humanHandoff ? (
                  <button
                    onClick={() => onToggleAi(activeConversation.conversationId, true)}
                    className="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition shadow-sm"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Resume AI</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleAi(activeConversation.conversationId, false)}
                    className="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition shadow-sm"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Take Over (Human)</span>
                  </button>
                )}

                <div
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center space-x-1 border ${
                    activeConversation.aiEnabled && !activeConversation.humanHandoff
                      ? 'bg-blue-950/60 border-blue-800 text-blue-400'
                      : 'bg-amber-950/60 border-amber-800 text-amber-400'
                  }`}
                >
                  {activeConversation.aiEnabled && !activeConversation.humanHandoff ? (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>AI AUTO-REPLY ON</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>HUMAN MANAGED</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Notification alert banner when thank-you email is sent */}
            {thankYouStatusMsg && (
              <div
                className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
                  thankYouStatusMsg.type === 'success'
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                    : 'bg-rose-950/80 border-rose-700 text-rose-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  {thankYouStatusMsg.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{thankYouStatusMsg.text}</span>
                </div>
                <button
                  onClick={() => setThankYouStatusMsg(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Omnichannel Platform Navigation Tabs (Section 55 - Unified Multi-Platform Conversations) */}
            <div className="px-3.5 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2 overflow-x-auto">
              <div className="flex items-center space-x-1.5 overflow-x-auto text-xs scrollbar-none">
                <span className="text-[11px] text-slate-400 font-medium mr-1 flex items-center space-x-1 whitespace-nowrap">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span>Platforms:</span>
                </span>

                {/* All Platforms Unified Stream Tab */}
                <button
                  onClick={() => setIsUnifiedAllPlatforms(true)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 transition whitespace-nowrap ${
                    isUnifiedAllPlatforms
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>All Platforms Stream</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isUnifiedAllPlatforms ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300'
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
                      className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 transition whitespace-nowrap ${
                        isSelected
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      {renderChannelIcon(conv.channel, 3.5)}
                      <span className="capitalize">{conv.channel.toLowerCase()}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300'
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
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700/50 text-xs font-medium transition whitespace-nowrap"
                title="Simulate receiving an inbound message from another platform"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Simulate Inbound Platform Msg</span>
              </button>
            </div>

            {/* Email Metadata banner if email channel */}
            {!isUnifiedAllPlatforms && activeConversation.channel === 'EMAIL' && (
              <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                <div className="flex items-center space-x-2 truncate">
                  <span className="font-semibold text-slate-400">Subject:</span>
                  <span className="font-medium text-slate-200 truncate">
                    {activeMessages[0]?.emailMeta?.subject || activeConversation.conversationSummary || 'Umrah360 Inquiry'}
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-[11px] text-slate-400 font-mono">
                  {activeConversation.gmailThreadId && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      Gmail Thread: {activeConversation.gmailThreadId.slice(0, 16)}...
                    </span>
                  )}
                  {activeConversation.managementMode && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold uppercase ${
                      activeConversation.managementMode === 'AI' || (activeConversation.managementMode as any) === 'AUTONOMOUS'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {activeConversation.managementMode} MODE
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Unified Stream Notification Banner */}
            {isUnifiedAllPlatforms && (
              <div className="px-4 py-1.5 bg-emerald-950/40 border-b border-emerald-900/60 text-[11px] text-emerald-300 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Globe className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Unified Stream active: Showing complete chronological history across{' '}
                    <strong>{contactConversations.length} connected platforms</strong> (
                    {contactConversations.map((c) => c.channel).join(', ')}).
                  </span>
                </div>
                <span className="text-emerald-400/80 font-medium">All Interactions Linked</span>
              </div>
            )}

            {/* Message Thread Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {displayMessages.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
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
                      <div className="flex items-center space-x-2 text-[11px] text-slate-400 mb-1 px-1">
                        {/* Channel Badge */}
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border flex items-center space-x-1 ${getChannelColor(
                            msg.channel
                          )}`}
                        >
                          {renderChannelIcon(msg.channel, 2.5)}
                          <span className="uppercase">{msg.channel}</span>
                        </span>

                        <span className="font-medium">
                          {msg.senderName || (isIncoming ? activeContact.firstName : 'Umrah360 Agent')}
                        </span>
                        {isAi && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/30 flex items-center space-x-1">
                            <Bot className="w-2.5 h-2.5" />
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
                        className={`max-w-xl p-3.5 rounded-xl text-xs leading-relaxed ${
                          isIncoming
                            ? 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/80 shadow-sm'
                            : isAi
                            ? 'bg-blue-950/80 text-blue-50 rounded-tr-none border border-blue-800/80 shadow-sm'
                            : 'bg-emerald-900/70 text-emerald-50 rounded-tr-none border border-emerald-700/80 shadow-sm'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{msg.text}</div>

                        {/* Outbound live email delivery tracking & inline trigger */}
                        {!isIncoming && (
                          <div className="mt-2.5 pt-2 border-t border-slate-700/60">
                            {msg.deliveryStatus === 'DELIVERED' || (msg.smtpMessageId && msg.smtpMessageId.startsWith('<')) ? (
                              <div className="text-[10px] text-emerald-300 flex items-center justify-between flex-wrap gap-1">
                                <span className="flex items-center space-x-1">
                                  <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                                  <span>Live Email Delivered to {msg.recipientEmail || effectiveEmail}</span>
                                </span>
                                {msg.smtpMessageId && (
                                  <span className="font-mono text-[9px] text-emerald-400/80 truncate max-w-[150px]" title={msg.smtpMessageId}>
                                    {msg.smtpMessageId}
                                  </span>
                                )}
                              </div>
                            ) : msg.deliveryStatus === 'FAILED' ? (
                              <div className="text-[10px] text-rose-300 flex items-center justify-between flex-wrap gap-1">
                                <span className="flex items-center space-x-1">
                                  <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                                  <span>Email not delivered to {msg.recipientEmail || effectiveEmail}</span>
                                </span>
                                <button
                                  onClick={handleDispatchThankYou}
                                  disabled={isSendingThankYou}
                                  className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[10px]"
                                >
                                  Retry Send
                                </button>
                              </div>
                            ) : (
                              <div className="text-[10px] text-amber-300/90 flex items-center justify-between bg-amber-950/40 p-1.5 rounded border border-amber-800/40 flex-wrap gap-1">
                                <span className="flex items-center space-x-1">
                                  <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                                  <span>Recorded in CRM • Live mail pending for {effectiveEmail || 'lead'}</span>
                                </span>
                                <button
                                  onClick={handleDispatchThankYou}
                                  disabled={isSendingThankYou || !effectiveEmail}
                                  className="ml-auto px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[10px] shrink-0"
                                >
                                  {isSendingThankYou ? 'Sending...' : 'Send Live Email'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* RAG sources indicator */}
                        {msg.knowledgeSources && msg.knowledgeSources.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-blue-800/40 text-[10px] text-blue-300/80 flex items-center space-x-1.5">
                            <ShieldCheck className="w-3 h-3 text-blue-400" />
                            <span>Knowledge Sources: {msg.knowledgeSources.join(', ')}</span>
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
        <div className="w-full lg:w-80 border-l border-slate-800 bg-slate-900/95 p-4 overflow-y-auto space-y-4">
          {/* Customer Card Header */}
          <div className="border-b border-slate-800 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Lead Profile 360
              </span>
              {activeLead && (
                <button
                  onClick={() => onViewLeadInCrm(activeLead.leadId)}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center space-x-0.5"
                >
                  <span>Open CRM</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
            <h4 className="font-bold text-sm text-slate-100 mt-2">
              {activeContact.firstName} {activeContact.lastName}
            </h4>
            <div className="flex items-center space-x-1.5 text-xs text-slate-300 mt-0.5">
              <Building className="w-3.5 h-3.5 text-slate-400" />
              <span>{activeContact.companyName}</span>
            </div>
          </div>

          {/* Lead Email & Quick Dispatch Action */}
          <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold flex items-center space-x-1.5">
                <Mail className="w-3.5 h-3.5 text-blue-400" />
                <span>Lead Email Field</span>
              </span>
              {isThankYouDelivered ? (
                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5">
                  <CheckCircle className="w-3 h-3" />
                  <span>Delivered</span>
                </span>
              ) : (
                <span className="text-[10px] text-amber-400 font-semibold">
                  Pending
                </span>
              )}
            </div>

            <div className="p-2 rounded bg-slate-900 border border-slate-700/80 font-mono text-[11px] text-blue-300 break-all select-all">
              {effectiveEmail || '(No email on file)'}
            </div>

            {effectiveEmail && (
              <button
                onClick={handleDispatchThankYou}
                disabled={isSendingThankYou}
                className="w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50 shadow-sm"
              >
                {isSendingThankYou ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isThankYouDelivered ? 'Resend Thank-You Email' : 'Send Thank-You to This Email'}</span>
              </button>
            )}
          </div>

          {/* Connected Channels & Platform Streams (Section 55 Omnichannel Customer 360) */}
          <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold flex items-center space-x-1.5">
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                <span>Connected Platforms</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
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
                    className={`p-2 rounded-md border text-xs cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-slate-700/80 border-emerald-500 text-white'
                        : 'bg-slate-900/60 border-slate-800 hover:bg-slate-700/40 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {renderChannelIcon(conv.channel, 3.5)}
                      <span className="capitalize font-medium">{conv.channel.toLowerCase()}</span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] text-slate-400">
                        {convMsgs.length} msgs
                      </span>
                      {conv.humanHandoff ? (
                        <span className="w-2 h-2 rounded-full bg-amber-400" title="Human Handoff" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-emerald-400" title="AI Active" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setIsUnifiedAllPlatforms(true)}
              className={`w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center space-x-1.5 border transition ${
                isUnifiedAllPlatforms
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>Open All-Platform Timeline</span>
            </button>
          </div>

          {/* Lead Qualification Score & Intent */}
          {activeLead && (
            <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Lead Score</span>
                <span className="font-bold text-emerald-400 text-sm">
                  {activeLead.leadScore} / 100
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${activeLead.leadScore}%` }}
                />
              </div>
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="text-slate-400">Intent:</span>
                <span
                  className={`px-1.5 py-0.2 rounded font-semibold ${
                    activeLead.intent === 'HIGH'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {activeLead.intent}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Buying Stage:</span>
                <span className="text-slate-200 font-medium">{activeLead.buyingStage}</span>
              </div>
            </div>
          )}

          {/* Demo Booking (Single Source of Truth) */}
          {activeLead && (
            <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700/60 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Demo Status</span>
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
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
                    // Also fire score delta or update to trigger refresh
                    onUpdateLeadScore(activeLead.leadId, 0);
                  } catch (e) {
                    console.error('Error toggling demo status:', e);
                  }
                }}
                className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 border transition ${
                  activeLead.demoStatus === 'BOOKED' || activeLead.status === 'DEMO_BOOKED'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                    : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
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

          {/* Section 23 Conversation Memory (Customer Facts & Extracted Requirements) */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold text-slate-300 flex items-center space-x-1">
              <Bot className="w-3.5 h-3.5 text-blue-400" />
              <span>Conversation Memory</span>
            </h5>

            {/* Requirements */}
            <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-800 text-xs space-y-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Extracted Needs:</span>
              <div className="flex flex-wrap gap-1">
                {(Array.isArray(activeLead?.requirements)
                  ? activeLead.requirements
                  : typeof activeLead?.requirements === 'string'
                  ? (activeLead.requirements as string).split('|').map((s) => s.trim())
                  : ['Umrah Packages', 'Costing Engine']
                ).map((req, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px]"
                  >
                    {req}
                  </span>
                ))}
              </div>
            </div>

            {/* Customer Facts */}
            {activeConversation.memory?.customerFacts && (
              <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-800 text-xs space-y-1">
                <span className="text-[11px] text-slate-400 font-medium">Customer Facts:</span>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  {activeConversation.memory.customerFacts.map((fact, i) => (
                    <li key={i} className="flex items-start space-x-1.5">
                      <span className="text-emerald-400 mt-0.5">•</span>
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
    </div>
  );
};
