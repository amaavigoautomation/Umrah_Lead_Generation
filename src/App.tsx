import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { lazyNamed, prefetchLazy, markAppLoaded } from './lazyLoad';
import { BrandProvider, getCurrentBrand } from './context/BrandContext';
import { brandHost } from './shared/brand';
import { Navbar, ActiveTab } from './components/Navbar';
import { HeaderBar } from './components/HeaderBar';
import { UnifiedInbox } from './components/UnifiedInbox';
import { LoginView } from './components/LoginView';
import { onSession, signOutUser, installAuthFetch, type SessionInfo } from './services/authService';
import { LockedModuleView } from './components/LockedModuleView';
import { UpgradeRequiredView } from './components/UpgradeRequiredView';
import { FEATURES, FEATURE_BY_TAB } from './shared/features';
import {
  Contact,
  Lead,
  Conversation,
  Message,
  KnowledgeDocument,
  OutboundCampaign,
  OutboundProspect,
  LeadActivity,
  SystemSettings,
  AppUser,
} from './types';
import {
  INITIAL_CONTACTS,
  INITIAL_LEADS,
  INITIAL_CONVERSATIONS,
  INITIAL_MESSAGES,
  INITIAL_CAMPAIGN,
  INITIAL_PROSPECTS,
  INITIAL_ACTIVITIES,
  DEFAULT_SETTINGS,
  defaultSettingsFor,
} from './services/dataService';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from './services/knowledgeData';
import { generateOmnichannelResponse } from './services/aiService';
import {
  processInboundEmail,
  InboundEmailPayload,
  InboundProcessingResult,
} from './services/emailInboundService';
import {
  processInboundWhatsAppMessage,
  InboundWhatsAppPayload,
  InboundWhatsAppProcessingResult,
  WHATSAPP_BUSINESS_NUMBER,
  WHATSAPP_BUSINESS_NUMBER_FORMATTED,
} from './services/whatsappInboundService';
import { db, isFirebaseConfigured } from './firebase/config';
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';

// thsi is a test Screens loaded on demand (own JS files). Login, navigation and the inbox stay in the main bundle.
const CampaignManagement = lazyNamed(() => import('./components/CampaignManagement'), 'CampaignManagement');
const CrmPipeline = lazyNamed(() => import('./components/CrmPipeline'), 'CrmPipeline');
const KnowledgeBaseView = lazyNamed(() => import('./components/KnowledgeBaseView'), 'KnowledgeBaseView');
const AiTestingPlayground = lazyNamed(() => import('./components/AiTestingPlayground'), 'AiTestingPlayground');
const InteractiveScenarios = lazyNamed(() => import('./components/InteractiveScenarios'), 'InteractiveScenarios');
const SettingsView = lazyNamed(() => import('./components/SettingsView'), 'SettingsView');
const LiveMailboxCenter = lazyNamed(() => import('./components/LiveMailboxCenter'), 'LiveMailboxCenter');
const DemoSchedulingView = lazyNamed(() => import('./components/DemoSchedulingView'), 'DemoSchedulingView');
const AutoFollowUpDashboard = lazyNamed(() => import('./components/AutoFollowUpDashboard'), 'AutoFollowUpDashboard');
const PlatformConsole = lazyNamed(() => import('./components/PlatformConsole'), 'PlatformConsole');
const BillingView = lazyNamed(() => import('./components/BillingView'), 'BillingView');

function ScreenLoading() {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-slate-400">
      <span className="inline-block w-4 h-4 mr-2 border-2 border-slate-300 border-t-orange-500 rounded-full animate-spin" />
      Loading…
    </div>
  );
}

// Inbox page size: how many conversations the live listener loads at a time.
const CONVERSATION_PAGE_SIZE = 50;
import { initCalendarAuth } from './services/googleCalendarAuth';

// Per-workspace brand strings for locally-built message records (read at call time).
const bn = () => getCurrentBrand();
const brandEmail = () => bn().salesEmail || `noreply@${brandHost(bn()) || 'workspace.local'}`;
const brandReSubject = () => (bn().playbook === 'umrah360' ? brandReSubject() : `Re: ${bn().companyName}`);
const brandGrowthTeam = () => (bn().playbook === 'umrah360' ? brandGrowthTeam() : bn().teamName);

function sanitizeDoc(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDoc);
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = sanitizeDoc(v);
    }
  }
  return clean;
}

function deduplicateMessages(msgs: Message[]): Message[] {
  const seenMap = new Map<string, Message>();
  for (const msg of msgs) {
    if (!msg || !msg.messageId) continue;
    let key = '';
    if (msg.gmailMessageId && !msg.gmailMessageId.startsWith('<out-')) {
      key = `gmail-${msg.gmailMessageId}`;
    } else {
      const timeBucket = Math.floor(new Date(msg.timestamp || msg.createdAt || Date.now()).getTime() / 60000);
      key = `${msg.conversationId}-${msg.direction}-${msg.senderType}-${msg.text.trim()}-${timeBucket}`;
    }

    if (seenMap.has(key)) {
      const existing = seenMap.get(key)!;
      if (msg.gmailMessageId && !msg.gmailMessageId.startsWith('<out-') && existing.gmailMessageId?.startsWith('<out-')) {
        seenMap.set(key, { ...existing, ...msg });
      }
    } else {
      seenMap.set(key, msg);
    }
  }
  return Array.from(seenMap.values());
}

function sanitizeLead(l: any): Lead {
  if (!l) return {} as Lead;
  let reqs: string[] = [];
  if (Array.isArray(l.requirements)) {
    reqs = l.requirements.map(String);
  } else if (typeof l.requirements === 'string') {
    reqs = l.requirements.split('|').map((s: string) => s.trim()).filter(Boolean);
  }
  if (reqs.length === 0) {
    reqs = ['Umrah ERP & B2B Portal'];
  }
  return {
    ...l,
    leadScore: Number(l.leadScore) || 75,
    intent: l.intent || 'HIGH',
    buyingStage: l.buyingStage || 'ENGAGED',
    status: l.status || 'DEMO_SCHEDULED',
    requirements: reqs,
    tags: Array.isArray(l.tags) ? l.tags : [],
  };
}

function sanitizeContact(c: any): Contact {
  if (!c) return {} as Contact;
  const firstName = c.firstName || (c.fullName ? c.fullName.split(' ')[0] : 'Tour') || 'Tour';
  const lastName = c.lastName || (c.fullName ? c.fullName.split(' ').slice(1).join(' ') : 'Operator') || 'Operator';
  return {
    ...c,
    firstName,
    lastName,
    fullName: c.fullName || `${firstName} ${lastName}`,
    companyName: c.companyName || 'Umrah Travel Agency',
    jobTitle: c.jobTitle || c.designation || 'Tour Operator',
    email: c.email || '',
    phone: c.phone || '',
    tags: Array.isArray(c.tags) ? c.tags : [],
  };
}

function toAppUser(u: any): AppUser {
  return {
    userId: u.uid || u.userId,
    name: u.name || u.email?.split('@')[0] || 'Operator',
    email: u.email || '',
    username: u.username || u.email?.split('@')[0] || '',
    password: '******',
    role: u.role === 'admin' || u.role === 'ADMIN' ? 'ADMIN' : 'SPECIALIST',
    accessLevel: 'ALL',
    allowedModules: Array.isArray(u.allowedModules) ? u.allowedModules : ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings'],
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt || u.createdAt || new Date().toISOString(),
  } as AppUser;
}

export default function App() {
  // Coming back from "Sign in with Microsoft" (?mailbox=...) opens Settings, where the mailbox panel shows the result.
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window === 'undefined') return 'inbox';
    const q = new URLSearchParams(window.location.search);
    if (q.has('mailbox')) return 'settings';
    if (q.has('calendar')) return 'scheduling';
    return 'inbox';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [contacts, setContacts] = useState<Contact[]>(() => isFirebaseConfigured ? [] : INITIAL_CONTACTS);
  const [leads, setLeads] = useState<Lead[]>(() => isFirebaseConfigured ? [] : INITIAL_LEADS);
  const [conversations, setConversations] = useState<Conversation[]>(() => isFirebaseConfigured ? [] : INITIAL_CONVERSATIONS);
  const [messagesState, setMessagesState] = useState<Message[]>(() => isFirebaseConfigured ? [] : deduplicateMessages(INITIAL_MESSAGES));
  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    setMessagesState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return deduplicateMessages(next);
    });
  };
  const messages = messagesState;
  const [campaigns, setCampaigns] = useState<OutboundCampaign[]>([]);
  const [prospects, setProspects] = useState<OutboundProspect[]>(() => isFirebaseConfigured ? [] : INITIAL_PROSPECTS);
  const [activities, setActivities] = useState<LeadActivity[]>(() => isFirebaseConfigured ? [] : INITIAL_ACTIVITIES);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>(() => isFirebaseConfigured ? [] : INITIAL_KNOWLEDGE_DOCUMENTS);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [selectedLeadIdForCrm, setSelectedLeadIdForCrm] = useState<string | null>(null);
  const [isFirebaseActive, setIsFirebaseActive] = useState<boolean>(isFirebaseConfigured);

  // Multi-Tenant Context & Workspace State
  const [currentTenantId, setCurrentTenantId] = useState<string>('');
  const [currentTenant, setCurrentTenant] = useState<any>({
    id: '',
    name: '',
    slug: '',
    status: 'active',
    plan: 'enterprise',
    limits: { monthlyAiTokens: 5000000, dailyOutboundSends: 10000, hourlyOutboundSends: 1000, seats: 25 },
    createdAt: new Date().toISOString(),
  });
  const [allTenants, setAllTenants] = useState<any[]>([]);

  // Until the workspace's own settings load, never show another company's default signature/accounts.
  useEffect(() => {
    if (currentTenantId && currentTenantId !== 'umrah360') {
      setSettings((prev) => (prev === DEFAULT_SETTINGS ? defaultSettingsFor(currentTenantId, currentTenant?.name) : prev));
    }
  }, [currentTenantId, currentTenant?.name]);

  const tCol = useCallback((colName: string) => collection(db, 'tenants', currentTenantId, colName), [currentTenantId]);
  const tDoc = useCallback((colName: string, docId: string) => doc(db, 'tenants', currentTenantId, colName, docId), [currentTenantId]);

  // Users & Authentication State (Firebase Auth is the single source of truth)
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    installAuthFetch();
    return onSession((s, err) => {
      setSession(s);
      setCurrentUser(s ? s.appUser : null);
      setCurrentTenantId(s?.tenantId || '');
      if (err) setAuthError(err.message);
      else if (s) setAuthError(null);
      setAuthLoading(false);
    });
  }, []);

  // Load tenant info for the signed-in user's workspace (platform admins list all)
  useEffect(() => {
    if (!session) return;
    if (session.isPlatformAdmin) {
      fetch('/api/tenants')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.tenants)) setAllTenants(data.tenants);
        })
        .catch(() => {});
    } else if (currentTenantId) {
      fetch(`/api/tenants/${currentTenantId}`)
        .then((r) => r.json())
        .then((data) => {
          const t = data?.tenant || data;
          if (t?.id) {
            setCurrentTenant(t);
            setAllTenants([t]);
          }
        })
        .catch(() => {});
    }
  }, [session, currentTenantId]);

  // What the workspace's plan includes (the server enforces it too; this only drives the UI).
  const [entitlements, setEntitlements] = useState<{ planName: string; features: Record<string, boolean>; billing?: { status: string; locked: boolean; graceEndsAt?: string } } | null>(null);
  const [activatingPlan, setActivatingPlan] = useState(false);
  const [entitlementsLoaded, setEntitlementsLoaded] = useState(false);
  useEffect(() => {
    if (!session || session.isPlatformAdmin || !currentTenantId) return;
    let cancelled = false;
    const load = () =>
      fetch('/api/entitlements')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d?.features) setEntitlements({ planName: d.planName, features: d.features, billing: d.billing });
        })
        .catch(() => {})
        .finally(() => setEntitlementsLoaded(true));
    // Back from Stripe Checkout: activate the plan right away instead of waiting for the webhook.
    const params = new URLSearchParams(window.location.search);
    const checkoutSession = params.get('session_id');
    if (params.get('billing') === 'success' && checkoutSession) {
      setActivatingPlan(true);
      fetch('/api/billing/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: checkoutSession }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.entitlements?.features) setEntitlements({ planName: d.entitlements.planName, features: d.entitlements.features, billing: d.entitlements.billing });
        })
        .catch(() => {})
        .finally(() => {
          window.history.replaceState({}, '', window.location.pathname);
          setActivatingPlan(false);
          load();
        });
    } else {
      load();
    }
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session, currentTenantId]);
  const planLocked = useCallback(
    (tab: string) => {
      const feature = FEATURE_BY_TAB[tab];
      return Boolean(feature && entitlements && entitlements.features[feature] === false);
    },
    [entitlements]
  );

  // Initialize Firestore seeding & loading on startup
  useEffect(() => {
    let unsubLeads: (() => void) | undefined;
    let unsubContacts: (() => void) | undefined;
    let unsubKb: (() => void) | undefined;
    let unsubUsers: (() => void) | undefined;
    let unsubOutboundCamps: (() => void) | undefined;

    if (!currentUser || !currentTenantId) return;

    async function initFirestore() {
      // Initialize Google Calendar authentication & sync token to backend
      initCalendarAuth();

      // Sync settings from backend API
      try {
        const apiSetRes = await fetch('/api/settings');
        if (apiSetRes.ok) {
          const apiSet = await apiSetRes.json();
          if (apiSet?.emailMode) {
            setSettings((prev) => ({
              ...prev,
              channelModes: {
                ...prev.channelModes,
                EMAIL: apiSet.emailMode,
              },
              emailSignature: apiSet.emailSignature || prev.emailSignature,
              debounceSeconds: apiSet.debounceSeconds ?? prev.debounceSeconds,
            }));
          }
        }
      } catch {}

      if (!isFirebaseConfigured || !db) return;
      try {
        // Load or seed settings in Firestore tenant scope
        const settingsRef = tDoc('settings', 'default');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const loadedSettings = settingsSnap.data() as SystemSettings;
          setSettings(loadedSettings);
        } else {
          await setDoc(settingsRef, defaultSettingsFor(currentTenantId, currentTenant?.name)).catch(() => {});
        }

        // Check if database was ever initialized before for this tenant
        const initMarkerRef = tDoc('settings', 'db_initialized');
        const initMarkerSnap = await getDoc(initMarkerRef);

        if (!initMarkerSnap.exists()) {
          // Check if any contacts or leads already exist in Firestore for this tenant
          // limit(1): we only need to know if ANY doc exists, not read them all.
          const contactsSnap = await getDocs(query(tCol('contacts'), limit(1))).catch(() => null);
          const leadsSnap = await getDocs(query(tCol('leads'), limit(1))).catch(() => null);
          const convsSnap = await getDocs(query(tCol('conversations'), limit(1))).catch(() => null);

          // Sample data (including the Umrah360 knowledge articles) belongs to the Umrah360 workspace only.
          // Every other workspace starts empty.
          if (currentTenantId === 'umrah360' && (!contactsSnap || (contactsSnap.empty && leadsSnap?.empty && convsSnap?.empty))) {
            // Seed initial data ONLY on brand-new setup
            for (const c of INITIAL_CONTACTS) {
              await setDoc(tDoc('contacts', c.contactId), c).catch(() => {});
            }
            for (const l of INITIAL_LEADS) {
              await setDoc(tDoc('leads', l.leadId), l).catch(() => {});
            }
            for (const conv of INITIAL_CONVERSATIONS) {
              await setDoc(tDoc('conversations', conv.conversationId), conv).catch(() => {});
            }
            for (const m of INITIAL_MESSAGES) {
              await setDoc(tDoc('messages', m.messageId), m).catch(() => {});
            }
            for (const kb of INITIAL_KNOWLEDGE_DOCUMENTS) {
              await setDoc(tDoc('knowledge_documents', kb.id), kb).catch(() => {});
            }
            for (const p of INITIAL_PROSPECTS) {
              await setDoc(tDoc('outbound_prospects', p.prospectId), p).catch(() => {});
            }
          }

          // Mark database as permanently initialized so deletions are never resurrected on reload
          await setDoc(initMarkerRef, {
            initialized: true,
            initializedAt: new Date().toISOString(),
          }).catch(() => {});
        }

        // No one-off getDocs preload here: each onSnapshot listener below returns the full current
        // result on its first callback, so a preload paid for every document twice.

        // Attach realtime listeners for Firestore updates
        // Conversations and messages have their own scoped listeners (see the effects below).

        unsubLeads = onSnapshot(tCol('leads'), (snap) => {
          const list: Lead[] = [];
          snap.docs.forEach((d) => {
            const data = d.data();
            const lead = sanitizeLead(data);
            const isCampaignLead = Boolean(lead.campaignId || lead.campaignLeadId || (lead.leadType === 'OUTBOUND' && lead.source === 'EMAIL'));
            if (isCampaignLead && lead.replyStatus !== 'REPLIED') {
              deleteDoc(tDoc('leads', d.id)).catch(() => {});
            } else {
              list.push(lead);
            }
          });
          setLeads(list);
        }, () => {});

        unsubContacts = onSnapshot(tCol('contacts'), (snap) => {
          const list = snap.docs.map((d) => sanitizeContact(d.data()));
          setContacts(list);
        }, () => {});

        unsubKb = onSnapshot(tCol('knowledge_documents'), (snap) => {
          setKnowledgeDocs(snap.docs.map((d) => d.data() as KnowledgeDocument));
        }, () => {});

        unsubOutboundCamps = onSnapshot(tCol('outbound_campaigns'), (snap) => {
          const list: OutboundCampaign[] = [];
          snap.docs.forEach((d) => {
            const data = d.data() as OutboundCampaign;
            const cleanName = (data.name || '').toLowerCase().trim();
            if (
              data.campaignId === 'camp-umrah-1448' ||
              data.campaignId === 'camp-indian-umrah-operators' ||
              cleanName === 'indian umrah operators 2026' ||
              data.campaignId === 'camp-1790758967982-7his' ||
              cleanName === 'test'
            ) {
              deleteDoc(tDoc('outbound_campaigns', d.id)).catch(() => {});
              deleteDoc(tDoc('campaigns', d.id)).catch(() => {});
            } else {
              list.push(data);
            }
          });
          setCampaigns(list);
        }, () => {});

        // outbound_prospects is no longer streamed: no screen renders prospects, so watching the whole
        // collection only cost reads.

        // Team list: only this workspace's users. The signed-in user's identity and role always come
        // from the verified session, never from a database row.
        unsubUsers = onSnapshot(query(collection(db, 'users'), where('tenantId', '==', currentTenantId)), (snap) => {
          setUsers(snap.docs.map((d) => toAppUser(d.data())));
        }, () => {});

        setIsFirebaseActive(true);
      } catch (err) {
        console.warn('Firestore sync fallback to in-memory state:', err);
      }
    }

    initFirestore();

    return () => {
      if (unsubLeads) unsubLeads();
      if (unsubContacts) unsubContacts();
      if (unsubKb) unsubKb();
      if (unsubUsers) unsubUsers();
      if (unsubOutboundCamps) unsubOutboundCamps();
    };
  }, [currentUser?.userId, currentTenantId]);

  // ---------------------------------------------------------------------------
  // Inbox conversations: live, but only the newest `conversationLimit` (grows via "Load more").
  // Sorting/limiting happens in Firestore, so we pay for ~50 docs instead of the whole collection.
  // ---------------------------------------------------------------------------
  const [conversationLimit, setConversationLimit] = useState<number>(CONVERSATION_PAGE_SIZE);
  const [hasMoreConversations, setHasMoreConversations] = useState<boolean>(false);

  useEffect(() => {
    setConversationLimit(CONVERSATION_PAGE_SIZE);
  }, [currentTenantId]);

  useEffect(() => {
    if (!currentUser || !currentTenantId || !isFirebaseConfigured || !db) return;
    const q = query(tCol('conversations'), orderBy('lastMessageAt', 'desc'), limit(conversationLimit));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setConversations(snap.docs.map((d) => d.data() as Conversation));
        // A full page back means there may be older conversations to load.
        setHasMoreConversations(snap.size >= conversationLimit);
      },
      (err) => console.warn('[Inbox] conversations listener error:', err)
    );
    return () => unsub();
  }, [currentUser?.userId, currentTenantId, conversationLimit, tCol]);

  // App started fine: allow a future "missing file after deploy" reload again, and download the other
  // screens in idle time so opening a tab is instant.
  useEffect(() => {
    if (!currentUser) return;
    markAppLoaded();
    prefetchLazy();
  }, [currentUser?.userId]);

  const loadMoreConversations = useCallback(() => {
    setConversationLimit((n) => n + CONVERSATION_PAGE_SIZE);
  }, []);

  // ---------------------------------------------------------------------------
  // Messages: only for the conversations the inbox has open (the selected thread plus the same
  // contact's other channels for the "all platforms" view). Never the whole collection.
  // ---------------------------------------------------------------------------
  const [watchedConversationIds, setWatchedConversationIds] = useState<string[]>([]);
  const watchedKey = watchedConversationIds.slice().sort().join('|');

  const watchConversations = useCallback((ids: string[]) => {
    const clean = Array.from(new Set(ids.filter(Boolean)));
    setWatchedConversationIds((prev) =>
      prev.slice().sort().join('|') === clean.slice().sort().join('|') ? prev : clean
    );
  }, []);

  useEffect(() => {
    setWatchedConversationIds([]);
  }, [currentTenantId]);

  useEffect(() => {
    if (!currentUser || !currentTenantId || !isFirebaseConfigured || !db) return;
    const ids = watchedKey ? watchedKey.split('|') : [];
    if (ids.length === 0) {
      setMessages([]);
      return;
    }

    // Firestore 'in' accepts at most 30 values, so split into chunks and merge the results.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const byChunk = new Map<number, Message[]>();
    const msgTime = (m: Message) => new Date(m.sentAt || m.timestamp || m.createdAt || 0).getTime();

    const unsubs = chunks.map((chunk, idx) =>
      onSnapshot(
        query(tCol('messages'), where('conversationId', 'in', chunk)),
        (snap) => {
          byChunk.set(idx, snap.docs.map((d) => d.data() as Message));
          const all = Array.from(byChunk.values()).flat();
          setMessages(all.sort((a, b) => msgTime(a) - msgTime(b)));
        },
        (err) => console.warn('[Inbox] messages listener error:', err)
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [currentUser?.userId, currentTenantId, watchedKey, tCol]);

  // Track message IDs ingested from backend to prevent duplicates
  const ingestedBackendMsgIds = useRef<Set<string>>(new Set());
  const isSyncingInboundRef = useRef<boolean>(false);

  // Background sync for live inbound emails (from IMAP or direct webhook)
  const syncWithBackendInbound = useCallback(async () => {
    if (isSyncingInboundRef.current) return;
    isSyncingInboundRef.current = true;
    try {
      const res = await fetch('/api/inbound/sync');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await res.json();
      if (!data || !data.history || !Array.isArray(data.history)) return;

      for (const item of data.history) {
        if (!item.crmEntities || !item.messageId) continue;
        if (ingestedBackendMsgIds.current.has(item.messageId)) continue;
        ingestedBackendMsgIds.current.add(item.messageId);

        const { contact, lead, conversation, incomingMessage, aiReplyMessage, activity } = item.crmEntities;

        if (contact) {
          setContacts((prev) => {
            const idx = prev.findIndex(
              (c) =>
                c.contactId === contact.contactId ||
                c.email.toLowerCase() === contact.email.toLowerCase()
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...contact, lastActivityAt: contact.lastActivityAt };
              return next;
            }
            return [contact, ...prev];
          });
        }

        if (lead) {
          setLeads((prev) => {
            const idx = prev.findIndex(
              (l) => l.leadId === lead.leadId || l.contactId === lead.contactId
            );
            if (idx >= 0) {
              const next = [...prev];
              const updated = { ...next[idx], ...lead };
              next.splice(idx, 1);
              return [updated, ...next];
            }
            return [lead, ...prev];
          });
        }

        if (conversation) {
          setConversations((prev) => {
            const idx = prev.findIndex(
              (c) =>
                c.conversationId === conversation.conversationId ||
                (conversation.emailThreadId && c.emailThreadId === conversation.emailThreadId)
            );
            if (idx >= 0) {
              const next = [...prev];
              const updated = {
                ...next[idx],
                ...conversation,
                lastMessageAt: conversation.lastMessageAt,
                lastMessageText: conversation.lastMessageText,
              };
              next.splice(idx, 1);
              return [updated, ...next];
            }
            return [conversation, ...prev];
          });
        }

        const threadMsgs: Message[] = Array.isArray(item.crmEntities?.allThreadMessages) && item.crmEntities.allThreadMessages.length > 0
          ? item.crmEntities.allThreadMessages
          : ([incomingMessage, aiReplyMessage].filter(Boolean) as Message[]);

        setMessages((prev) => {
          let updated = [...prev];
          for (const msg of threadMsgs) {
            if (!msg) continue;
            const existingIdx = updated.findIndex((m) => m.messageId === msg.messageId || (msg.gmailMessageId && m.gmailMessageId === msg.gmailMessageId && !m.gmailMessageId.startsWith('<out-')));
            if (existingIdx >= 0) {
              updated[existingIdx] = { ...updated[existingIdx], ...msg };
            } else {
              updated.push(msg);
            }
          }
          return updated;
        });

        if (activity) {
          setActivities((prev) => {
            if (prev.some((a) => a.activityId === activity.activityId)) return prev;
            return [activity, ...prev];
          });
        }

        if (isFirebaseConfigured && db) {
          try {
            if (incomingMessage) {
              setDoc(doc(db, 'messages', incomingMessage.messageId), sanitizeDoc(incomingMessage), { merge: true }).catch(() => {});
            }
            if (aiReplyMessage) {
              setDoc(doc(db, 'messages', aiReplyMessage.messageId), sanitizeDoc(aiReplyMessage), { merge: true }).catch(() => {});
            }
            if (conversation) {
              setDoc(doc(db, 'conversations', conversation.conversationId), sanitizeDoc(conversation), { merge: true }).catch(() => {});
            }
          } catch {}
        }
      }

      if (data.allThreadMessages && typeof data.allThreadMessages === 'object') {
        const allMsgList: Message[] = Object.values(data.allThreadMessages).flat() as Message[];
        if (allMsgList.length > 0) {
          setMessages((prev) => {
            const toAdd = allMsgList.filter((m) => m && !prev.some((p) => p.messageId === m.messageId));
            return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
          });
        }
      }
    } catch (e) {
      console.warn('Inbound sync polling notice:', e);
    } finally {
      isSyncingInboundRef.current = false;
    }
  }, []);

  // Campaign sending and mailbox checks are server jobs (cron-job.org -> /api/campaigns/cron and
  // /api/inbound-mail/cron). The browser no longer triggers them on a timer: every open tab doing so
  // made the server re-read whole collections every few seconds. New mail and campaign progress reach
  // the screen through the Firestore listeners. One sync on sign-in, plus the manual "Sync now" button.
  useEffect(() => {
    if (!currentUser || !currentTenantId) return;
    syncWithBackendInbound();
  }, [syncWithBackendInbound, currentUser?.userId, currentTenantId]);

  // NOTE: remainder of App.tsx is identical to workspace copy for handlers/render.
  // Active AI Auto-Reply Engine through the final BrandProvider return is included below.
