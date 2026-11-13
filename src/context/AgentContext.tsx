import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AgentAutonomy = 'ask' | 'balanced' | 'full';
export interface AgentConfig {
  autonomy: AgentAutonomy;
  companyPreferences: string[];
  updatedAt?: string;
}
export interface AgentConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  moduleContext?: string;
}
export interface AgentArtifact {
  type: string;
  draftId?: string;
  templateKind?: string;
  approvalId?: string;
  campaignId?: string;
  templateId?: string;
  name?: string;
  subject?: string;
  preheader?: string;
  html?: string;
  body?: string;
  header?: string;
  footer?: string;
  imageUrl?: string;
  imageAssetId?: string;
  logoUrl?: string;
  version?: number;
  savedTo?: string;
  status?: string;
  recipientCount?: number;
  excludedWithoutEmail?: number;
  databaseName?: string;
  templateName?: string;
  sendReady?: boolean;
  sendReadinessError?: string;
  websiteLinks?: Array<{ label: string; url: string; intent: string }>;
  report?: Record<string, any>;
  updatedAt?: string;
}
export interface AgentAttachmentInput {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}
export interface AgentAttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind?: string;
  rowCount?: number;
}
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  toolsUsed?: string[];
  artifacts?: AgentArtifact[];
  attachments?: AgentAttachmentMeta[];
}
interface AgentContextValue {
  config: AgentConfig;
  conversations: AgentConversation[];
  activeConversationId: string | null;
  messages: AgentMessage[];
  loading: boolean;
  sending: boolean;
  activityLabel: string;
  error: string;
  canManageConfig: boolean;
  selectConversation: (id: string) => Promise<void>;
  newConversation: (moduleContext?: string) => Promise<string | null>;
  sendMessage: (message: string, moduleContext?: string, attachments?: AgentAttachmentInput[], targetConversationId?: string) => Promise<void>;
  saveConfig: (patch: Partial<AgentConfig>) => Promise<boolean>;
  refresh: () => Promise<void>;
  clearError: () => void;
}
const DEFAULT_CONFIG: AgentConfig = { autonomy: 'balanced', companyPreferences: [] };
const AgentContext = createContext<AgentContextValue | null>(null);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data && data.success === false)) {
    throw new Error(data?.error || 'The AI Agent request failed.');
  }
  return data as T;
}
function createId(): string {
  try { return crypto.randomUUID(); } catch { return 'exec_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
}

export const AgentProvider: React.FC<{ tenantId: string; userId: string; enabled?: boolean; children: React.ReactNode }> = ({ tenantId, userId, enabled = true, children }) => {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [activityLabel, setActivityLabel] = useState('');
  const [error, setError] = useState('');
  const [canManageConfig, setCanManageConfig] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !tenantId || !userId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api<{ success: boolean; config: AgentConfig; conversations: AgentConversation[]; canManageConfig: boolean }>('/api/agent/bootstrap');
      setConfig(data.config || DEFAULT_CONFIG);
      setConversations(data.conversations || []);
      setCanManageConfig(Boolean(data.canManageConfig));
    } catch (e: any) {
      setError(e?.message || 'Could not load the AI Agent workspace.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId, enabled]);

  useEffect(() => {
    setConfig(DEFAULT_CONFIG);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    if (enabled && tenantId && userId) void refresh();
  }, [tenantId, userId, enabled, refresh]);

  const selectConversation = useCallback(async (id: string) => {
    if (!id) return;
    setActiveConversationId(id);
    setError('');
    try {
      const data = await api<{ success: boolean; conversation: AgentConversation; messages: AgentMessage[] }>('/api/agent/conversations/' + encodeURIComponent(id));
      setMessages(data.messages || []);
    } catch (e: any) {
      setMessages([]);
      setError(e?.message || 'Could not open this conversation.');
    }
  }, []);

  const newConversation = useCallback(async (moduleContext = ''): Promise<string | null> => {
    setError('');
    try {
      const data = await api<{ success: boolean; conversation: AgentConversation; messages: AgentMessage[] }>('/api/agent/conversations', {
        method: 'POST',
        body: JSON.stringify({ moduleContext }),
      });
      setConversations((prev) => [data.conversation, ...prev.filter((x) => x.id !== data.conversation.id)]);
      setActiveConversationId(data.conversation.id);
      setMessages([]);
      return data.conversation.id;
    } catch (e: any) {
      setError(e?.message || 'Could not start a new conversation.');
      return null;
    }
  }, []);

  const sendMessage = useCallback(async (rawMessage: string, moduleContext = '', attachments: AgentAttachmentInput[] = [], targetConversationId?: string) => {
    const message = rawMessage.trim() || (attachments.length
      ? 'Please inspect the attached files and help me with the appropriate next step. Ask a focused question if my intended action is unclear.'
      : '');
    if ((!message && !attachments.length) || sending) return;
    const attachmentMeta: AgentAttachmentMeta[] = attachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }));
    setSending(true);
    setActivityLabel(/template|email|campaign|image|design|banner/i.test(message) ? 'Researching your brand, creating campaign artwork and saving the editable draft…' : 'Reviewing your workspace and preparing an answer…');
    setError('');
    let conversationId = targetConversationId || activeConversationId;
    try {
      if (!conversationId) conversationId = await newConversation(moduleContext);
      if (!conversationId) return;
      const executionId = createId();
      const userMessage: AgentMessage = { id: 'local-' + executionId, role: 'user', content: message, createdAt: new Date().toISOString(), attachments: attachmentMeta };
      if (targetConversationId) {
        // A Home-to-Agent handoff always targets a new conversation. Reset the transcript
        // explicitly so a batched React update cannot briefly carry over the previous chat.
        setActiveConversationId(targetConversationId);
        setMessages([userMessage]);
      } else {
        setMessages((prev) => [...prev, userMessage]);
      }
      let data: { success: boolean; assistantMessage: AgentMessage; conversation: AgentConversation };
      let needsPoll = false;
      let lastDeliveryError: any = null;
      try {
        const initial = await api<{ success: boolean; status?: string; progress?: string; assistantMessage?: AgentMessage; conversation?: AgentConversation }>('/api/agent/chat', {
          method: 'POST',
          body: JSON.stringify({ conversationId, executionId, message, moduleContext, attachments }),
        });
        if (initial.status === 'processing' || !initial.assistantMessage) {
          needsPoll = true;
          setActivityLabel(initial.progress || 'Agent task started…');
        } else {
          data = { success: true, assistantMessage: initial.assistantMessage, conversation: initial.conversation! };
        }
      } catch (deliveryError: any) {
        needsPoll = true;
        lastDeliveryError = deliveryError;
        setActivityLabel('Reconnecting to the same Agent task…');
      }

      if (needsPoll) {
        const deadline = Date.now() + 300000;
        let recovered: { success: boolean; assistantMessage: AgentMessage; conversation: AgentConversation } | null = null;
        let interimMessageId: string | null = null;
        while (Date.now() < deadline && !recovered) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const status = await api<{ success: boolean; status: string; progress?: string; assistantMessage?: AgentMessage | null; error?: string; conversationId?: string }>('/api/agent/executions/' + encodeURIComponent(executionId));
            if (status.assistantMessage && status.status === 'processing') {
              interimMessageId = status.assistantMessage.id;
              setMessages((prev) => [
                ...prev.filter((item) => item.id !== interimMessageId && item.id !== userMessage.id),
                { id: 'user-' + executionId, role: 'user', content: message, createdAt: userMessage.createdAt, attachments: attachmentMeta },
                status.assistantMessage!,
              ]);
            }
            if (status.status === 'completed' && status.assistantMessage) {
              recovered = {
                success: true,
                assistantMessage: status.assistantMessage,
                conversation: { id: conversationId, title: message.slice(0, 64), createdAt: new Date().toISOString(), updatedAt: status.assistantMessage.createdAt, moduleContext },
              };
              break;
            }
            if (status.status === 'failed') throw new Error(status.error || 'The Agent task failed.');
            setActivityLabel(status.progress || 'The Agent is still working on your request…');
          } catch (pollError: any) {
            if (String(pollError?.message || '').toLowerCase().includes('execution not found')) {
              lastDeliveryError = pollError;
              continue;
            }
            throw pollError;
          }
        }
        if (!recovered) throw new Error('The Agent task is still running or the connection was interrupted. Reopen this conversation to check its status; do not submit the same request again yet. ' + (lastDeliveryError?.message || ''));
        data = recovered;
      }
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== userMessage.id),
        { id: 'user-' + executionId, role: 'user', content: message, createdAt: userMessage.createdAt, attachments: attachmentMeta },
        data.assistantMessage,
      ]);
      if (data.conversation) setConversations((prev) => [data.conversation, ...prev.filter((x) => x.id !== data.conversation.id)]);
    } catch (e: any) {
      setError(e?.message || 'The Agent could not complete that request.');
      setMessages((prev) => prev.filter((item) => !item.id.startsWith('local-')));
    } finally {
      setSending(false);
      setActivityLabel('');
    }
  }, [activeConversationId, newConversation, sending]);

  const saveConfig = useCallback(async (patch: Partial<AgentConfig>): Promise<boolean> => {
    setError('');
    try {
      const data = await api<{ success: boolean; config: AgentConfig }>('/api/agent/config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setConfig(data.config);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Could not save Agent settings.');
      return false;
    }
  }, []);

  const value = useMemo<AgentContextValue>(() => ({
    config, conversations, activeConversationId, messages, loading, sending, activityLabel, error, canManageConfig,
    selectConversation, newConversation, sendMessage, saveConfig, refresh, clearError: () => setError(''),
  }), [config, conversations, activeConversationId, messages, loading, sending, activityLabel, error, canManageConfig, selectConversation, newConversation, sendMessage, saveConfig, refresh]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};

export function useAgent(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error('useAgent must be used inside AgentProvider.');
  return value;
}
