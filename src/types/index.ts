export type Channel = 'WEBSITE' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'LINKEDIN' | 'EMAIL';

export type LeadSource = 'WEBSITE' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'LINKEDIN' | 'EMAIL' | 'APOLLO';

export type LeadType = 'INBOUND' | 'OUTBOUND';

export type LeadStatus =
  | 'NEW'
  | 'ENGAGED'
  | 'QUALIFIED'
  | 'DEMO_SCHEDULED'
  | 'PROPOSAL_SENT'
  | 'CLOSED_WON'
  | 'CLOSED_LOST'
  | 'NOT_INTERESTED'
  | 'UNSUBSCRIBED'
  | 'HUMAN_HANDOFF';

export type BuyingStage = 'AWARENESS' | 'CONSIDERATION' | 'DECISION' | 'PURCHASE';

export type IntentLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type CampaignStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED';

export type ProspectStatus =
  | 'PROSPECTED'
  | 'SELECTED'
  | 'EMAIL_QUEUED'
  | 'EMAIL_SENT'
  | 'DELIVERED'
  | 'REPLIED'
  | 'ENGAGED'
  | 'QUALIFIED'
  | 'MEETING_REQUESTED'
  | 'MEETING_BOOKED'
  | 'NOT_INTERESTED'
  | 'UNSUBSCRIBED'
  | 'BOUNCED'
  | 'HUMAN_HANDOFF';

export type KnowledgeStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED';

export type ChannelMode = 'SIMULATION' | 'REVIEW' | 'AUTO';
export type WhatsAppMode = 'AUTO' | 'HUMAN';

export interface WhatsAppConfig {
  channel: 'WHATSAPP';
  displayPhoneNumber: string; // '+91 9820252434'
  metaPhoneNumberId?: string;
  metaBusinessAccountId?: string;
  mode: WhatsAppMode;
  aiEnabled: boolean;
  webhookStatus: 'CONNECTED' | 'DISCONNECTED';
  connected: boolean;
  webhookUrl?: string;
  updatedAt: string;
}

export interface Contact {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  companyName: string;
  jobTitle?: string;
  whatsappUserId?: string;
  instagramUserId?: string;
  facebookUserId?: string;
  linkedinUserId?: string;
  apolloPersonId?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface Lead {
  leadId: string;
  contactId: string;
  source: LeadSource;
  leadType: LeadType;
  status: LeadStatus;
  leadScore: number; // 0-100
  intent: IntentLevel;
  buyingStage: BuyingStage;
  serviceInterest?: string;
  requirements: string[];
  budget?: string | null;
  timeline?: string | null;
  aiSummary?: string;
  aiRecommendation?: string;
  ownerId?: string;
  campaignId?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ConversationMemory {
  customerFacts: string[];
  requirements: string[];
  questionsAsked: string[];
  questionsAnswered: string[];
  questionsPending: string[];
  objections: string[];
  budget?: string | null;
  timeline?: string | null;
  buyingStage: BuyingStage;
  nextAction?: string;
}

export interface Conversation {
  conversationId: string;
  contactId: string;
  leadId?: string;
  channel: Channel;
  direction: 'INBOUND' | 'OUTBOUND';
  externalConversationId?: string;
  campaignId?: string;
  status: 'ACTIVE' | 'RESOLVED' | 'ARCHIVED' | 'REVIEW';
  aiEnabled: boolean;
  humanHandoff: boolean;
  managementMode?: 'AI' | 'HUMAN';
  conversationSummary?: string;
  memory?: ConversationMemory;
  startedAt: string;
  lastMessageAt: string;
  lastMessageText?: string;
  unreadCount?: number;
  isRead?: boolean;
  readAt?: string | null;
  unread?: boolean;
  emailThreadId?: string;
  gmailThreadId?: string;
  customerPhone?: string;
  whatsappMessageId?: string;
  draftReply?: {
    draftId: string;
    text: string;
    subject?: string;
    generatedAt: string;
    status: 'PENDING' | 'APPROVED' | 'DISCARDED';
  };
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  messageId: string;
  conversationId: string;
  channel: Channel;
  senderType: 'CUSTOMER' | 'PROSPECT' | 'AI' | 'AGENT' | 'HUMAN';
  senderName: string;
  senderEmail?: string;
  senderPhone?: string;
  fromPhone?: string;
  toPhone?: string;
  whatsappMessageId?: string;
  text: string;
  timestamp: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  aiReplied?: boolean;
  repliedAt?: string;
  repliedByMessageId?: string;
  sentAt?: string;
  receivedAt?: string;
  createdAt?: string;
  humanGenerated?: boolean;
  isDraft?: boolean;
  draftStatus?: 'PENDING' | 'APPROVED' | 'DISCARDED';
  aiProcessed?: boolean;
  aiGenerated?: boolean;
  confidence?: number;
  knowledgeSources?: string[];
  humanApproved?: boolean;
  emailMeta?: {
    subject?: string;
    from?: string;
    to?: string;
    cc?: string[];
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
  };
  whatsappMeta?: {
    from?: string;
    to?: string;
    displayPhoneNumber?: string;
    messageId?: string;
    profileName?: string;
    timestamp?: string;
  };
}


export interface EmailThread {
  emailThreadId: string;
  conversationId: string;
  subject: string;
  participants: string[];
  contactId: string;
  leadId?: string;
  campaignId?: string;
  firstMessageAt: string;
  lastMessageAt: string;
  status: 'OPEN' | 'REPLIED' | 'HUMAN_HANDOFF' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  category: 'PRODUCT' | 'MODULES' | 'PRICING' | 'B2B' | 'OPERATIONS' | 'FAQS' | 'INTEGRATIONS';
  content: string;
  tags: string[];
  status: KnowledgeStatus;
  version: number;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundCampaign {
  campaignId: string;
  name: string;
  description: string;
  targetIndustry: string;
  targetLocation: string;
  targetJobTitles: string[];
  targetCompanySize: string;
  apolloSearchConfiguration: {
    q_organization_keyword_tags?: string[];
    person_titles?: string[];
    person_locations?: string[];
    organization_num_employees_ranges?: string[];
  };
  emailAccountId: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  status: CampaignStatus;
  stats: {
    prospectsFound: number;
    prospectsQualified: number;
    emailsSent: number;
    replies: number;
    engaged: number;
    qualifiedLeads: number;
    meetingsRequested: number;
    unsubscribes: number;
    bounces: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OutboundProspect {
  prospectId: string;
  campaignId: string;
  apolloPersonId: string;
  apolloOrganizationId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle: string;
  companyName: string;
  industry: string;
  companySize: string;
  location: string;
  website?: string;
  linkedinUrl?: string;
  source: 'APOLLO';
  status: ProspectStatus;
  qualificationStatus: 'PENDING' | 'QUALIFIED' | 'DISQUALIFIED';
  qualificationScore?: number;
  qualificationReason?: string;
  emailThreadId?: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  activityId: string;
  leadId: string;
  contactId: string;
  type:
    | 'PROSPECT_ADDED'
    | 'COLD_EMAIL_SENT'
    | 'PROSPECT_REPLIED'
    | 'AI_REPLIED'
    | 'CUSTOMER_REPLIED'
    | 'HUMAN_TAKEOVER'
    | 'AI_RESUMED'
    | 'LEAD_QUALIFIED'
    | 'DEMO_REQUESTED'
    | 'NOTE_ADDED';
  title: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SystemSettings {
  channelModes: Record<Channel, ChannelMode>;
  whatsappMode?: WhatsAppMode;
  whatsappConfig?: WhatsAppConfig;
  sendingAccounts: Array<{ id: string; email: string; name: string; isDefault: boolean }>;
  emailSignature: string;
  debounceSeconds: number;
  apolloApiKeyConfigured: boolean;
  webhookEndpoint: string;
  updatedAt: string;
}

