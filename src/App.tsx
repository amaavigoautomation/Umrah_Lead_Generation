import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { UnifiedInbox } from './components/UnifiedInbox';
import { CampaignManagement } from './components/CampaignManagement';
import { OutboundCampaigns } from './components/OutboundCampaigns';
import { CrmPipeline } from './components/CrmPipeline';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { AiTestingPlayground } from './components/AiTestingPlayground';
import { InteractiveScenarios } from './components/InteractiveScenarios';
import { SettingsView } from './components/SettingsView';
import { LiveMailboxCenter } from './components/LiveMailboxCenter';
import { DemoSchedulingView } from './components/DemoSchedulingView';
import { LoginView } from './components/LoginView';
import { LockedModuleView } from './components/LockedModuleView';
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
  INITIAL_USERS,
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
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { initCalendarAuth } from './services/googleCalendarAuth';

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

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('inbox');
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
  const [currentTenantId, setCurrentTenantId] = useState<string>('umrah360');
  const [currentTenant, setCurrentTenant] = useState<any>({
    id: 'umrah360',
    name: 'Umrah360 Flagship',
    slug: 'umrah360',
    status: 'active',
    plan: 'enterprise',
    limits: { monthlyAiTokens: 5000000, dailyOutboundSends: 10000, hourlyOutboundSends: 1000, seats: 25 },
    createdAt: new Date().toISOString(),
  });
  const [allTenants, setAllTenants] = useState<any[]>([]);

  const tCol = useCallback((colName: string) => collection(db, 'tenants', currentTenantId, colName), [currentTenantId]);
  const tDoc = useCallback((colName: string, docId: string) => doc(db, 'tenants', currentTenantId, colName, docId), [currentTenantId]);

  // Load Tenants list
  useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.tenants) && data.tenants.length > 0) {
          setAllTenants(data.tenants);
          const matched = data.tenants.find((t: any) => t.id === currentTenantId);
          if (matched) setCurrentTenant(matched);
        }
      })
      .catch(() => {});
  }, [currentTenantId]);

  // Users & Authentication State
  const [users, setUsers] = useState<AppUser[]>(INITIAL_USERS);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    try {
      const saved = localStorage.getItem('umrah360_user_session');
      return saved ? JSON.parse(saved) : INITIAL_USERS[0];
    } catch {
      return INITIAL_USERS[0];
    }
  });

  // Initialize Firestore seeding & loading on startup
  useEffect(() => {
    let unsubConvs: (() => void) | undefined;
    let unsubMsgs: (() => void) | undefined;
    let unsubLeads: (() => void) | undefined;
    let unsubContacts: (() => void) | undefined;
    let unsubKb: (() => void) | undefined;
    let unsubUsers: (() => void) | undefined;
    let unsubOutboundCamps: (() => void) | undefined;
    let unsubOutboundProspects: (() => void) | undefined;

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
          await setDoc(settingsRef, DEFAULT_SETTINGS).catch(() => {});
        }

        // Check if database was ever initialized before for this tenant
        const initMarkerRef = tDoc('settings', 'db_initialized');
        const initMarkerSnap = await getDoc(initMarkerRef);

        if (!initMarkerSnap.exists()) {
          // Check if any contacts or leads already exist in Firestore for this tenant
          const contactsSnap = await getDocs(tCol('contacts')).catch(() => null);
          const leadsSnap = await getDocs(tCol('leads')).catch(() => null);
          const convsSnap = await getDocs(tCol('conversations')).catch(() => null);

          if (!contactsSnap || (contactsSnap.empty && leadsSnap?.empty && convsSnap?.empty)) {
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

        // Load persisted entities from Firestore so state reflects actual database state
        const [convsSnap, msgsSnap, leadsSnap, contsSnap, kbSnap, campSnap, usersSnap, prospectsSnap] = await Promise.all([
          getDocs(query(tCol('conversations'), orderBy('lastMessageAt', 'desc'))).catch(() => null),
          getDocs(query(tCol('messages'), orderBy('sentAt', 'asc'))).catch(() => null),
          getDocs(tCol('leads')).catch(() => null),
          getDocs(tCol('contacts')).catch(() => null),
          getDocs(tCol('knowledge_documents')).catch(() => null),
          getDocs(tCol('outbound_campaigns')).catch(() => null),
          getDocs(collection(db, 'users')).catch(() => null),
          getDocs(tCol('outbound_prospects')).catch(() => null),
        ]);

        // Filter and purge legacy test/default campaigns from Firestore
        const validCampaigns: OutboundCampaign[] = [];
        if (campSnap && !campSnap.empty) {
          campSnap.docs.forEach((d) => {
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
              validCampaigns.push(data);
            }
          });
        }

        // Always set the exact documents present in Firestore (if user deleted documents, reflects empty/subset)
        if (convsSnap) setConversations(convsSnap.docs.map((d) => d.data() as Conversation));
        if (msgsSnap) setMessages(msgsSnap.docs.map((d) => d.data() as Message));
        if (leadsSnap) setLeads(leadsSnap.docs.map((d) => sanitizeLead(d.data())));
        if (contsSnap) setContacts(contsSnap.docs.map((d) => sanitizeContact(d.data())));
        if (kbSnap) setKnowledgeDocs(kbSnap.docs.map((d) => d.data() as KnowledgeDocument));
        setCampaigns(validCampaigns);
        setProspects(prospectsSnap ? prospectsSnap.docs.map((d) => d.data() as OutboundProspect) : []);

        // Initialize / sync users
        if (!usersSnap || usersSnap.empty) {
          setUsers(INITIAL_USERS);
        } else {
          const tenantUsers = usersSnap.docs
            .map((d) => d.data())
            .filter((u) => u.tenantId === currentTenantId || !u.tenantId)
            .map((u) => ({
              userId: u.uid || u.userId,
              name: u.name || u.email?.split('@')[0] || 'Operator',
              email: u.email || '',
              username: u.username || u.email?.split('@')[0] || '',
              password: u.password || '******',
              role: u.role === 'admin' || u.role === 'ADMIN' ? 'ADMIN' : 'SPECIALIST',
              accessLevel: 'ALL',
              allowedModules: u.allowedModules || ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings'],
              createdAt: u.createdAt || new Date().toISOString(),
            })) as AppUser[];
          setUsers(tenantUsers.length > 0 ? tenantUsers : INITIAL_USERS);
        }

        // Attach realtime listeners for Firestore updates
        unsubConvs = onSnapshot(tCol('conversations'), (snap) => {
          const list = snap.docs.map((d) => d.data() as Conversation);
          setConversations(
            list.sort(
              (a, b) =>
                new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
                new Date(a.lastMessageAt || a.createdAt || 0).getTime()
            )
          );
        }, () => {});

        unsubMsgs = onSnapshot(tCol('messages'), (snap) => {
          const list = snap.docs.map((d) => d.data() as Message);
          setMessages(
            list.sort(
              (a, b) =>
                new Date(a.sentAt || a.timestamp || a.createdAt || 0).getTime() -
                new Date(b.sentAt || b.timestamp || b.createdAt || 0).getTime()
            )
          );
        }, () => {});

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

        unsubOutboundProspects = onSnapshot(tCol('outbound_prospects'), (snap) => {
          if (!snap.empty) {
            setProspects(snap.docs.map((d) => d.data() as OutboundProspect));
          }
        }, () => {});

        unsubUsers = onSnapshot(collection(db, 'app_users'), (snap) => {
          if (!snap.empty) {
            const list = snap.docs.map((d) => d.data() as AppUser);
            setUsers(list);
            setCurrentUser((prev) => {
              if (!prev) return null;
              const updated = list.find((u) => u.userId === prev.userId || u.email.toLowerCase() === prev.email.toLowerCase());
              if (updated) {
                try {
                  localStorage.setItem('umrah360_user_session', JSON.stringify(updated));
                } catch {}
                return updated;
              }
              return prev;
            });
          }
        });

        setIsFirebaseActive(true);
      } catch (err) {
        console.warn('Firestore sync fallback to in-memory state:', err);
      }
    }

    initFirestore();

    return () => {
      if (unsubConvs) unsubConvs();
      if (unsubMsgs) unsubMsgs();
      if (unsubLeads) unsubLeads();
      if (unsubContacts) unsubContacts();
      if (unsubKb) unsubKb();
      if (unsubUsers) unsubUsers();
      if (unsubOutboundCamps) unsubOutboundCamps();
      if (unsubOutboundProspects) unsubOutboundProspects();
    };
  }, []);

  // Track message IDs ingested from backend to prevent duplicates
  const ingestedBackendMsgIds = useRef<Set<string>>(new Set());
  const isSyncingInboundRef = useRef<boolean>(false);
  const isDispatchingCampaignsRef = useRef<boolean>(false);

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

  // Global campaign dispatch keep-alive: ensures RUNNING campaigns dispatch continuously
  // regardless of which tab is active, or whether CampaignManagement component is mounted
  const triggerActiveCampaignsDispatch = useCallback(async () => {
    if (isDispatchingCampaignsRef.current) return;
    isDispatchingCampaignsRef.current = true;
    try {
      await fetch('/api/campaigns/process-active', { method: 'POST' }).catch(() => null);
    } catch {} finally {
      isDispatchingCampaignsRef.current = false;
    }
  }, []);

  // Poll backend inbound mailbox and trigger active campaign dispatches safely (25s interval)
  useEffect(() => {
    syncWithBackendInbound();
    triggerActiveCampaignsDispatch();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncWithBackendInbound();
        triggerActiveCampaignsDispatch();
      }
    }, 25000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncWithBackendInbound();
        triggerActiveCampaignsDispatch();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [syncWithBackendInbound, triggerActiveCampaignsDispatch]);

  // Active AI Auto-Reply Engine: checks for any unreplied inbound customer messages in AI-enabled threads
  const autoRepliedTurnsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (conversations.length === 0 || messages.length === 0) return;

    for (const conv of conversations) {
      if (!conv.aiEnabled || conv.humanHandoff) continue;

      // CRITICAL: Website Demo Leads must NEVER be auto-replied by generic inbox AI.
      // Website leads receive their single verified thank-you email upon submission.
      const isWebsiteLeadConv =
        conv.channel === 'WEBSITE' ||
        conv.conversationId?.startsWith('conv-web-') ||
        conv.conversationSummary?.includes('Website Demo Request') ||
        conv.subject?.includes('Website Demo Request') ||
        Boolean(conv.thankYouEmailSent);

      if (isWebsiteLeadConv) {
        continue;
      }

      const threadMsgs = messages.filter((m) => m.conversationId === conv.conversationId);
      if (threadMsgs.length === 0) continue;

      const lastMsg = threadMsgs[threadMsgs.length - 1];
      if (
        lastMsg &&
        lastMsg.direction === 'INBOUND' &&
        (lastMsg.senderType === 'CUSTOMER' || lastMsg.senderType === 'PROSPECT') &&
        !lastMsg.aiReplied
      ) {
        const turnKey = `${conv.conversationId}-${lastMsg.messageId}`;
        if (autoRepliedTurnsRef.current.has(turnKey)) continue;
        autoRepliedTurnsRef.current.add(turnKey);

        const foundContact = contacts.find((c) => c.contactId === conv.contactId);
        const targetRecipientEmail = (
          foundContact?.email ||
          lastMsg.senderEmail ||
          lastMsg.emailMeta?.from ||
          (conv.emailThreadId?.includes('@') ? conv.emailThreadId.split('thread-')[1] : '') ||
          (conv.conversationId?.includes('@') ? conv.conversationId.replace('conv-', '').replace(/_/g, '.') : '') ||
          ''
        ).trim();
        const recipientEmail = targetRecipientEmail.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || targetRecipientEmail;

        const contact: Contact = {
          contactId: foundContact?.contactId || conv.contactId || `contact-${Date.now()}`,
          firstName: foundContact?.firstName || (lastMsg.senderName ? lastMsg.senderName.split(' ')[0] : 'Customer'),
          lastName: foundContact?.lastName || (lastMsg.senderName ? lastMsg.senderName.split(' ').slice(1).join(' ') : ''),
          email: recipientEmail,
          phone: foundContact?.phone || '',
          companyName: foundContact?.companyName || 'Umrah Travel Agency',
          jobTitle: foundContact?.jobTitle || 'Tour Operator',
          createdAt: foundContact?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        };
        const lead = leads.find((l) => l.leadId === conv.leadId);

        generateOmnichannelResponse({
          incomingMessage: lastMsg.text,
          contact,
          lead,
          conversation: conv,
          recentMessages: threadMsgs,
          knowledgeDocs,
          signature: settings.emailSignature,
        }).then(async (aiResult) => {
          const replyNowIso = new Date().toISOString();
          const inReplyTo = lastMsg.gmailMessageId || lastMsg.emailMeta?.messageId || lastMsg.messageId;
          const aiMsg: Message = {
            messageId: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            gmailMessageId: `<ai-reply-${Date.now()}@umrah360.in>`,
            conversationId: conv.conversationId,
            channel: conv.channel,
            direction: 'OUTBOUND',
            senderType: 'AI',
            senderName: 'Umrah360 AI',
            senderEmail: 'sales@umrah360.in',
            text: aiResult.responseText,
            timestamp: replyNowIso,
            sentAt: replyNowIso,
            receivedAt: replyNowIso,
            createdAt: replyNowIso,
            aiProcessed: true,
            aiGenerated: true,
            confidence: aiResult.confidence,
            knowledgeSources: aiResult.knowledgeSources || [],
            emailMeta: conv.channel === 'EMAIL' ? {
              subject: lastMsg.emailMeta?.subject
                ? (lastMsg.emailMeta.subject.toLowerCase().startsWith('re:') ? lastMsg.emailMeta.subject : `Re: ${lastMsg.emailMeta.subject}`)
                : 'Re: Umrah360 - Automate B2B Packages & Visa Operations',
              from: 'sales@umrah360.in',
              to: recipientEmail || 'sales@umrah360.in',
              inReplyTo,
              references: inReplyTo ? [inReplyTo] : undefined,
              messageId: `<ai-reply-${Date.now()}@umrah360.in>`,
            } : undefined,
          };

          const updatedLastMsg: Message = {
            ...lastMsg,
            aiReplied: true,
            repliedAt: replyNowIso,
            repliedByMessageId: aiMsg.messageId,
          };

          // Dispatch real email to customer over live SMTP
          if (conv.channel === 'EMAIL' && recipientEmail) {
            try {
              const sendRes = await fetch('/api/email/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: recipientEmail,
                  subject: aiMsg.emailMeta?.subject || `Re: ${lastMsg.emailMeta?.subject || 'Umrah360 Platform'}`,
                  text: aiResult.responseText,
                  inReplyTo: inReplyTo || lastMsg.messageId,
                  references: inReplyTo ? [inReplyTo] : undefined,
                  conversationId: conv.conversationId,
                  gmailThreadId: conv.gmailThreadId || conv.emailThreadId,
                  senderName: 'Umrah360 AI Automation',
                }),
              });
              const sendData = await sendRes.json();
              if (sendRes.ok && sendData?.messageId) {
                aiMsg.gmailMessageId = sendData.messageId;
                aiMsg.smtpStatus = 'DELIVERED';
                if (aiMsg.emailMeta) {
                  aiMsg.emailMeta.messageId = sendData.messageId;
                }
              } else {
                aiMsg.smtpStatus = 'DELIVERY_FAILED';
                aiMsg.smtpError = sendData?.error || 'SMTP Delivery Failed';
              }
            } catch (smtpErr: any) {
              aiMsg.smtpStatus = 'DELIVERY_FAILED';
              aiMsg.smtpError = smtpErr?.message || 'SMTP Connection Error';
              console.warn('[AI Email Dispatch] Notice dispatching auto-reply email:', smtpErr);
            }
          }

          if (isFirebaseConfigured && db) {
            try {
              await setDoc(doc(db, 'messages', lastMsg.messageId), sanitizeDoc(updatedLastMsg), { merge: true });
              await setDoc(doc(db, 'messages', aiMsg.messageId), sanitizeDoc(aiMsg));
              await setDoc(
                doc(db, 'conversations', conv.conversationId),
                sanitizeDoc({
                  lastMessageAt: replyNowIso,
                  lastMessageText: aiMsg.text.slice(0, 120),
                  updatedAt: replyNowIso,
                }),
                { merge: true }
              );
            } catch (e) {
              console.warn('Firestore auto-reply sync notice:', e);
            }
          }

          setMessages((prev) => [
            ...prev.map((m) => (m.messageId === lastMsg.messageId ? updatedLastMsg : m)),
            aiMsg,
          ]);

          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conv.conversationId
                ? {
                    ...c,
                    lastMessageAt: replyNowIso,
                    lastMessageText: aiMsg.text,
                    updatedAt: replyNowIso,
                  }
                : c
            )
          );
        }).catch((err) => {
          console.warn('[Auto-Reply Engine] Error generating auto-reply:', err);
        });
      }
    }
  }, [conversations, messages, contacts, leads, knowledgeDocs, settings.emailSignature]);

  // Handle message sending (Manual or Inbound / Outbound reply)
  const handleSendMessage = async (
    conversationId: string,
    text: string,
    senderType: 'AGENT' | 'AI' | 'CUSTOMER' | 'PROSPECT' = 'AGENT'
  ) => {
    const conv = conversations.find((c) => c.conversationId === conversationId);
    if (!conv) return;

    const threadMsgs = messages.filter((m) => m.conversationId === conversationId);
    const lastIncoming = [...threadMsgs].reverse().find((m) => m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT');
    const inReplyTo = lastIncoming?.gmailMessageId || lastIncoming?.emailMeta?.messageId;
    const gmailThreadId = conv.gmailThreadId || conv.emailThreadId || `thread-${conversationId}`;
    const nowIso = new Date().toISOString();

    const foundContact = contacts.find((c) => c.contactId === conv.contactId);
    const targetRecipientEmail = (
      foundContact?.email ||
      lastIncoming?.senderEmail ||
      lastIncoming?.emailMeta?.from ||
      (conv.emailThreadId?.includes('@') ? conv.emailThreadId.split('thread-')[1] : '') ||
      (conv.conversationId?.includes('@') ? conv.conversationId.replace('conv-', '').replace(/_/g, '.') : '') ||
      ''
    ).trim();
    const recipientEmail = targetRecipientEmail.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || targetRecipientEmail;

    const contact: Contact = {
      contactId: foundContact?.contactId || conv.contactId || `contact-${Date.now()}`,
      firstName: foundContact?.firstName || ((senderType === 'CUSTOMER' || senderType === 'PROSPECT') ? (lastIncoming?.senderName ? lastIncoming.senderName.split(' ')[0] : 'Customer') : 'Tour'),
      lastName: foundContact?.lastName || ((senderType === 'CUSTOMER' || senderType === 'PROSPECT') ? (lastIncoming?.senderName ? lastIncoming.senderName.split(' ').slice(1).join(' ') : '') : 'Operator'),
      email: recipientEmail,
      phone: foundContact?.phone || '',
      companyName: foundContact?.companyName || 'Umrah Travel Agency',
      jobTitle: foundContact?.jobTitle || 'Tour Operator',
      createdAt: foundContact?.createdAt || nowIso,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
    };
    const lead = leads.find((l) => l.leadId === conv.leadId);

    let sentGmailMessageId = `<out-${Date.now()}@amaavigo.com>`;

    // If sending an email manually over SMTP
    if ((conv.channel === 'EMAIL' || conv.channel === 'WEBSITE') && senderType === 'AGENT' && recipientEmail) {
      const subject = lastIncoming?.emailMeta?.subject
        ? (lastIncoming.emailMeta.subject.toLowerCase().startsWith('re:') ? lastIncoming.emailMeta.subject : `Re: ${lastIncoming.emailMeta.subject}`)
        : 'Re: Umrah360 - Automate B2B Packages & Visa Operations';

      try {
        const sendRes = await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipientEmail,
            subject,
            text,
            inReplyTo,
            references: inReplyTo ? [inReplyTo] : undefined,
            conversationId,
            gmailThreadId,
          }),
        });
        const sendData = await sendRes.json();
        if (sendData.messageId) {
          sentGmailMessageId = sendData.messageId;
        }
      } catch (err) {
        console.warn('Live email dispatch notice:', err);
      }
    }

    const direction = (senderType === 'AGENT' || senderType === 'AI') ? 'OUTBOUND' : 'INBOUND';

    const newMsg: Message = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      gmailMessageId: sentGmailMessageId,
      gmailThreadId,
      conversationId,
      channel: conv.channel === 'WEBSITE' ? 'EMAIL' : conv.channel,
      direction,
      senderType,
      senderName:
        senderType === 'AGENT'
          ? 'Umrah360 Agent'
          : senderType === 'AI'
          ? 'Umrah360 AI'
          : contact?.firstName || 'Customer',
      senderEmail: senderType === 'AGENT' ? 'sales@umrah360.in' : contact?.email,
      text,
      aiReplied: false,
      timestamp: nowIso,
      sentAt: nowIso,
      receivedAt: nowIso,
      createdAt: nowIso,
      emailMeta:
        conv.channel === 'EMAIL' || conv.channel === 'WEBSITE' || Boolean(recipientEmail)
          ? {
              subject: lastIncoming?.emailMeta?.subject
                ? (lastIncoming.emailMeta.subject.toLowerCase().startsWith('re:') ? lastIncoming.emailMeta.subject : `Re: ${lastIncoming.emailMeta.subject}`)
                : 'Re: Umrah360 - Automate B2B Packages & Visa Operations',
              from: senderType === 'AGENT' ? 'sales@umrah360.in' : (contact?.email || 'sales@umrah360.in'),
              to: senderType === 'AGENT' ? (contact?.email || 'sales@umrah360.in') : 'sales@umrah360.in',
              messageId: sentGmailMessageId,
              inReplyTo,
              references: inReplyTo ? [inReplyTo] : undefined,
            }
          : undefined,
    };

    // Save to Firestore BEFORE local state update to ensure persistent state of truth
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'messages', newMsg.messageId), sanitizeDoc(newMsg));
        await setDoc(
          doc(db, 'conversations', conversationId),
          sanitizeDoc({
            lastMessageAt: newMsg.timestamp,
            lastMessageText: newMsg.text.slice(0, 120),
            updatedAt: newMsg.timestamp,
          }),
          { merge: true }
        );
      } catch (e) {
        console.warn('Firestore write warning:', e);
      }
    }

    const updatedMessages = [...messages.filter(m => !(newMsg.gmailMessageId && m.gmailMessageId === newMsg.gmailMessageId && !m.gmailMessageId.startsWith('<out-'))), newMsg];
    setMessages(updatedMessages);

    // Update conversation in local state
    setConversations((prev) =>
      prev.map((c) =>
        c.conversationId === conversationId
          ? {
              ...c,
              lastMessageAt: newMsg.timestamp,
              lastMessageText: newMsg.text,
              updatedAt: newMsg.timestamp,
            }
          : c
      )
    );

    // IDEMPOTENCY CHECK:
    // AI must trigger ONLY when a genuinely NEW inbound CUSTOMER message is received.
    // Check: gmailMessageId + direction=INBOUND + senderType=CUSTOMER + aiReplied=true
    if (
      direction === 'INBOUND' &&
      (senderType === 'CUSTOMER' || senderType === 'PROSPECT') &&
      conv.aiEnabled &&
      !conv.humanHandoff &&
      !newMsg.aiReplied
    ) {
      setTimeout(async () => {
        const aiResult = await generateOmnichannelResponse({
          incomingMessage: text,
          contact,
          lead,
          conversation: conv,
          recentMessages: updatedMessages.filter((m) => m.conversationId === conversationId),
          knowledgeDocs,
          signature: settings.emailSignature,
        });

        const replyNowIso = new Date().toISOString();
        const aiMsg: Message = {
          messageId: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          gmailMessageId: `<ai-reply-${Date.now()}@umrah360.in>`,
          conversationId,
          channel: conv.channel,
          direction: 'OUTBOUND',
          senderType: 'AI',
          senderName: 'Umrah360 AI',
          senderEmail: 'sales@umrah360.in',
          text: aiResult.responseText,
          timestamp: replyNowIso,
          sentAt: replyNowIso,
          receivedAt: replyNowIso,
          createdAt: replyNowIso,
          aiProcessed: true,
          aiGenerated: true,
          confidence: aiResult.confidence,
          knowledgeSources: aiResult.knowledgeSources || [],
          emailMeta: conv.channel === 'EMAIL' ? {
            subject: lastIncoming?.emailMeta?.subject
              ? (lastIncoming.emailMeta.subject.toLowerCase().startsWith('re:') ? lastIncoming.emailMeta.subject : `Re: ${lastIncoming.emailMeta.subject}`)
              : 'Re: Umrah360 - Automate B2B Packages & Visa Operations',
            from: 'sales@umrah360.in',
            to: contact.email || 'sales@umrah360.in',
            inReplyTo: inReplyTo || newMsg.messageId,
            references: inReplyTo ? [inReplyTo] : undefined,
            messageId: `<ai-reply-${Date.now()}@umrah360.in>`,
          } : undefined,
        };

        // Mark incoming message as replied
        newMsg.aiReplied = true;
        newMsg.repliedAt = replyNowIso;
        newMsg.repliedByMessageId = aiMsg.messageId;

        // Dispatch real email to customer over live SMTP
        if (conv.channel === 'EMAIL' && contact.email) {
          try {
            const sendRes = await fetch('/api/email/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: contact.email,
                subject: aiMsg.emailMeta?.subject || `Re: ${lastIncoming?.emailMeta?.subject || 'Umrah360 Platform'}`,
                text: aiResult.responseText,
                inReplyTo: inReplyTo || newMsg.messageId,
                references: inReplyTo ? [inReplyTo] : undefined,
                conversationId: conv.conversationId,
                gmailThreadId: conv.gmailThreadId || conv.emailThreadId,
                senderName: 'Umrah360 AI Automation',
              }),
            });
            const sendData = await sendRes.json();
            if (sendRes.ok && sendData?.messageId) {
              aiMsg.gmailMessageId = sendData.messageId;
              aiMsg.smtpStatus = 'DELIVERED';
              if (aiMsg.emailMeta) {
                aiMsg.emailMeta.messageId = sendData.messageId;
              }
            } else {
              aiMsg.smtpStatus = 'DELIVERY_FAILED';
              aiMsg.smtpError = sendData?.error || 'SMTP Delivery Failed';
            }
          } catch (smtpErr: any) {
            aiMsg.smtpStatus = 'DELIVERY_FAILED';
            aiMsg.smtpError = smtpErr?.message || 'SMTP Connection Error';
            console.warn('[AI Email Dispatch] Notice dispatching AI reply email:', smtpErr);
          }
        }

        if (isFirebaseConfigured && db) {
          try {
            await setDoc(doc(db, 'messages', newMsg.messageId), sanitizeDoc(newMsg), { merge: true });
            await setDoc(doc(db, 'messages', aiMsg.messageId), sanitizeDoc(aiMsg));
            await setDoc(
              doc(db, 'conversations', conversationId),
              sanitizeDoc({
                lastMessageAt: replyNowIso,
                lastMessageText: aiMsg.text.slice(0, 120),
                updatedAt: replyNowIso,
              }),
              { merge: true }
            );
          } catch (e) {
            console.warn('Firestore write warning:', e);
          }
        }

        setMessages((prev) => [
          ...prev.map((m) => (m.messageId === newMsg.messageId ? { ...m, aiReplied: true, repliedAt: replyNowIso, repliedByMessageId: aiMsg.messageId } : m)),
          aiMsg,
        ]);

        // If human handoff triggered
        if (aiResult.humanHandoffTriggered) {
          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conversationId
                ? {
                    ...c,
                    humanHandoff: true,
                    aiEnabled: false,
                    lastMessageAt: aiMsg.timestamp,
                    lastMessageText: aiMsg.text,
                  }
                : c
            )
          );

          if (lead) {
            setLeads((prev) =>
              prev.map((l) =>
                l.leadId === lead.leadId
                  ? {
                      ...l,
                      status: 'HUMAN_HANDOFF',
                      leadScore: aiResult.leadQualification.leadScore,
                      intent: aiResult.leadQualification.intent,
                      buyingStage: aiResult.leadQualification.buyingStage,
                      aiRecommendation: 'Human intervention required for custom Enterprise pricing.',
                    }
                  : l
              )
            );
          }

          // Add activity
          const handoffAct: LeadActivity = {
            activityId: `act-${Date.now()}`,
            leadId: lead?.leadId || 'lead-generic',
            contactId: contact.contactId,
            type: 'HUMAN_TAKEOVER',
            title: 'Human Handoff Triggered (AI = OFF)',
            description: aiResult.handoffReason || 'Pricing inquiry for 20+ seats requires senior specialist.',
            timestamp: new Date().toISOString(),
          };
          setActivities((prev) => [handoffAct, ...prev]);
        } else {
          // Regular AI reply
          setConversations((prev) =>
            prev.map((c) =>
              c.conversationId === conversationId
                ? {
                    ...c,
                    lastMessageAt: aiMsg.timestamp,
                    lastMessageText: aiMsg.text,
                  }
                : c
            )
          );

          if (lead) {
            setLeads((prev) =>
              prev.map((l) =>
                l.leadId === lead.leadId
                  ? {
                      ...l,
                      leadScore: aiResult.leadQualification.leadScore,
                      intent: aiResult.leadQualification.intent,
                      buyingStage: aiResult.leadQualification.buyingStage,
                      requirements: aiResult.leadQualification.requirements,
                    }
                  : l
              )
            );
          }
        }
      }, 1000);
    }
  };

  // Toggle AI / Human Takeover (Section 30 & 31)
  const handleToggleAi = async (conversationId: string, enabled: boolean) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.conversationId === conversationId
          ? {
              ...c,
              aiEnabled: enabled,
              humanHandoff: !enabled,
            }
          : c
      )
    );

    try {
      await fetch('/api/conversation/ai-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          aiEnabled: enabled,
          humanHandoff: !enabled,
        }),
      });
    } catch (err) {
      console.warn('Failed to sync AI state to backend:', err);
    }

    const conv = conversations.find((c) => c.conversationId === conversationId);
    if (conv?.leadId) {
      const act: LeadActivity = {
        activityId: `act-${Date.now()}`,
        leadId: conv.leadId,
        contactId: conv.contactId,
        type: enabled ? 'AI_RESUMED' : 'HUMAN_TAKEOVER',
        title: enabled ? 'AI Auto-Pilot Resumed' : 'Human Specialist Takeover',
        description: enabled
          ? 'Agent resumed automated AI conversation responses.'
          : 'Human operator took control of conversation; automated AI replies disabled.',
        timestamp: new Date().toISOString(),
      };
      setActivities((prev) => [act, ...prev]);
    }
  };

  // Process inbound email sent to automation@amaavigo.com
  const handleProcessInboundEmail = async (
    payload: InboundEmailPayload
  ): Promise<InboundProcessingResult> => {
    const result = await processInboundEmail({
      payload,
      contacts,
      leads,
      conversations,
      messages,
      knowledgeDocs,
      settings,
    });

    // Merge Contact
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.contactId === result.contact.contactId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result.contact;
        return next;
      }
      return [result.contact, ...prev];
    });

    // Merge Lead
    setLeads((prev) => {
      const idx = prev.findIndex((l) => l.leadId === result.lead.leadId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result.lead;
        return next;
      }
      return [result.lead, ...prev];
    });

    // Merge Conversation
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.conversationId === result.conversation.conversationId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result.conversation;
        return next;
      }
      return [result.conversation, ...prev];
    });

    // Append Messages (Incoming and AI reply)
    setMessages((prev) => {
      const toAdd = [result.incomingMessage];
      if (result.aiReplyMessage) toAdd.push(result.aiReplyMessage);
      return [...prev, ...toAdd];
    });

    // Prepend Activities
    if (result.activities && result.activities.length > 0) {
      setActivities((prev) => [...result.activities, ...prev]);
    }

    return result;
  };

  // Process inbound WhatsApp sent to +919820252434
  const handleProcessInboundWhatsApp = async (
    payload: InboundWhatsAppPayload
  ): Promise<InboundWhatsAppProcessingResult> => {
    const result = await processInboundWhatsAppMessage({
      payload,
      contacts,
      leads,
      conversations,
      messages,
      knowledgeDocs,
      settings,
    });

    // Merge Contact
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.contactId === result.contact.contactId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result.contact;
        return next;
      }
      return [result.contact, ...prev];
    });

    // Merge Lead
    setLeads((prev) => {
      const idx = prev.findIndex((l) => l.leadId === result.lead.leadId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result.lead;
        return next;
      }
      return [result.lead, ...prev];
    });

    // Merge Conversation
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.conversationId === result.conversation.conversationId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result.conversation;
        return next;
      }
      return [result.conversation, ...prev];
    });

    // Append Messages (Incoming and AI reply)
    setMessages((prev) => {
      const toAdd = [result.incomingMessage];
      if (result.aiReplyMessage) toAdd.push(result.aiReplyMessage);
      return [...prev, ...toAdd];
    });

    // Prepend Activities
    if (result.activities && result.activities.length > 0) {
      setActivities((prev) => [...result.activities, ...prev]);
    }

    return result;
  };

  // Send cold outreach for Apollo prospect (Section 14 & 15)
  const handleSendColdEmail = async (prospectId: string, customSubject?: string, customBody?: string) => {
    const prospect = prospects.find((p) => p.prospectId === prospectId);
    if (!prospect) return;

    // 1. Ensure contact exists or create contact
    let contact = contacts.find((c) => c.email === prospect.email);
    if (!contact) {
      contact = {
        contactId: `contact-${Date.now()}`,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        email: prospect.email,
        phone: prospect.phone,
        companyName: prospect.companyName,
        jobTitle: prospect.jobTitle,
        apolloPersonId: prospect.apolloPersonId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      };
      setContacts((prev) => [contact!, ...prev]);
      if (isFirebaseConfigured && db) {
        setDoc(doc(db, 'contacts', contact.contactId), contact).catch(() => {});
      }
    }

    // 2. Create Lead
    const leadId = `lead-${Date.now()}`;
    const newLead: Lead = {
      leadId,
      contactId: contact.contactId,
      source: 'APOLLO',
      leadType: 'OUTBOUND',
      status: 'ENGAGED',
      leadScore: prospect.qualificationScore || 85,
      intent: 'MEDIUM',
      buyingStage: 'AWARENESS',
      serviceInterest: 'Umrah360 B2B & Package Builder',
      requirements: ['B2B Reseller Portal'],
      aiSummary: `Discovered via Apollo (${prospect.jobTitle} at ${prospect.companyName}). Cold outreach sent.`,
      aiRecommendation: 'Monitor for reply and let AI continue thread contextually.',
      campaignId: prospect.campaignId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    setLeads((prev) => [newLead, ...prev]);
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'leads', leadId), newLead).catch(() => {});
    }

    // 3. Create Conversation & Email Thread immediately (Section 14 & 15)
    const conversationId = `conv-${Date.now()}`;
    const emailThreadId = `thread-${Date.now()}`;

    const coldMsgText =
      customBody ||
      `Hi ${prospect.firstName},\n\nI noticed you are leading operations at ${prospect.companyName}. We work with top Umrah operators across India to automate their dynamic package costing, Makkah/Madinah room allotments, and sub-agent B2B voucher distribution.\n\nUmrah360 gives your agency an automated B2B portal with live supplier costs and compliant invoicing.\n\nWould you be open to exploring how this could streamline your upcoming season?\n\nRegards,\nUmrah360 Growth Team`;

    const newConversation: Conversation = {
      conversationId,
      contactId: contact.contactId,
      leadId,
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      campaignId: prospect.campaignId,
      status: 'ACTIVE',
      aiEnabled: true,
      humanHandoff: false,
      emailThreadId,
      conversationSummary: `Cold outreach sent to ${prospect.firstName} at ${prospect.companyName}.`,
      startedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      lastMessageText: coldMsgText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setConversations((prev) => [newConversation, ...prev]);
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'conversations', conversationId), newConversation).catch(() => {});
    }

    const coldMessage: Message = {
      messageId: `msg-${Date.now()}`,
      conversationId,
      channel: 'EMAIL',
      senderType: 'AGENT',
      senderName: 'Umrah360 Growth Team',
      senderEmail: 'sales@umrah360.in',
      text: coldMsgText,
      timestamp: new Date().toISOString(),
      emailMeta: {
        subject:
          customSubject ||
          `Umrah360 for ${prospect.companyName} - Automate B2B Packages & Visa Operations`,
        from: 'sales@umrah360.in',
        to: prospect.email,
        messageId: `<cold-${Date.now()}@umrah360.in>`,
      },
    };
    setMessages((prev) => [...prev, coldMessage]);
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'messages', coldMessage.messageId), coldMessage).catch(() => {});
    }

    // Update prospect status
    const updatedProspect = {
      ...prospect,
      status: 'EMAIL_SENT' as const,
      emailThreadId,
      conversationId,
      updatedAt: new Date().toISOString(),
    };
    setProspects((prev) =>
      prev.map((p) => (p.prospectId === prospectId ? updatedProspect : p))
    );
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'outbound_prospects', prospectId), updatedProspect, { merge: true }).catch(() => {});
    }

    // Log Activity
    const act: LeadActivity = {
      activityId: `act-${Date.now()}`,
      leadId,
      contactId: contact.contactId,
      type: 'COLD_EMAIL_SENT',
      title: 'Cold Outreach Dispatched',
      description: `Sent Introduction to Umrah360 with personalized companyName: ${prospect.companyName}`,
      timestamp: new Date().toISOString(),
    };
    setActivities((prev) => [act, ...prev]);
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'lead_activities', act.activityId), act).catch(() => {});
    }
  };

  // Add Apollo Prospect (Persistent to Firestore)
  const handleAddProspect = async (prospect: OutboundProspect) => {
    setProspects((prev) => [prospect, ...prev]);
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'outbound_prospects', prospect.prospectId), prospect);
      } catch (err) {
        console.warn('Error saving prospect to Firestore:', err);
      }
    }
  };

  // Toggle Outbound Campaign Running/Paused Status
  const handleToggleCampaignStatus = async (campaignId: string) => {
    let nextStatus: 'RUNNING' | 'PAUSED' = 'RUNNING';
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.campaignId === campaignId) {
          nextStatus = c.status === 'RUNNING' ? 'PAUSED' : 'RUNNING';
          return { ...c, status: nextStatus, updatedAt: new Date().toISOString() };
        }
        return c;
      })
    );
    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'outbound_campaigns', campaignId), {
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Error toggling campaign status in Firestore:', err);
      }
    }
  };

  // Reset demo seed data
  const handleResetSeedData = () => {
    setContacts(INITIAL_CONTACTS);
    setLeads(INITIAL_LEADS);
    setConversations(INITIAL_CONVERSATIONS);
    setMessages(INITIAL_MESSAGES);
    setCampaigns([]);
    setProspects(INITIAL_PROSPECTS);
    setActivities(INITIAL_ACTIVITIES);
    setKnowledgeDocs(INITIAL_KNOWLEDGE_DOCUMENTS);
    setSettings(DEFAULT_SETTINGS);
  };

  // Mark conversation as read (persistent in Firestore)
  const handleMarkConversationAsRead = async (conversationId: string) => {
    const nowIso = new Date().toISOString();
    setConversations((prev) =>
      prev.map((c) =>
        c.conversationId === conversationId
          ? { ...c, isRead: true, unread: false, unreadCount: 0, readAt: nowIso }
          : c
      )
    );

    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'conversations', conversationId), {
          isRead: true,
          unread: false,
          unreadCount: 0,
          readAt: nowIso,
        });
      } catch (e) {
        try {
          await setDoc(
            doc(db, 'conversations', conversationId),
            { isRead: true, unread: false, unreadCount: 0, readAt: nowIso },
            { merge: true }
          );
        } catch {}
      }
    }
  };

  // Approve AI-drafted reply (REVIEW mode) and send via real SMTP
  const handleApproveDraft = async (conversationId: string) => {
    const conv = conversations.find((c) => c.conversationId === conversationId);
    if (!conv || !conv.draftReply) return;

    const draft = conv.draftReply;
    const contact = contacts.find((c) => c.contactId === conv.contactId);
    const toEmail = contact?.email;
    if (!toEmail) return;

    const subject = draft.subject || 'Re: Umrah360 Inquiry';
    const nowIso = new Date().toISOString();

    let approvedSmtpStatus: 'DELIVERED' | 'DELIVERY_FAILED' = 'DELIVERED';
    let approvedSmtpError: string | undefined = undefined;

    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject,
          text: draft.text,
          conversationId,
          gmailThreadId: conv.gmailThreadId || conv.emailThreadId,
        }),
      });
      const sendResult = await res.json();

      if (!res.ok || !sendResult.success) {
        approvedSmtpStatus = 'DELIVERY_FAILED';
        approvedSmtpError = sendResult.error || 'SMTP Delivery Failed';
      }

      const aiMsgId = sendResult.messageId || `<reply-approved-${Date.now()}@amaavigo.com>`;
      const approvedMsg: Message = {
        messageId: `msg-reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        gmailMessageId: aiMsgId,
        gmailThreadId: conv.gmailThreadId || conv.emailThreadId || `thread-${conversationId}`,
        conversationId,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        senderType: 'AI',
        senderName: 'Umrah360 AI Automation (Approved)',
        senderEmail: 'sales@umrah360.in',
        text: draft.text,
        timestamp: nowIso,
        sentAt: nowIso,
        receivedAt: nowIso,
        createdAt: nowIso,
        aiProcessed: true,
        aiGenerated: true,
        confidence: 0.98,
        emailMeta: {
          subject,
          from: 'sales@umrah360.in',
          to: toEmail,
          messageId: aiMsgId,
        },
        smtpStatus: approvedSmtpStatus,
        smtpError: approvedSmtpError,
      };

      setMessages((prev) => [...prev, approvedMsg]);
      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversationId
            ? {
                ...c,
                status: 'ACTIVE',
                lastMessageAt: nowIso,
                lastMessageText: draft.text.slice(0, 120),
                draftReply: undefined,
                updatedAt: nowIso,
              }
            : c
        )
      );

      if (isFirebaseConfigured && db) {
        await setDoc(doc(db, 'messages', approvedMsg.messageId), approvedMsg);
        await setDoc(
          doc(db, 'conversations', conversationId),
          {
            status: 'ACTIVE',
            lastMessageAt: nowIso,
            lastMessageText: draft.text.slice(0, 120),
            draftReply: null,
            updatedAt: nowIso,
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.error('Error sending approved draft:', err);
    }
  };

  // Persistent System Settings save (Firestore + Backend API pipeline config)
  const handleSaveSettings = async (newSettings: SystemSettings) => {
    setSettings(newSettings);
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'system_settings', 'default'), newSettings, { merge: true });
      } catch (err) {
        console.warn('Error persisting settings to Firestore:', err);
      }
    }

    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailMode: newSettings.channelModes.EMAIL,
          emailSignature: newSettings.emailSignature,
          debounceSeconds: newSettings.debounceSeconds,
        }),
      });
    } catch (err) {
      console.warn('Error syncing settings to backend API:', err);
    }
  };

  // Switch to CRM lead
  const handleViewLeadInCrm = (leadId: string) => {
    setSelectedLeadIdForCrm(leadId);
    setActiveTab('crm');
  };

  // Knowledge Document Save/Update with instant local state, Firestore persistence, and Backend RAG cache synchronization
  const handleSaveKnowledgeDoc = async (docItem: KnowledgeDocument) => {
    // 1. Instant local state update for zero latency
    setKnowledgeDocs((prev) => {
      const idx = prev.findIndex((d) => d.id === docItem.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = docItem;
        return next;
      }
      return [docItem, ...prev];
    });

    // 2. Persist to Firestore
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'knowledge_documents', docItem.id), docItem, { merge: true });
      } catch (err) {
        console.warn('Firestore KB save error:', err);
      }
    }

    // 3. Sync to backend API cache (0ms lookup on server for auto-replies)
    try {
      await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docItem),
      });
    } catch (apiErr) {
      console.warn('Backend KB cache sync error:', apiErr);
    }
  };

  // Knowledge Document Delete with Firestore & Backend cache removal
  const handleDeleteKnowledgeDoc = async (id: string) => {
    // 1. Instant local removal
    setKnowledgeDocs((prev) => prev.filter((d) => d.id !== id));

    // 2. Remove from Firestore
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'knowledge_documents', id));
      } catch (err) {
        console.warn('Firestore KB delete error:', err);
      }
    }

    // 3. Remove from backend cache
    try {
      await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch (apiErr) {
      console.warn('Backend KB delete sync error:', apiErr);
    }
  };

  // Count unread & handoff with Firestore persistent unread tracking
  const handoffCount = conversations.filter((c) => c.humanHandoff).length;
  const unreadCount = conversations.reduce(
    (acc, c) => acc + (c.unread || !c.isRead ? (c.unreadCount || 1) : 0),
    0
  );

  // User Authentication Handlers
  const handleLogin = (user: AppUser) => {
    setCurrentUser(user);
    try {
      localStorage.setItem('umrah360_user_session', JSON.stringify(user));
    } catch {}
    if (user.accessLevel !== 'ALL' && user.role !== 'ADMIN' && !user.allowedModules.includes(activeTab)) {
      setActiveTab((user.allowedModules[0] as ActiveTab) || 'knowledge');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('umrah360_user_session');
    } catch {}
  };

  const handleSaveUser = async (userToSave: AppUser) => {
    setUsers((prev) => {
      const idx = prev.findIndex((u) => u.userId === userToSave.userId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = userToSave;
        return next;
      }
      return [...prev, userToSave];
    });

    if (currentUser?.userId === userToSave.userId) {
      setCurrentUser(userToSave);
      try {
        localStorage.setItem('umrah360_user_session', JSON.stringify(userToSave));
      } catch {}
    }

    if (db && isFirebaseConfigured) {
      try {
        await setDoc(doc(db, 'app_users', userToSave.userId), userToSave, { merge: true });
      } catch (err) {
        console.warn('Firestore user save error:', err);
      }
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.userId !== userId));
    if (db && isFirebaseConfigured) {
      try {
        await deleteDoc(doc(db, 'app_users', userId));
      } catch (err) {
        console.warn('Firestore user delete error:', err);
      }
    }
  };

  if (!currentUser) {
    return (
      <LoginView
        onLogin={handleLogin}
        users={users}
        isFirebaseActive={isFirebaseActive}
      />
    );
  }

  const isCurrentTabAllowed =
    currentUser.accessLevel === 'ALL' ||
    currentUser.role === 'ADMIN' ||
    currentUser.allowedModules.includes(activeTab);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadCount={unreadCount}
        handoffCount={handoffCount}
        onResetSeedData={handleResetSeedData}
        isFirebaseActive={isFirebaseActive}
        currentUser={currentUser}
        onLogout={handleLogout}
        currentTenant={currentTenant}
        allTenants={allTenants}
        onSwitchTenant={(tenantId) => setCurrentTenantId(tenantId)}
      />

      <main className="flex-1">
        {!isCurrentTabAllowed ? (
          <LockedModuleView
            currentUser={currentUser}
            attemptedTab={activeTab}
            onNavigateToAllowed={(tab) => setActiveTab(tab)}
          />
        ) : (
          <>
            {activeTab === 'inbox' && (
              <UnifiedInbox
                conversations={conversations}
                messages={messages}
                contacts={contacts}
                leads={leads}
                knowledgeDocs={knowledgeDocs}
                onSendMessage={(convId, text, type) => handleSendMessage(convId, text, type)}
                onToggleAi={handleToggleAi}
                onMarkAsRead={handleMarkConversationAsRead}
                onApproveDraft={handleApproveDraft}
                onUpdateLeadScore={(leadId, delta) => {
                  setLeads((prev) =>
                    prev.map((l) =>
                      l.leadId === leadId ? { ...l, leadScore: Math.min(100, l.leadScore + delta) } : l
                    )
                  );
                }}
                onViewLeadInCrm={handleViewLeadInCrm}
                onProcessInboundEmail={handleProcessInboundEmail}
                onProcessInboundWhatsApp={handleProcessInboundWhatsApp}
                onSyncNow={syncWithBackendInbound}
              />
            )}

            {activeTab === 'campaigns' && (
              <CampaignManagement
                conversations={conversations}
                leads={leads}
                contacts={contacts}
                prospects={prospects}
                outboundCampaigns={campaigns}
                onAddProspect={handleAddProspect}
                onSendColdEmail={handleSendColdEmail}
                onToggleCampaignStatus={handleToggleCampaignStatus}
                onOpenConversation={(convId) => {
                  setActiveTab('inbox');
                }}
              />
            )}

            {activeTab === 'crm' && (
              <CrmPipeline
                leads={leads}
                contacts={contacts}
                activities={activities}
                selectedLeadId={selectedLeadIdForCrm}
                onOpenConversation={(convId, leadId) => {
                  setActiveTab('inbox');
                }}
                onUpdateLeadStatus={(leadId, newStatus) => {
                  setLeads((prev) =>
                    prev.map((l) =>
                      l.leadId === leadId
                        ? {
                            ...l,
                            status: newStatus,
                            demoStatus: newStatus === 'DEMO_BOOKED' ? 'BOOKED' : l.demoStatus,
                            demoSource: newStatus === 'DEMO_BOOKED' ? 'MANUAL' : l.demoSource,
                            demoBookedAt:
                              newStatus === 'DEMO_BOOKED' ? new Date().toISOString() : l.demoBookedAt,
                          }
                        : l
                    )
                  );
                  if (isFirebaseConfigured && db) {
                    updateDoc(doc(db, 'leads', leadId), {
                      status: newStatus,
                      ...(newStatus === 'DEMO_BOOKED'
                        ? {
                            demoStatus: 'BOOKED',
                            demoSource: 'MANUAL',
                            demoBookedAt: new Date().toISOString(),
                          }
                        : {}),
                    }).catch(() => {});
                  }
                }}
              />
            )}

            {activeTab === 'scheduling' && (
              <DemoSchedulingView leads={leads} />
            )}

            {activeTab === 'knowledge' && (
              <KnowledgeBaseView
                documents={knowledgeDocs}
                onAddDocument={handleSaveKnowledgeDoc}
                onUpdateDocument={handleSaveKnowledgeDoc}
                onDeleteDocument={handleDeleteKnowledgeDoc}
              />
            )}

            {activeTab === 'playground' && <AiTestingPlayground knowledgeDocs={knowledgeDocs} />}

            {activeTab === 'scenarios' && (
              <InteractiveScenarios
                onNavigateToInbox={() => setActiveTab('inbox')}
                onNavigateToCrm={() => setActiveTab('crm')}
                onProcessInboundEmail={handleProcessInboundEmail}
                onProcessInboundWhatsApp={handleProcessInboundWhatsApp}
                onNavigateToThread={(threadId) => {
                  setActiveTab('inbox');
                }}
                onNavigateToCrmLead={(leadId) => {
                  setSelectedLeadIdForCrm(leadId);
                  setActiveTab('crm');
                }}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                onSaveSettings={handleSaveSettings}
                onResetSeedData={handleResetSeedData}
                users={users}
                onSaveUser={handleSaveUser}
                onDeleteUser={handleDeleteUser}
              />
            )}

            {activeTab === 'live-mailbox' && (
              <LiveMailboxCenter
                onNavigateToThread={() => setActiveTab('inbox')}
                onNavigateToCrm={() => setActiveTab('crm')}
                onSyncNow={syncWithBackendInbound}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
