import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { getDoc, getDocs, setDoc, createDoc, query, orderBy, limit, where } from './adminFirestore.js';
import { tenantRepo, globalUserDoc } from './tenantRepo.js';
import { getOpenAIApiKey } from './openaiClient.js';
import { recordAiCompletionUsage, checkTenantQuota } from './usageService.js';
import { writeTenantAuditEvent } from './auditLogger.js';
import { getCompanyProfile } from './companyProfileService.js';
import { retrieveRelevantKnowledge } from './knowledgeService.js';
import { listLeadDatabases } from './leadDatabaseService.js';
import { listTenantAssets } from './assetService.js';
import { listEmailDesignData } from './emailDesignService.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import type { TenantContext } from '../types/tenant.js';

type AutonomyMode = 'ask' | 'balanced' | 'full';
type AgentConfig = { autonomy: AutonomyMode; companyPreferences: string[]; updatedAt?: string };

const DEFAULT_CONFIG: AgentConfig = { autonomy: 'balanced', companyPreferences: [] };
const DEFAULT_MODULES = ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings', 'database', 'agent', 'company-profile'];
const MODEL = process.env.AGENT_MODEL || 'gpt-4o-mini';
const MAX_USER_MESSAGE = 8000;
const MAX_CONTEXT_MESSAGES = 16;

const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'get_company_profile', description: 'Read the current tenant company profile and contact details.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'search_knowledge_base', description: 'Search published tenant knowledge articles for product, pricing, policy, FAQ and service information.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'A focused search phrase or question.' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'list_lead_databases', description: 'List the tenant lead databases and high-level lead counts. Does not expose individual lead records.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'list_company_assets', description: 'List tenant company asset metadata. Does not read or return file contents.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'list_email_designs', description: 'List available email design names and metadata. Does not modify templates.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
];

function cleanText(value: unknown, max = 300): string {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeConfig(value: any): AgentConfig {
  const autonomy: AutonomyMode = value?.autonomy === 'ask' || value?.autonomy === 'full' ? value.autonomy : 'balanced';
  const companyPreferences = Array.isArray(value?.companyPreferences)
    ? value.companyPreferences.map((v: unknown) => cleanText(v, 300)).filter(Boolean).slice(0, 20)
    : [];
  return { autonomy, companyPreferences, updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : undefined };
}

async function getUserModules(ctx: TenantContext): Promise<string[]> {
  if (ctx.role === 'admin' || ctx.isPlatformAdmin) return ['*'];
  try {
    const snap = await getDoc(globalUserDoc(ctx.uid));
    const data = snap.exists() ? snap.data() as any : null;
    if (Array.isArray(data?.allowedModules) && data.allowedModules.length) return data.allowedModules.map(String);
  } catch {}
  return DEFAULT_MODULES;
}

async function requireAgentAccess(ctx: TenantContext): Promise<string[]> {
  const modules = await getUserModules(ctx);
  if (!modules.includes('*') && !modules.includes('agent')) {
    throw Object.assign(new Error('Your account does not have access to the AI Agent module.'), { status: 403 });
  }
  return modules;
}

function assertOwnConversation(data: any, ctx: TenantContext): void {
  if (!data || data.createdBy !== ctx.uid) {
    throw Object.assign(new Error('Conversation not found.'), { status: 404 });
  }
}

async function readConfig(ctx: TenantContext): Promise<AgentConfig> {
  const snap = await getDoc(tenantRepo(ctx).settingsDoc('agent_config'));
  return snap.exists() ? normalizeConfig(snap.data()) : DEFAULT_CONFIG;
}

async function readConversationMessages(ctx: TenantContext, conversationId: string, take = 40): Promise<any[]> {
  const col = tenantRepo(ctx).collection('agent_conversations/' + conversationId + '/messages');
  const snap = await getDocs(query(col, orderBy('createdAt', 'desc'), limit(take)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() as any })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function safeJson(value: unknown, maxChars = 14000): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > maxChars ? encoded.slice(0, maxChars) + '…[truncated]' : encoded;
  } catch {
    return '{"error":"Could not serialize tool result"}';
  }
}

async function executeRegisteredTool(name: string, args: any, ctx: TenantContext, modules: string[]): Promise<unknown> {
  const canUse = (m: string) => modules.includes('*') || m === 'database' || m === 'company-profile' || modules.includes(m) || (m === 'email-design-studio' && modules.includes('settings'));
  switch (name) {
    case 'get_company_profile': {
      if (!canUse('company-profile')) throw new Error('This user cannot access Company Profile data.');
      const result = await getCompanyProfile(ctx);
      return { brand: result.brand };
    }
    case 'search_knowledge_base': {
      if (!canUse('knowledge')) throw new Error('This user cannot access Knowledge Base data.');
      const search = cleanText(args?.query, 500);
      if (!search) throw new Error('A search query is required.');
      return retrieveRelevantKnowledge(search, 5, ctx).map((x) => ({ title: x.title, category: x.category, excerpt: x.relevantExcerpt, relevance: x.score }));
    }
    case 'list_lead_databases': {
      if (!canUse('database')) throw new Error('This user cannot access lead database data.');
      return (await listLeadDatabases(ctx)).map((x) => ({ databaseId: x.databaseId, name: x.name, description: x.description, totalLeads: x.totalLeads, emailEligibleCount: x.emailEligibleCount, updatedAt: x.updatedAt }));
    }
    case 'list_company_assets': {
      if (!canUse('company-profile') && !canUse('email-design-studio')) throw new Error('This user cannot access Company Assets.');
      return (await listTenantAssets(ctx)).map((x: any) => ({ id: x.id, name: x.name, category: x.category, mimeType: x.mimeType, sizeFormatted: x.sizeFormatted, url: x.url, altText: x.altText }));
    }
    case 'list_email_designs': {
      if (!canUse('email-design-studio')) throw new Error('This user cannot access Email Design Studio.');
      const data = await listEmailDesignData(ctx);
      return { defaultTemplateId: data.defaultTemplateId, templates: data.templates.map((x: any) => ({ id: x.id, name: x.name || x.title, description: x.description || x.subject, source: x.source, category: x.category, style: x.style })) };
    }
    default:
      throw new Error('Tool is not registered.');
  }
}

async function runAgent(message: string, history: any[], ctx: TenantContext, config: AgentConfig, moduleContext: string, modules: string[]) {
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) throw new Error('OpenAI is not configured for this workspace.');
  const client = new OpenAI({ apiKey });
  const system = [
    'You are the Amaavigo workspace AI Agent. Be practical, precise, and transparent.',
    'Use the registered read-only tools when workspace facts are needed. Never invent database counts, company facts, asset names, or template details.',
    'You may inspect tenant data only through the registered tools. Tool handlers enforce user module permissions and tenant scope.',
    'This release has read-only tools. You cannot create, edit, delete, schedule, send, dispatch campaigns, contact leads, change settings, or perform external actions. Never claim that a change or action was completed.',
    'Autonomy preference is recorded for the future action registry only; it does not override permissions, enable unavailable tools, or bypass approvals.',
    'Conversation history is private to the signed-in user. Company preferences below are shared workspace guidance.',
    'When information is missing, say what is missing and ask one focused question. Distinguish retrieved facts from suggestions.',
    'Prefer concise, structured answers. When proposing a multi-step task, explain dependencies and verification steps.',
    'Current workspace module: ' + (moduleContext || 'unknown'),
    'Workspace preferences: ' + (config.companyPreferences.length ? config.companyPreferences.join(' | ') : 'None saved'),
    'Autonomy preference: ' + config.autonomy,
  ].join('\n');

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...history.slice(-MAX_CONTEXT_MESSAGES).map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String(m.content || '').slice(0, MAX_USER_MESSAGE),
    })),
    { role: 'user', content: message },
  ];
  const calledTools: string[] = [];
  let finalText = '';

  for (let turn = 0; turn < 4; turn++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.25,
      max_tokens: 1300,
    });
    await recordAiCompletionUsage(ctx.tenantId, completion, MODEL, 'openai');
    const choice = completion.choices?.[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) break;
    messages.push(assistantMessage);
    const toolCalls = assistantMessage.tool_calls || [];
    if (!toolCalls.length) {
      finalText = assistantMessage.content?.trim() || '';
      break;
    }
    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const toolName = call.function.name;
      let result: unknown;
      try {
        const parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        result = await executeRegisteredTool(toolName, parsed, ctx, modules);
        calledTools.push(toolName);
        await writeTenantAuditEvent(ctx, {
          action: 'AGENT_READ_TOOL_EXECUTED',
          module: 'AI_ENGINE',
          description: 'AI Agent executed a registered read-only workspace tool.',
          target: { type: 'Agent Tool', id: toolName },
          metadata: { tool: toolName, outcome: 'success' },
        });
      } catch (error: any) {
        result = { error: error?.message || 'Tool execution failed.' };
        await writeTenantAuditEvent(ctx, {
          action: 'AGENT_READ_TOOL_FAILED',
          module: 'AI_ENGINE',
          severity: 'WARNING',
          description: 'AI Agent read-only tool execution failed.',
          target: { type: 'Agent Tool', id: toolName },
          metadata: { tool: toolName, outcome: 'failed' },
        });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: safeJson(result) });
    }
    if (turn === 3) finalText = 'I gathered the available workspace information, but reached the tool-call limit for this turn. Please narrow the request and I will continue.';
  }

  if (!finalText) finalText = 'I could not produce a response for that request. Please try again.';
  return { content: finalText, toolsUsed: [...new Set(calledTools)] };
}

export async function handleAgentApi(req: any, res: any, ctx: TenantContext, body: any, url: string): Promise<boolean> {
  const send = (status: number, payload: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(payload));
    return true;
  };
  if (!isFirebaseConfigured) return send(503, { success: false, error: 'Workspace storage is not configured.' });

  try {
    const modules = await requireAgentAccess(ctx);
    const repo = tenantRepo(ctx);

    if (url === '/api/agent/bootstrap' && req.method === 'GET') {
      const [config, snap] = await Promise.all([
        readConfig(ctx),
        getDocs(query(repo.collection('agent_conversations'), where('createdBy', '==', ctx.uid))),
      ]);
      const conversations = snap.docs
        .map((d) => ({ id: d.id, ...d.data() as any }))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 30)
        .map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, moduleContext: d.moduleContext }));
      return send(200, { success: true, config, conversations, canManageConfig: ctx.role === 'admin' });
    }

    if (url === '/api/agent/config' && req.method === 'PATCH') {
      if (ctx.role !== 'admin') return send(403, { success: false, error: 'Workspace admin only.' });
      const current = await readConfig(ctx);
      const next = normalizeConfig({ ...current, ...(body || {}), updatedAt: new Date().toISOString() });
      await setDoc(repo.settingsDoc('agent_config'), next, { merge: true });
      await writeTenantAuditEvent(ctx, {
        action: 'AGENT_POLICY_UPDATED',
        module: 'SETTINGS',
        description: 'AI Agent autonomy or company preferences were updated.',
        metadata: { autonomy: next.autonomy, preferenceCount: next.companyPreferences.length },
      });
      return send(200, { success: true, config: next });
    }

    if (url === '/api/agent/conversations' && req.method === 'POST') {
      const id = randomUUID();
      const now = new Date().toISOString();
      const conversation = { id, title: 'New conversation', createdBy: ctx.uid, moduleContext: cleanText(body?.moduleContext, 80), createdAt: now, updatedAt: now };
      await setDoc(repo.doc('agent_conversations', id), conversation);
      return send(201, { success: true, conversation, messages: [] });
    }

    const conversationMatch = url.match(/^\/api\/agent\/conversations\/([a-zA-Z0-9_-]{8,80})$/);
    if (conversationMatch && req.method === 'GET') {
      const id = conversationMatch[1];
      const snap = await getDoc(repo.doc('agent_conversations', id));
      const data = snap.exists() ? snap.data() : null;
      assertOwnConversation(data, ctx);
      const messages = await readConversationMessages(ctx, id, 40);
      return send(200, { success: true, conversation: { id, title: (data as any).title, moduleContext: (data as any).moduleContext }, messages });
    }

    if (url === '/api/agent/chat' && req.method === 'POST') {
      const conversationId = cleanText(body?.conversationId, 80);
      const executionId = cleanText(body?.executionId, 100);
      const message = cleanText(body?.message, MAX_USER_MESSAGE);
      const moduleContext = cleanText(body?.moduleContext, 80);
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(conversationId) || !/^[a-zA-Z0-9_-]{12,100}$/.test(executionId) || !message) {
        return send(400, { success: false, error: 'Conversation, execution ID and message are required.' });
      }
      const quota = await checkTenantQuota(ctx.tenantId, 'ai');
      if (!quota.allowed) return send(402, { success: false, error: quota.reason || 'Monthly AI usage limit reached.', code: 'AI_QUOTA_EXCEEDED' });
      const conversationRef = repo.doc('agent_conversations', conversationId);
      const conversationSnap = await getDoc(conversationRef);
      const conversation = conversationSnap.exists() ? conversationSnap.data() as any : null;
      assertOwnConversation(conversation, ctx);

      const executionRef = repo.doc('agent_executions', executionId);
      try {
        await createDoc(executionRef, { id: executionId, conversationId, actorUid: ctx.uid, status: 'processing', createdAt: new Date().toISOString() });
      } catch (error: any) {
        const existing = await getDoc(executionRef);
        const saved = existing.exists() ? existing.data() as any : null;
        if (saved?.actorUid !== ctx.uid || saved?.conversationId !== conversationId) return send(409, { success: false, error: 'Execution ID conflict.' });
        if (saved?.status === 'completed') return send(200, { success: true, duplicate: true, assistantMessage: saved.assistantMessage, toolsUsed: saved.toolsUsed || [] });
        return send(409, { success: false, error: 'This request is already processing or has failed. Start a new message to retry safely.', code: 'EXECUTION_EXISTS' });
      }

      const now = new Date().toISOString();
      await setDoc(repo.doc('agent_conversations/' + conversationId + '/messages', 'user-' + executionId), {
        id: 'user-' + executionId, role: 'user', content: message, createdAt: now, actorUid: ctx.uid, moduleContext,
      });
      const history = await readConversationMessages(ctx, conversationId, MAX_CONTEXT_MESSAGES);
      const config = await readConfig(ctx);
      try {
        const result = await runAgent(message, history.filter((m) => m.id !== 'user-' + executionId), ctx, config, moduleContext, modules);
        const assistantId = 'assistant-' + executionId;
        const assistantMessage = { id: assistantId, role: 'assistant', content: result.content, createdAt: new Date().toISOString(), toolsUsed: result.toolsUsed };
        await setDoc(repo.doc('agent_conversations/' + conversationId + '/messages', assistantId), assistantMessage);
        const title = conversation.title === 'New conversation' ? message.slice(0, 64) : conversation.title;
        await setDoc(conversationRef, { title, updatedAt: assistantMessage.createdAt, moduleContext: moduleContext || conversation.moduleContext }, { merge: true });
        await setDoc(executionRef, { status: 'completed', assistantMessage, toolsUsed: result.toolsUsed, completedAt: assistantMessage.createdAt }, { merge: true });
        await writeTenantAuditEvent(ctx, {
          action: 'AGENT_MESSAGE_COMPLETED',
          module: 'AI_ENGINE',
          description: 'AI Agent completed a user conversation turn.',
          target: { type: 'Agent Conversation', id: conversationId, name: title },
          metadata: { toolsUsed: result.toolsUsed, executionId },
        });
        return send(200, { success: true, assistantMessage, toolsUsed: result.toolsUsed, conversation: { id: conversationId, title, updatedAt: assistantMessage.createdAt } });
      } catch (error: any) {
        await setDoc(executionRef, { status: 'failed', error: cleanText(error?.message || 'Agent execution failed.', 300), failedAt: new Date().toISOString() }, { merge: true });
        throw error;
      }
    }

    return send(404, { success: false, error: 'Agent route not found.' });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return send(status, { success: false, error: error?.message || 'AI Agent request failed.' });
  }
}
