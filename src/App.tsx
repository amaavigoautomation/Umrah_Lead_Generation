import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { UnifiedInbox } from './components/UnifiedInbox';
import { OutboundCampaigns } from './components/OutboundCampaigns';
import { CrmPipeline } from './components/CrmPipeline';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { AiTestingPlayground } from './components/AiTestingPlayground';
import { InteractiveScenarios } from './components/InteractiveScenarios';
import { SettingsView } from './components/SettingsView';
import { LiveMailboxCenter } from './components/LiveMailboxCenter';
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
} from './services/dataService';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from './services/knowledgeData';
import { generateOmnichannelResponse } from './services/aiService';
import {
  processInboundEmail,
  InboundEmailPayload,
  InboundProcessingResult,
} from './services/emailInboundService';
import { db, isFirebaseConfigured } from './firebase/config';
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, query, orderBy, onSnapshot } from 'firebase/firestore';

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

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('inbox');
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [leads, setLeads] = useState<Lead[]>(INITIAL_LEADS);
  const [conversations, setConversations] = useState<Conversation[]>(INITIAL_CONVERSATIONS);
  const [messagesState, setMessagesState] = useState<Message[]>(deduplicateMessages(INITIAL_MESSAGES));
  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    setMessagesState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return deduplicateMessages(next);
    });
  };
  const messages = messagesState;
  const [campaigns, setCampaigns] = useState<OutboundCampaign[]>([INITIAL_CAMPAIGN]);
  const [prospects, setProspects] = useState<OutboundProspect[]>(INITIAL_PROSPECTS);
  const [activities, setActivities] = useState<LeadActivity[]>(INITIAL_ACTIVITIES);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>(INITIAL_KNOWLEDGE_DOCUMENTS);
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [selectedLeadIdForCrm, setSelectedLeadIdForCrm] = useState<string | null>(null);
  const [isFirebaseActive, setIsFirebaseActive] = useState<boolean>(isFirebaseConfigured);

  // Initialize Firestore seeding & loading on startup
  useEffect(() => {
    let unsubConvs: (() => void) | undefined;
    let unsubMsgs: (() => void) | undefined;

    async function initFirestore() {
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
        // Load or seed settings in Firestore
        const settingsRef = doc(db, 'system_settings', 'default');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const loadedSettings = settingsSnap.data() as SystemSettings;
          setSettings(loadedSettings);
        } else {
          await setDoc(settingsRef, DEFAULT_SETTINGS);
        }

        // Check if initial contacts exist in Firestore
        const contactsRef = collection(db, 'contacts');
        const snapshot = await getDocs(contactsRef);

        if (snapshot.empty) {
          // Seed contacts
          for (const c of INITIAL_CONTACTS) {
            await setDoc(doc(db, 'contacts', c.contactId), c);
          }
          // Seed leads
          for (const l of INITIAL_LEADS) {
            await setDoc(doc(db, 'leads', l.leadId), l);
          }
          // Seed conversations
          for (const conv of INITIAL_CONVERSATIONS) {
            await setDoc(doc(db, 'conversations', conv.conversationId), conv);
          }
          // Seed initial messages with complete persistent fields
          for (const m of INITIAL_MESSAGES) {
            await setDoc(doc(db, 'messages', m.messageId), m);
          }
          // Seed KB
          for (const kb of INITIAL_KNOWLEDGE_DOCUMENTS) {
            await setDoc(doc(db, 'knowledge_documents', kb.id), kb);
          }
          // Seed campaigns
          await setDoc(doc(db, 'outbound_campaigns', INITIAL_CAMPAIGN.campaignId), INITIAL_CAMPAIGN);
        } else {
          // Load persisted entities from Firestore so state survives page refresh
          const [convsSnap, msgsSnap, leadsSnap, contsSnap] = await Promise.all([
            getDocs(query(collection(db, 'conversations'), orderBy('lastMessageAt', 'desc'))),
            getDocs(query(collection(db, 'messages'), orderBy('sentAt', 'asc'))),
            getDocs(collection(db, 'leads')),
            getDocs(collection(db, 'contacts')),
          ]);

          if (!convsSnap.empty) {
            const cList = convsSnap.docs.map((d) => d.data() as Conversation);
            setConversations(cList);
          }
          if (!msgsSnap.empty) {
            const mList = msgsSnap.docs.map((d) => d.data() as Message);
            setMessages(mList);
          }
          if (!leadsSnap.empty) {
            setLeads(leadsSnap.docs.map((d) => d.data() as Lead));
          }
          if (!contsSnap.empty) {
            setContacts(contsSnap.docs.map((d) => d.data() as Contact));
          }
        }

        // Attach realtime listeners for Firestore updates
        unsubConvs = onSnapshot(collection(db, 'conversations'), (snap) => {
          if (!snap.empty) {
            const list = snap.docs.map((d) => d.data() as Conversation);
            setConversations(
              list.sort(
                (a, b) =>
                  new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
                  new Date(a.lastMessageAt || a.createdAt || 0).getTime()
              )
            );
          }
        });

        unsubMsgs = onSnapshot(collection(db, 'messages'), (snap) => {
          if (!snap.empty) {
            const list = snap.docs.map((d) => d.data() as Message);
            setMessages(
              list.sort(
                (a, b) =>
                  new Date(a.sentAt || a.timestamp || a.createdAt || 0).getTime() -
                  new Date(b.sentAt || b.timestamp || b.createdAt || 0).getTime()
              )
            );
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
    };
  }, []);

  // Track message IDs ingested from backend to prevent duplicates
  const ingestedBackendMsgIds = useRef<Set<string>>(new Set());

  // Background sync for live inbound emails (from IMAP or direct webhook)
  const syncWithBackendInbound = useCallback(async () => {
    try {
      const res = await fetch('/api/inbound/sync');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.history || !Array.isArray(data.history)) return;

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

        // Ingest complete thread messages for multi-turn conversations
        const threadMsgs: Message[] = Array.isArray(item.crmEntities?.allThreadMessages) && item.crmEntities.allThreadMessages.length > 0
          ? item.crmEntities.allThreadMessages
          : ([incomingMessage, aiReplyMessage].filter(Boolean) as Message[]);

        setMessages((prev) => {
          const toAdd: Message[] = [];
          for (const msg of threadMsgs) {
            if (msg && !prev.some((m) => m.messageId === msg.messageId)) {
              toAdd.push(msg);
            }
          }
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });

        if (activity) {
          setActivities((prev) => {
            if (prev.some((a) => a.activityId === activity.activityId)) return prev;
            return [activity, ...prev];
          });
        }

        // Persist to Firestore if configured
        if (isFirebaseConfigured && db) {
          try {
            if (contact) setDoc(doc(db, 'contacts', contact.contactId), contact, { merge: true }).catch(() => {});
            if (lead) setDoc(doc(db, 'leads', lead.leadId), lead, { merge: true }).catch(() => {});
            if (conversation) setDoc(doc(db, 'conversations', conversation.conversationId), conversation, { merge: true }).catch(() => {});
            for (const msg of threadMsgs) {
              if (msg) setDoc(doc(db, 'messages', msg.messageId), msg, { merge: true }).catch(() => {});
            }
          } catch {}
        }
      }

      // Ingest all stored thread messages from backend
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
    }
  }, []);

  // Poll backend inbound mailbox every 4 seconds for immediate UI updates
  useEffect(() => {
    syncWithBackendInbound();
    const interval = setInterval(syncWithBackendInbound, 4000);
    return () => clearInterval(interval);
  }, [syncWithBackendInbound]);

  // Handle message sending (Manual or Inbound / Outbound reply)
  const handleSendMessage = async (
    conversationId: string,
    text: string,
    senderType: 'AGENT' | 'AI' | 'CUSTOMER' | 'PROSPECT' = 'AGENT'
  ) => {
    const conv = conversations.find((c) => c.conversationId === conversationId);
    if (!conv) return;

    const contact = contacts.find((c) => c.contactId === conv.contactId);
    const lead = leads.find((l) => l.leadId === conv.leadId);
    const nowIso = new Date().toISOString();

    const threadMsgs = messages.filter((m) => m.conversationId === conversationId);
    const lastIncoming = [...threadMsgs].reverse().find((m) => m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT');
    const inReplyTo = lastIncoming?.gmailMessageId || lastIncoming?.emailMeta?.messageId;
    const gmailThreadId = conv.gmailThreadId || conv.emailThreadId || `thread-${conversationId}`;

    let sentGmailMessageId = `<out-${Date.now()}@amaavigo.com>`;

    // If sending an email manually over SMTP
    if (conv.channel === 'EMAIL' && senderType === 'AGENT' && contact?.email) {
      const subject = lastIncoming?.emailMeta?.subject
        ? (lastIncoming.emailMeta.subject.toLowerCase().startsWith('re:') ? lastIncoming.emailMeta.subject : `Re: ${lastIncoming.emailMeta.subject}`)
        : 'Re: Umrah360 - Automate B2B Packages & Visa Operations';

      try {
        const sendRes = await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: contact.email,
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

    // If sending a WhatsApp message manually via Meta Cloud API
    if (conv.channel === 'WHATSAPP' && senderType === 'AGENT') {
      const recipientPhone = contact?.whatsappUserId || contact?.phone || conv.customerPhone;
      if (recipientPhone) {
        try {
          const sendRes = await fetch('/api/whatsapp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: recipientPhone,
              text,
              conversationId,
              recipientName: `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim(),
            }),
          });
          const sendData = await sendRes.json();
          if (sendData?.messageId) {
            sentGmailMessageId = sendData.messageId;
          }
        } catch (err) {
          console.warn('Live WhatsApp dispatch notice:', err);
        }
      }
    }

    const direction = (senderType === 'AGENT' || senderType === 'AI') ? 'OUTBOUND' : 'INBOUND';

    const newMsg: Message = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      gmailMessageId: sentGmailMessageId,
      gmailThreadId,
      conversationId,
      channel: conv.channel,
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
        conv.channel === 'EMAIL'
          ? {
              subject: lastIncoming?.emailMeta?.subject
                ? (lastIncoming.emailMeta.subject.toLowerCase().startsWith('re:') ? lastIncoming.emailMeta.subject : `Re: ${lastIncoming.emailMeta.subject}`)
                : 'Re: Umrah360 - Automate B2B Packages & Visa Operations',
              from: senderType === 'AGENT' ? 'sales@umrah360.in' : contact?.email,
              to: senderType === 'AGENT' ? contact?.email : 'sales@umrah360.in',
              messageId: sentGmailMessageId,
              inReplyTo,
              references: inReplyTo ? [inReplyTo] : undefined,
            }
          : undefined,
    };

    // Save to Firestore BEFORE local state update to ensure persistent state of truth
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'messages', newMsg.messageId), newMsg);
        await setDoc(
          doc(db, 'conversations', conversationId),
          {
            lastMessageAt: newMsg.timestamp,
            lastMessageText: newMsg.text.slice(0, 120),
            updatedAt: newMsg.timestamp,
          },
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
        if (!contact) return;
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
          messageId: `msg-ai-${Date.now()}`,
          conversationId,
          channel: conv.channel,
          direction: 'OUTBOUND',
          senderType: 'AI',
          senderName: 'Umrah360 AI',
          senderEmail: 'sales@umrah360.in',
          text: aiResult.responseText,
          timestamp: replyNowIso,
          aiProcessed: true,
          aiGenerated: true,
          confidence: aiResult.confidence,
          knowledgeSources: aiResult.knowledgeSources,
        };

        // Mark incoming message as replied
        newMsg.aiReplied = true;
        newMsg.repliedAt = replyNowIso;
        newMsg.repliedByMessageId = aiMsg.messageId;

        if (isFirebaseConfigured && db) {
          try {
            await setDoc(doc(db, 'messages', newMsg.messageId), newMsg, { merge: true });
            await setDoc(doc(db, 'messages', aiMsg.messageId), aiMsg);
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

  // Send cold outreach for Apollo prospect (Section 14 & 15)
  const handleSendColdEmail = (prospectId: string) => {
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

    // 3. Create Conversation & Email Thread immediately (Section 14 & 15)
    const conversationId = `conv-${Date.now()}`;
    const emailThreadId = `thread-${Date.now()}`;

    const coldMsgText = `Hi ${prospect.firstName},\n\nI noticed you are leading operations at ${prospect.companyName}. We work with top Umrah operators across India to automate their dynamic package costing, Makkah/Madinah room allotments, and sub-agent B2B voucher distribution.\n\nUmrah360 gives your agency an automated B2B portal with live supplier costs and compliant invoicing.\n\nWould you be open to exploring how this could streamline your upcoming season?\n\nRegards,\nUmrah360 Growth Team`;

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
        subject: `Umrah360 for ${prospect.companyName} - Automate B2B Packages & Visa Operations`,
        from: 'sales@umrah360.in',
        to: prospect.email,
        messageId: `<cold-${Date.now()}@umrah360.in>`,
      },
    };
    setMessages((prev) => [...prev, coldMessage]);

    // Update prospect status
    setProspects((prev) =>
      prev.map((p) =>
        p.prospectId === prospectId
          ? {
              ...p,
              status: 'EMAIL_SENT',
              emailThreadId,
              conversationId,
              updatedAt: new Date().toISOString(),
            }
          : p
      )
    );

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
  };

  // Reset demo seed data
  const handleResetSeedData = () => {
    setContacts(INITIAL_CONTACTS);
    setLeads(INITIAL_LEADS);
    setConversations(INITIAL_CONVERSATIONS);
    setMessages(INITIAL_MESSAGES);
    setCampaigns([INITIAL_CAMPAIGN]);
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
      if (newSettings.whatsappMode) {
        await fetch('/api/whatsapp/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: newSettings.whatsappMode }),
        });
      }
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailMode: newSettings.channelModes.EMAIL,
          emailSignature: newSettings.emailSignature,
          debounceSeconds: newSettings.debounceSeconds,
          whatsappMode: newSettings.whatsappMode,
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

  // Count unread & handoff with Firestore persistent unread tracking
  const handoffCount = conversations.filter((c) => c.humanHandoff).length;
  const unreadCount = conversations.reduce(
    (acc, c) => acc + (c.unread || !c.isRead ? (c.unreadCount || 1) : 0),
    0
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadCount={unreadCount}
        handoffCount={handoffCount}
        onResetSeedData={handleResetSeedData}
        isFirebaseActive={isFirebaseActive}
      />

      <main className="flex-1">
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
            onSyncNow={syncWithBackendInbound}
          />
        )}

        {activeTab === 'campaigns' && (
          <OutboundCampaigns
            campaigns={campaigns}
            prospects={prospects}
            contacts={contacts}
            onAddProspect={(p) => setProspects((prev) => [p, ...prev])}
            onSendColdEmail={handleSendColdEmail}
            onToggleCampaignStatus={(campId) => {
              setCampaigns((prev) =>
                prev.map((c) =>
                  c.campaignId === campId
                    ? { ...c, status: c.status === 'RUNNING' ? 'PAUSED' : 'RUNNING' }
                    : c
                )
              );
            }}
            onSelectProspectConversation={(threadId) => {
              const conv = conversations.find((c) => c.emailThreadId === threadId);
              if (conv) {
                setActiveTab('inbox');
              }
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
          />
        )}

        {activeTab === 'knowledge' && (
          <KnowledgeBaseView
            documents={knowledgeDocs}
            onAddDocument={(doc) => setKnowledgeDocs((prev) => [doc, ...prev])}
            onUpdateDocument={(doc) =>
              setKnowledgeDocs((prev) => prev.map((d) => (d.id === doc.id ? doc : d)))
            }
          />
        )}

        {activeTab === 'playground' && <AiTestingPlayground knowledgeDocs={knowledgeDocs} />}

        {activeTab === 'scenarios' && (
          <InteractiveScenarios
            onNavigateToInbox={() => setActiveTab('inbox')}
            onNavigateToCrm={() => setActiveTab('crm')}
            onProcessInboundEmail={handleProcessInboundEmail}
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
          />
        )}

        {activeTab === 'live-mailbox' && (
          <LiveMailboxCenter
            onNavigateToThread={() => setActiveTab('inbox')}
            onNavigateToCrm={() => setActiveTab('crm')}
            onSyncNow={syncWithBackendInbound}
          />
        )}
      </main>
    </div>
  );
}
