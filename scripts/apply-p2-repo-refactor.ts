import fs from 'fs';
import path from 'path';

function refactorCampaignService() {
  const filePath = path.resolve('src/server/campaignService.ts');
  let content = fs.readFileSync(filePath, 'utf-8');

  // Add imports
  if (!content.includes("from './tenantRepo.js'")) {
    content = `import { tenantRepo } from './tenantRepo.js';\nimport type { TenantContext } from '../types/tenant.js';\n` + content;
  }

  // Replace collections
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]email_templates['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).emailTemplates()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]campaigns['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).campaigns()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]campaign_leads['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).campaignLeads()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]campaign_runs['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).campaignRuns()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]campaign_send_history['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).campaignSendHistory()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]outbound_prospects['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).outboundProspects()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]conversations['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).conversations()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]messages['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).messages()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]leads['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).leads()");

  // Replace docs
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]system_metadata['"]\s*,\s*['"]templates_initialized['"]\s*\)/g, "tenantRepo(getCampaignActiveCtx()).settingsDoc('templates_initialized')");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]email_templates['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).emailTemplateDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]campaigns['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).campaignDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]outbound_campaigns['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).outboundCampaignDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]campaign_leads['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).campaignLeadDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]campaign_runs['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).campaignRunDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]campaign_send_history['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).campaignSendHistoryDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]outbound_prospects['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).outboundProspectDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]conversations['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).conversationDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]messages['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).messageDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]leads['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).leadDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]contacts['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getCampaignActiveCtx()).contactDoc($1)");

  // Add TenantStore and activeCtx helpers before DEFAULT_CAMPAIGNS
  const storePreamble = `
const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

let activeCampaignCtx: TenantContext = DEFAULT_UMRAH_CTX;
export function setCampaignActiveContext(ctx: TenantContext) {
  activeCampaignCtx = ctx;
}
export function getCampaignActiveCtx(): TenantContext {
  return activeCampaignCtx;
}

export interface TenantCampaignStore {
  campaignsMap: Map<string, Campaign>;
  campaignLeadsMap: Map<string, CampaignLead>;
  campaignRunsMap: Map<string, CampaignRun>;
  emailTemplatesMap: Map<string, EmailTemplate>;
  sendHistorySet: Set<string>;
  inFlightLeadSendsSet: Set<string>;
  pausedCampaignsSet: Set<string>;
  activeCampaignAbortControllers: Map<string, AbortController>;
  isInitialized: boolean;
}

const tenantCampaignStores = new Map<string, TenantCampaignStore>();

export function getTenantCampaignStore(tenantId: string = 'umrah360'): TenantCampaignStore {
  let store = tenantCampaignStores.get(tenantId);
  if (!store) {
    store = {
      campaignsMap: new Map(),
      campaignLeadsMap: new Map(),
      campaignRunsMap: new Map(),
      emailTemplatesMap: new Map(),
      sendHistorySet: new Set(),
      inFlightLeadSendsSet: new Set(),
      pausedCampaignsSet: new Set(),
      activeCampaignAbortControllers: new Map(),
      isInitialized: false,
    };
    tenantCampaignStores.set(tenantId, store);
  }
  return store;
}

// Proxies mapping legacy globals to tenant-scoped stores
const campaignsMap = {
  get: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.get(k),
  set: (k: string, v: Campaign) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.delete(k),
  values: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.values(),
  keys: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.keys(),
  entries: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.entries(),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).campaignsMap.size; },
};

const campaignLeadsMap = {
  get: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.get(k),
  set: (k: string, v: CampaignLead) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.delete(k),
  values: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.values(),
  keys: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.keys(),
  entries: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.entries(),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).campaignLeadsMap.size; },
};

const campaignRunsMap = {
  get: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.get(k),
  set: (k: string, v: CampaignRun) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.delete(k),
  values: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.values(),
  keys: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.keys(),
  entries: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.entries(),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).campaignRunsMap.size; },
};

const emailTemplatesMap = {
  get: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.get(k),
  set: (k: string, v: EmailTemplate) => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.delete(k),
  values: () => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.values(),
  keys: () => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.keys(),
  entries: () => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.entries(),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).emailTemplatesMap.size; },
};

const sendHistorySet = {
  add: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).sendHistorySet.add(k),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).sendHistorySet.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).sendHistorySet.delete(k),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).sendHistorySet.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).sendHistorySet.size; },
};

const inFlightLeadSendsSet = {
  add: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).inFlightLeadSendsSet.add(k),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).inFlightLeadSendsSet.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).inFlightLeadSendsSet.delete(k),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).inFlightLeadSendsSet.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).inFlightLeadSendsSet.size; },
};

const pausedCampaignsSet = {
  add: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).pausedCampaignsSet.add(k),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).pausedCampaignsSet.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).pausedCampaignsSet.delete(k),
  clear: () => getTenantCampaignStore(activeCampaignCtx.tenantId).pausedCampaignsSet.clear(),
  get size() { return getTenantCampaignStore(activeCampaignCtx.tenantId).pausedCampaignsSet.size; },
};

const activeCampaignAbortControllers = {
  get: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).activeCampaignAbortControllers.get(k),
  set: (k: string, v: AbortController) => getTenantCampaignStore(activeCampaignCtx.tenantId).activeCampaignAbortControllers.set(k, v),
  has: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).activeCampaignAbortControllers.has(k),
  delete: (k: string) => getTenantCampaignStore(activeCampaignCtx.tenantId).activeCampaignAbortControllers.delete(k),
};
`;

  // Replace old map declarations
  content = content.replace(
    /\/\/ In-Memory state caches[\s\S]*?const activeCampaignAbortControllers = new Map<string, AbortController>\(\);/,
    storePreamble.trim()
  );

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[Refactor] src/server/campaignService.ts refactored successfully.');
}

function refactorDemoSchedulingService() {
  const filePath = path.resolve('src/server/demoSchedulingService.ts');
  let content = fs.readFileSync(filePath, 'utf-8');

  if (!content.includes("from './tenantRepo.js'")) {
    content = `import { tenantRepo } from './tenantRepo.js';\nimport type { TenantContext } from '../types/tenant.js';\n\nconst DEFAULT_UMRAH_CTX: TenantContext = {\n  tenantId: 'umrah360',\n  uid: 'system',\n  email: 'system@umrah360.in',\n  role: 'admin',\n};\n\nlet activeSchedulingCtx: TenantContext = DEFAULT_UMRAH_CTX;\nexport function setSchedulingActiveContext(ctx: TenantContext) {\n  activeSchedulingCtx = ctx;\n}\nfunction getSchedCtx(): TenantContext {\n  return activeSchedulingCtx;\n}\n` + content;
  }

  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]bookings['"]\s*\)/g, "tenantRepo(getSchedCtx()).bookings()");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]bookings['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getSchedCtx()).bookingDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]leads['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getSchedCtx()).leadDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]settings['"]\s*,\s*['"]calendar_auth['"]\s*\)/g, "tenantRepo(getSchedCtx()).settingsDoc('calendar_auth')");

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[Refactor] src/server/demoSchedulingService.ts refactored successfully.');
}

function refactorInboundPipeline() {
  const filePath = path.resolve('src/server/inboundPipeline.ts');
  let content = fs.readFileSync(filePath, 'utf-8');

  if (!content.includes("from './tenantRepo.js'")) {
    content = `import { tenantRepo } from './tenantRepo.js';\nimport type { TenantContext } from '../types/tenant.js';\n\nconst DEFAULT_UMRAH_CTX: TenantContext = {\n  tenantId: 'umrah360',\n  uid: 'system',\n  email: 'system@umrah360.in',\n  role: 'admin',\n};\n\nlet activeInboundCtx: TenantContext = DEFAULT_UMRAH_CTX;\nexport function setInboundActiveContext(ctx: TenantContext) {\n  activeInboundCtx = ctx;\n}\nfunction getInboundCtx(): TenantContext {\n  return activeInboundCtx;\n}\n` + content;
  }

  // Collections
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]messages['"]\s*\)/g, "tenantRepo(getInboundCtx()).messages()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]conversations['"]\s*\)/g, "tenantRepo(getInboundCtx()).conversations()");
  content = content.replace(/collection\s*\(\s*db\s*,\s*['"]contacts['"]\s*\)/g, "tenantRepo(getInboundCtx()).contacts()");

  // Docs
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]contacts['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getInboundCtx()).contactDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]leads['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getInboundCtx()).leadDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]conversations['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getInboundCtx()).conversationDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]messages['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getInboundCtx()).messageDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]lead_activities['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getInboundCtx()).leadActivityDoc($1)");

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[Refactor] src/server/inboundPipeline.ts refactored successfully.');
}

function refactorWhatsAppInboundPipeline() {
  const filePath = path.resolve('src/server/whatsappInboundPipeline.ts');
  let content = fs.readFileSync(filePath, 'utf-8');

  if (!content.includes("from './tenantRepo.js'")) {
    content = `import { tenantRepo } from './tenantRepo.js';\nimport type { TenantContext } from '../types/tenant.js';\n\nconst DEFAULT_UMRAH_CTX: TenantContext = {\n  tenantId: 'umrah360',\n  uid: 'system',\n  email: 'system@umrah360.in',\n  role: 'admin',\n};\n\nlet activeWhatsAppCtx: TenantContext = DEFAULT_UMRAH_CTX;\nexport function setWhatsAppActiveContext(ctx: TenantContext) {\n  activeWhatsAppCtx = ctx;\n}\nfunction getWACtx(): TenantContext {\n  return activeWhatsAppCtx;\n}\n` + content;
  }

  // Docs
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]contacts['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getWACtx()).contactDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]leads['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getWACtx()).leadDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]conversations['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getWACtx()).conversationDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]messages['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getWACtx()).messageDoc($1)");
  content = content.replace(/doc\s*\(\s*db\s*,\s*['"]lead_activities['"]\s*,\s*([^)]+)\)/g, "tenantRepo(getWACtx()).leadActivityDoc($1)");

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('[Refactor] src/server/whatsappInboundPipeline.ts refactored successfully.');
}

refactorCampaignService();
refactorDemoSchedulingService();
refactorInboundPipeline();
refactorWhatsAppInboundPipeline();
console.log('All server modules refactored to tenantRepo!');
