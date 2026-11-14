import { db, collection, limit, orderByDocumentId, startAfterId, query, getDocs, where } from './adminFirestore.js';
import { tenantRepo, globalUsersCol } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

type SearchModule = 'crm' | 'inbox' | 'campaigns' | 'email-design-studio' | 'knowledge' | 'database' | 'workspace';

export interface GlobalSearchResult {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  snippet: string;
  module: SearchModule;
  recordId: string;
  recordType: string;
  relatedId?: string;
  updatedAt?: string;
}

const COLLECTION_CACHE_TTL_MS = 30_000;
const collectionCache = new Map<string, { at: number; rows: Array<{ id: string; data: Record<string, any> }> }>();
const MAX_RESULTS_PER_CATEGORY = 5;
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; results: GlobalSearchResult[]; truncated: boolean }>();
const whatsAppTemplatesCache = new Map<string, { at: number; templates: any[] }>();

function text(value: unknown, max = 1200): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  return '';
}

function pick(data: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = text(data?.[key], 400);
    if (value) return value;
  }
  return '';
}

function searchBlob(data: Record<string, any>, keys: string[]): string {
  return keys.map((key) => text(data?.[key], 1200)).filter(Boolean).join(' · ');
}

function makeSnippet(data: Record<string, any>, keys: string[], term: string): string {
  const fields = keys.map((key) => text(data?.[key], 1200)).filter(Boolean);
  const match = fields.find((value) => value.toLowerCase().includes(term));
  if (!match) return fields[0]?.slice(0, 150) || '';
  const index = match.toLowerCase().indexOf(term);
  const start = Math.max(0, index - 55);
  return (start > 0 ? '…' : '') + match.slice(start, start + 150) + (start + 150 < match.length ? '…' : '');
}

async function readCollection(ref: any, cacheKey: string): Promise<{ rows: Array<{ id: string; data: Record<string, any> }>; truncated: boolean }> {
  const cached = collectionCache.get(cacheKey);
  if (cached && Date.now() - cached.at < COLLECTION_CACHE_TTL_MS) {
    return { rows: cached.rows, truncated: false };
  }
  // Scan the complete tenant-scoped collection in stable document-ID pages.
  // The short in-memory cache prevents one Firestore rescan for every typed character.
  const rows: Array<{ id: string; data: Record<string, any> }> = [];
  let cursor = '';
  while (true) {
    const constraints: any[] = [orderByDocumentId()];
    if (cursor) constraints.push(startAfterId(cursor));
    constraints.push(limit(250));
    const snap = await getDocs(query(ref, ...constraints));
    if (!snap.docs.length) break;
    for (const doc of snap.docs) rows.push({ id: doc.id, data: doc.data() as Record<string, any> });
    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.docs.length < 250) break;
  }
  collectionCache.set(cacheKey, { at: Date.now(), rows });
  return { rows, truncated: false };
}

function canSearchModule(module: SearchModule, allowed: Set<string>, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const aliases: Record<SearchModule, string[]> = {
    crm: ['crm'],
    inbox: ['inbox'],
    campaigns: ['campaigns'],
    'email-design-studio': ['email-design-studio', 'settings'],
    knowledge: ['knowledge'],
    database: ['database'],
    workspace: ['workspace', 'settings'],
  };
  return aliases[module].some((key) => allowed.has(key));
}

export async function searchTenantWorkspace(
  ctx: TenantContext,
  rawQuery: string,
  allowedModules: string[] = [],
): Promise<{ query: string; results: GlobalSearchResult[]; total: number; truncated: boolean }> {
  const term = text(rawQuery, 100).toLowerCase();
  if (term.length < 2) return { query: term, results: [], total: 0, truncated: false };
  const cacheKey = ctx.tenantId + ':' + ctx.uid + ':' + term;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { query: term, results: cached.results, total: cached.results.length, truncated: cached.truncated };
  }

  const repo = tenantRepo(ctx);
  const isAdmin = ctx.role === 'admin' || ctx.isPlatformAdmin === true;
  const allowed = new Set(allowedModules);
  const specs: Array<{ category: string; module: SearchModule; recordType: string; ref: any; title: string[]; subtitle: string[]; content: string[]; date: string[] }> = [
    { category: 'Leads & Contacts', module: 'crm', recordType: 'lead', ref: repo.leads(), title: ['name', 'fullName', 'contactName'], subtitle: ['email', 'phone', 'companyName', 'company'], content: ['name', 'fullName', 'email', 'phone', 'mobile', 'companyName', 'company', 'city', 'country', 'source', 'notes', 'queryMessage', 'designation'], date: ['updatedAt', 'createdAt'] },
    { category: 'Leads & Contacts', module: 'crm', recordType: 'contact', ref: repo.contacts(), title: ['name', 'fullName', 'contactName'], subtitle: ['email', 'phone', 'companyName', 'company'], content: ['name', 'fullName', 'email', 'phone', 'mobile', 'companyName', 'company', 'city', 'country', 'notes'], date: ['updatedAt', 'createdAt'] },
    { category: 'Conversations', module: 'inbox', recordType: 'conversation', ref: repo.conversations(), title: ['contactName', 'leadName', 'name', 'subject'], subtitle: ['channel', 'email', 'phone', 'contactEmail'], content: ['contactName', 'leadName', 'name', 'subject', 'email', 'phone', 'lastMessage', 'lastMessageText', 'preview', 'snippet', 'channel'], date: ['lastMessageAt', 'updatedAt', 'createdAt'] },
    { category: 'Conversations', module: 'inbox', recordType: 'message', ref: repo.messages(), title: ['subject', 'contactName', 'fromName'], subtitle: ['channel', 'from', 'to', 'email'], content: ['subject', 'text', 'body', 'html', 'content', 'message', 'from', 'to', 'email', 'contactName'], date: ['createdAt', 'timestamp', 'sentAt'] },
    { category: 'Campaigns', module: 'campaigns', recordType: 'campaign', ref: repo.outboundCampaigns(), title: ['name', 'campaignName', 'title'], subtitle: ['status', 'channel', 'type'], content: ['name', 'campaignName', 'title', 'description', 'status', 'subject', 'previewText'], date: ['updatedAt', 'createdAt'] },
    { category: 'Campaigns', module: 'campaigns', recordType: 'campaign', ref: repo.campaigns(), title: ['name', 'campaignName', 'title'], subtitle: ['status', 'channel', 'type'], content: ['name', 'campaignName', 'title', 'description', 'status', 'subject'], date: ['updatedAt', 'createdAt'] },
    { category: 'Email & WhatsApp Templates', module: 'email-design-studio', recordType: 'template', ref: repo.emailTemplates(), title: ['name', 'title', 'templateName'], subtitle: ['type', 'channel', 'status'], content: ['name', 'title', 'templateName', 'subject', 'description', 'html', 'body', 'content'], date: ['updatedAt', 'createdAt'] },
    { category: 'Knowledge Base', module: 'knowledge', recordType: 'knowledge-document', ref: repo.knowledgeDocuments(), title: ['title', 'name'], subtitle: ['category', 'source', 'status'], content: ['title', 'name', 'content', 'text', 'summary', 'description', 'url'], date: ['updatedAt', 'createdAt'] },
    { category: 'Lead Database', module: 'database', recordType: 'database-entry', ref: repo.leadDatabaseEntries(), title: ['name', 'companyName'], subtitle: ['email', 'phone', 'sourceDatabaseName'], content: ['name', 'email', 'phone', 'companyName', 'website', 'designation', 'city', 'country'], date: ['updatedAt', 'createdAt'] },
    { category: 'Activities & Follow-ups', module: 'crm', recordType: 'activity', ref: repo.leadActivities(), title: ['title', 'subject', 'leadName', 'contactName'], subtitle: ['type', 'status', 'assignedToName'], content: ['title', 'subject', 'leadName', 'contactName', 'description', 'notes', 'type', 'status'], date: ['updatedAt', 'createdAt', 'dueAt'] },
  ];

  const visibleSpecs = specs.filter((spec) => canSearchModule(spec.module, allowed, isAdmin));
  const categoryCounts = new Map<string, number>();
  const results: GlobalSearchResult[] = [];
  const batches = await Promise.all(visibleSpecs.map(async (spec) => {
    try {
      const scanned = await readCollection(spec.ref, ctx.tenantId + ':' + spec.category + ':' + visibleSpecs.indexOf(spec));
      return { spec, rows: scanned.rows, truncated: scanned.truncated, failed: false };
    } catch {
      return { spec, rows: [], truncated: false, failed: true };
    }
  }));

  for (const batch of batches) {
    const { spec, rows } = batch;
    for (const row of rows) {
      const categoryCount = categoryCounts.get(spec.category) || 0;
      if (categoryCount >= MAX_RESULTS_PER_CATEGORY) continue;
      const blob = searchBlob(row.data, spec.content).toLowerCase();
      if (!blob.includes(term)) continue;
      const title = pick(row.data, spec.title) || pick(row.data, ['email', 'phone', 'id']) || 'Untitled record';
      const subtitle = pick(row.data, spec.subtitle) || spec.category;
      const updatedAt = pick(row.data, spec.date);
      results.push({
        id: spec.module + ':' + row.id,
        category: spec.category,
        title,
        subtitle,
        snippet: makeSnippet(row.data, spec.content, term),
        module: spec.module,
        recordId: row.id,
        recordType: spec.recordType,
        ...((row.data.conversationId || row.data.leadId || row.data.contactId) ? { relatedId: String(row.data.conversationId || row.data.leadId || row.data.contactId) } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });
      categoryCounts.set(spec.category, categoryCount + 1);
    }
  }

  // Team member search is intentionally limited to the current tenant's own user records.
  if (canSearchModule('workspace', allowed, isAdmin)) {
    try {
      const [members, legacyMembers] = await Promise.all([
        getDocs(query(globalUsersCol(), where('tenantId', '==', ctx.tenantId), limit(100))),
        getDocs(query(collection(db, 'app_users'), where('tenantId', '==', ctx.tenantId), limit(100))),
      ]);
      const memberDocs = [...members.docs, ...legacyMembers.docs];
      const seenMemberIds = new Set<string>();
      for (const doc of memberDocs) {
        if (seenMemberIds.has(doc.id)) continue;
        seenMemberIds.add(doc.id);
        const data = doc.data() as Record<string, any>;
        const blob = [data.name, data.displayName, data.email].map((v) => text(v, 300)).join(' ').toLowerCase();
        if (!blob.includes(term)) continue;
        results.push({
          id: 'workspace:' + doc.id,
          category: 'Team Members',
          title: pick(data, ['name', 'displayName', 'email']) || 'Workspace member',
          subtitle: pick(data, ['email', 'role']) || 'Team member',
          snippet: pick(data, ['email', 'role']),
          module: 'workspace',
          recordId: doc.id,
          recordType: 'team-member',
          ...(pick(data, ['updatedAt', 'createdAt']) ? { updatedAt: pick(data, ['updatedAt', 'createdAt']) } : {}),
        });
      }
    } catch {
      // A missing optional user collection must not break the rest of global search.
    }
  }

  // WhatsApp templates are sourced live from Meta, not Firestore. Cache the tenant's list briefly.
  if (isAdmin) {
    try {
      let templates = whatsAppTemplatesCache.get(ctx.tenantId);
      if (!templates || Date.now() - templates.at >= COLLECTION_CACHE_TTL_MS) {
        const meta = await import('./metaChannelsService.js');
        const liveTemplates = await meta.listWhatsAppTemplatesForManagement(ctx);
        templates = { at: Date.now(), templates: liveTemplates };
        whatsAppTemplatesCache.set(ctx.tenantId, templates);
      }
      for (const template of templates.templates) {
        const componentsText = JSON.stringify(template.components || []);
        const blob = [template.name, template.language, template.category, template.status, componentsText].map((value) => text(value, 1200)).join(' ').toLowerCase();
        if (!blob.includes(term)) continue;
        results.push({
          id: 'whatsapp-template:' + String(template.id || template.name),
          category: 'Email & WhatsApp Templates',
          title: text(template.name, 160) || 'WhatsApp template',
          subtitle: ['WhatsApp', template.language, template.status].filter(Boolean).join(' · '),
          snippet: makeSnippet({ body: componentsText }, ['body'], term),
          module: 'email-design-studio',
          recordId: String(template.id || template.name),
          recordType: 'whatsapp-template',
        });
      }
    } catch {
      // WhatsApp may not be connected; email template results remain available.
    }
  }

  const sorted = results.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const capped = sorted.slice(0, 35);
  const result = { query: term, results: capped, total: capped.length, truncated: false };
  cache.set(cacheKey, { at: Date.now(), results: capped, truncated: false });
  return result;
}
