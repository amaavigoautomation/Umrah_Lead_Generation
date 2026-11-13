import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
export interface AgentTaskNotification {
  id: string;
  conversationId: string;
  title: string;
  message: string;
  status: 'completed' | 'failed';
  completedAt: string;
}
interface AgentContextValue {
  config: AgentConfig;
  conversations: AgentConversation[];
  activeConversationId: string | null;
  messages: AgentMessage[];
  loading: boolean;
  sending: boolean;
  stopping: boolean;
  activityLabel: string;
  notifications: AgentTaskNotification[];
  unreadNotificationCount: number;
  refreshNotifications: (notifyNew?: boolean) => Promise<void>;
  markNotificationsRead: (executionIds: string[]) => Promise<void>;
  error: string;
  canManageConfig: boolean;
  selectConversation: (id: string) => Promise<void>;
  newConversation: (moduleContext?: string) => Promise<string | null>;
  sendMessage: (message: string, moduleContext?: string, attachments?: AgentAttachmentInput[], targetConversationId?: string) => Promise<void>;
  cancelMessage: () => Promise<void>;
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

export const AgentProvider: React.FC<{
  tenantId: string;
  userId: string;
  enabled?: boolean;
  activeTab?: string;
  agentTaskCompletionNotifications?: boolean;
  onOpenNotification?: () => void;
  children: React.ReactNode;
}> = ({ tenantId, userId, enabled = true, activeTab = 'dashboard', agentTaskCompletionNotifications = false, onOpenNotification, children }) => {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const activeExecutionIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const [activityLabel, setActivityLabel] = useState('');
  const [error, setError] = useState('');
  const [canManageConfig, setCanManageConfig] = useState(false);
  const [notifications, setNotifications] = useState<AgentTaskNotification[]>([]);
  const activeTabRef = useRef(activeTab);
  const activeConversationIdRef = useRef<string | null>(null);
  const completionNotificationsEnabledRef = useRef(agentTaskCompletionNotifications);
  const onOpenNotificationRef = useRef(onOpenNotification);
  const selectConversationRef = useRef<(id: string) => Promise<void>>(async () => {});
  const notificationBaselineReadyRef = useRef(false);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  activeTabRef.current = activeTab;
  completionNotificationsEnabledRef.current = agentTaskCompletionNotifications;
  onOpenNotificationRef.current = onOpenNotification;
  activeConversationIdRef.current = activeConversationId;

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

  const markNotificationsRead = useCallback(async (executionIds: string[]) => {
    const ids = [...new Set(executionIds)].filter(Boolean).slice(0, 30);
    if (!ids.length) return;
    try {
      await api('/api/agent/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ executionIds: ids }),
      });
      const readSet = new Set(ids);
      setNotifications((current) => current.filter((item) => !readSet.has(item.id)));
    } catch (error) {
      console.warn('[AI Agent] Could not mark task notifications as read:', error);
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    if (!id) return;
    setActiveConversationId(id);
    setError('');
    try {
      const data = await api<{ success: boolean; conversation: AgentConversation; messages: AgentMessage[] }>('/api/agent/conversations/' + encodeURIComponent(id));
      setMessages(data.messages || []);
      const unreadForConversation = notifications.filter((item) => item.conversationId === id).map((item) => item.id);
      if (unreadForConversation.length) await markNotificationsRead(unreadForConversation);
    } catch (e: any) {
      setMessages([]);
      setError(e?.message || 'Could not open this conversation.');
    }
  }, [notifications, markNotificationsRead]);

  selectConversationRef.current = selectConversation;

  const refreshNotifications = useCallback(async (notifyNew = true): Promise<void> => {
    if (!enabled || !tenantId || !userId) return;
    try {
      const data = await api<{ success: boolean; notifications: AgentTaskNotification[] }>('/api/agent/notifications');
      const incoming = Array.isArray(data.notifications) ? data.notifications : [];
      if (!notificationBaselineReadyRef.current) {
        incoming.forEach((item) => seenNotificationIdsRef.current.add(item.id));
        notificationBaselineReadyRef.current = true;
      } else {
        const unseen = incoming.filter((item) => !seenNotificationIdsRef.current.has(item.id));
        for (const item of unseen) {
          seenNotificationIdsRef.current.add(item.id);
          const shouldAlert = notifyNew &&
            completionNotificationsEnabledRef.current &&
            (activeTabRef.current !== 'agent' || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) &&
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted';
          if (shouldAlert) {
            try {
              const alert = new Notification(item.title || 'AI Agent task completed', {
                body: item.message || 'Your AI Agent task is ready to review.',
                tag: 'agent-task-' + item.id,
              });
              alert.onclick = () => {
                window.focus();
                void selectConversationRef.current(item.conversationId);
                onOpenNotificationRef.current?.();
                alert.close();
              };
            } catch (error) {
              console.warn('[AI Agent] Could not show browser notification:', error);
            }
          }
        }
      }
      setNotifications(incoming);
    } catch (error) {
      console.warn('[AI Agent] Could not refresh task notifications:', error);
    }
  }, [enabled, tenantId, userId]);

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
    setStopping(false);
    stopRequestedRef.current = false;
    setActivityLabel(/template|email|campaign|image|design|banner/i.test(message) ? 'Researching your brand, creating campaign artwork and saving the editable draft…' : 'Reviewing your workspace and preparing an answer…');
    setError('');
    let conversationId = targetConversationId || activeConversationId;
    let currentExecutionId: string | null = null;
    try {
      if (!conversationId) conversationId = await newConversation(moduleContext);
      if (!conversationId) return;
      const executionId = createId();
      currentExecutionId = executionId;
      activeExecutionIdRef.current = executionId;
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
        setActivityLabel('Reconnecting to the same Agent task…');
      }

      if (needsPoll) {
        let recovered: { success: boolean; assistantMessage: AgentMessage; conversation: AgentConversation } | null = null;
        let interimMessageId: string | null = null;
        let consecutiveMissingExecutions = 0;
        let consecutivePollErrors = 0;
        while (!recovered) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const status = await api<{ success: boolean; status: string; progress?: string; assistantMessage?: AgentMessage | null; error?: string; conversationId?: string }>('/api/agent/executions/' + encodeURIComponent(executionId));
            consecutiveMissingExecutions = 0;
            consecutivePollErrors = 0;
            if (status.status === 'cancelled') {
              stopRequestedRef.current = true;
              setMessages((prev) => prev.map((item) => item.id === userMessage.id ? { ...item, id: 'user-' + executionId } : item));
              return;
            }
            if (status.status === 'cancel_requested') {
              setStopping(true);
              setActivityLabel(status.progress || 'Stopping generation…');
              continue;
            }
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
            const errorMessage = String(pollError?.message || '').toLowerCase();
            if (errorMessage.includes('execution not found')) {
              consecutiveMissingExecutions += 1;
              if (consecutiveMissingExecutions >= 20) throw new Error('The Agent execution could not be found. Refresh the conversation before retrying.');
              setActivityLabel('Reconnecting to your background task…');
              continue;
            }
            consecutivePollErrors += 1;
            if (/permission|unauthor|forbidden|invalid|cancelled|agent task failed/.test(errorMessage) || consecutivePollErrors >= 20) throw pollError;
            setActivityLabel('Connection interrupted. Reconnecting to your background task…');
            await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 1000 * Math.pow(1.5, consecutivePollErrors))));
          }
        }
        data = recovered;
      }
      setMessages((prev) => [
        ...prev.filter((item) => item.id !== userMessage.id),
        { id: 'user-' + executionId, role: 'user', content: message, createdAt: userMessage.createdAt, attachments: attachmentMeta },
        data.assistantMessage,
      ]);
      if (data.conversation) setConversations((prev) => [data.conversation, ...prev.filter((x) => x.id !== data.conversation.id)]);
      const isViewingCompletedConversation =
        activeTabRef.current === 'agent' &&
        activeConversationIdRef.current === conversationId &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible';
      if (isViewingCompletedConversation) await markNotificationsRead([executionId]);
      else await refreshNotifications(true);
    } catch (e: any) {
      if (stopRequestedRef.current || e?.code === 'AGENT_CANCELLED') {
        if (currentExecutionId) {
          setMessages((prev) => prev.map((item) => item.id === 'local-' + currentExecutionId ? { ...item, id: 'user-' + currentExecutionId } : item));
        }
      } else {
        setError(e?.message || 'The Agent could not complete that request.');
        setMessages((prev) => prev.filter((item) => !item.id.startsWith('local-')));
      }
    } finally {
      if (activeExecutionIdRef.current === currentExecutionId) activeExecutionIdRef.current = null;
      stopRequestedRef.current = false;
      setSending(false);
      setStopping(false);
      setActivityLabel('');
    }
  }, [activeConversationId, newConversation, sending, activeTab, markNotificationsRead, refreshNotifications]);

  const cancelMessage = useCallback(async () => {
    const executionId = activeExecutionIdRef.current;
    if (!executionId || !sending || stopping) return;
    stopRequestedRef.current = true;
    setStopping(true);
    setActivityLabel('Stopping generation…');
    setError('');
    try {
      await api<{ success: boolean; status: string }>('/api/agent/executions/' + encodeURIComponent(executionId) + '/cancel', {
        method: 'POST',
      });
    } catch (error: any) {
      stopRequestedRef.current = false;
      setStopping(false);
      setActivityLabel('');
      setError(error?.message || 'Could not stop the Agent response. It may have already finished.');
    }
  }, [sending, stopping]);

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

  useEffect(() => {
    setConfig(DEFAULT_CONFIG);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setNotifications([]);
    notificationBaselineReadyRef.current = false;
    seenNotificationIdsRef.current = new Set();
    if (enabled && tenantId && userId) {
      void refresh();
      void refreshNotifications(false);
    }
  }, [tenantId, userId, enabled, refresh, refreshNotifications]);

  useEffect(() => {
    if (!enabled || !tenantId || !userId) return;
    const poll = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'prerender') void refreshNotifications(true);
    };
    const interval = window.setInterval(poll, 12000);
    const onFocus = () => poll();
    const onVisibility = () => { if (document.visibilityState === 'visible') poll(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, tenantId, userId, refreshNotifications]);

  useEffect(() => {
    if (activeTab !== 'agent' || !activeConversationId || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const ids = notifications.filter((item) => item.conversationId === activeConversationId).map((item) => item.id);
    if (ids.length) void markNotificationsRead(ids);
  }, [activeTab, activeConversationId, notifications, markNotificationsRead]);

  const value = useMemo<AgentContextValue>(() => ({
    config, conversations, activeConversationId, messages, loading, sending, stopping, activityLabel, error, canManageConfig,
    notifications, unreadNotificationCount: notifications.length, refreshNotifications, markNotificationsRead,
    selectConversation, newConversation, sendMessage, cancelMessage, saveConfig, refresh, clearError: () => setError(''),
  }), [config, conversations, activeConversationId, messages, loading, sending, stopping, activityLabel, error, canManageConfig, notifications, refreshNotifications, markNotificationsRead, selectConversation, newConversation, sendMessage, cancelMessage, saveConfig, refresh]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};

export function useAgent(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error('useAgent must be used inside AgentProvider.');
  return value;
}
