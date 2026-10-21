/**
 * Per-company brand profile.
 *
 * Everything customer-facing that used to be hardcoded as "Umrah360" lives here as DATA.
 * The `umrah360` workspace keeps its exact historical values (UMRAH360_BRAND), so its output is unchanged.
 * Every other workspace gets neutral defaults built from its own name until it fills in its brand settings.
 *
 * Shared by server and client (no imports from either side).
 */

export type BrandPlaybook = 'umrah360' | 'generic';

export interface TenantBrand {
  /** 'umrah360' keeps the Hajj/Umrah-specific AI rules & fallback replies. 'generic' uses neutral, KB-grounded ones. */
  playbook: BrandPlaybook;
  /** Display name, e.g. "Acme Travel". */
  companyName: string;
  /** Short product/service line used in prompts, e.g. "the travel ERP & CRM for tour operators". */
  tagline: string;
  /** What the company sells, used as default "product" on webhook leads. */
  defaultProduct: string;
  /** Description of who the AI is speaking for (used in system prompts). */
  industryDescription: string;
  websiteUrl: string;
  /** Public contact / sales email shown to customers. */
  salesEmail: string;
  /** Public phone / WhatsApp for hand-offs ("" = none). */
  supportPhone: string;
  /** Name of the team that signs messages, e.g. "Acme Team". */
  teamName: string;
  /** Sender display name for automated emails. */
  senderName: string;
  /** Name shown for AI-authored messages in the inbox. */
  aiAgentName: string;
  /** Logo URL ("" = text wordmark). */
  logoUrl: string;
  /** IANA timezone used for scheduling & follow-up windows. */
  timezone: string;
  /** Label shown to customers next to times, e.g. "IST". */
  timezoneLabel: string;
  /** Days 0=Sun..6=Sat on which demos can be booked. */
  workingDays: number[];
  /** Working hours, 24h, local to `timezone`. */
  workingHoursStart: number;
  workingHoursEnd: number;
  /** Calendar account used for demo invites ("" = platform default). */
  calendarEmail: string;
}

export const UMRAH360_BRAND: TenantBrand = {
  playbook: 'umrah360',
  companyName: 'Umrah360',
  tagline: 'the travel ERP & CRM software for Hajj & Umrah tour operators',
  defaultProduct: 'Umrah360 ERP & B2B Sub-Agent Portal',
  industryDescription: 'Hajj and Umrah tour operators',
  websiteUrl: 'https://umrah360.in',
  salesEmail: 'sales@umrah360.in',
  supportPhone: '+91 98202 52434',
  teamName: 'Umrah360 Team',
  senderName: 'Umrah360 Automation',
  aiAgentName: 'Umrah360 AI',
  logoUrl: '',
  timezone: 'Asia/Kolkata',
  timezoneLabel: 'IST',
  workingDays: [1, 2, 3, 4, 5],
  workingHoursStart: 10,
  workingHoursEnd: 19,
  calendarEmail: 'amaavigo@gmail.com',
};

/** Neutral defaults for any workspace that is not umrah360. */
export function defaultBrandFor(tenantId: string, tenantName?: string, extra?: { timezone?: string; contactEmail?: string }): TenantBrand {
  if (tenantId === 'umrah360') return { ...UMRAH360_BRAND };
  const name = (tenantName || tenantId || 'Our Team').trim();
  return {
    playbook: 'generic',
    companyName: name,
    tagline: '',
    defaultProduct: name,
    industryDescription: '',
    websiteUrl: '',
    salesEmail: extra?.contactEmail || '',
    supportPhone: '',
    teamName: `${name} Team`,
    senderName: name,
    aiAgentName: `${name} AI`,
    logoUrl: '',
    timezone: extra?.timezone || 'UTC',
    timezoneLabel: '',
    workingDays: [1, 2, 3, 4, 5],
    workingHoursStart: 10,
    workingHoursEnd: 19,
    calendarEmail: '',
  };
}

/** Merge a stored (possibly partial / untrusted) brand over the defaults. */
export function mergeBrand(base: TenantBrand, stored: Partial<TenantBrand> | null | undefined): TenantBrand {
  const out: TenantBrand = { ...base };
  if (!stored || typeof stored !== 'object') return out;
  const str = (k: keyof TenantBrand) => {
    const v = (stored as any)[k];
    if (typeof v === 'string') (out as any)[k] = v.trim();
  };
  (['companyName', 'tagline', 'defaultProduct', 'industryDescription', 'websiteUrl', 'salesEmail', 'supportPhone',
    'teamName', 'senderName', 'aiAgentName', 'logoUrl', 'timezone', 'timezoneLabel', 'calendarEmail'] as (keyof TenantBrand)[]).forEach(str);
  if (stored.playbook === 'umrah360' || stored.playbook === 'generic') out.playbook = stored.playbook;
  if (Array.isArray(stored.workingDays)) {
    const d = stored.workingDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (d.length) out.workingDays = Array.from(new Set(d)).sort();
  }
  const h = (v: any) => (Number.isInteger(v) && v >= 0 && v <= 24 ? (v as number) : undefined);
  const hs = h(stored.workingHoursStart);
  const he = h(stored.workingHoursEnd);
  if (hs !== undefined && he !== undefined && hs < he) {
    out.workingHoursStart = hs;
    out.workingHoursEnd = he;
  }
  // Empty required strings fall back to the base value.
  if (!out.companyName) out.companyName = base.companyName;
  if (!out.teamName) out.teamName = `${out.companyName} Team`;
  if (!out.senderName) out.senderName = out.companyName;
  if (!out.aiAgentName) out.aiAgentName = `${out.companyName} AI`;
  if (!out.timezone) out.timezone = base.timezone;
  return out;
}

// ---- derived helpers (single source of truth for strings built from the brand) ----

export const brandSignature = (b: TenantBrand): string => `Regards,\n${b.teamName}`;

export const brandAutomationSignature = (b: TenantBrand): string =>
  b.playbook === 'umrah360'
    ? 'Regards,\nUmrah360 Automation Team\nwww.umrah360.in'
    : `Regards,\n${b.teamName}${b.websiteUrl ? `\n${b.websiteUrl.replace(/^https?:\/\//, '')}` : ''}`;

export const brandHost = (b: TenantBrand): string => b.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

export const brandFallbackAgency = (b: TenantBrand, firstName: string): string =>
  b.playbook === 'umrah360' ? `${firstName}'s Pilgrimage Agency` : `${firstName}'s Company`;

export const brandIntro = (b: TenantBrand): string =>
  `${b.companyName}${b.websiteUrl ? ` (${brandHost(b)})` : ''}${b.tagline ? `, ${b.tagline}` : ''}`;

export const brandTzLabel = (b: TenantBrand): string => b.timezoneLabel || b.timezone;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Monday to Friday" / "Mon, Wed, Fri" style label for the working days. */
export function brandWorkingDaysLabel(b: TenantBrand): string {
  const d = [...b.workingDays].sort();
  const contiguous = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  if (d.length > 2 && contiguous) return `${DAY_NAMES[d[0]]} to ${DAY_NAMES[d[d.length - 1]]}`;
  return d.map((n) => DAY_NAMES[n]).join(', ');
}

export const fmtHour = (h: number): string => {
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${h % 24 >= 12 ? 'PM' : 'AM'}`;
};

/** e.g. "Monday to Friday between 10:00 AM and 7:00 PM IST" */
export const brandWorkingWindowLabel = (b: TenantBrand): string =>
  `${brandWorkingDaysLabel(b)} between ${fmtHour(b.workingHoursStart)} and ${fmtHour(b.workingHoursEnd)} ${brandTzLabel(b)}`.trim();

// ---- website-lead thank-you email (shared by both senders) ----

export const brandDemoThankYouSubject = (b: TenantBrand, company: string): string =>
  b.playbook === 'umrah360'
    ? `We have received your Umrah360 Demo Request - ${company}`
    : `We have received your ${b.companyName} Demo Request - ${company}`;

export const brandSpecialistLine = (b: TenantBrand, contactVia: string): string =>
  b.playbook === 'umrah360'
    ? `One of our senior pilgrimage software specialists will reach out to you shortly at ${contactVia} to coordinate a suitable time for your personalized walkthrough and answer any operational questions you have.`
    : `One of our specialists will reach out to you shortly at ${contactVia} to coordinate a suitable time for your personalized walkthrough and answer any questions you have.`;

export const brandThankYouSignoff = (b: TenantBrand): string[] =>
  b.playbook === 'umrah360' ? [`The Umrah360 Team`, `https://umrah360.in`] : [`The ${b.teamName.replace(/\s+Team$/i, '')} Team`, ...(b.websiteUrl ? [b.websiteUrl] : [])];

export const brandDefaultSourceUrl = (b: TenantBrand): string =>
  b.playbook === 'umrah360' ? 'https://umrah360.in/request-demo' : b.websiteUrl;

/** First line of the inbound website-lead log message. */
export const brandInboundHeading = (b: TenantBrand): string =>
  b.playbook === 'umrah360'
    ? `🕋 INBOUND DEMO REQUEST from umrah360.in/request-demo:`
    : `📥 INBOUND DEMO REQUEST${brandHost(b) ? ` from ${brandHost(b)}` : ''}:`;
