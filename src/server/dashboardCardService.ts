import { randomUUID } from 'node:crypto';
import { generateOpenAICompletion } from './openaiClient.js';
import { tenantRepo } from './tenantRepo.js';
import { getDoc, getDocs, setDoc, query, where, orderBy, limit, countDocs } from './adminFirestore.js';
import type { TenantContext } from '../types/tenant.js';

export type DashboardChartType = 'kpi' | 'line' | 'bar' | 'pie' | 'area' | 'table';
export type DashboardDateRange = '7d' | '30d' | '90d' | '6m' | '12m' | 'all';
export type DashboardCardWidth = 'small' | 'medium' | 'large';
export type DashboardPlacement = 'top' | 'middle' | 'bottom';

export interface DashboardCardConfig {
  id: string;
  prompt: string;
  title: string;
  description: string;
  metricId: string;
  chartType: DashboardChartType;
  dateRange: DashboardDateRange;
  groupBy: 'day' | 'week' | 'month' | 'status' | 'channel' | 'none';
  comparePrevious: boolean;
  displayFormat: 'number' | 'percentage' | 'currency' | 'compact';
  width: DashboardCardWidth;
  placement: DashboardPlacement;
  filters: { statuses?: string[]; channels?: string[] };
  createdAt: string;
  updatedAt: string;
}

export interface DashboardCardPreview {
  value?: number;
  previousValue?: number;
  changePercent?: number | null;
  series: Array<{ label: string; value: number; previousValue?: number }>;
  note?: string;
  sampled?: boolean;
  updatedAt: string;
}

type MetricDefinition = {
  id: string;
  label: string;
  description: string;
  source: 'leads' | 'conversations' | 'campaigns' | 'campaignLeads';
  kind: 'count' | 'trend' | 'breakdown' | 'rate';
  field?: string;
  value?: string | number | boolean;
  charts: DashboardChartType[];
  defaultChart: DashboardChartType;
  dateField?: string;
  groupBy: DashboardCardConfig['groupBy'][];
  format: DashboardCardConfig['displayFormat'];
};

const STATUS_OPTIONS = [
  'NEW', 'CONTACTED', 'FOLLOW_UP', 'ENGAGED', 'QUALIFIED', 'DEMO_BOOKED',
  'DEMO_SCHEDULED', 'PROPOSAL_SENT', 'HUMAN_HANDOFF', 'CLOSED_WON',
  'CLOSED_LOST', 'NOT_INTERESTED', 'UNSUBSCRIBED',
];
const CHANNEL_OPTIONS = ['EMAIL', 'WHATSAPP', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN'];

export const DASHBOARD_METRICS: MetricDefinition[] = [
  { id:'leads.total', label:'Total leads', description:'Total CRM leads in this workspace', source:'leads', kind:'count', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'leads.new', label:'New leads', description:'Leads currently in the New stage', source:'leads', kind:'count', field:'status', value:'NEW', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'leads.hot', label:'Hot leads', description:'Leads with an AI lead score of 80 or higher', source:'leads', kind:'count', field:'leadScore', value:80, charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'leads.by_status', label:'Leads by stage', description:'CRM lead distribution by pipeline status', source:'leads', kind:'breakdown', charts:['bar','pie','table'], defaultChart:'bar', groupBy:['status'], format:'number' },
  { id:'leads.created_over_time', label:'Lead growth', description:'New CRM leads created over time', source:'leads', kind:'trend', dateField:'createdAt', charts:['line','area','bar','table'], defaultChart:'line', groupBy:['day','week','month'], format:'number' },
  { id:'conversations.total', label:'Total conversations', description:'All conversations across connected channels', source:'conversations', kind:'count', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'conversations.active', label:'Active conversations', description:'Conversations currently active or in review', source:'conversations', kind:'count', field:'status', value:'ACTIVE_REVIEW', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'conversations.unread', label:'Unread conversations', description:'Conversations with unread messages', source:'conversations', kind:'count', field:'unread', value:true, charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'conversations.by_channel', label:'Conversations by channel', description:'Conversation distribution by Email, WhatsApp, Website and social channels', source:'conversations', kind:'breakdown', field:'channel', charts:['bar','pie','table'], defaultChart:'pie', groupBy:['channel'], format:'number' },
  { id:'conversations.created_over_time', label:'Conversation activity', description:'Conversations started over time', source:'conversations', kind:'trend', dateField:'startedAt', charts:['line','area','bar','table'], defaultChart:'line', groupBy:['day','week','month'], format:'number' },
  { id:'campaigns.total', label:'Total campaigns', description:'Campaigns created in this workspace', source:'campaigns', kind:'count', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'campaigns.running', label:'Running campaigns', description:'Campaigns with Running status', source:'campaigns', kind:'count', field:'status', value:'RUNNING', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'campaigns.sent', label:'Campaign emails sent', description:'Campaign lead records marked Sent', source:'campaignLeads', kind:'count', field:'sendStatus', value:'SENT', charts:['kpi'], defaultChart:'kpi', dateField:'lastSentAt', groupBy:['none'], format:'number' },
  { id:'campaigns.replies', label:'Campaign replies', description:'Campaign lead records with a verified reply', source:'campaignLeads', kind:'count', field:'replyStatus', value:'REPLIED', charts:['kpi'], defaultChart:'kpi', dateField:'repliedAt', groupBy:['none'], format:'number' },
  { id:'campaigns.open_rate', label:'Campaign open rate', description:'Share of sent campaign emails with a tracked open event', source:'campaignLeads', kind:'rate', charts:['kpi'], defaultChart:'kpi', dateField:'lastSentAt', groupBy:['none'], format:'percentage' },
  { id:'campaigns.send_status', label:'Campaign delivery status', description:'Campaign lead distribution by send status', source:'campaignLeads', kind:'breakdown', field:'sendStatus', charts:['bar','pie','table'], defaultChart:'pie', groupBy:['status'], format:'number' },
  { id:'followups.due', label:'Follow-ups due', description:'Leads currently in the Follow Up stage', source:'leads', kind:'count', field:'status', value:'FOLLOW_UP', charts:['kpi'], defaultChart:'kpi', dateField:'createdAt', groupBy:['none'], format:'number' },
  { id:'demos.booked', label:'Demos booked', description:'CRM leads currently marked Demo Booked or Demo Scheduled', source:'leads', kind:'count', field:'status', value:'DEMO_BOOKED', charts:['kpi'], defaultChart:'kpi', dateField:'demoBookedAt', groupBy:['none'], format:'number' },
];

const DATE_DAYS: Record<DashboardDateRange, number | null> = {
  '7d': 7, '30d': 30, '90d': 90, '6m': 183, '12m': 365, all: null,
};
const COLLECTION = (ctx: TenantContext, source: MetricDefinition['source']) => {
  const tenant = tenantRepo(ctx);
  return source === 'leads' ? tenant.leads()
    : source === 'conversations' ? tenant.conversations()
    : source === 'campaigns' ? tenant.campaigns() : tenant.campaignLeads();
};

function parseModelJson(raw: string): any {
  const cleaned = raw.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/,'').trim();
  return JSON.parse(cleaned);
}

function cleanString(value: unknown, fallback: string, max: number): string {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) || fallback;
}

export function normalizeDashboardCard(input: any, prompt = ''): DashboardCardConfig {
  const metric = DASHBOARD_METRICS.find((item) => item.id === String(input?.metricId || ''));
  if (!metric) throw new Error('AI selected a metric that is not supported by this workspace.');
  const chartType = metric.charts.includes(input?.chartType) ? input.chartType as DashboardChartType : metric.defaultChart;
  const dateRange = (['7d','30d','90d','6m','12m','all'] as string[]).includes(input?.dateRange) ? input.dateRange as DashboardDateRange : '30d';
  const groupBy = metric.groupBy.includes(input?.groupBy) ? input.groupBy as DashboardCardConfig['groupBy'] : metric.groupBy[0];
  const statuses = Array.isArray(input?.filters?.statuses)
    ? input.filters.statuses.filter((value: unknown): value is string => typeof value === 'string' && STATUS_OPTIONS.includes(value)).slice(0, 10)
    : [];
  const channels = Array.isArray(input?.filters?.channels)
    ? input.filters.channels.filter((value: unknown): value is string => typeof value === 'string' && CHANNEL_OPTIONS.includes(value)).slice(0, 6)
    : [];
  const now = new Date().toISOString();
  return {
    id: cleanString(input?.id, randomUUID(), 80),
    prompt: cleanString(prompt || input?.prompt, 'AI-generated dashboard card', 500),
    title: cleanString(input?.title, metric.label, 72),
    description: cleanString(input?.description, metric.description, 180),
    metricId: metric.id,
    chartType,
    dateRange,
    groupBy,
    comparePrevious: input?.comparePrevious === true && metric.kind !== 'breakdown' && dateRange !== 'all',
    displayFormat: (['number','percentage','currency','compact'] as string[]).includes(input?.displayFormat)
      ? input.displayFormat : metric.format,
    width: (['small','medium','large'] as string[]).includes(input?.width) ? input.width : (chartType === 'kpi' ? 'small' : chartType === 'pie' ? 'medium' : 'large'),
    placement: (['top','middle','bottom'] as string[]).includes(input?.placement) ? input.placement : 'bottom',
    filters: {
      ...(metric.source === 'leads' && statuses.length ? { statuses } : {}),
      ...(metric.source === 'conversations' && channels.length ? { channels } : {}),
    },
    createdAt: cleanString(input?.createdAt, now, 50),
    updatedAt: now,
  };
}

export async function generateDashboardCard(ctx: TenantContext, userPrompt: string): Promise<DashboardCardConfig> {
  const prompt = String(userPrompt || '').trim();
  if (prompt.length < 8 || prompt.length > 500) throw new Error('Describe the dashboard card in 8 to 500 characters.');
  const catalogue = DASHBOARD_METRICS.map((metric) => ({
    id: metric.id, label: metric.label, description: metric.description,
    kind: metric.kind, allowedCharts: metric.charts, allowedGroupings: metric.groupBy, defaultChart: metric.defaultChart,
  }));
  const systemPrompt = [
    'You design analytics cards for a multi-tenant SaaS dashboard.',
    'Choose exactly one metric from the supplied catalogue. Do not invent fields, metrics, data sources, formulas, filters or database queries.',
    'The user only supplies a natural-language request. You must infer the card title, chart type, date range, grouping, filters, comparison period, display format, width and placement.',
    'Choose chartType only from that metric allowedCharts. Choose groupBy only from allowedGroupings.',
    'Use KPI for a single value, line/area for trends, bar for comparisons, pie for proportions, and table for precise row values.',
    'Set width to small for KPI, medium for compact categorical charts, large for time-series charts or tables. Placement is top, middle, or bottom depending on importance.',
    'Use displayFormat percentage only for rates, currency only when the metric actually represents money, otherwise number or compact.',
    'If the request cannot be represented with one supported metric, select the closest safe metric and explain the limitation in description.',
    'Return valid JSON only with keys: title, description, metricId, chartType, dateRange, groupBy, comparePrevious, displayFormat, width, placement, filters.',
    'filters may contain only statuses (known CRM status values) or channels (EMAIL, WHATSAPP, WEBSITE, INSTAGRAM, FACEBOOK, LINKEDIN). Omit unused filters.',
  ].join(' ');
  const raw = await generateOpenAICompletion({
    systemPrompt,
    userPrompt: JSON.stringify({ request: prompt, supportedMetrics: catalogue }),
    jsonMode: true,
    temperature: 0.15,
    maxTokens: 900,
    models: [process.env.DASHBOARD_CARD_MODEL || 'gpt-4o-mini'],
    tenantId: ctx.tenantId,
    usageFeature: 'dashboard_card_builder',
    timeoutMs: 25000,
    maxRetries: 0,
  });
  const parsed = parseModelJson(raw);
  return normalizeDashboardCard(parsed, prompt);
}

function rangeStart(range: DashboardDateRange, offsetDays = 0, now = Date.now()): number | null {
  const days = DATE_DAYS[range];
  return days === null ? null : now - (days + offsetDays) * 86400000;
}
function dateMs(value: any): number {
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function toBucketKey(date: Date, groupBy: 'day' | 'week' | 'month'): string {
  if (groupBy === 'month') return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  if (groupBy === 'week') {
    const start = new Date(date);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function getRowsForRange(rows: any[], field: string, range: DashboardDateRange, offsetDays = 0) {
  const start = rangeStart(range, offsetDays);
  const end = offsetDays ? rangeStart(range, 0) : Date.now();
  return rows.filter((row) => {
    const time = dateMs(row?.[field]);
    return time > 0 && (start === null || time >= start) && (end === null || time < end);
  });
}
async function readRecentRows(ctx: TenantContext, source: MetricDefinition['source'], field: string): Promise<any[]> {
  const collection = COLLECTION(ctx, source);
  try {
    const snapshot = await getDocs(query(collection, orderBy(field, 'desc'), limit(300)));
    return snapshot.docs.map((doc) => doc.data());
  } catch {
    const snapshot = await getDocs(query(collection, limit(300)));
    return snapshot.docs.map((doc) => doc.data());
  }
}

async function countInRange(
  ctx: TenantContext,
  source: MetricDefinition['source'],
  range: DashboardDateRange,
  dateField: string,
  conditions: Array<{ field: string; op: any; value: any }> = [],
  previous = false
): Promise<number> {
  const base = COLLECTION(ctx, source);
  const constraints: any[] = conditions.map((condition) => where(condition.field, condition.op, condition.value));
  const start = rangeStart(range, previous ? (DATE_DAYS[range] || 0) : 0);
  if (start !== null) {
    const end = previous ? rangeStart(range, 0) : Date.now();
    constraints.push(where(dateField, '>=', new Date(start).toISOString()));
    if (end !== null) constraints.push(where(dateField, '<', new Date(end).toISOString()));
  }
  try { return await countDocs(query(base, ...constraints)); }
  catch {
    // Legacy rows can contain non-ISO timestamps; use the same tenant collection with a bounded fallback.
    const recent = await readRecentRows(ctx, source, dateField);
    const startMs = start;
    const endMs = previous ? rangeStart(range, 0) : Date.now();
    return recent.filter((row) => {
      const value = dateMs(row?.[dateField]);
      const matches = conditions.every((condition) => condition.op === '==' ? row?.[condition.field] === condition.value : condition.op === '>=' ? numeric(row?.[condition.field]) >= numeric(condition.value) : condition.op === 'in' ? Array.isArray(condition.value) && condition.value.includes(row?.[condition.field]) : true);
      return matches && (startMs === null || value >= startMs) && (endMs === null || value < endMs);
    }).length;
  }
}

async function countMetric(ctx: TenantContext, metric: MetricDefinition, card: DashboardCardConfig, previous = false): Promise<number> {
  const conditions: Array<{field:string;op:any;value:any}> = [];
  if (metric.id === 'leads.hot') conditions.push({ field:'leadScore', op:'>=', value:80 });
  else if (metric.id === 'conversations.active') conditions.push({ field:'status', op:'in', value:['ACTIVE','REVIEW'] });
  else if (metric.id === 'conversations.unread') conditions.push({ field:'unread', op:'==', value:true });
  else if (metric.id === 'demos.booked') conditions.push({ field:'status', op:'in', value:['DEMO_BOOKED','DEMO_SCHEDULED'] });
  else if (metric.field && metric.value !== undefined) conditions.push({ field:metric.field, op:'==', value:metric.value });
  if (card.filters.statuses?.length && metric.source === 'leads' && metric.field !== 'status' && metric.id !== 'leads.hot') conditions.push({ field:'status', op:'in', value:card.filters.statuses });
  if (card.filters.channels?.length && metric.source === 'conversations') conditions.push({ field:'channel', op:'in', value:card.filters.channels });
  const field = metric.dateField || 'createdAt';
  return countInRange(ctx, metric.source, card.dateRange, field, conditions, previous);
}

async function buildBreakdown(ctx: TenantContext, metric: MetricDefinition, card: DashboardCardConfig): Promise<Array<{label:string;value:number}>> {
  const field = metric.id === 'leads.by_status' ? 'status' : metric.id === 'conversations.by_channel' ? 'channel' : 'sendStatus';
  const values = metric.id === 'leads.by_status' ? STATUS_OPTIONS
    : metric.id === 'conversations.by_channel' ? CHANNEL_OPTIONS
    : ['PENDING','SENDING','SENT','FAILED','PAUSED','COMPLETED'];
  const selected = metric.id === 'leads.by_status' && card.filters.statuses?.length ? values.filter((value) => card.filters.statuses!.includes(value))
    : metric.id === 'conversations.by_channel' && card.filters.channels?.length ? values.filter((value) => card.filters.channels!.includes(value))
    : values;
  const results = await Promise.all(selected.map(async (value) => ({
    label: value.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' '),
    value: await countInRange(ctx, metric.source, card.dateRange, metric.dateField || 'createdAt', [{ field, op:'==', value }]),
  })));
  return results.filter((item) => item.value > 0);
}

function buildBuckets(rows: any[], field: string, range: DashboardDateRange, groupBy: 'day'|'week'|'month', offsetDays = 0) {
  const days = DATE_DAYS[range] || 183;
  const start = rangeStart(range, offsetDays) ?? Date.now() - days * 86400000;
  const end = offsetDays ? rangeStart(range, 0) ?? Date.now() : Date.now();
  const filtered = getRowsForRange(rows, field, range, offsetDays);
  const byKey = new Map<string, number>();
  filtered.forEach((row) => {
    const date = new Date(dateMs(row[field]));
    const key = toBucketKey(date, groupBy);
    byKey.set(key, (byKey.get(key) || 0) + 1);
  });
  const count = groupBy === 'day' ? Math.min(days, 14) : groupBy === 'week' ? Math.min(Math.ceil(days / 7), 14) : Math.min(Math.ceil(days / 30), 14);
  const span = groupBy === 'day' ? 86400000 : groupBy === 'week' ? 7 * 86400000 : 30 * 86400000;
  const labels: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(end - index * span - (groupBy === 'week' ? 3 * 86400000 : 0));
    labels.push(toBucketKey(date, groupBy));
  }
  return labels.map((label) => ({ label, value: byKey.get(label) || 0 }));
}

export async function previewDashboardCard(ctx: TenantContext, input: any): Promise<DashboardCardPreview> {
  const card = normalizeDashboardCard(input, input?.prompt);
  const metric = DASHBOARD_METRICS.find((item) => item.id === card.metricId)!;
  let series: Array<{label:string;value:number;previousValue?:number}> = [];
  let value: number | undefined;
  let previousValue: number | undefined;
  let note = '';

  if (metric.kind === 'count' || metric.kind === 'rate') {
    if (metric.kind === 'rate') {
      const sent = await countMetric(ctx, { ...metric, id:'campaigns.sent', source:'campaignLeads', kind:'count', field:'sendStatus', value:'SENT' }, card, false);
      const opened = await countInRange(ctx, 'campaignLeads', card.dateRange, 'lastSentAt', [{ field:'opened', op:'==', value:true }], false);
      value = sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0;
      if (card.comparePrevious) {
        const priorSent = await countMetric(ctx, { ...metric, id:'campaigns.sent', source:'campaignLeads', kind:'count', field:'sendStatus', value:'SENT' }, card, true);
        const priorOpened = await countInRange(ctx, 'campaignLeads', card.dateRange, 'lastSentAt', [{ field:'opened', op:'==', value:true }], true);
        previousValue = priorSent > 0 ? Math.round((priorOpened / priorSent) * 1000) / 10 : 0;
      }
    } else {
      value = await countMetric(ctx, metric, card, false);
      if (card.comparePrevious) previousValue = await countMetric(ctx, metric, card, true);
    }
    series = [{ label:card.dateRange === 'all' ? 'All time' : 'Selected period', value, ...(previousValue !== undefined ? { previousValue } : {}) }];
  } else if (metric.kind === 'breakdown') {
    series = await buildBreakdown(ctx, metric, card);
  } else {
    const field = metric.dateField || 'createdAt';
    let rows = await readRecentRows(ctx, metric.source, field);
    if (metric.source === 'leads' && card.filters.statuses?.length) rows = rows.filter((row) => card.filters.statuses!.includes(row.status));
    if (metric.source === 'conversations' && card.filters.channels?.length) rows = rows.filter((row) => card.filters.channels!.includes(row.channel));
    const active = buildBuckets(rows, field, card.dateRange, card.groupBy as 'day'|'week'|'month');
    if (card.comparePrevious) {
      const prior = buildBuckets(rows, field, card.dateRange, card.groupBy as 'day'|'week'|'month', DATE_DAYS[card.dateRange] || 183);
      series = active.map((item,index) => ({ ...item, previousValue:prior[index]?.value || 0 }));
    } else series = active;
    note = rows.length >= 300 ? 'Trend uses the latest 300 records available for this metric.' : '';
  }

  if (metric.kind !== 'trend' && metric.kind !== 'breakdown' && value === undefined) {
    value = 0;
  }
  const changePercent = value !== undefined && previousValue !== undefined
    ? (previousValue === 0 ? null : Math.round(((value - previousValue) / previousValue) * 1000) / 10)
    : undefined;
  return {
    ...(value !== undefined ? { value } : {}),
    ...(previousValue !== undefined ? { previousValue } : {}),
    ...(changePercent !== undefined ? { changePercent } : {}),
    series,
    ...(note ? { note } : {}),
    sampled: metric.kind === 'trend' && note.length > 0,
    updatedAt:new Date().toISOString(),
  };
}

export async function getSavedDashboardCards(ctx: TenantContext): Promise<DashboardCardConfig[]> {
  const snapshot = await getDoc(tenantRepo(ctx).settingsDoc('dashboard_cards'));
  if (!snapshot.exists()) return [];
  const cards = snapshot.data()?.cards;
  if (!Array.isArray(cards)) return [];
  return cards.map((card: any) => normalizeDashboardCard(card, card?.prompt)).slice(0, 24);
}

export async function saveDashboardCard(ctx: TenantContext, input: any): Promise<DashboardCardConfig[]> {
  const card = normalizeDashboardCard(input, input?.prompt);
  const ref = tenantRepo(ctx).settingsDoc('dashboard_cards');
  const snapshot = await getDoc(ref);
  const existing = Array.isArray(snapshot.data()?.cards) ? snapshot.data().cards : [];
  const next = [...existing.filter((item: any) => item?.id !== card.id), card].slice(-24);
  await setDoc(ref, { cards:next, updatedAt:new Date().toISOString() }, { merge:true });
  return next.map((item: any) => normalizeDashboardCard(item, item?.prompt));
}

export async function deleteDashboardCard(ctx: TenantContext, cardId: string): Promise<DashboardCardConfig[]> {
  const id = String(cardId || '').trim().slice(0,80);
  if (!id) throw new Error('Card id is required.');
  const ref = tenantRepo(ctx).settingsDoc('dashboard_cards');
  const snapshot = await getDoc(ref);
  const existing = Array.isArray(snapshot.data()?.cards) ? snapshot.data().cards : [];
  const next = existing.filter((item: any) => item?.id !== id);
  await setDoc(ref, { cards:next, updatedAt:new Date().toISOString() }, { merge:true });
  return next.map((item: any) => normalizeDashboardCard(item, item?.prompt));
}

export const DASHBOARD_CARD_CATALOGUE_FOR_AI = DASHBOARD_METRICS.map(({ id, label, description, kind, charts, groupBy }) => ({
  id, label, description, kind, allowedCharts:charts, allowedGroupings:groupBy,
}));
