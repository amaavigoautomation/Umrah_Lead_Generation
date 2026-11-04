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
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  toolsUsed?: string[];
}
interface AgentContextValue {
  config: AgentConfig;
  conversations: AgentConversation[];
  activeConversationId: string | null;
  messages: AgentMessage[];
  loading: boolean;
  sending: boolean;
  error: string;
  canManageConfig: boolean;
  selectConversation: (id: string) => Promise<void>;
  newConversation: (moduleContext?: string) => Promise<string | null>;
  sendMessage: (message: string, moduleContext?: string) => Promise<void>;
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

  const sendMessage = useCallback(async (rawMessage: string, moduleContext = '') => {
    const message = rawMessage.trim();
    if (!message || sending) return;
    setSending(true);
    setError('');
    let conversationId = activeConversationId;
    try {
      if (!conversationId) conversationId = await newConversation(moduleContext);
      if (!conversationId) return;
      const executionId = createId();
      const userMessage: AgentMessage = { id: 'local-' + executionId, role: 'user', content: message, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, userMessage]);
      const data = await api<{ success: boolean; assistantMessage: AgentMessage; conversation: AgentConversation }>('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ conversationId, executionId, message, moduleContext }),
      });
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== userMessage.id),
        { id: 'user-' + executionId, role: 'user', content: message, createdAt: userMessage.createdAt },
        data.assistantMessage,
      ]);
      if (data.conversation) setConversations((prev) => [data.conversation, ...prev.filter((x) => x.id !== data.conversation.id)]);
    } catch (e: any) {
      setError(e?.message || 'The Agent could not complete that request.');
      setMessages((prev) => prev.filter((item) => !item.id.startsWith('local-')));
    } finally {
      setSending(false);
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
    config, conversations, activeConversationId, messages, loading, sending, error, canManageConfig,
    selectConversation, newConversation, sendMessage, saveConfig, refresh, clearError: () => setError(''),
  }), [config, conversations, activeConversationId, messages, loading, sending, error, canManageConfig, selectConversation, newConversation, sendMessage, saveConfig, refresh]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};

export function useAgent(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error('useAgent must be used inside AgentProvider.');
  return value;
}
