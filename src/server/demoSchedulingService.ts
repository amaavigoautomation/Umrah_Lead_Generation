import { AsyncLocalStorage } from 'node:async_hooks';
import { tenantRepo } from './tenantRepo.js';
import {
  getGoogleCalendarAccessToken,
  hasGoogleCalendarRefreshToken,
  invalidateGoogleCalendarAccessToken,
  GoogleCalendarReauthRequired,
} from './googleCalendarOAuth.js';
import { STOP_FOLLOWUPS_WHEN_DEMO_BOOKED } from '../shared/followUpPolicy.js';
import type { TenantContext } from '../types/tenant.js';
import { getTenantBrand, getBrandSync } from './brandService.js';
import { brandTzLabel, brandWorkingDaysLabel, brandWorkingWindowLabel, workingHoursForDay, fmtHour, DAY_NAMES, timezoneLabelFor } from '../shared/brand.js';

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

let activeSchedulingCtx: TenantContext = DEFAULT_UMRAH_CTX;
export function setSchedulingActiveContext(ctx: TenantContext) {
  activeSchedulingCtx = ctx;
}
// Per-call tenant scope. Work started with runWithSchedulingCtx() always sees its own workspace, even
// if another request changes the global active context while it is awaiting. Inbound email / WhatsApp
// replies (cron and webhooks) never set the global one, so they must run inside this scope.
const schedulingCtxStore = new AsyncLocalStorage<TenantContext>();
export function runWithSchedulingCtx<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return schedulingCtxStore.run(ctx, fn);
}
function getSchedCtx(): TenantContext {
  return schedulingCtxStore.getStore() ?? activeSchedulingCtx;
}

// ---- Per-company scheduling brand (timezone, working days/hours, names). Cache is warmed by warmSchedBrand(). ----
const sb = () => getBrandSync(getSchedCtx().tenantId);
const warmSchedBrand = () => getTenantBrand(getSchedCtx().tenantId).catch(() => sb());
const tz = () => sb().timezone;
const TZL = () => brandTzLabel(sb());
const tzDisplay = () => (sb().timezoneLabel ? `${tz()} (${sb().timezoneLabel})` : tz());
const workStartH = () => sb().workingHoursStart;
const workEndH = () => sb().workingHoursEnd;
const demoDurationMinutes = () => sb().demoDurationMinutes || DEMO_DURATION_MINUTES;
const slotStartMinutes = (dayOfWeek?: number) => {
  const days = dayOfWeek === undefined ? sb().workingDays : [dayOfWeek];
  const duration = demoDurationMinutes();
  const out = new Set<number>();
  for (const day of days) {
    if (!sb().workingDays.includes(day)) continue;
    const window = workingHoursForDay(sb(), day);
    const start = window.start * 60;
    const end = window.end * 60;
    for (let minute = start; minute + duration <= end; minute += duration) out.add(minute);
  }
  return Array.from(out).sort((a, b) => a - b);
};
const isConfiguredSlotStart = (hour: number, minute = 0, dayOfWeek?: number) =>
  slotStartMinutes(dayOfWeek).includes(hour * 60 + minute);
const slotEndTotalMinutes = (hour: number, minute = 0) => hour * 60 + minute + demoDurationMinutes();
const slotEndIso = (date: string, hour: number, minute = 0) => {
  const total = slotEndTotalMinutes(hour, minute);
  return createIstIsoString(date, Math.floor(total / 60), total % 60);
};
const formatClockTime = (hour: number, minute = 0) => {
  const h = ((hour % 24) + 24) % 24;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
};
const formatClockTime24 = (totalMinutes: number) => {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};
const workingScheduleLabel = () => brandWorkingWindowLabel(sb());
const hrShort = (h: number) => formatClockTime(h, 0).replace(':00', '');
const daysLabel = () => brandWorkingDaysLabel(sb());
const closedDaysLabel = () => {
  const closed = [0, 1, 2, 3, 4, 5, 6].filter((d) => !sb().workingDays.includes(d)).sort((a, b) => ((a + 1) % 7) - ((b + 1) % 7));
  const names = closed.map((d) => DAY_NAMES[d]);
  return names.length ? (names.length === 2 ? names.join(' and ') : names.join(', ')) : 'no days';
};
const brandName = () => sb().companyName;
/** Calendar account that hosts demos for this company ('' if none). */
const hostCalendarEmail = () => sb().calendarEmail;
const hostEmailList = (smtpUser?: string, smtpFrom?: string) =>
  [
    hostCalendarEmail(),
    smtpUser || '',
    smtpFrom || '',
    ...(sb().playbook === 'umrah360' ? ['sales@umrah360.in', 'support@umrah360.in'] : [sb().salesEmail]),
  ]
    .map((e) => e.toLowerCase().trim())
    .filter((e) => e.length > 0);
import OpenAI from 'openai';
import { recordAiCompletionUsage } from './usageService.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  createDoc,
  deleteDoc,
  setDoc,
  runTransaction,
} from './adminFirestore.js';
import crypto from 'crypto';
import { safeSetDoc } from './firestoreUtils.js';
import { Booking, BookingStatus, Channel, Lead } from '../types/index.js';
import { updateCampaignLeadStatus } from './campaignService.js';
import { sendLiveEmail, getSmtpConfig } from './smtpService.js';
import { stripQuotedEmailHistory as stripQuotedEmailHistoryShared } from './quotedText.js';
import {
  type OfferedSlot,
  hasExplicitDateToken,
  isAffirmative,
  isIsoDate,
  isNegative,
  leadReplyHead,
  looksLikeSchedulingFollowUp,
  namedWeekdays,
  parseExplicitTime,
  pickOfferedSlot,
  preferredPeriodOf,
  resolveSimpleDate,
} from '../shared/schedulingGuardrails.js';

export const SCHEDULING_TIMEZONE = 'Asia/Kolkata'; // IST (UTC +05:30)
// Legacy constants retained for integrations that import them. Tenant demo settings are authoritative.
export const WORKING_START_HOUR = 10;
export const WORKING_END_HOUR = 19;
export const DEMO_DURATION_MINUTES = 60; // Backward-compatible default for tenants without a saved duration.
export const VALID_SLOT_START_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18]; // Legacy hourly start times only.

// Server-side in-memory cache for OAuth access tokens, one entry per workspace (never shared between them).
const serverCalendarTokens = new Map<string, { token: string; expiresAt: number }>();

/**
 * Clears the expired or invalid Google Calendar access token on the server and Firestore
 * to prevent continuous 401 background log errors.
 */
export async function handleExpiredCalendarToken() {
  const tenantId = getSchedCtx().tenantId;
  serverCalendarTokens.delete(tenantId);
  // Connected through the server flow: a 401 only means the short access token ran out. Drop it so the
  // next call renews it with the refresh token. Do NOT mark the calendar expired/disconnected.
  invalidateGoogleCalendarAccessToken(tenantId);
  if (await hasGoogleCalendarRefreshToken(tenantId).catch(() => false)) return;
  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(
        tenantRepo(getSchedCtx()).settingsDoc('calendar_auth'),
        {
          accessToken: null,
          active: false,
          expired: true,
          expiredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('[Calendar Auth Notice] Error updating expired status in Firestore:', e);
    }
  }
}

/**
 * Updates or registers the Google Calendar OAuth access token on the server.
 */
export function setServerCalendarAccessToken(token: string, expiresInSeconds: number = 3600) {
  if (!token || !token.trim() || token === 'null' || token === 'undefined') return;
  serverCalendarTokens.set(getSchedCtx().tenantId, { token: token.trim(), expiresAt: Date.now() + expiresInSeconds * 1000 });
}

/**
 * Retrieves an active Google Calendar OAuth access token.
 * Checks explicit parameter, in-memory cache, Firestore settings/calendar_auth, and env vars.
 * Automatically exchanges stored Refresh Token if Access Token is expired.
 */
export async function getLiveCalendarToken(explicitToken?: string): Promise<string | null> {
  // Preferred: this workspace connected through the server-side Google flow, so a saved refresh token
  // renews the access token automatically. A (possibly stale) token sent by the browser is ignored then.
  try {
    const managed = await getGoogleCalendarAccessToken(getSchedCtx().tenantId);
    if (managed) return managed;
  } catch (e) {
    if (e instanceof GoogleCalendarReauthRequired) return null; // revoked: user must connect again
    console.warn('[Calendar] token renewal failed, falling back:', (e as any)?.message || e);
  }

  if (explicitToken && explicitToken.trim() && explicitToken !== 'null' && explicitToken !== 'undefined') {
    setServerCalendarAccessToken(explicitToken.trim());
    return explicitToken.trim();
  }

  const cachedToken = serverCalendarTokens.get(getSchedCtx().tenantId);
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30000) {
    return cachedToken.token;
  }

  // 1. Try Firestore settings/calendar_auth
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(tenantRepo(getSchedCtx()).settingsDoc('calendar_auth'));
      if (snap.exists()) {
        const data = snap.data();

        // Check if we have an active access token that isn't flagged expired
        if (data?.accessToken && data.accessToken !== 'null' && data?.active !== false && !data?.expired) {
          setServerCalendarAccessToken(data.accessToken);
          return data.accessToken as string;
        }

        // Automatic Refresh Token Exchange if Refresh Token + Client Credentials are saved
        const refreshToken = data?.refreshToken || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
        const clientId = data?.clientId || process.env.GOOGLE_CALENDAR_CLIENT_ID;
        const clientSecret = data?.clientSecret || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

        if (refreshToken && clientId && clientSecret) {
          try {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
              }),
            });

            if (tokenRes.ok) {
              const tokenData = await tokenRes.json();
              if (tokenData.access_token) {
                setServerCalendarAccessToken(tokenData.access_token, tokenData.expires_in || 3600);
                await safeSetDoc(
                  tenantRepo(getSchedCtx()).settingsDoc('calendar_auth'),
                  {
                    accessToken: tokenData.access_token,
                    active: true,
                    expired: false,
                    updatedAt: new Date().toISOString(),
                  },
                  { merge: true }
                );
                return tokenData.access_token;
              }
            } else {
              const errBody = await tokenRes.text();
              console.warn('[Calendar Refresh Token Exchange Failed]:', tokenRes.status, errBody);
            }
          } catch (refErr) {
            console.warn('[Calendar Refresh Token Error]:', refErr);
          }
        }
      }
    } catch (e) {
      console.warn('[Calendar Service Notice] Error reading settings/calendar_auth:', e);
    }
  }

  // 2. Check environment variable fallback
  if (process.env.GOOGLE_CALENDAR_ACCESS_TOKEN) {
    return process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  }

  return null;
}

/**
 * Validates whether the active Google Calendar token is valid by querying Google Calendar API.
 */
export async function verifyGoogleCalendarConnection(tokenOverride?: string): Promise<{
  connected: boolean;
  email?: string;
  error?: string;
}> {
  const token = await getLiveCalendarToken(tokenOverride);
  if (!token) {
    return { connected: false, error: 'No OAuth token found. Please sign in with Google Calendar.' };
  }

  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      return { connected: true, email: data.id || hostCalendarEmail() };
    } else {
      const errText = await res.text();
      if (res.status === 401) {
        await handleExpiredCalendarToken();
        return { connected: false, error: 'Google Calendar OAuth token expired (401). Please click "Connect / Sync Google Calendar" to re-authenticate.' };
      }
      return { connected: false, error: `Google API returned status ${res.status}: ${errText}` };
    }
  } catch (err: any) {
    return { connected: false, error: err?.message || 'Network error verifying Google Calendar' };
  }
}

// -----------------------------------------------------------------------------
// Time & Date Utilities (anchored to Asia/Kolkata / IST)
// -----------------------------------------------------------------------------

export interface IstDateComponents {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dateString: string; // YYYY-MM-DD
}

/**
 * Gets current date and time components in Asia/Kolkata (IST).
 */
/** UTC offset like "+05:30" for a wall-clock date/time in the company timezone. */
function tzOffsetFor(dateString: string, hour: number, minute: number = 0): string {
  const [y, m, d] = dateString.split('-').map((n) => parseInt(n, 10));
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(),
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const offsetAt = (instant: number) => {
    const pm: Record<string, string> = {};
    fmt.formatToParts(new Date(instant)).forEach((p) => { pm[p.type] = p.value; });
    const asUtc = Date.UTC(+pm.year, +pm.month - 1, +pm.day, +pm.hour % 24, +pm.minute, +pm.second);
    return Math.round((asUtc - instant) / 60000);
  };
  let off = offsetAt(wall);
  off = offsetAt(wall - off * 60000);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Day of week (0=Sun) of a calendar date; independent of timezone. */
function dayOfWeekFor(dateString: string): number {
  const [y, m, d] = dateString.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

export function getNowInIst(): IstDateComponents {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const partMap: Record<string, string> = {};
  parts.forEach((p) => {
    partMap[p.type] = p.value;
  });

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  const hour = parseInt(partMap.hour, 10) % 24;
  const minute = parseInt(partMap.minute, 10);

  // Compute day of week in IST
  const dayOfWeek = dayOfWeekFor(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * Creates an ISO string with +05:30 timezone offset for a specific date and hour in IST.
 */
export function createIstIsoString(dateString: string, hour: number, minute: number = 0): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // A configured window may end at midnight (24:00). Normalize that to 00:00
  // on the following date because Google Calendar expects valid RFC3339 times.
  const [year, month, day] = dateString.split('-').map((part) => Number(part));
  const normalizedDate = new Date(Date.UTC(year, month - 1, day + Math.floor(hour / 24), 12, 0, 0))
    .toISOString()
    .slice(0, 10);
  const normalizedHour = ((hour % 24) + 24) % 24;
  return `${normalizedDate}T${pad(normalizedHour)}:${pad(minute)}:00${tzOffsetFor(normalizedDate, normalizedHour, minute)}`;
}

/**
 * Checks whether a given weekday is enabled in this tenant's weekly demo schedule.
 */
export function isWorkingDay(dayOfWeek: number): boolean {
  return sb().workingDays.includes(dayOfWeek);
}

/**
 * Formats an IST slot into a friendly human-readable label.
 * e.g. "Wednesday, Oct 1: 3:00 PM – 4:00 PM IST"
 */
export function formatSlotLabel(dateString: string, startHour: number, startMinute = 0): string {
  const dateObj = new Date(createIstIsoString(dateString, 12, 0));
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(),
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
  const endTotal = slotEndTotalMinutes(startHour, startMinute);
  const slotTimezoneLabel = timezoneLabelFor(tz(), new Date(createIstIsoString(dateString, startHour, startMinute))) || TZL();
  return `${dayName}: ${formatClockTime(startHour, startMinute)} – ${formatClockTime(Math.floor(endTotal / 60), endTotal % 60)} ${slotTimezoneLabel}`;
}

// -----------------------------------------------------------------------------
// Realtime Google Calendar Integration// -----------------------------------------------------------------------------
// Realtime Google Calendar Integration (Single Source of Truth)
// NOTE: Available slots are NEVER stored in any database.
// They are computed dynamically on-the-fly directly from Google Calendar.
// -----------------------------------------------------------------------------

export interface CalendarBusyInterval {
  start: string;
  end: string;
}

export interface CalendarAvailabilityResult {
  available: boolean;
  busyIntervals: CalendarBusyInterval[];
  source: 'GOOGLE_CALENDAR' | 'FALLBACK';
  googleCalendarChecked: boolean;
  error?: string;
}

/**
 * Queries Google Calendar FreeBusy and Events API in real time for [startIso, endIso).
 * Checks the Google Calendar directly as the single source of truth.
 */
export async function checkRealtimeGoogleCalendarSlot(
  startIso: string,
  endIso: string,
  accessTokenOverride?: string
): Promise<CalendarAvailabilityResult> {
  await warmSchedBrand();
  const token = await getLiveCalendarToken(accessTokenOverride);

  if (!token) {
    // If OAuth token is not configured yet, query existing Firestore bookings as fallback
    const fallbackOccupied = await checkFirestoreBookingsConflict(startIso, endIso);
    return {
      available: !fallbackOccupied,
      busyIntervals: fallbackOccupied ? [{ start: startIso, end: endIso }] : [],
      source: 'FALLBACK',
      googleCalendarChecked: false,
      error: 'Google Calendar OAuth token not yet authenticated. Checking booked records ledger.',
    };
  }

  try {
    const reqStartMs = new Date(startIso).getTime();
    const reqEndMs = new Date(endIso).getTime();
    const busyList: CalendarBusyInterval[] = [];

    // 1. Check Google Calendar FreeBusy API
    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: startIso,
        timeMax: endIso,
        timeZone: tz(),
        items: [{ id: 'primary' }],
      }),
    });

    if (freeBusyRes.status === 401) {
      console.warn('[Calendar Service Notice] Google Calendar token expired (401). Clearing stale token.');
      await handleExpiredCalendarToken();
      const fallbackOccupied = await checkFirestoreBookingsConflict(startIso, endIso);
      return {
        available: !fallbackOccupied,
        busyIntervals: fallbackOccupied ? [{ start: startIso, end: endIso }] : [],
        source: 'FALLBACK',
        googleCalendarChecked: false,
        error: 'Google Calendar OAuth token expired (401). Please re-authenticate.',
      };
    }

    if (freeBusyRes.ok) {
      const fbData = await freeBusyRes.json();
      const primaryBusy = fbData.calendars?.primary?.busy || [];

      for (const item of primaryBusy) {
        const itemStartMs = new Date(item.start).getTime();
        const itemEndMs = new Date(item.end).getTime();
        if (reqStartMs < itemEndMs && reqEndMs > itemStartMs) {
          busyList.push({ start: item.start, end: item.end });
        }
      }

      if (busyList.length > 0) {
        return {
          available: false,
          busyIntervals: busyList,
          source: 'GOOGLE_CALENDAR',
          googleCalendarChecked: true,
        };
      }
    }

    // 2. Query Events API for single events overlapping [startIso, endIso)
    const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
      startIso
    )}&timeMax=${encodeURIComponent(endIso)}&singleEvents=true&timeZone=${encodeURIComponent(tz())}`;

    const eventsRes = await fetch(eventsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      // Only events that really block the host: not cancelled, not marked "Free", not declined by the
      // calendar owner, and not informational all-day entries (working location, birthdays).
      const items = (eventsData.items || []).filter(
        (e: any) =>
          e.status !== 'cancelled' &&
          e.transparency !== 'transparent' &&
          e.eventType !== 'workingLocation' &&
          e.eventType !== 'birthday' &&
          !(Array.isArray(e.attendees) && e.attendees.some((a: any) => a?.self && a?.responseStatus === 'declined'))
      );

      for (const item of items) {
        const itemStart = item.start?.dateTime || (item.start?.date ? createIstIsoString(item.start.date, 0, 0) : startIso);
        const itemEnd = item.end?.dateTime || (item.end?.date ? `${item.end.date}T23:59:59${tzOffsetFor(item.end.date, 23, 59)}` : endIso);
        const itemStartMs = new Date(itemStart).getTime();
        const itemEndMs = new Date(itemEnd).getTime();

        if (reqStartMs < itemEndMs && reqEndMs > itemStartMs) {
          busyList.push({ start: itemStart, end: itemEnd });
        }
      }

      if (busyList.length > 0) {
        return {
          available: false,
          busyIntervals: busyList,
          source: 'GOOGLE_CALENDAR',
          googleCalendarChecked: true,
        };
      }
    }

    // Google Calendar API queried successfully and found no busy intervals.
    // Google Calendar is the single source of truth: slot is AVAILABLE.
    return {
      available: true,
      busyIntervals: [],
      source: 'GOOGLE_CALENDAR',
      googleCalendarChecked: true,
    };
  } catch (err: any) {
    console.error('[Calendar Service Error] Realtime availability check failed:', err);
    const fallbackOccupied = await checkFirestoreBookingsConflict(startIso, endIso);
    return {
      available: !fallbackOccupied,
      busyIntervals: fallbackOccupied ? [{ start: startIso, end: endIso }] : [],
      source: 'FALLBACK',
      googleCalendarChecked: false,
      error: err?.message || 'Network error querying Google Calendar',
    };
  }
}

/**
 * Checks Firestore bookings collection to prevent double-booking.
 */
export async function checkFirestoreBookingsConflict(
  startIso: string,
  endIso: string,
  excludeBookingId?: string
): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  try {
    const q = query(
      tenantRepo(getSchedCtx()).bookings(),
      where('status', 'in', ['BOOKED', 'RESCHEDULED']),
      limit(50)
    );
    const snap = await getDocs(q);

    const reqStart = new Date(startIso).getTime();
    const reqEnd = new Date(endIso).getTime();

    for (const d of snap.docs) {
      const b = d.data() as Booking;
      if (excludeBookingId && b.bookingId === excludeBookingId) continue;
      if (!b.startDateTimeIso || !b.endDateTimeIso) continue;

      const bStart = new Date(b.startDateTimeIso).getTime();
      const bEnd = new Date(b.endDateTimeIso).getTime();

      // Overlap condition: start < bEnd && end > bStart
      if (reqStart < bEnd && reqEnd > bStart) {
        return true;
      }
    }
  } catch (e) {
    console.warn('[Calendar Service Notice] Error checking Firestore bookings:', e);
  }
  return false;
}

/**
 * Finds next available slots using this tenant's duration interval and per-day working windows.
 * A slot is only offered when the complete session fits within the configured day.
 * NO AVAILABLE SLOTS ARE SAVED TO ANY DATABASE; slots are computed from live Google Calendar availability.
 */
/**
 * Reads Google Calendar busy intervals for one visible calendar range in a single request.
 * The connected calendar is the availability source of truth; tenant booking records are
 * merged as a second guard for meetings created through this application.
 */
async function getCalendarBusyIntervalsForRange(
  startIso: string,
  endIso: string,
  accessTokenOverride?: string
): Promise<CalendarBusyInterval[]> {
  const token = await getLiveCalendarToken(accessTokenOverride);
  if (!token) {
    throw new Error('Google Calendar availability could not be verified. Reconnect the calendar and try again.');
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: startIso,
      timeMax: endIso,
      timeZone: tz(),
      items: [{ id: 'primary' }],
    }),
  });

  if (response.status === 401) {
    await handleExpiredCalendarToken();
    throw new Error('Google Calendar authorization expired. Reconnect Google Calendar to refresh availability.');
  }
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Google Calendar availability check failed (${response.status}). ${details.slice(0, 220)}`.trim());
  }

  const payload = await response.json();
  const primary = payload?.calendars?.primary;
  if (!primary || (Array.isArray(primary.errors) && primary.errors.length > 0) || !Array.isArray(primary.busy)) {
    const reason = primary?.errors?.[0]?.reason || primary?.errors?.[0]?.message || 'Google did not return the primary calendar busy intervals.';
    throw new Error(`Google Calendar did not return verified availability: ${reason}`);
  }

  const busyIntervals: CalendarBusyInterval[] = primary.busy
    .filter((interval: any) => Number.isFinite(Date.parse(interval?.start)) && Number.isFinite(Date.parse(interval?.end)))
    .map((interval: any) => ({ start: interval.start, end: interval.end }));

  // Preserve the workspace's own booking ledger as a double-booking safeguard.
  if (isFirebaseConfigured && db) {
    try {
      const snapshot = await getDocs(query(
        tenantRepo(getSchedCtx()).bookings(),
        where('status', 'in', ['BOOKED', 'RESCHEDULED']),
        limit(500)
      ));
      const rangeStart = Date.parse(startIso);
      const rangeEnd = Date.parse(endIso);
      for (const document of snapshot.docs) {
        const booking = document.data() as Booking;
        const bookingStart = Date.parse(booking.startDateTimeIso || '');
        const bookingEnd = Date.parse(booking.endDateTimeIso || '');
        if (
          Number.isFinite(bookingStart) &&
          Number.isFinite(bookingEnd) &&
          bookingStart < rangeEnd &&
          bookingEnd > rangeStart
        ) {
          busyIntervals.push({ start: booking.startDateTimeIso, end: booking.endDateTimeIso });
        }
      }
    } catch (error) {
      console.warn('[Calendar Service Notice] Could not merge workspace bookings into availability:', error);
    }
  }

  return busyIntervals;
}

export async function findNextAvailableSlots(
  options: {
    targetDaysCount?: number;
    /** Scan exactly this many calendar dates and query Google FreeBusy once for the whole range. */
    calendarRange?: boolean;
    maxSlotsToReturn?: number;
    preferredDate?: string;
    /** Start scanning from this date (YYYY-MM-DD) instead of today. Past dates fall back to today. */
    startFromDate?: string;
    preferredPeriod?: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY';
    accessToken?: string;
  } = {}
): Promise<Array<{
  date: string; startHour: number; startMinute: number; startTime: string; endTime: string;
  durationMinutes: number; label: string; startIso: string; endIso: string;
}>> {
  await warmSchedBrand();
  const {
    targetDaysCount = 10,
    calendarRange = false,
    maxSlotsToReturn = 4,
    preferredDate,
    preferredPeriod = 'ANY',
    accessToken,
  } = options;
  const nowIst = getNowInIst();
  const nowMs = Date.now();
  const duration = demoDurationMinutes();
  const availableSlots: Array<{
    date: string; startHour: number; startMinute: number; startTime: string; endTime: string;
    durationMinutes: number; label: string; startIso: string; endIso: string;
  }> = [];

  // Start from the date currently displayed in the calendar. Past slots are filtered below,
  // while future dates in a partially elapsed week are still scanned.
  const requestedStartDate = options.startFromDate || preferredDate;
  const scanStartDate = requestedStartDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate)
    ? requestedStartDate
    : nowIst.dateString;
  let currentOffset = 0;
  const maxOffset = Math.max(14, targetDaysCount * 7);
  const addDateKeyDays = (dateKey: string, amount: number) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount, 12)).toISOString().slice(0, 10);
  };
  if (calendarRange) {
    const rangeStartIso = createIstIsoString(scanStartDate, 0, 0);
    const rangeEndIso = createIstIsoString(addDateKeyDays(scanStartDate, targetDaysCount), 0, 0);
    const busyIntervals = await getCalendarBusyIntervalsForRange(rangeStartIso, rangeEndIso, accessToken);
    const availableInRange: Array<{
      date: string; startHour: number; startMinute: number; startTime: string; endTime: string;
      durationMinutes: number; label: string; startIso: string; endIso: string;
    }> = [];
    const busyRanges = busyIntervals
      .map((interval) => ({ start: Date.parse(interval.start), end: Date.parse(interval.end) }))
      .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start);

    // This range is exactly the seven visible calendar dates. Each configured slot is
    // generated locally, then checked against the complete Google busy-interval response.
    for (let offset = 0; offset < targetDaysCount && availableInRange.length < maxSlotsToReturn; offset++) {
      const dateStr = addDateKeyDays(scanStartDate, offset);
      const dayOfWeek = dayOfWeekFor(dateStr);
      if (!isWorkingDay(dayOfWeek)) continue;

      for (const totalStart of slotStartMinutes(dayOfWeek)) {
        if (availableInRange.length >= maxSlotsToReturn) break;
        const startHour = Math.floor(totalStart / 60);
        const startMinute = totalStart % 60;
        const endTotal = totalStart + duration;
        const startIso = createIstIsoString(dateStr, startHour, startMinute);
        const endIso = createIstIsoString(dateStr, Math.floor(endTotal / 60), endTotal % 60);
        const startMs = Date.parse(startIso);
        const endMs = Date.parse(endIso);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= nowMs + MIN_LEAD_TIME_MS) continue;

        const overlapsBusyTime = busyRanges.some((busy) => startMs < busy.end && endMs > busy.start);
        if (overlapsBusyTime) continue;

        availableInRange.push({
          date: dateStr,
          startHour,
          startMinute,
          startTime: formatClockTime24(totalStart),
          endTime: formatClockTime24(endTotal),
          durationMinutes: duration,
          label: formatSlotLabel(dateStr, startHour, startMinute),
          startIso,
          endIso,
        });
      }
    }
    return availableInRange;
  }

  const liveCalendarToken = await getLiveCalendarToken(accessToken);
  let fallbackBookings: Booking[] = [];
  if (!liveCalendarToken && isFirebaseConfigured && db) {
    try {
      const booked = await getDocs(query(
        tenantRepo(getSchedCtx()).bookings(),
        where('status', 'in', ['BOOKED', 'RESCHEDULED']),
        limit(500)
      ));
      fallbackBookings = booked.docs.map((document) => document.data() as Booking);
    } catch (error) {
      console.warn('[Calendar Service Notice] Could not load booking fallback for availability:', error);
    }
  }
  const filterByPeriod = (starts: number[]) => starts.filter((totalMinutes) => {
    const hour = Math.floor(totalMinutes / 60);
    if (preferredPeriod === 'MORNING') return hour < 12;
    if (preferredPeriod === 'AFTERNOON') return hour >= 12 && hour < 17;
    if (preferredPeriod === 'EVENING') return hour >= 17;
    return true;
  });

  let daysChecked = 0;
  while (daysChecked < targetDaysCount && availableSlots.length < maxSlotsToReturn && currentOffset < maxOffset) {
    const dateStr = addDateKeyDays(scanStartDate, currentOffset);
    const dayOfWeek = dayOfWeekFor(dateStr);
    currentOffset++;
    if (!isWorkingDay(dayOfWeek)) continue;

    const starts = filterByPeriod(slotStartMinutes(dayOfWeek));
    if (starts.length === 0) continue;
    daysChecked++;

    const dayCandidates = starts.map((totalStart) => {
      const startHour = Math.floor(totalStart / 60);
      const startMinute = totalStart % 60;
      const startIso = createIstIsoString(dateStr, startHour, startMinute);
      const endTotal = totalStart + duration;
      const endIso = createIstIsoString(dateStr, Math.floor(endTotal / 60), endTotal % 60);
      return {
        date: dateStr, startHour, startMinute,
        startTime: formatClockTime24(totalStart),
        endTime: formatClockTime24(endTotal),
        durationMinutes: duration,
        label: formatSlotLabel(dateStr, startHour, startMinute),
        startIso, endIso,
      };
    }).filter((slot) => Date.parse(slot.startIso) > nowMs + MIN_LEAD_TIME_MS);

    // Check slots in small batches so a full week's calendar fits within the API execution window.
    for (let index = 0; index < dayCandidates.length && availableSlots.length < maxSlotsToReturn; index += 8) {
      const batch = dayCandidates.slice(index, index + 8);
      const results = await Promise.all(batch.map(async (slot) => {
        if (liveCalendarToken) {
          const check = await checkRealtimeGoogleCalendarSlot(slot.startIso, slot.endIso, liveCalendarToken);
          return { slot, available: check.available };
        }
        const slotStart = Date.parse(slot.startIso);
        const slotEnd = Date.parse(slot.endIso);
        const conflict = fallbackBookings.some((booking) => {
          const bookedStart = Date.parse(booking.startDateTimeIso || '');
          const bookedEnd = Date.parse(booking.endDateTimeIso || '');
          return Number.isFinite(bookedStart) && Number.isFinite(bookedEnd) && slotStart < bookedEnd && slotEnd > bookedStart;
        });
        return { slot, available: !conflict };
      }));
      for (const result of results) {
        if (availableSlots.length >= maxSlotsToReturn) break;
        if (result.available) availableSlots.push(result.slot);
      }
    }
  }
  return availableSlots;
}

// -----------------------------------------------------------------------------
// Booking Creation with Google Calendar & Google Meet// -----------------------------------------------------------------------------
// Booking Creation with Google Calendar & Google Meet
// -----------------------------------------------------------------------------

export interface CreateBookingParams {
  leadId?: string;
  contactId?: string;
  campaignId?: string;
  conversationId?: string;
  channel: Channel;
  leadName: string;
  leadEmail: string;
  leadPhone?: string;
  companyName: string;
  startIso: string;
  endIso: string;
  dateString: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  /** Existing guests to carry over when replacing a booking. */
  attendees?: string[];
  accessToken?: string;
  /** Internal (reschedule only): the booking being moved. Skips the duplicate check and the new record. */
  replacingBookingId?: string;
}

export interface CreateBookingResult {
  success: boolean;
  booking?: Booking;
  googleMeetLink?: string;
  calendarEventId?: string;
  calendarInviteSent?: boolean;
  conflict?: boolean;
  /** The lead already has an upcoming demo: nothing was booked. */
  alreadyBooked?: boolean;
  existingBooking?: Booking;
  /** True only when a confirmed booking was synchronized to an existing CRM lead. */
  crmLeadUpdated?: boolean;
  error?: string;
}

const normalizeLeadEmail = (e?: string) => String(e || '').trim().toLowerCase();
const phoneLast10 = (p?: string) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : '';
};

/**
 * Resolve an existing CRM lead for a confirmed booking. Not every booking path has
 * the lead document ID, so fall back to the tenant contact link and normalized
 * contact email/phone. These lookups never cross the active workspace boundary.
 */
async function findCrmLeadIdForBooking(params: {
  leadId?: string;
  contactId?: string;
  leadEmail?: string;
  leadPhone?: string;
}): Promise<string> {
  if (!isFirebaseConfigured || !db) return '';
  const repo = tenantRepo(getSchedCtx());

  if (params.leadId) {
    const directLead = await getDoc(repo.leadDoc(params.leadId)).catch(() => null);
    if (directLead?.exists()) return params.leadId;
  }

  const findByContactId = async (contactId: string): Promise<string> => {
    if (!contactId) return '';
    const snapshot = await getDocs(query(repo.leads(), where('contactId', '==', contactId), limit(1))).catch(() => null);
    return snapshot?.docs?.[0]?.id || '';
  };

  if (params.contactId) {
    const linkedLeadId = await findByContactId(params.contactId);
    if (linkedLeadId) return linkedLeadId;
  }

  const emailValues = Array.from(new Set([
    normalizeLeadEmail(params.leadEmail),
    String(params.leadEmail || '').trim(),
  ].filter(Boolean)));
  for (const email of emailValues) {
    const contactSnapshot = await getDocs(query(repo.contacts(), where('email', '==', email), limit(10))).catch(() => null);
    const contactIds: string[] = Array.from(new Set<string>((contactSnapshot?.docs || []).map((entry) => {
      const data = entry.data() as any;
      return String(data.contactId || entry.id);
    })));
    for (const contactId of contactIds) {
      const linkedLeadId = await findByContactId(contactId);
      if (linkedLeadId) return linkedLeadId;
    }
  }

  const phoneValues = Array.from(new Set([
    String(params.leadPhone || '').trim(),
    phoneLast10(params.leadPhone),
  ].filter(Boolean)));
  for (const phone of phoneValues) {
    const contactSnapshot = await getDocs(query(repo.contacts(), where('phone', '==', phone), limit(10))).catch(() => null);
    const contactIds: string[] = Array.from(new Set<string>((contactSnapshot?.docs || []).map((entry) => {
      const data = entry.data() as any;
      return String(data.contactId || entry.id);
    })));
    for (const contactId of contactIds) {
      const linkedLeadId = await findByContactId(contactId);
      if (linkedLeadId) return linkedLeadId;
    }
  }

  return '';
}

/** A booking blocks a new one only while its demo has not happened yet. */
function isUpcomingBooking(b: Booking): boolean {
  const end = Date.parse(b.endDateTimeIso || b.startDateTimeIso || '');
  return Number.isFinite(end) ? end > Date.now() : true;
}

/** "Tue 14 Oct, 3:00 – 4:00 PM IST" style line for an existing booking. */
function bookingWhen(b: Booking): string {
  return `${b.date} from ${b.startTime} – ${b.endTime} ${TZL()}`;
}

/** What the lead is told when they already have a demo coming up. */
export function alreadyBookedReplyText(b: Booking, requestedLabel?: string): string {
  const lines = [
    `You already have a ${brandName()} demo scheduled for ${bookingWhen(b)}.`,
    ``,
    `• Google Meet Link: ${b.googleMeetLink || 'in your calendar invitation'}`,
    ``,
    requestedLabel
      ? `If you'd like to move it to ${requestedLabel} instead, just reply "reschedule to ${requestedLabel}".`
      : `Would you like to reschedule it to another date or time? Just reply with the day and time.`,
  ];
  return lines.join('\n');
}

/**
 * Short lock so two requests for the same lead (e.g. an email and a WhatsApp message arriving together)
 * cannot both pass the duplicate check and book twice. Create-only document; released right after.
 * A lock older than 2 minutes is treated as left over from a crashed request and taken over.
 */
const LOCK_STALE_MS = 120_000;
async function acquireDemoBookingLock(key: string): Promise<{ ok: boolean; release: () => Promise<void> }> {
  const noop = { ok: true, release: async () => {} };
  if (!key || !isFirebaseConfigured || !db) return noop;
  const id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
  const ref = tenantRepo(getSchedCtx()).doc('demo_booking_locks', id);
  const release = async () => {
    await deleteDoc(ref).catch(() => {});
  };
  const tryCreate = async () => {
    await createDoc(ref, { key, createdAt: new Date().toISOString() });
  };
  try {
    await tryCreate();
    return { ok: true, release };
  } catch {
    const snap = await getDoc(ref).catch(() => null);
    const at = Date.parse(String(snap?.data()?.createdAt || ''));
    if (!snap?.exists() || !Number.isFinite(at) || Date.now() - at > LOCK_STALE_MS) {
      await deleteDoc(ref).catch(() => {});
      try {
        await tryCreate();
        return { ok: true, release };
      } catch {}
    }
    return { ok: false, release: async () => {} };
  }
}

/**
 * Books a demo, but never a second one for a lead who already has an upcoming demo (any campaign, any
 * channel, matched by email, lead, conversation or phone). There is no override: to change the time the
 * existing demo is rescheduled. Every booking path (AI conversation, Demo Scheduling page) comes here.
 */
export async function createGoogleCalendarDemoBooking(params: CreateBookingParams): Promise<CreateBookingResult> {
  if (params.replacingBookingId) return createGoogleCalendarDemoBookingInner(params);
  await warmSchedBrand();
  const email = normalizeLeadEmail(params.leadEmail);

  const existing = await getActiveBookingForLeadOrConversation(params.leadId, email, params.conversationId, params.leadPhone);
  if (existing) {
    return {
      success: false,
      alreadyBooked: true,
      existingBooking: existing,
      error: `${params.leadName || 'This lead'} already has a demo booked for ${bookingWhen(existing)}. Reschedule that one instead.`,
    };
  }

  const lock = await acquireDemoBookingLock(email || params.leadId || phoneLast10(params.leadPhone) || params.conversationId || '');
  if (!lock.ok) {
    return { success: false, alreadyBooked: true, error: 'A demo for this lead is being booked right now. Please refresh in a moment.' };
  }
  try {
    // Re-check inside the lock: another request may have finished booking while we waited.
    const again = await getActiveBookingForLeadOrConversation(params.leadId, email, params.conversationId, params.leadPhone);
    if (again) {
      return {
        success: false,
        alreadyBooked: true,
        existingBooking: again,
        error: `${params.leadName || 'This lead'} already has a demo booked for ${bookingWhen(again)}. Reschedule that one instead.`,
      };
    }
    return await createGoogleCalendarDemoBookingInner({ ...params, leadEmail: email });
  } finally {
    await lock.release();
  }
}

/**
 * Creates a Google Calendar Event with an authentic Google Meet conference link,
 * invites the lead's email (sends calendar invitation ONCE via sendUpdates=all),
 * stores the confirmed booking record in Firestore, and updates the CRM Lead.
 */
/** Validate exact duration, timezone date, weekday, and tenant-configured start-time grid. */
function validateConfiguredDemoSlot(startIso: string, endIso: string, dateString: string): string | null {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'The selected demo time is invalid.';
  if (endMs - startMs !== demoDurationMinutes() * 60_000) {
    return `Each demo must be exactly ${demoDurationMinutes()} minutes. Please select one of the available slots.`;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(startMs));
  const values: Record<string, string> = {};
  parts.forEach((part) => { values[part.type] = part.value; });
  const localDate = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (localDate !== dateString) return 'The selected date and time do not match the tenant timezone.';
  const day = dayOfWeekFor(localDate);
  if (!isWorkingDay(day)) return 'Demo bookings are not available on that weekday.';
  if (!isConfiguredSlotStart(hour, minute, day)) {
    return `Available demo start times repeat every ${demoDurationMinutes()} minutes within ${workingScheduleLabel()}.`;
  }
  return null;
}

async function createGoogleCalendarDemoBookingInner(
  params: CreateBookingParams
): Promise<CreateBookingResult> {
  await warmSchedBrand();
  const slotValidationError = validateConfiguredDemoSlot(params.startIso, params.endIso, params.dateString);
  if (slotValidationError) return { success: false, error: slotValidationError };
  const {
    leadId,
    contactId,
    campaignId,
    conversationId,
    channel,
    leadName,
    leadEmail,
    leadPhone,
    companyName,
    startIso,
    endIso,
    dateString,
    startTime,
    endTime,
    accessToken,
  } = params;

  // 1. Double-booking atomic pre-check: perform fresh Google Calendar check right now
  const freshCheck = await checkRealtimeGoogleCalendarSlot(startIso, endIso, accessToken);
  if (!freshCheck.available) {
    return {
      success: false,
      conflict: true,
      error: 'That slot was just booked by another attendee.',
    };
  }

  let token = await getLiveCalendarToken(accessToken);
  if (!token && isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(tenantRepo(getSchedCtx()).settingsDoc('calendar_auth'));
      if (snap.exists() && snap.data()?.accessToken) {
        token = snap.data().accessToken;
        setServerCalendarAccessToken(token!);
      }
    } catch {}
  }

  let calendarEventId = `mock-cal-${Date.now()}`;
  let googleMeetLink = '';
  let calendarInviteSent = false;

  const isUmrahSched = sb().playbook === 'umrah360';
  const summary = `${brandName()} Demo - ${companyName || leadName || (isUmrahSched ? 'Agency Partner' : 'Guest')}`;
  const description = [
    isUmrahSched ? `Personalized 1-on-1 walkthrough of Umrah360 pilgrimage enterprise software.` : `Personalized 1-on-1 walkthrough of ${brandName()}.`,
    ``,
    `Attendee Details:`,
    `• Lead Name: ${leadName}`,
    `• Email: ${leadEmail}`,
    `• Company: ${companyName || (isUmrahSched ? 'Travel Agency' : 'Not provided')}`,
    `• Phone: ${leadPhone || 'Not provided'}`,
    `• Inbound Channel: ${channel}`,
    `• Timezone: ${tzDisplay()}`,
    ``,
    `Agenda:`,
    ...(isUmrahSched
      ? [`- Group Series Operations & Visa Tracking`, `- B2B Sub-Agent Portal & Dynamic Package Builder`, `- Pilgrim Mobile Voucher & Accounting Automation`, `- Q&A and Deployment Timelines`]
      : [`- Product walkthrough`, `- Q&A and next steps`]),
  ].join('\n');

  // 2. Create Event in Google Calendar with genuine Google Meet video conference
  // and send the calendar invitation ONCE to leadEmail
  if (token) {
    try {
      const hostEmail = hostCalendarEmail().toLowerCase().trim();
      const inviteEmails = Array.from(new Set([leadEmail, ...(params.attendees || [])]
        .map((email) => String(email || '').toLowerCase().trim())
        .filter((email) => email.includes('@') && email !== hostEmail)));
      const attendees: Array<{ email: string }> = inviteEmails.map((email) => ({ email }));

      const eventPayload = {
        summary,
        description,
        start: {
          dateTime: startIso,
          timeZone: tz(),
        },
        end: {
          dateTime: endIso,
          timeZone: tz(),
        },
        attendees,
        conferenceData: {
          createRequest: {
            requestId: `reschedule-meet-${crypto.randomUUID()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet',
            },
          },
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 },
          ],
        },
      };

      // sendUpdates=all sends calendar invitation ONCE to attendees
      const calRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventPayload),
        }
      );

      if (!calRes.ok) {
        const errText = await calRes.text();
        if (calRes.status === 401) {
          await handleExpiredCalendarToken();
          return {
            success: false,
            error: 'Google Calendar OAuth token expired or invalid (401). Please click "Connect / Sync Google Calendar" in the dashboard to re-authenticate.',
          };
        }
        console.error('[Google Calendar API Error] Event creation failed:', calRes.status, errText);
        return {
          success: false,
          error: `Google Calendar event creation failed (status ${calRes.status}): ${errText}`,
        };
      }

      const eventData = await calRes.json();
      calendarEventId = eventData.id || calendarEventId;
      calendarInviteSent = attendees.length > 0;

      // Extract genuine Google Meet Link returned by Google Calendar
      googleMeetLink =
        eventData.hangoutLink ||
        eventData.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ||
        (eventData.conferenceData?.conferenceId ? `https://meet.google.com/${eventData.conferenceData.conferenceId}` : '');

      // If conferenceData creation was pending, poll the event once to get the ready Google Meet URL
      if (!googleMeetLink && eventData.id) {
        try {
          await new Promise((r) => setTimeout(r, 600));
          const checkRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventData.id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (checkRes.ok) {
            const freshEvent = await checkRes.json();
            googleMeetLink =
              freshEvent.hangoutLink ||
              freshEvent.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ||
              (freshEvent.conferenceData?.conferenceId ? `https://meet.google.com/${freshEvent.conferenceData.conferenceId}` : '');
          }
        } catch {}
      }

      if (!googleMeetLink) {
        // Do not leave an orphaned calendar event (or a sent invitation) when Meet generation fails.
        if (calendarEventId && !calendarEventId.startsWith('mock-')) {
          try {
            await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(calendarEventId)}?sendUpdates=all`,
              { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
            );
          } catch (cleanupErr) {
            console.warn('[Calendar Cleanup Notice] Could not remove event without Meet link:', cleanupErr);
          }
        }
        return {
          success: false,
          error: 'Google Calendar created the event but could not generate a Google Meet video conference link. The incomplete event was removed where possible.',
        };
      }
    } catch (apiErr: any) {
      console.error('[Google Calendar Error]:', apiErr);
      return {
        success: false,
        error: apiErr?.message || 'Failed connecting to Google Calendar API',
      };
    }
  } else {
    return {
      success: false,
      error:
        'Google Calendar OAuth token not found. Please click "Sync Calendar" in the Demo Scheduling dashboard to connect your Google Calendar.',
    };
  }

  // 3. Store Booking Record in Firestore bookings collection (only confirmed bookings stored)
  const nowIso = new Date().toISOString();
  const bookingId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const booking: Booking = {
    bookingId,
    leadId: leadId || '',
    contactId: contactId || '',
    campaignId: campaignId || '',
    conversationId: conversationId || '',
    channel,
    leadName: leadName || 'Valued Partner',
    leadEmail: normalizeLeadEmail(leadEmail),
    leadPhone: leadPhone || '',
    leadPhoneLast10: phoneLast10(leadPhone) || undefined,
    companyName: companyName || 'Travel Agency',
    calendarEventId,
    googleMeetLink,
    date: dateString,
    startTime,
    endTime,
    startDateTimeIso: startIso,
    endDateTimeIso: endIso,
    timezone: tz(),
    status: 'BOOKED',
    summary,
    description,
    calendarProvider: 'google',
    attendees: Array.from(new Set([hostCalendarEmail(), leadEmail, ...(params.attendees || [])]
      .map((email) => String(email || '').toLowerCase().trim())
      .filter(Boolean))),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  let persistedBooking: Booking = booking;
  let crmLeadUpdated = false;
  if (isFirebaseConfigured && db) {
    try {
      // Manual booking and inbound AI paths do not always carry the CRM lead ID.
      // Resolve by tenant contact/email/phone before saving the authoritative booking.
      const resolvedLeadId = params.replacingBookingId
        ? leadId || ''
        : await findCrmLeadIdForBooking({ leadId, contactId, leadEmail, leadPhone });
      if (!params.replacingBookingId && resolvedLeadId) {
        persistedBooking = { ...booking, leadId: resolvedLeadId };
      }

      // Reschedules update the original booking document in their coordinating method.
      if (!params.replacingBookingId) {
        await safeSetDoc(tenantRepo(getSchedCtx()).bookingDoc(bookingId), persistedBooking, { merge: true });
      }

      // A reschedule syncs CRM only after the original event is safely released.
      if (resolvedLeadId && !params.replacingBookingId) {
        try {
          await safeSetDoc(
            tenantRepo(getSchedCtx()).leadDoc(resolvedLeadId),
            {
              status: 'DEMO_BOOKED',
              demoStatus: 'BOOKED',
              demoSource: 'AUTOMATIC',
              demoBookedAt: nowIso,
              demoDate: dateString,
              demoStartTime: startTime,
              demoEndTime: endTime,
              demoTimezone: tz(),
              calendarEventId,
              googleMeetLink,
              ...(STOP_FOLLOWUPS_WHEN_DEMO_BOOKED
                ? {
                    autoFollowUp: {
                      enabled: false,
                      disabledBy: 'System Demo Booking',
                      disabledAt: nowIso,
                      disabledReason: 'demo_booked',
                      activeFollowUpId: null,
                      nextScheduledAt: null,
                      channelDelayOverride: null,
                    },
                  }
                : {}),
              updatedAt: nowIso,
            },
            { merge: true }
          );
          crmLeadUpdated = true;
        } catch (leadSyncError) {
          console.warn('[Demo Booking] CRM lead status sync failed:', leadSyncError);
        }

        // Cancel scheduled follow-up jobs only after the CRM update has succeeded.
        if (crmLeadUpdated && STOP_FOLLOWUPS_WHEN_DEMO_BOOKED) {
          try {
            const { cancelFollowUpsForLead } = await import('./autoFollowUpService.js');
            await cancelFollowUpsForLead(getSchedCtx(), resolvedLeadId, 'demo_booked');
          } catch (fuErr) {
            console.warn('[Demo Booking] Auto follow-up cancel notice:', fuErr);
          }
        }
      }

      // Campaign metrics retain their existing campaign-lead identity.
      if (campaignId && leadId && !params.replacingBookingId) {
        await updateCampaignLeadStatus({
          leadId,
          demoStatus: 'BOOKED',
          demoSource: 'AUTOMATIC',
        }).catch((err) => {
          console.warn('[Campaign Metric Notice] Could not update campaign demo count:', err);
        });
      }
    } catch (dbErr) {
      console.warn('[Booking Persistence Notice] Error writing booking to Firestore:', dbErr);
    }
  }

  return {
    success: true,
    booking: persistedBooking,
    crmLeadUpdated,
    googleMeetLink,
    calendarEventId,
    calendarInviteSent,
  };
}

/** Remove a Google Calendar event and notify attendees. A missing event is already released. */
async function deleteGoogleCalendarDemoEvent(
  eventId: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.ok || response.status === 404 || response.status === 410) {
      return { success: true };
    }
    if (response.status === 401) await handleExpiredCalendarToken();
    const details = await response.text().catch(() => '');
    return {
      success: false,
      error: `Google Calendar could not release the event (HTTP ${response.status})${details ? `: ${details}` : ''}.`,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Could not contact Google Calendar to release the event.' };
  }
}

/**
 * Cancels a demo booking and frees its Google Calendar event.
 * The booking is only marked cancelled after Google confirms deletion (or reports it missing).
 */
export async function cancelDemoBooking(
  bookingId: string,
  reason: string = 'Customer requested cancellation'
): Promise<{ success: boolean; error?: string }> {
  await warmSchedBrand();
  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    const bookingRef = tenantRepo(getSchedCtx()).bookingDoc(bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) {
      return { success: false, error: 'Booking not found' };
    }

    const booking = snap.data() as Booking;

    const hasLiveCalendarEvent = Boolean(
      booking.calendarEventId && !booking.calendarEventId.startsWith('mock-')
    );
    const token = hasLiveCalendarEvent ? await getLiveCalendarToken() : null;
    if (hasLiveCalendarEvent && !token) {
      return {
        success: false,
        error: 'Google Calendar is not connected. The existing booking was left active; reconnect the calendar before cancelling it.',
      };
    }

    const nowIso = new Date().toISOString();
    // Persist the cancellation first. If Google refuses to delete the event, restore the
    // original booking so CRM state never claims the slot is free while the event is still there.
    await setDoc(
      bookingRef,
      {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: nowIso,
        updatedAt: nowIso,
      } as any,
      { merge: true }
    );

    if (hasLiveCalendarEvent && token) {
      const removed = await deleteGoogleCalendarDemoEvent(booking.calendarEventId!, token);
      if (!removed.success) {
        await setDoc(bookingRef, booking as any, { merge: true }).catch((rollbackError) =>
          console.error('[Cancellation Rollback] Could not restore original booking:', rollbackError)
        );
        return {
          success: false,
          error: `${removed.error || 'The calendar event could not be deleted'} The cancellation was not completed; the original booking was restored where possible.`,
        };
      }
    }

    // The booking + calendar are now cancelled. CRM lead sync is best-effort and must not
    // turn a completed cancellation into a false failure message.
    if (booking.leadId) {
      await safeSetDoc(
        tenantRepo(getSchedCtx()).leadDoc(booking.leadId),
        {
          demoStatus: 'NOT_BOOKED',
          status: 'QUALIFIED',
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to cancel booking' };
  }
}

/**
 * Reschedules a booking without sacrificing the existing event:
 * 1. Re-check the requested new slot.
 * 2. Create the new Google Calendar event and obtain its Meet link/invitation.
 * 3. Persist the replacement details, then delete the old event and notify its attendees.
 * If creation or deletion fails, the original booking is restored and the replacement event is cleaned up.
 */
export async function rescheduleDemoBooking(
  bookingId: string,
  newStartIso: string,
  newEndIso: string,
  newDateString: string,
  newStartTime: string,
  newEndTime: string,
  accessToken?: string
): Promise<{ success: boolean; booking?: Booking; error?: string; conflict?: boolean; calendarInviteSent?: boolean }> {
  await warmSchedBrand();
  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    const bookingRef = tenantRepo(getSchedCtx()).bookingDoc(bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) return { success: false, error: 'Booking not found' };

    const booking = snap.data() as Booking;
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      return { success: false, error: `This booking is already ${booking.status.toLowerCase()} and cannot be rescheduled.` };
    }
    const oldMeetLink = String(booking.googleMeetLink || '').trim();
    const oldEventId = String(booking.calendarEventId || '').trim();
    if (/meet\.google\.com/i.test(oldMeetLink) && (!oldEventId || oldEventId.startsWith('mock-'))) {
      return {
        success: false,
        error: 'The existing Google Meet link has no valid Calendar event ID saved, so its old invitation cannot be safely cancelled. Please contact the team to correct the booking record before rescheduling.',
      };
    }
    if (booking.startDateTimeIso === newStartIso && booking.endDateTimeIso === newEndIso) {
      return { success: true, booking };
    }

    const freshCheck = await checkRealtimeGoogleCalendarSlot(newStartIso, newEndIso, accessToken);
    if (!freshCheck.available) {
      return {
        success: false,
        conflict: true,
        error: 'The requested new slot is already booked on our calendar. Please choose another time.',
      };
    }

    const token = await getLiveCalendarToken(accessToken);
    if (!token) {
      return {
        success: false,
        error: 'Google Calendar is not connected. Your original demo remains booked; reconnect the calendar before rescheduling.',
      };
    }

    // Create the new calendar event FIRST. The previous booking is untouched if this fails.
    const createRes = await createGoogleCalendarDemoBookingInner({
      replacingBookingId: booking.bookingId,
      leadId: booking.leadId,
      contactId: booking.contactId,
      campaignId: booking.campaignId,
      conversationId: booking.conversationId,
      channel: booking.channel,
      leadName: booking.leadName,
      leadEmail: booking.leadEmail,
      leadPhone: booking.leadPhone,
      companyName: booking.companyName,
      attendees: booking.attendees || [],
      startIso: newStartIso,
      endIso: newEndIso,
      dateString: newDateString,
      startTime: newStartTime,
      endTime: newEndTime,
      accessToken: token,
    });

    const newCalendarEventId = createRes.calendarEventId || createRes.booking?.calendarEventId || '';
    const newGoogleMeetLink = createRes.googleMeetLink || createRes.booking?.googleMeetLink || '';
    if (!createRes.success || !createRes.booking || !newCalendarEventId || newCalendarEventId.startsWith('mock-') || !newGoogleMeetLink) {
      return {
        success: false,
        conflict: createRes.conflict,
        error: createRes.error || 'The new calendar event and Google Meet link could not be created. Your original booking remains unchanged.',
      };
    }
    if (newCalendarEventId === oldEventId) {
      return {
        success: false,
        error: 'Google Calendar did not create a separate replacement event. Your original booking and invitation were left unchanged.',
      };
    }
    if (oldMeetLink && newGoogleMeetLink.trim() === oldMeetLink) {
      const cleanup = await deleteGoogleCalendarDemoEvent(newCalendarEventId, token);
      if (!cleanup.success) console.error('[Reschedule Cleanup] Could not remove replacement event with reused Meet link:', cleanup.error);
      return {
        success: false,
        error: 'Google Calendar returned the existing Meet link instead of a new one. The original booking was left unchanged; please try again.',
      };
    }

    const nowIso = new Date().toISOString();
    const updatedBooking: Booking = {
      ...booking,
      date: newDateString,
      startTime: newStartTime,
      endTime: newEndTime,
      startDateTimeIso: newStartIso,
      endDateTimeIso: newEndIso,
      status: 'RESCHEDULED',
      calendarEventId: newCalendarEventId,
      googleMeetLink: newGoogleMeetLink,
      updatedAt: nowIso,
    };

    // Update the tenant booking and CRM lead before releasing the previous calendar event.
    try {
      // Keep the authoritative booking write separate from CRM sync. If the old event
      // cannot be released, this document can be rolled back without leaving CRM mutated.
      await setDoc(bookingRef, updatedBooking as any, { merge: true });
    } catch (persistError: any) {
      await setDoc(bookingRef, booking as any, { merge: true }).catch((rollbackError) =>
        console.error('[Reschedule Rollback] Could not restore original booking:', rollbackError)
      );
      if (booking.leadId) {
        await setDoc(
          tenantRepo(getSchedCtx()).leadDoc(booking.leadId),
          {
            status: 'DEMO_BOOKED',
            demoStatus: 'BOOKED',
            demoDate: booking.date,
            demoStartTime: booking.startTime,
            demoEndTime: booking.endTime,
            demoTimezone: booking.timezone || tz(),
            calendarEventId: booking.calendarEventId || '',
            googleMeetLink: booking.googleMeetLink || '',
            updatedAt: new Date().toISOString(),
          } as any,
          { merge: true }
        ).catch((rollbackError) => console.error('[Reschedule Rollback] Could not restore original lead details:', rollbackError));
      }
      const cleanup = await deleteGoogleCalendarDemoEvent(newCalendarEventId, token);
      if (!cleanup.success) console.error('[Reschedule Cleanup] Could not remove replacement event:', cleanup.error);
      return {
        success: false,
        error: `The replacement calendar event was created, but its booking details could not be saved. Your original booking was kept. ${persistError?.message || ''}`.trim(),
      };
    }

    // Only now release the old event. If Google refuses, restore the original booking and remove
    // the replacement event so the lead never ends up with two active invitations.
    if (booking.calendarEventId && !booking.calendarEventId.startsWith('mock-') && booking.calendarEventId !== newCalendarEventId) {
      const removed = await deleteGoogleCalendarDemoEvent(booking.calendarEventId, token);
      if (!removed.success) {
        await setDoc(bookingRef, booking as any, { merge: true }).catch((rollbackError) =>
          console.error('[Reschedule Rollback] Could not restore original booking:', rollbackError)
        );
        if (booking.leadId) {
          await setDoc(
            tenantRepo(getSchedCtx()).leadDoc(booking.leadId),
            {
              status: 'DEMO_BOOKED',
              demoStatus: 'BOOKED',
              demoDate: booking.date,
              demoStartTime: booking.startTime,
              demoEndTime: booking.endTime,
              demoTimezone: booking.timezone || tz(),
              calendarEventId: booking.calendarEventId || '',
              googleMeetLink: booking.googleMeetLink || '',
              updatedAt: new Date().toISOString(),
            } as any,
            { merge: true }
          ).catch((rollbackError) => console.error('[Reschedule Rollback] Could not restore original lead details:', rollbackError));
        }
        const cleanup = await deleteGoogleCalendarDemoEvent(newCalendarEventId, token);
        if (!cleanup.success) console.error('[Reschedule Cleanup] Could not remove replacement event:', cleanup.error);
        return {
          success: false,
          error: `${removed.error || 'The original calendar event could not be released.'} The original booking remains active.`,
        };
      }
    }

    if (booking.leadId) {
      await safeSetDoc(
        tenantRepo(getSchedCtx()).leadDoc(booking.leadId),
        {
          status: 'DEMO_BOOKED',
          demoStatus: 'BOOKED',
          demoDate: newDateString,
          demoStartTime: newStartTime,
          demoEndTime: newEndTime,
          demoTimezone: tz(),
          calendarEventId: newCalendarEventId,
          googleMeetLink: newGoogleMeetLink,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    console.info('[Demo Reschedule] Calendar replacement completed', {
      bookingId,
      oldCalendarEventId: oldEventId,
      newCalendarEventId,
      oldMeetLinkChanged: oldMeetLink !== newGoogleMeetLink.trim(),
      inviteSent: Boolean(createRes.calendarInviteSent),
    });
    return {
      success: true,
      booking: updatedBooking,
      calendarInviteSent: Boolean(createRes.calendarInviteSent),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reschedule booking' };
  }
}

function stripQuotedEmailHistory(text: string): string {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.replace(/On\s+[\s\S]*?\s+wrote:[\s\S]*/gi, '');
  cleaned = cleaned.replace(/From:\s+[\s\S]*/gi, '');
  cleaned = cleaned.replace(/^>.*$/gm, '');
  return cleaned.trim();
}

/**
 * Adds one or more attendee emails to an existing demo booking:
 * 1. Updates Google Calendar event via Google Calendar API PATCH with sendUpdates=all
 * 2. Dispatches live email invitations directly via SMTP to the newly added attendees
 * 3. Updates the booking record in Firestore with the new attendees list
 */
export async function addAttendeeToDemoBooking(params: {
  bookingId?: string;
  leadId?: string;
  leadEmail?: string;
  conversationId?: string;
  attendeeEmail?: string;
  attendeeEmails?: string[];
  attendeeName?: string;
  accessToken?: string;
}): Promise<{
  success: boolean;
  booking?: Booking;
  googleMeetLink?: string;
  calendarInviteSent?: boolean;
  error?: string;
  addedEmails?: string[];
}> {
  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database not initialized' };
  }

  const rawList: string[] = [];
  if (params.attendeeEmail) rawList.push(params.attendeeEmail);
  if (Array.isArray(params.attendeeEmails)) rawList.push(...params.attendeeEmails);

  const smtpCfg = getSmtpConfig();
  const hostEmails = Array.from(
    new Set(hostEmailList(smtpCfg.user, smtpCfg.from))
  ).filter((e) => e.length > 0);

  const primaryLeadEmail = (params.leadEmail || '').toLowerCase().trim();

  const emailsToAdd = Array.from(
    new Set(
      rawList
        .map((e) => (e || '').trim().toLowerCase())
        .filter(
          (e) =>
            e.includes('@') &&
            e.length > 3 &&
            e !== primaryLeadEmail &&
            !hostEmails.includes(e)
        )
    )
  );

  if (emailsToAdd.length === 0) {
    return { success: false, error: 'Please provide at least one valid attendee email address.' };
  }

  try {
    let bookingDocRef: any = null;
    let booking: Booking | null = null;

    if (params.bookingId) {
      bookingDocRef = tenantRepo(getSchedCtx()).bookingDoc(params.bookingId);
      const snap = await getDoc(bookingDocRef).catch(() => null);
      if (snap && snap.exists()) {
        booking = snap.data() as Booking;
      }
    }

    if (!booking) {
      const snap = await getDocs(tenantRepo(getSchedCtx()).bookings()).catch(() => null);
      if (snap && !snap.empty) {
        snap.forEach((d) => {
          if (booking) return;
          const b = d.data() as Booking;
          if (b && b.status !== 'CANCELLED') {
            if (
              (params.leadId && b.leadId === params.leadId) ||
              (params.leadEmail && b.leadEmail?.toLowerCase() === params.leadEmail.toLowerCase()) ||
              (params.conversationId && b.conversationId === params.conversationId)
            ) {
              booking = b;
              bookingDocRef = tenantRepo(getSchedCtx()).bookingDoc(b.bookingId);
            }
          }
        });
      }
    }

    if (!booking || !bookingDocRef) {
      return { success: false, error: 'No active demo booking found for this lead.' };
    }

    const currentAttendees = Array.from(
      new Set(
        (Array.isArray(booking.attendees) ? booking.attendees : [])
          .map((e) => (e || '').trim().toLowerCase())
          .filter((e) => e.length > 0)
      )
    );

    const newlyAdded: string[] = [];
    for (const em of emailsToAdd) {
      if (em !== booking.leadEmail?.toLowerCase().trim() && !currentAttendees.includes(em)) {
        currentAttendees.push(em);
        newlyAdded.push(em);
      }
    }

    let calendarInviteSent = false;
    let googleMeetLink = booking.googleMeetLink;

    if (booking.calendarEventId && !booking.calendarEventId.startsWith('mock-')) {
      const token = await getLiveCalendarToken(params.accessToken);
      if (token) {
        try {
          const getRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
              booking.calendarEventId
            )}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (getRes.ok) {
            const eventData = await getRes.json();
            const existingGcalAttendees: Array<{ email: string; displayName?: string }> =
              Array.isArray(eventData.attendees) ? eventData.attendees : [];

            for (const em of emailsToAdd) {
              if (!existingGcalAttendees.some((a) => a.email?.toLowerCase() === em)) {
                existingGcalAttendees.push({
                  email: em,
                  displayName: params.attendeeName || undefined,
                });
              }
            }

            const patchRes = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
                booking.calendarEventId
              )}?sendUpdates=all`,
              {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  attendees: existingGcalAttendees,
                }),
              }
            );

            if (patchRes.ok) {
              const patchedEvent = await patchRes.json();
              googleMeetLink = patchedEvent.hangoutLink || patchedEvent.htmlLink || googleMeetLink;
              calendarInviteSent = true;
              console.log(`[Google Calendar] Updated event ${booking.calendarEventId} with attendees: ${emailsToAdd.join(', ')}`);
            }
          }
        } catch (calErr) {
          console.warn('[Calendar Add Attendee Error]:', calErr);
        }
      }
    }

    const smtpConfig = getSmtpConfig();
    for (const targetEmail of emailsToAdd) {
      try {
        const inviteSubject = `[Calendar Invite] ${brandName()} Demo Walkthrough - ${booking.date} at ${booking.startTime} ${TZL()}`;
        const inviteHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #1e293b; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #0d9488; margin-bottom: 8px;">${brandName()} Demo Invitation</h2>
            <p style="font-size: 15px; color: #334155;">
              You have been added as an attendee for the live product walkthrough of <strong>${brandName()}</strong>.
            </p>
            <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 4px 0;"><strong>Company:</strong> ${booking.companyName}</p>
              <p style="margin: 4px 0;"><strong>Primary Contact:</strong> ${booking.leadName} (${booking.leadEmail})</p>
              <p style="margin: 4px 0;"><strong>Date:</strong> ${booking.date}</p>
              <p style="margin: 4px 0;"><strong>Time:</strong> ${booking.startTime} – ${booking.endTime} ${tzDisplay()}</p>
              <p style="margin: 12px 0 4px 0;"><strong>Google Meet Video Link:</strong></p>
              <a href="${googleMeetLink}" style="display: inline-block; background-color: #0d9488; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Join Google Meet
              </a>
            </div>
            <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
              ${sb().playbook === 'umrah360' ? 'Looking forward to demonstrating how Umrah360 automates pilgrimage group costing, visa tracking, and sub-agent portals!' : `Looking forward to speaking with you about ${brandName()}!`}
            </p>
          </div>
        `;

        await sendLiveEmail({
          tenantId: getSchedCtx().tenantId,
          to: targetEmail,
          subject: inviteSubject,
          text: `You have been added to the ${brandName()} Demo Walkthrough on ${booking.date} from ${booking.startTime} – ${booking.endTime} ${TZL()}.\n\nJoin Google Meet: ${googleMeetLink}\n\nPrimary Contact: ${booking.leadName} (${booking.leadEmail})`,
          html: inviteHtml,
        }).catch((e) => console.warn(`[SMTP Invite Warning for ${targetEmail}]:`, e));

        calendarInviteSent = true;
      } catch (mailErr) {
        console.warn(`[Email Invitation Dispatch Note]:`, mailErr);
      }
    }

    const nowIso = new Date().toISOString();
    const updatedBooking: Booking = {
      ...booking,
      attendees: currentAttendees,
      googleMeetLink,
      updatedAt: nowIso,
    };

    await safeSetDoc(bookingDocRef, { attendees: currentAttendees, googleMeetLink, updatedAt: nowIso }, { merge: true });

    if (booking.leadId) {
      await safeSetDoc(
        tenantRepo(getSchedCtx()).leadDoc(booking.leadId),
        { attendees: currentAttendees, updatedAt: nowIso },
        { merge: true }
      ).catch(() => {});
    }

    return {
      success: true,
      booking: updatedBooking,
      googleMeetLink,
      calendarInviteSent,
      addedEmails: emailsToAdd,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to add attendee' };
  }
}

// -----------------------------------------------------------------------------
// Central Conversational Intent & Slot Parser Agent
// -----------------------------------------------------------------------------

export interface SchedulingTurnResult {
  handled: boolean;
  replyText: string;
  booking?: Booking;
  action:
    | 'ASKED_AVAILABILITY'
    | 'OFFERED_ALTERNATIVES'
    | 'CONFIRMED_BOOKING'
    | 'ALREADY_BOOKED'
    | 'RESCHEDULED'
    | 'CANCELLED'
    | 'CANCELLATION_FAILED'
    | 'RESCHEDULE_FAILED'
    | 'WEEKEND_NOT_ALLOWED'
    | 'HOURS_NOT_ALLOWED'
    | 'ATTENDEE_ADDED'
    | 'ASKED_ATTENDEE_EMAIL'
    | 'ADD_ATTENDEE_FAILED'
    | 'AWAITING_CONFIRMATION'
    | 'SLOT_UNAVAILABLE'
    | 'NOT_DEMO_INTENT';
}

// -----------------------------------------------------------------------------
// Scheduling conversation state (guardrails)
// Remembers, per lead, that we asked for their availability (and which slots we offered) or that we
// are waiting for a "yes" on one exact slot. Stored in Firestore because serverless instances share
// no memory. Path: tenants/{tenantId}/scheduling_state/{key} (server-only; client rules deny it).
// -----------------------------------------------------------------------------
const MAX_DAYS_AHEAD = 60;
const MIN_LEAD_TIME_MS = 30 * 60 * 1000;
const AVAILABILITY_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONFIRMATION_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

interface SchedulingState {
  stage: 'AWAITING_AVAILABILITY' | 'AWAITING_CONFIRMATION';
  offeredSlots?: OfferedSlot[];
  proposedSlot?: OfferedSlot;
  mode?: 'NEW' | 'RESCHEDULE';
  /** Partial date/time retained while the lead answers a follow-up. */
  partialDate?: string | null;
  partialHour?: number | null;
  partialMinute?: number | null;
  updatedAt?: string;
  expiresAt?: number;
}

function addDaysToDate(dateString: string, days: number): string {
  const [y, m, d] = dateString.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

/** Stable per-lead key: email first, then phone, then conversation / lead id. */
function schedulingStateKey(p: { leadEmail?: string; leadPhone?: string; conversationId?: string; leadId?: string }): string | null {
  const email = normalizeLeadEmail(String(p.leadEmail || '').trim());
  let raw = '';
  if (email.includes('@')) raw = `email:${email}`;
  else if (phoneLast10(p.leadPhone)) raw = `phone:${phoneLast10(p.leadPhone)}`;
  else if (p.conversationId) raw = `conv:${p.conversationId}`;
  else if (p.leadId) raw = `lead:${p.leadId}`;
  if (!raw) return null;
  return `s_${crypto.createHash('sha1').update(raw).digest('hex')}`;
}

async function loadSchedulingState(key: string | null): Promise<SchedulingState | null> {
  if (!key || !isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(tenantRepo(getSchedCtx()).doc('scheduling_state', key));
    if (!snap.exists()) return null;
    const data = snap.data() as SchedulingState;
    if (!data?.stage) return null;
    if (typeof data.expiresAt === 'number' && data.expiresAt < Date.now()) {
      // This expires only the pending conversation state. It must never cancel or mutate
      // an already-confirmed booking; the original demo remains active unless explicitly cancelled.
      await clearSchedulingState(key);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[Demo Scheduling] Could not read scheduling state:', (e as any)?.message || e);
    return null;
  }
}

async function saveSchedulingState(key: string | null, state: SchedulingState): Promise<void> {
  if (!key || !isFirebaseConfigured || !db) return;
  const ttl = state.stage === 'AWAITING_CONFIRMATION' ? CONFIRMATION_STATE_TTL_MS : AVAILABILITY_STATE_TTL_MS;
  try {
    await safeSetDoc(tenantRepo(getSchedCtx()).doc('scheduling_state', key), {
      stage: state.stage,
      offeredSlots: state.offeredSlots || [],
      proposedSlot: state.proposedSlot || null,
      mode: state.mode || 'NEW',
      partialDate: state.partialDate ?? null,
      partialHour: state.partialHour ?? null,
      partialMinute: state.partialMinute ?? null,
      updatedAt: new Date().toISOString(),
      expiresAt: Date.now() + ttl,
    });
  } catch (e) {
    console.warn('[Demo Scheduling] Could not save scheduling state:', (e as any)?.message || e);
  }
}

async function clearSchedulingState(key: string | null): Promise<void> {
  if (!key || !isFirebaseConfigured || !db) return;
  try {
    await deleteDoc(tenantRepo(getSchedCtx()).doc('scheduling_state', key));
  } catch {
    // Missing doc or transient error: an expired/stale state is ignored on read anyway.
  }
}

/**
 * True when this lead is in the middle of a scheduling exchange (we asked for their availability or for a
 * "yes"). Inbound pipelines use it to route replies such as "Tuesday 4pm" or "yes" back to the scheduling
 * agent even though they don't mention a demo. Only reads Firestore for messages that could be such a reply.
 */
export async function hasPendingSchedulingState(params: {
  messageText: string;
  leadEmail?: string;
  leadPhone?: string;
  conversationId?: string;
  leadId?: string;
}): Promise<boolean> {
  await warmSchedBrand();
  const fresh = stripQuotedEmailHistoryShared(params.messageText || '') || String(params.messageText || '').trim();
  if (!looksLikeSchedulingFollowUp(fresh)) return false;
  return !!(await loadSchedulingState(schedulingStateKey(params)));
}

/**
 * Checks if a lead already has an active demo scheduled.
 */
export async function getActiveBookingForLeadOrConversation(
  leadId?: string,
  leadEmail?: string,
  conversationId?: string,
  leadPhone?: string
): Promise<Booking | null> {
  await warmSchedBrand();
  if (!isFirebaseConfigured || !db) return null;
  // Only an UPCOMING demo counts: once its time has passed the lead may book again.
  const firstUpcoming = async (field: string, value: string): Promise<Booking | null> => {
    const snap = await getDocs(
      query(tenantRepo(getSchedCtx()).bookings(), where(field, '==', value), where('status', 'in', ['BOOKED', 'RESCHEDULED']), limit(10))
    );
    const upcoming = snap.docs
      .map((d) => d.data() as Booking)
      .filter(isUpcomingBooking)
      .sort((a, b) => Date.parse(a.startDateTimeIso) - Date.parse(b.startDateTimeIso));
    return upcoming[0] || null;
  };
  try {
    const raw = String(leadEmail || '').trim();
    const email = normalizeLeadEmail(raw);
    if (email.includes('@')) {
      const hit = (await firstUpcoming('leadEmail', email)) || (raw !== email ? await firstUpcoming('leadEmail', raw) : null);
      if (hit) return hit;
    }
    if (leadId) {
      const hit = await firstUpcoming('leadId', leadId);
      if (hit) return hit;
    }
    const last10 = phoneLast10(leadPhone);
    if (last10) {
      const hit = await firstUpcoming('leadPhoneLast10', last10);
      if (hit) return hit;
    }
    if (conversationId) {
      const hit = await firstUpcoming('conversationId', conversationId);
      if (hit) return hit;
    }
  } catch (e) {
    console.warn('[Calendar Service Notice] Error finding active booking:', e);
  }
  return null;
}

/**
 * Detects if a message contains demo / meeting scheduling intent.
 */
export function detectDemoSchedulingIntent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  // Only what the sender newly wrote. Quoted headers such as
  // "Sent: Monday, October 5, 2026 6:20 PM" must never count as scheduling intent.
  const t = stripQuotedEmailHistory(text).toLowerCase();
  if (!t) return false;

  const patterns = [
    /schedule\s+(a\s+)?(demo|meeting|call|walkthrough|session)/i,
    /book\s+(a\s+)?(demo|meeting|call|slot|time)/i,
    /want\s+(a\s+)?(demo|meeting|call|walkthrough)/i,
    /like\s+to\s+(see|have|schedule|book)\s+(a\s+)?(demo|meeting|walkthrough)/i,
    /connect\s+over\s+(a\s+)?(call|meeting|google\s+meet|zoom)/i,
    /show\s+me\s+(the\s+)?(software|platform|system|crm|demo)/i,
    /give\s+me\s+(a\s+)?demo/i,
    /have\s+(a\s+)?(meeting|call|demo)/i,
    /arrange\s+(a\s+)?(demo|meeting|call)/i,
    /set\s+up\s+(a\s+)?(demo|meeting|call)/i,
    /can\s+we\s+(meet|talk|connect|have\s+a\s+call|schedule)/i,
    /\b(let's|lets|can we|could we|shall we)\s+connect\b/i,
    /\b(connect|meet|talk|call)\s+(today|tomorrow|tonight)\b/i,
    /when\s+can\s+we\s+(meet|see\s+demo)/i,
    /reschedule\s+(the\s+)?(demo|meeting|call)/i,
    /cancel\s+(the\s+)?(demo|meeting|call)/i,
  ];

  for (const p of patterns) {
    if (p.test(t)) return true;
  }

  // A day + a time only counts when it is also about meeting / a demo
  if (
    /(monday|tuesday|wednesday|thursday|friday|today|tomorrow|tonight|next\s+week)/i.test(t) &&
    /(\d{1,2}\s*(am|pm)|morning|afternoon|evening|\d{1,2}:\d{2})/i.test(t) &&
    /(demo|meeting|call|walkthrough|slot|schedule|available|availability|connect|talk|meet)/i.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * Central Demo Scheduling Agent logic.
 * Evaluates the full conversation, checks Google Calendar in realtime,
 * handles scheduling, rescheduling, cancellations, and alternative offers.
 */
export async function processSchedulingConversationTurn(params: {
  messageText: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  leadContext?: {
    leadId?: string;
    contactId?: string;
    leadName?: string;
    leadEmail?: string;
    leadPhone?: string;
    companyName?: string;
    channel?: Channel;
    campaignId?: string;
    conversationId?: string;
    accessToken?: string;
  };
  accessToken?: string;
  /** True when called from the inbound email / WhatsApp pipelines (no human in the loop). */
  automated?: boolean;
  [key: string]: any;
}): Promise<SchedulingTurnResult> {
  await warmSchedBrand();
  const messageText = params.messageText || '';
  // Only what the lead newly wrote (no quoted thread, no signature). Dates and times are read from this alone.
  const fresh = stripQuotedEmailHistoryShared(messageText) || messageText.trim();
  const conversationHistory = Array.isArray(params.conversationHistory) ? params.conversationHistory : [];
  const ctx: any = params.leadContext || {};
  const leadName = ctx.leadName || params.senderName || params.leadName || 'Valued Partner';
  const companyName = ctx.companyName || params.companyName || 'your travel agency';
  const leadEmail = ctx.leadEmail || params.senderEmail || params.leadEmail || '';
  const leadPhone = ctx.leadPhone || params.senderPhone || params.leadPhone || '';
  const channel: Channel = ctx.channel || params.channel || 'EMAIL';
  const leadId = ctx.leadId || params.leadId;
  const conversationId = ctx.conversationId || params.conversationId;
  const contactId = ctx.contactId || params.contactId;
  const campaignId = ctx.campaignId || params.campaignId;
  const accessToken = params.accessToken || ctx.accessToken;

  const leadContext = {
    leadId,
    contactId,
    leadName,
    leadEmail,
    leadPhone,
    companyName,
    channel,
    campaignId,
    conversationId,
    accessToken,
  };

  // Saved state of an in-progress scheduling exchange (we asked for availability / for a "yes").
  // Only read for messages that could continue one, to keep Firestore reads down.
  const stateKey = schedulingStateKey({ leadEmail, leadPhone, conversationId, leadId });
  const schedState =
    stateKey && (detectDemoSchedulingIntent(fresh) || looksLikeSchedulingFollowUp(fresh))
      ? await loadSchedulingState(stateKey)
      : null;

  // Booking only happens when the sender actually asks for it, or is answering our scheduling question.
  // Manual calls (Demo Scheduling tab simulator) always proceed to the guarded checks below.
  if (params.manual !== true && !detectDemoSchedulingIntent(fresh) && !schedState) {
    return { handled: false, replyText: '', action: 'NOT_DEMO_INTENT' };
  }

  const nowIst = getNowInIst();

  // 1. Check if user already has an active booking
  const activeBooking = await getActiveBookingForLeadOrConversation(
    leadId,
    leadEmail,
    conversationId,
    leadPhone
  );

  const lowerText = messageText.toLowerCase();

  // 2. Cancellation Intent
  if (/cancel\s+(the\s+)?(demo|meeting|booking|appointment|call)/i.test(lowerText)) {
    await clearSchedulingState(stateKey);
    if (activeBooking) {
      const cancellation = await cancelDemoBooking(activeBooking.bookingId, 'Lead requested cancellation in conversation');
      if (!cancellation.success) {
        return {
          handled: true,
          action: 'CANCELLATION_FAILED',
          replyText: `I couldn't complete the cancellation: ${cancellation.error || 'Google Calendar did not confirm the deletion.'} Your existing demo on ${activeBooking.date} at ${activeBooking.startTime} ${TZL()} remains booked. Please reconnect the calendar or contact the team for help.`,
        };
      }
      return {
        handled: true,
        action: 'CANCELLED',
        replyText: `Your ${brandName()} demo scheduled for ${activeBooking.date} at ${activeBooking.startTime} ${TZL()} has been cancelled. The time slot has been freed up on our calendar. Whenever you're ready to explore ${brandName()} in the future, just let us know and we'll gladly schedule a fresh walkthrough!`,
      };
    } else {
      return {
        handled: true,
        action: 'CANCELLED',
        replyText: `You do not have any active demo scheduled currently. You can book one during our available hours: ${workingScheduleLabel()}.`,
      };
    }
  }

  // 3. Rescheduling Intent
  const isRescheduleIntent = /reschedule|change\s+(the\s+)?(time|date|slot|demo|meeting)/i.test(lowerText);

  // 3b. Add Attendee Intent
  const cleanMsgText = stripQuotedEmailHistory(messageText);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const rawEmailsInMsg = cleanMsgText.match(emailRegex) || [];
  
  const primaryLeadEmail = (
    leadEmail ||
    activeBooking?.leadEmail ||
    ctx.leadEmail ||
    ''
  ).toLowerCase().trim();

  const activeSmtpCfg = getSmtpConfig();
  const hostEmails = Array.from(
    new Set(hostEmailList(activeSmtpCfg.user, activeSmtpCfg.from))
  ).filter((e) => e.length > 0);

  // Extract only NEW, distinct emails provided in THIS user message that are NOT the primary lead or host emails
  const freshEmailsInMsg = Array.from(
    new Set(
      rawEmailsInMsg
        .map((e) => e.toLowerCase().trim())
        .filter((e) => e !== primaryLeadEmail && !hostEmails.includes(e))
    )
  );

  const isAddAttendeeIntent =
    /add\s+(an?\s+)?(attendee|colleague|guest|member|participant|person|email|team)/i.test(lowerText) ||
    /invite\s+(my\s+)?(colleague|team|manager|co-worker|guest|person)/i.test(lowerText) ||
    /include\s+(my\s+)?(colleague|team|manager|co-worker|guest|person|email)/i.test(lowerText) ||
    /send\s+(the\s+)?(invite|calendar\s+invite|invitation)\s+to/i.test(lowerText) ||
    /add\s+my\s+team/i.test(lowerText) ||
    /team\s+members?/i.test(lowerText) ||
    /their\s+email\s+is/i.test(lowerText);

  if (isAddAttendeeIntent || freshEmailsInMsg.length > 0) {
    if (freshEmailsInMsg.length === 0) {
      // Lead requested adding attendee / team members, BUT provided no new email address in this message
      return {
        handled: true,
        action: 'ASKED_ATTENDEE_EMAIL',
        replyText: `I would be glad to add your team members to the demo calendar invitation! Could you please share their email address(es)?`,
      };
    }

    // Lead provided new attendee email address(es)!
    if (activeBooking) {
      const addRes = await addAttendeeToDemoBooking({
        bookingId: activeBooking.bookingId,
        leadId,
        leadEmail,
        conversationId,
        attendeeEmails: freshEmailsInMsg,
        accessToken,
      });

      if (addRes.success && addRes.booking) {
        const [bookedHour, bookedMinute] = (addRes.booking.startTime || '15:00').split(':').map((value) => parseInt(value, 10));
        const slotLabel = formatSlotLabel(addRes.booking.date, bookedHour, bookedMinute || 0);
        const meetLink = addRes.booking.googleMeetLink || activeBooking.googleMeetLink;

        const uniqueAttendeesList = Array.from(
          new Set([
            `${addRes.booking.leadName || 'Primary Contact'} (${addRes.booking.leadEmail || leadEmail})`,
            ...(addRes.booking.attendees || []),
          ])
        ).join(', ');

        return {
          handled: true,
          action: 'ATTENDEE_ADDED',
          booking: addRes.booking,
          replyText: `You're all set! I have added ${freshEmailsInMsg.join(', ')} as an attendee to your ${brandName()} demo on ${slotLabel}.\n\n• Google Meet Link: ${meetLink}\n• Date & Time: ${addRes.booking.date} from ${addRes.booking.startTime} – ${addRes.booking.endTime} ${TZL()}\n• Attendees: ${uniqueAttendeesList}\n\nI have updated Google Calendar and sent the invitation directly to ${freshEmailsInMsg.join(', ')}. We look forward to demonstrating ${brandName()} to your team!`,
        };
      } else {
        return {
          handled: true,
          action: 'ADD_ATTENDEE_FAILED',
          replyText: `I encountered an issue adding ${freshEmailsInMsg.join(', ')} to the calendar event. ${addRes.error || ''} Please confirm their email address.`,
        };
      }
    } else {
      return {
        handled: true,
        action: 'ASKED_AVAILABILITY',
        replyText: `I'd be glad to invite ${freshEmailsInMsg.join(', ')} to the demo! Let's select a date and time for your walkthrough first. What day and time between ${workingScheduleLabel()} works best for you? Once booked, I'll send the calendar invitation to both you and ${freshEmailsInMsg.join(', ')}.`,
      };
    }
  }

  // ===========================================================================
  // 4. GUARDED SLOT RESOLUTION
  // The agent never picks a time for the lead. It books only after:
  //   (a) the lead's own newest message names a specific day AND clock time (or picks one of the
  //       slots we offered), the slot is valid and free, AND
  //   (b) the lead says "yes" to our "Just to confirm..." message.
  // Everything else is answered with a question (plus 2-3 free options when their time can't work).
  // ===========================================================================
  // Remembered with the next question when only one half of a slot is known (declared first: the helper
  // functions at the end of this function read it).
  const carry: { date?: string; hour?: number; minute?: number } = {};
  const time = parseExplicitTime(fresh);
  const dateMentioned = hasExplicitDateToken(fresh);
  const offered: OfferedSlot[] = Array.isArray(schedState?.offeredSlots) ? schedState!.offeredSlots! : [];
  // A lead may phrase a reschedule naturally ("Can we connect today at 5 PM?") without
  // using the word "reschedule". If they already have a booking and now provide a new
  // meeting date/time, treat it as a proposed move rather than creating a second meeting.
  const proposesNewTimeForExistingBooking = Boolean(
    activeBooking &&
    (dateMentioned || time.hasTime) &&
    /\b(connect|meet|meeting|talk|call|demo|slot|schedule|available)\b/i.test(fresh)
  );
  const mode: 'NEW' | 'RESCHEDULE' =
    activeBooking && (isRescheduleIntent || schedState?.mode === 'RESCHEDULE' || proposesNewTimeForExistingBooking)
      ? 'RESCHEDULE'
      : 'NEW';

  // 4a. Lead is answering our "Just to confirm..." question.
  // Judged on the lead's own reply only: not the email subject, not our earlier message pasted back by
  // the mail client, not the signature. Otherwise a word from those ("different day", "no" in a subject)
  // turned a plain "Yes, that is correct." into a refusal and the lead was asked for a time again.
  if (schedState?.stage === 'AWAITING_CONFIRMATION' && schedState.proposedSlot) {
    const answerSource = params.bodyText != null ? stripQuotedEmailHistoryShared(String(params.bodyText)) || String(params.bodyText) : fresh;
    const answer = leadReplyHead(answerSource) || answerSource.trim();
    const firstSentence = (answer.split('\n').find((l) => l.trim()) || '').split(/(?<=[.!?])\s+/)[0] || answer;
    if (!hasExplicitDateToken(answer) && !parseExplicitTime(answer).hasTime) {
      if (isAffirmative(firstSentence) || isAffirmative(answer)) {
        return finalizeConfirmedSlot(schedState.proposedSlot, schedState.mode === 'RESCHEDULE' ? 'RESCHEDULE' : 'NEW');
      }
      if (isNegative(answer)) {
        if (schedState.mode === 'RESCHEDULE' && activeBooking) {
          const cancellation = await cancelDemoBooking(
            activeBooking.bookingId,
            'Lead declined the proposed reschedule and requested no replacement slot'
          );
          await clearSchedulingState(stateKey);
          if (!cancellation.success) {
            return {
              handled: true,
              action: 'CANCELLATION_FAILED',
              replyText: `I couldn't cancel your existing demo: ${cancellation.error || 'Google Calendar did not confirm the deletion.'} Your original booking on ${activeBooking.date} at ${activeBooking.startTime} ${TZL()} remains active.`,
            };
          }
          return {
            handled: true,
            action: 'CANCELLED',
            replyText: `No problem. I've cancelled your existing demo scheduled for ${activeBooking.date} at ${activeBooking.startTime} ${TZL()} and freed that calendar slot. You can request a new demo whenever you're ready.`,
          };
        }
        return askForAvailability(
          'ASKED_AVAILABILITY',
          `No problem. What day and time would suit you instead? Our demo availability is ${workingScheduleLabel()} (${demoDurationMinutes()} minutes per demo).`
        );
      }
    }
  }

  // 4b. AI extraction, limited to the lead's newest words. History is context only.
  const ai: {
    isDemoIntent?: boolean;
    requestedDate?: string | null;
    requestedHour?: number | null;
    requestedMinute?: number | null;
    wantsEarliest?: boolean;
  } = {};
  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const prompt = `You extract demo-scheduling details for ${brandName()}.
Now (${TZL()}, ${tz()}): ${dayNames[nowIst.dayOfWeek]} ${nowIst.dateString}, ${nowIst.hour}:${String(nowIst.minute).padStart(2, '0')}.

Earlier conversation (context only - NEVER take a date or time from here):
${conversationHistory.slice(-6).map((m) => `${m.role.toUpperCase()}: ${String(m.content || '').slice(0, 600)}`).join('\n') || '(none)'}

LEAD'S NEWEST MESSAGE (the ONLY source for date and time):
"""${fresh.slice(0, 1500)}"""

Strict rules:
- requestedDate: only if the newest message itself names a specific day (today, tomorrow, a weekday, or a calendar date). Resolve it to YYYY-MM-DD on or after today. Otherwise null.
- requestedHour and requestedMinute: only if the newest message itself states a clock time ("4pm", "16:20", "at 4:45"). Give the 24h start hour and minute exactly as asked, even if outside business hours. Use minute 0 when no minutes are stated. Otherwise both null.
- Never guess, never default, never use a time we suggested earlier, and never treat counts, prices, phone numbers or years as times.
- wantsEarliest: true only if they ask for the earliest / soonest / next available time without naming one.
Output JSON only: {"isDemoIntent": boolean, "requestedDate": string|null, "requestedHour": number|null, "requestedMinute": number|null, "wantsEarliest": boolean}`;

      for (const modelName of ['gpt-4o-mini', 'gpt-4o']) {
        try {
          const completion = await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0,
          });
          await recordAiCompletionUsage(getSchedCtx().tenantId, completion, modelName, 'openai');
          const content = completion.choices[0]?.message?.content;
          if (content) {
            Object.assign(ai, JSON.parse(content.trim()));
            break;
          }
        } catch (mErr: any) {
          console.warn(`[Demo Scheduling OpenAI ${modelName}] Notice:`, mErr?.message || mErr);
        }
      }
    } catch (aiErr) {
      console.warn('[Demo Scheduling AI Fallback]: Proceeding with rule-based parsing');
    }
  }

  // 4c. Deterministic checks decide; the AI output is only accepted when the lead's text backs it up.
  let requestedDate: string | null = null;
  if (dateMentioned) {
    // Relative dates and weekdays are deterministic in the tenant's timezone.
    // Do not let an LLM's date calculation override "today", "tomorrow", or a weekday.
    const simple = resolveSimpleDate(fresh, nowIst, addDaysToDate);
    const aiDate = isIsoDate(ai.requestedDate) ? ai.requestedDate : null;
    requestedDate = simple || aiDate;
    if (simple && aiDate && simple !== aiDate) {
      console.warn('[Demo Scheduling Date Resolution] AI date differed from tenant-local calendar; deterministic date used.', {
        text: fresh.slice(0, 240), aiDate, deterministicDate: simple,
        tenantDate: nowIst.dateString, timezone: tz(),
      });
    }
    const named = namedWeekdays(fresh);
    if (requestedDate && named.length === 1 && dayOfWeekFor(requestedDate) !== named[0]) {
      requestedDate = simple;
    }
  }

  // The lead gave the day earlier and now only the time (or the other way round): combine them.
  // While confirming a slot, "make it 11am" keeps the day and "Friday instead" keeps the time.
  const knownDate = isIsoDate(schedState?.partialDate) ? schedState!.partialDate! : schedState?.proposedSlot?.date;
  const knownHour =
    typeof schedState?.partialHour === 'number' ? schedState.partialHour : schedState?.proposedSlot?.startHour;
  const knownMinute =
    typeof schedState?.partialMinute === 'number' ? schedState.partialMinute : (schedState?.proposedSlot?.startMinute || 0);
  if (!requestedDate && !dateMentioned && time.hasTime && isIsoDate(knownDate)) requestedDate = knownDate;

  let requestedHour: number | null = null;
  let requestedMinute: number | null = null;
  let hourOutOfRange = false;
  if (time.hasTime) {
    const inGrid = time.timeCandidates.filter((candidate) => isConfiguredSlotStart(candidate.hour, candidate.minute));
    const aiHour = typeof ai.requestedHour === 'number' ? ai.requestedHour : null;
    const aiMinute = typeof ai.requestedMinute === 'number' ? ai.requestedMinute : 0;
    const aiMatch = aiHour === null ? undefined : time.timeCandidates.find((candidate) =>
      candidate.hour === aiHour && candidate.minute === aiMinute
    );
    if (aiMatch && isConfiguredSlotStart(aiMatch.hour, aiMatch.minute)) {
      requestedHour = aiMatch.hour;
      requestedMinute = aiMatch.minute;
    } else if (inGrid.length === 1) {
      requestedHour = inGrid[0].hour;
      requestedMinute = inGrid[0].minute;
    } else if (inGrid.length === 0) {
      requestedHour = time.timeCandidates[0]?.hour ?? time.hourCandidates[0] ?? null;
      requestedMinute = time.timeCandidates[0]?.minute ?? 0;
      hourOutOfRange = true;
    }
  }
  if (requestedHour === null && !time.hasTime && dateMentioned && typeof knownHour === 'number') {
    requestedHour = knownHour;
    requestedMinute = knownMinute;
    hourOutOfRange = !isConfiguredSlotStart(requestedHour, requestedMinute);
  }

  const wantsEarliest =
    ai.wantsEarliest === true ||
    /\b(earliest|asap|as soon as possible|soonest|next available|first available|any ?time|whenever)\b/i.test(fresh);
  const period = preferredPeriodOf(fresh);
  const pickedIdx = offered.length ? pickOfferedSlot(fresh, offered, dayOfWeekFor) : null;

  const isDemoIntent =
    detectDemoSchedulingIntent(fresh) ||
    ai.isDemoIntent === true ||
    pickedIdx !== null ||
    (!!schedState && (dateMentioned || time.hasTime || wantsEarliest || period !== 'ANY')) ||
    (params.manual === true && (dateMentioned || time.hasTime));

  if (!isDemoIntent) {
    return { handled: false, replyText: '', action: 'NOT_DEMO_INTENT' };
  }

  // 4d. Already has an upcoming demo and did not ask to move it: never book a second one.
  if (activeBooking && mode !== 'RESCHEDULE') {
    await clearSchedulingState(stateKey);
    const label = requestedDate && requestedHour !== null && !hourOutOfRange
      ? formatSlotLabel(requestedDate, requestedHour, requestedMinute ?? 0)
      : undefined;
    return { handled: true, action: 'ALREADY_BOOKED', replyText: alreadyBookedReplyText(activeBooking, label) };
  }

  // 4e. Lead picked one of the slots we offered -> confirm it.
  if (pickedIdx !== null && !(requestedDate && requestedHour !== null && !matchesOffered(requestedDate, requestedHour, requestedMinute ?? 0))) {
    return proposeSlot(offered[pickedIdx], mode);
  }

  // 4f. Nothing concrete yet: ask. Options only when they asked for the earliest or gave a part of the day.
  if (!requestedDate && requestedHour === null) {
    if (time.hasTime && !hourOutOfRange) {
      return askForAvailability(
        'ASKED_AVAILABILITY',
        `Could you share the exact day and time that suits you (for example, Tuesday at 4 PM ${TZL()})?`
      );
    }
    if (hourOutOfRange) {
      return offerOptions('HOURS_NOT_ALLOWED', hoursNotAllowedText(), { period });
    }
    if (wantsEarliest || period !== 'ANY') {
      return offerOptions('OFFERED_ALTERNATIVES', `Happy to set that up.`, { period }, {
        listLead: `Here are the earliest free slots${period !== 'ANY' ? ` in the ${period.toLowerCase()}` : ''}:`,
      });
    }
    return askForAvailability(
      'ASKED_AVAILABILITY',
      mode === 'RESCHEDULE'
        ? `Sure, I can move your ${brandName()} demo (currently ${activeBooking!.date} at ${activeBooking!.startTime} ${TZL()}). What day and time would suit you instead? Our demos run ${workingScheduleLabel()} (${demoDurationMinutes()} minutes).`
        : `I'd be glad to arrange a live walkthrough of ${brandName()} for ${companyName}! What day and time would suit you? Our demos run ${workingScheduleLabel()} and take ${demoDurationMinutes()} minutes.`
    );
  }

  // 4g. Day given but no usable time.
  if (requestedDate && (requestedHour === null || hourOutOfRange)) {
    const dateProblem = await validateDate(requestedDate);
    if (dateProblem) return dateProblem;
    if (hourOutOfRange) {
      return offerOptions('HOURS_NOT_ALLOWED', hoursNotAllowedText(), { startFromDate: requestedDate, period });
    }
    carry.date = requestedDate;
    return offerOptions(
      'ASKED_AVAILABILITY',
      `What time on ${formatDayLabel(requestedDate)} works for you?`,
      { startFromDate: requestedDate, period },
      {
        listLead: 'These are the nearest free slots:',
        outro: `Reply with the option number, or tell me another time during our available hours: ${workingScheduleLabel()}.`,
      }
    );
  }

  // 4h. Time given but no day.
  if (!requestedDate && requestedHour !== null) {
    if (hourOutOfRange) return offerOptions('HOURS_NOT_ALLOWED', hoursNotAllowedText(), { period });
    carry.hour = requestedHour;
    carry.minute = requestedMinute ?? 0;
    return askForAvailability(
      'ASKED_AVAILABILITY',
      `Which day would you like the demo at ${formatClockTime(requestedHour, requestedMinute ?? 0)}? Our available days and hours are: ${workingScheduleLabel()}.`
    );
  }

  // 4i. Day AND time given: validate, check the calendar, then ask for confirmation.
  const dateProblem = await validateDate(requestedDate!);
  if (dateProblem) return dateProblem;
  return proposeSlot({
    date: requestedDate!,
    startHour: requestedHour!,
    startMinute: requestedMinute ?? 0,
    label: formatSlotLabel(requestedDate!, requestedHour!, requestedMinute ?? 0),
  }, mode);

  // ---------------------------------------------------------------------------
  // Helpers (closures over this turn's lead context)
  // ---------------------------------------------------------------------------
  function matchesOffered(date: string, hour: number, minute = 0): boolean {
    return offered.some((s) => s.date === date && s.startHour === hour && (s.startMinute || 0) === minute);
  }

  function hoursNotAllowedText(): string {
    return `Our demo availability is ${workingScheduleLabel()}. Each demo is ${demoDurationMinutes()} minutes, with start times repeating every ${demoDurationMinutes()} minutes.`;
  }

  function formatDayLabel(date: string): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz(), weekday: 'long', month: 'short', day: 'numeric' }).format(
      new Date(createIstIsoString(date, 12, 0))
    );
  }

  /** Returns a reply if the date itself can't work (past, non-working day, too far out), else null. */
  async function validateDate(date: string): Promise<SchedulingTurnResult | null> {
    if (date < nowIst.dateString) {
      return askForAvailability('ASKED_AVAILABILITY', `That date has already passed. Which upcoming day and time would suit you?`);
    }
    if (date > addDaysToDate(nowIst.dateString, MAX_DAYS_AHEAD)) {
      return askForAvailability(
        'ASKED_AVAILABILITY',
        `We can schedule demos up to ${MAX_DAYS_AHEAD} days ahead. Could you pick a day and time a little sooner?`
      );
    }
    if (!isWorkingDay(dayOfWeekFor(date))) {
      return offerOptions(
        'WEEKEND_NOT_ALLOWED',
        `Our demo team works ${daysLabel()}, so ${formatDayLabel(date)} isn't available.`,
        { startFromDate: date, period }
      );
    }
    return null;
  }

  async function askForAvailability(action: SchedulingTurnResult['action'], replyText: string): Promise<SchedulingTurnResult> {
    await saveSchedulingState(stateKey, { stage: 'AWAITING_AVAILABILITY', offeredSlots: [], mode, partialDate: carry.date, partialHour: carry.hour, partialMinute: carry.minute });
    return { handled: true, action, replyText };
  }

  /** Lists 2-3 free slots the lead can pick from. Never books. */
  async function offerOptions(
    action: SchedulingTurnResult['action'],
    intro: string,
    opts: { startFromDate?: string; period?: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY' } = {},
    text: { listLead?: string; outro?: string } = {}
  ): Promise<SchedulingTurnResult> {
    let slots = await findNextAvailableSlots({
      maxSlotsToReturn: 3,
      startFromDate: opts.startFromDate,
      preferredPeriod: opts.period,
      accessToken,
    });
    if (slots.length === 0 && opts.period && opts.period !== 'ANY') {
      slots = await findNextAvailableSlots({ maxSlotsToReturn: 3, startFromDate: opts.startFromDate, accessToken });
    }
    const offeredSlots: OfferedSlot[] = slots.map((s) => ({ date: s.date, startHour: s.startHour, startMinute: s.startMinute, label: s.label }));
    await saveSchedulingState(stateKey, { stage: 'AWAITING_AVAILABILITY', offeredSlots, mode, partialDate: carry.date, partialHour: carry.hour, partialMinute: carry.minute });
    if (offeredSlots.length === 0) {
      return {
        handled: true,
        action,
        replyText: `${intro} I don't see free slots on our calendar for that, so what other day and time would suit you? Our demos run ${workingScheduleLabel()}.`.trim(),
      };
    }
    const list = offeredSlots.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
    return {
      handled: true,
      action,
      replyText: `${intro} ${text.listLead || 'Here are some free slots:'}`.trim() +
        `\n\n${list}\n\n${text.outro || 'Reply with the option number, or tell me another day and time that suits you.'}`,
    };
  }

  /** Valid, free slot -> ask the lead to confirm it. Never books. */
  async function proposeSlot(slot: OfferedSlot, slotMode: 'NEW' | 'RESCHEDULE'): Promise<SchedulingTurnResult> {
    const problem = await slotProblem(slot);
    if (problem) return problem;
    await saveSchedulingState(stateKey, {
      stage: 'AWAITING_CONFIRMATION',
      proposedSlot: { date: slot.date, startHour: slot.startHour, startMinute: slot.startMinute || 0, label: formatSlotLabel(slot.date, slot.startHour, slot.startMinute || 0) },
      offeredSlots: [],
      mode: slotMode,
    });
    const verb = slotMode === 'RESCHEDULE' ? `move your ${brandName()} demo to` : `book your ${brandName()} demo for`;
    return {
      handled: true,
      action: 'AWAITING_CONFIRMATION',
      replyText: `Just to confirm, shall I ${verb} ${formatSlotLabel(slot.date, slot.startHour, slot.startMinute || 0)}?\n\nReply "Yes" to confirm, or tell me a different day and time.`,
    };
  }

  /** Re-checks a slot right before proposing or booking it. Returns a reply when it can't be used. */
  async function slotProblem(slot: OfferedSlot): Promise<SchedulingTurnResult | null> {
    const startMinute = slot.startMinute || 0;
    const label = formatSlotLabel(slot.date, slot.startHour, startMinute);
    if (!slotStartMinutes(dayOfWeekFor(slot.date)).includes(slot.startHour * 60 + startMinute)) {
      return offerOptions('HOURS_NOT_ALLOWED', hoursNotAllowedText(), { startFromDate: slot.date });
    }
    if (!isWorkingDay(dayOfWeekFor(slot.date))) {
      return offerOptions('WEEKEND_NOT_ALLOWED', `Our demo team works ${daysLabel()}.`, { startFromDate: slot.date });
    }
    const startIso = createIstIsoString(slot.date, slot.startHour, startMinute);
    if (Date.parse(startIso) <= Date.now() + MIN_LEAD_TIME_MS) {
      return offerOptions('SLOT_UNAVAILABLE', `${label} is too soon or has already passed.`, {}, { listLead: 'Here are the next free slots:' });
    }
    const endIso = slotEndIso(slot.date, slot.startHour, startMinute);
    const availability = await checkRealtimeGoogleCalendarSlot(startIso, endIso, accessToken);
    if (!availability.available) {
      return offerOptions('SLOT_UNAVAILABLE', `${label} is already taken on our calendar.`, {
        startFromDate: slot.date,
      });
    }
    return null;
  }

  /** The lead said yes to a proposed slot: re-validate, then book or reschedule. */
  async function finalizeConfirmedSlot(slot: OfferedSlot, slotMode: 'NEW' | 'RESCHEDULE'): Promise<SchedulingTurnResult> {
    const problem = await slotProblem(slot);
    if (problem) return problem;

    const startH = slot.startHour;
    const startMinute = slot.startMinute || 0;
    const targetDateStr = slot.date;
    const startTotal = startH * 60 + startMinute;
    const endTotal = startTotal + demoDurationMinutes();
    const startIso = createIstIsoString(targetDateStr, startH, startMinute);
    const endIso = createIstIsoString(targetDateStr, Math.floor(endTotal / 60), endTotal % 60);
    const startTimeStr = formatClockTime24(startTotal);
    const endTimeStr = formatClockTime24(endTotal);
    const slotLabel = formatSlotLabel(targetDateStr, startH, startMinute);

    if (slotMode === 'RESCHEDULE' && activeBooking) {
      const resched = await rescheduleDemoBooking(
        activeBooking.bookingId,
        startIso,
        endIso,
        targetDateStr,
        startTimeStr,
        endTimeStr,
        accessToken
      );
      if (resched.success && resched.booking) {
        await clearSchedulingState(stateKey);
        return {
          handled: true,
          action: 'RESCHEDULED',
          booking: resched.booking,
          replyText: `You're all set! Your ${brandName()} demo has been rescheduled to ${slotLabel}.\n\n• New Google Meet Link: ${resched.booking.googleMeetLink}\n• Company: ${companyName}\n• Attendee: ${leadName} (${leadEmail || 'Email invite updated'})\n• Timezone: ${tzDisplay()}\n\n${resched.calendarInviteSent ? 'A new calendar invitation has been sent. The previous invitation was cancelled.' : 'The booking time was updated, but Google did not confirm sending the new calendar invitation; please check the calendar connection.'} We look forward to demonstrating how ${sb().playbook === 'umrah360' ? 'Umrah360 automates your pilgrimage operations' : `${brandName()} can help your business`}!`,
        };
      }
      return {
        handled: true,
        action: resched.conflict ? 'SLOT_UNAVAILABLE' : 'RESCHEDULE_FAILED',
        replyText: `I couldn't move the demo to ${slotLabel}. Your original booking remains active and unchanged. ${resched.error || 'Please try another available slot or contact the team.'}`,
      };
    }

    // Already has an upcoming demo and did not ask to reschedule: never book a second one.
    if (activeBooking) {
      await clearSchedulingState(stateKey);
      return { handled: true, action: 'ALREADY_BOOKED', replyText: alreadyBookedReplyText(activeBooking, slotLabel) };
    }

    // New booking creation with Google Calendar & Google Meet (sends invite once)
    const bookingResult = await createGoogleCalendarDemoBooking({
      leadId: leadContext.leadId,
      contactId: leadContext.contactId,
      campaignId: leadContext.campaignId,
      conversationId: leadContext.conversationId,
      channel: leadContext.channel,
      leadName,
      leadEmail,
      leadPhone: leadContext.leadPhone,
      companyName,
      startIso,
      endIso,
      dateString: targetDateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      accessToken,
    });

    if (bookingResult.success && bookingResult.booking) {
      await clearSchedulingState(stateKey);
      const meetLink = bookingResult.googleMeetLink || 'Will be shared via calendar invitation';
      const replyText = [
        `You're all set! Your ${brandName()} demo is booked for ${slotLabel}.`,
        ``,
        `Demo Details:`,
        `• Attendee: ${leadName}${leadEmail ? ` (${leadEmail})` : ''}`,
        `• Company: ${companyName}`,
        `• Google Meet Link: ${meetLink}`,
        `• Timezone: ${tzDisplay()}`,
        ``,
        sb().playbook === 'umrah360'
          ? `I have sent the calendar invitation to your email. We look forward to showing you Umrah360's group series operations, visa tracking, and B2B portal!`
          : `I have sent the calendar invitation to your email. We look forward to showing you ${brandName()}!`,
      ].join('\n');
      return { handled: true, action: 'CONFIRMED_BOOKING', booking: bookingResult.booking, replyText };
    }

    if (bookingResult.alreadyBooked) {
      // Another message from this lead booked a demo a moment ago.
      await clearSchedulingState(stateKey);
      return {
        handled: true,
        action: 'ALREADY_BOOKED',
        replyText: bookingResult.existingBooking
          ? alreadyBookedReplyText(bookingResult.existingBooking)
          : `A demo for you is being booked right now. You'll get the calendar invitation by email shortly.`,
      };
    }

    // Slot was taken in a race, or the booking failed: offer options, never pick one.
    return offerOptions(
      'SLOT_UNAVAILABLE',
      bookingResult.conflict ? `${slotLabel} was just booked by someone else.` : `I couldn't book ${slotLabel}.`,
      { startFromDate: targetDateStr }
    );
  }
}

/**
 * Returns all stored demo bookings from Firestore.
 */
export async function getAllBookings(): Promise<Booking[]> {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const q = query(tenantRepo(getSchedCtx()).bookings(), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    const nowMs = Date.now();
    const completedAt = new Date(nowMs).toISOString();
    const candidates = snap.docs.filter((document) => {
      const booking = document.data() as Booking;
      const endIso = booking.endDateTimeIso || (booking.date && booking.endTime ? `${booking.date}T${booking.endTime}:00+05:30` : '');
      const endMs = Date.parse(endIso);
      return (booking.status === 'BOOKED' || booking.status === 'RESCHEDULED') && Number.isFinite(endMs) && endMs <= nowMs;
    });

    const completedIds = candidates.length ? await runTransaction(async (transaction) => {
      const latestSnapshots = await Promise.all(candidates.map((document) => transaction.get(document.ref)));
      const ids: string[] = [];
      latestSnapshots.forEach((latest, index) => {
        if (!latest.exists) return;
        const booking = latest.data() as Booking;
        const endIso = booking.endDateTimeIso || (booking.date && booking.endTime ? `${booking.date}T${booking.endTime}:00+05:30` : '');
        const endMs = Date.parse(endIso);
        if ((booking.status === 'BOOKED' || booking.status === 'RESCHEDULED') && Number.isFinite(endMs) && endMs <= nowMs) {
          transaction.update(latest.ref, { status: 'COMPLETED', completedAt, updatedAt: completedAt });
          ids.push(candidates[index].id);
        }
      });
      return ids;
    }).catch((error) => {
      console.warn('[Calendar Service Notice] Could not auto-complete elapsed bookings:', error);
      return [] as string[];
    }) : [];
    const completedSet = new Set(completedIds);

    return snap.docs.map((document) => {
      const booking = document.data() as Booking;
      return completedSet.has(document.id)
        ? { ...booking, status: 'COMPLETED', completedAt, updatedAt: completedAt }
        : booking;
    });
  } catch (e) {
    console.warn('[Calendar Service Notice] Error listing bookings:', e);
    return [];
  }
}