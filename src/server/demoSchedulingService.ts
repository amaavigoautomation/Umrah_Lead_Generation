import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';
import { getTenantBrand, getBrandSync } from './brandService.js';
import { brandTzLabel, brandWorkingDaysLabel, fmtHour, DAY_NAMES } from '../shared/brand.js';

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
function getSchedCtx(): TenantContext {
  return activeSchedulingCtx;
}

// ---- Per-company scheduling brand (timezone, working days/hours, names). Cache is warmed by warmSchedBrand(). ----
const sb = () => getBrandSync(getSchedCtx().tenantId);
const warmSchedBrand = () => getTenantBrand(getSchedCtx().tenantId).catch(() => sb());
const tz = () => sb().timezone;
const TZL = () => brandTzLabel(sb());
const tzDisplay = () => (sb().timezoneLabel ? `${tz()} (${sb().timezoneLabel})` : tz());
const workStartH = () => sb().workingHoursStart;
const workEndH = () => sb().workingHoursEnd;
const slotHours = () => {
  const out: number[] = [];
  for (let h = workStartH(); h < workEndH(); h++) out.push(h);
  return out;
};
const hrShort = (h: number) => `${((h + 11) % 12) + 1} ${h % 24 >= 12 ? 'PM' : 'AM'}`;
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
} from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { Booking, BookingStatus, Channel, Lead } from '../types/index.js';
import { updateCampaignLeadStatus } from './campaignService.js';
import { sendLiveEmail, getSmtpConfig } from './smtpService.js';

export const TARGET_CALENDAR_EMAIL = 'amaavigo@gmail.com';
export const SCHEDULING_TIMEZONE = 'Asia/Kolkata'; // IST (UTC +05:30)
export const WORKING_START_HOUR = 10; // 10:00 AM IST
export const WORKING_END_HOUR = 19; // 7:00 PM IST (last 60-min demo starts at 18:00)
export const DEMO_DURATION_MINUTES = 60;

// Valid fixed 1-hour slots: 10-11, 11-12, 12-13, 13-14, 14-15, 15-16, 16-17, 17-18, 18-19
export const VALID_SLOT_START_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18];

// Server-side in-memory cache for OAuth access token
let serverCalendarAccessToken: string | null = null;
let serverTokenExpiresAt: number = 0;

/**
 * Clears the expired or invalid Google Calendar access token on the server and Firestore
 * to prevent continuous 401 background log errors.
 */
export async function handleExpiredCalendarToken() {
  serverCalendarAccessToken = null;
  serverTokenExpiresAt = 0;
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
  serverCalendarAccessToken = token.trim();
  serverTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
}

/**
 * Retrieves an active Google Calendar OAuth access token.
 * Checks explicit parameter, in-memory cache, Firestore settings/calendar_auth, and env vars.
 * Automatically exchanges stored Refresh Token if Access Token is expired.
 */
export async function getLiveCalendarToken(explicitToken?: string): Promise<string | null> {
  if (explicitToken && explicitToken.trim() && explicitToken !== 'null' && explicitToken !== 'undefined') {
    setServerCalendarAccessToken(explicitToken.trim());
    return explicitToken.trim();
  }

  if (serverCalendarAccessToken && Date.now() < serverTokenExpiresAt - 30000) {
    return serverCalendarAccessToken;
  }

  // 1. Try Firestore settings/calendar_auth
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(tenantRepo(getSchedCtx()).settingsDoc('calendar_auth'));
      if (snap.exists()) {
        const data = snap.data();

        // Check if we have an active access token that isn't flagged expired
        if (data?.accessToken && data.accessToken !== 'null' && data?.active !== false && !data?.expired) {
          serverCalendarAccessToken = data.accessToken;
          serverTokenExpiresAt = Date.now() + 3600 * 1000;
          return serverCalendarAccessToken;
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
  return `${dateString}T${pad(hour)}:${pad(minute)}:00${tzOffsetFor(dateString, hour, minute)}`;
}

/**
 * Checks whether a given day of week is a valid working day (Monday - Friday).
 */
export function isWorkingDay(dayOfWeek: number): boolean {
  return sb().workingDays.includes(dayOfWeek);
}

/**
 * Formats an IST slot into a friendly human-readable label.
 * e.g. "Wednesday, Oct 1: 3:00 PM – 4:00 PM IST"
 */
export function formatSlotLabel(dateString: string, startHour: number): string {
  const dateObj = new Date(createIstIsoString(dateString, 12, 0));
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(),
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);

  const formatHour = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${period}`;
  };

  return `${dayName}: ${formatHour(startHour)} – ${formatHour(startHour + 1)} ${TZL()}`;
}

// -----------------------------------------------------------------------------
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
      const items = (eventsData.items || []).filter((e: any) => e.status !== 'cancelled');

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
 * Finds next available fixed 1-hour slots in Google Calendar across upcoming business days.
 * NO AVAILABLE SLOTS ARE SAVED TO ANY DATABASE.
 * Only returns slots strictly within Monday-Friday, 10 AM - 7 PM IST.
 */
export async function findNextAvailableSlots(
  options: {
    targetDaysCount?: number;
    maxSlotsToReturn?: number;
    preferredDate?: string; // YYYY-MM-DD
    preferredPeriod?: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY';
    accessToken?: string;
  } = {}
): Promise<Array<{ date: string; startHour: number; label: string; startIso: string; endIso: string }>> {
  await warmSchedBrand();
  const {
    targetDaysCount = 10,
    maxSlotsToReturn = 4,
    preferredDate,
    preferredPeriod = 'ANY',
    accessToken,
  } = options;

  const nowIst = getNowInIst();
  const availableSlots: Array<{ date: string; startHour: number; label: string; startIso: string; endIso: string }> = [];

  // Always start scanning from TODAY (0) to guarantee the EARLIEST upcoming available slots
  let currentOffset = 0;

  // Define hour ranges based on preferred period
  const VALID_HOURS = slotHours();
  let allowedHours = VALID_HOURS;
  if (preferredPeriod === 'MORNING') {
    allowedHours = VALID_HOURS.filter((h) => h < 12); // 10, 11
  } else if (preferredPeriod === 'AFTERNOON') {
    allowedHours = VALID_HOURS.filter((h) => h >= 12 && h < 17); // 12, 13, 14, 15, 16
  } else if (preferredPeriod === 'EVENING') {
    allowedHours = VALID_HOURS.filter((h) => h >= 17); // 17, 18
  }

  if (allowedHours.length === 0) allowedHours = VALID_HOURS;

  let daysChecked = 0;

  while (daysChecked < targetDaysCount && availableSlots.length < maxSlotsToReturn && currentOffset < 14) {
    const checkDate = new Date();
    checkDate.setDate(checkDate.getDate() + currentOffset);

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dateStr = formatter.format(checkDate);

    const dayOfWeek = dayOfWeekFor(dateStr);

    currentOffset++;

    // Skip Saturday (6) and Sunday (0)
    if (!isWorkingDay(dayOfWeek)) {
      continue;
    }

    daysChecked++;

    for (const h of allowedHours) {
      if (availableSlots.length >= maxSlotsToReturn) break;

      // Skip past hours if checking today
      if (dateStr === nowIst.dateString) {
        if (h <= nowIst.hour || (h === nowIst.hour + 1 && nowIst.minute > 30)) {
          continue;
        }
      }

      const startIso = createIstIsoString(dateStr, h, 0);
      const endIso = createIstIsoString(dateStr, h + 1, 0);

      const check = await checkRealtimeGoogleCalendarSlot(startIso, endIso, accessToken);
      if (check.available) {
        availableSlots.push({
          date: dateStr,
          startHour: h,
          label: formatSlotLabel(dateStr, h),
          startIso,
          endIso,
        });
      }
    }
  }

  return availableSlots;
}

// -----------------------------------------------------------------------------
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
  accessToken?: string;
}

export interface CreateBookingResult {
  success: boolean;
  booking?: Booking;
  googleMeetLink?: string;
  calendarEventId?: string;
  calendarInviteSent?: boolean;
  conflict?: boolean;
  error?: string;
}

/**
 * Creates a Google Calendar Event with an authentic Google Meet conference link,
 * invites the lead's email (sends calendar invitation ONCE via sendUpdates=all),
 * stores the confirmed booking record in Firestore, and updates the CRM Lead.
 */
export async function createGoogleCalendarDemoBooking(
  params: CreateBookingParams
): Promise<CreateBookingResult> {
  await warmSchedBrand();
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
      const attendees: Array<{ email: string }> = [];
      if (leadEmail && leadEmail.includes('@') && leadEmail.toLowerCase() !== hostCalendarEmail().toLowerCase()) {
        attendees.push({ email: leadEmail });
      }

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
            requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        return {
          success: false,
          error: 'Google Calendar created the event but could not generate a Google Meet video conference link.',
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
    leadEmail: leadEmail || '',
    leadPhone: leadPhone || '',
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
    attendees: [...(hostCalendarEmail() ? [hostCalendarEmail()] : []), ...(leadEmail ? [leadEmail] : [])],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(tenantRepo(getSchedCtx()).bookingDoc(bookingId), booking, { merge: true });

      // 4. Update CRM Lead record
      if (leadId) {
        await safeSetDoc(
          tenantRepo(getSchedCtx()).leadDoc(leadId),
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
            autoFollowUp: {
              enabled: false,
              disabledBy: 'System Demo Booking',
              disabledAt: nowIso,
              disabledReason: 'demo_booked',
              activeFollowUpId: null,
              nextScheduledAt: null,
            },
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // Hard stop: cancel any scheduled follow-up jobs for this lead.
        try {
          const { cancelFollowUpsForLead } = await import('./autoFollowUpService.js');
          await cancelFollowUpsForLead(getSchedCtx(), leadId, 'demo_booked');
        } catch (fuErr) {
          console.warn('[Demo Booking] Auto follow-up cancel notice:', fuErr);
        }
      }

      // 5. Update Campaign analytics if lead originated from outbound campaign
      if (campaignId && leadId) {
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
    booking,
    googleMeetLink,
    calendarEventId,
    calendarInviteSent,
  };
}

/**
 * Cancels a demo booking, removes the event from Google Calendar, and frees up the slot.
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

    // 1. Remove from Google Calendar and notify attendees
    if (booking.calendarEventId && !booking.calendarEventId.startsWith('mock-')) {
      const token = await getLiveCalendarToken();
      if (token) {
        try {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
              booking.calendarEventId
            )}?sendUpdates=all`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          );
        } catch (e) {
          console.warn('[Calendar Delete Notice]:', e);
        }
      }
    }

    // 2. Update Firestore booking status
    const nowIso = new Date().toISOString();
    await safeSetDoc(
      bookingRef,
      {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    // 3. Update Lead status
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
 * Reschedules a demo booking to a new time slot:
 * 1. Checks real-time Google Calendar availability for the requested new slot.
 * 2. Empties/clears the initial booked slot by deleting the old event on Google Calendar (sendUpdates=all).
 * 3. Books the new slot on Google Calendar with a fresh Google Meet link and sends the new calendar invitation.
 * 4. Updates the booking record and lead state in Firestore.
 */
export async function rescheduleDemoBooking(
  bookingId: string,
  newStartIso: string,
  newEndIso: string,
  newDateString: string,
  newStartTime: string,
  newEndTime: string,
  accessToken?: string
): Promise<{ success: boolean; booking?: Booking; error?: string; conflict?: boolean }> {
  await warmSchedBrand();
  // 1. Verify availability for requested new slot before modifying existing booking
  const freshCheck = await checkRealtimeGoogleCalendarSlot(newStartIso, newEndIso, accessToken);
  if (!freshCheck.available) {
    return {
      success: false,
      conflict: true,
      error: 'The requested new slot is already booked on our calendar. Please choose another time.',
    };
  }

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
    const token = await getLiveCalendarToken(accessToken);

    // 2. FIRST: Make the initial booked slot EMPTY on Google Calendar by removing the original event
    if (booking.calendarEventId && !booking.calendarEventId.startsWith('mock-') && token) {
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
            booking.calendarEventId
          )}?sendUpdates=all`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        console.log(`[Reschedule] Initial booked slot (${booking.startDateTimeIso}) emptied on Google Calendar.`);
      } catch (delErr) {
        console.warn('[Reschedule Notice] Error deleting original event to empty initial slot:', delErr);
      }
    }

    // 3. SECOND: Book the new slot on Google Calendar and dispatch new calendar invite
    let newCalendarEventId = `mock-cal-${Date.now()}`;
    let newGoogleMeetLink = booking.googleMeetLink;

    if (token) {
      const createRes = await createGoogleCalendarDemoBooking({
        leadId: booking.leadId,
        contactId: booking.contactId,
        campaignId: booking.campaignId,
        conversationId: booking.conversationId,
        channel: booking.channel,
        leadName: booking.leadName,
        leadEmail: booking.leadEmail,
        leadPhone: booking.leadPhone,
        companyName: booking.companyName,
        startIso: newStartIso,
        endIso: newEndIso,
        dateString: newDateString,
        startTime: newStartTime,
        endTime: newEndTime,
        accessToken: token,
      });

      if (createRes.success && createRes.booking) {
        newCalendarEventId = createRes.calendarEventId || newCalendarEventId;
        newGoogleMeetLink = createRes.googleMeetLink || newGoogleMeetLink;
      }
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

    await safeSetDoc(bookingRef, updatedBooking, { merge: true });

    if (booking.leadId) {
      await safeSetDoc(
        tenantRepo(getSchedCtx()).leadDoc(booking.leadId),
        {
          demoDate: newDateString,
          demoStartTime: newStartTime,
          demoEndTime: newEndTime,
          demoTimezone: tz(),
          calendarEventId: newCalendarEventId,
          googleMeetLink: newGoogleMeetLink,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }

    return { success: true, booking: updatedBooking };
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
    | 'WEEKEND_NOT_ALLOWED'
    | 'HOURS_NOT_ALLOWED'
    | 'ATTENDEE_ADDED'
    | 'ASKED_ATTENDEE_EMAIL'
    | 'ADD_ATTENDEE_FAILED'
    | 'NOT_DEMO_INTENT';
}

/**
 * Checks if a lead already has an active demo scheduled.
 */
export async function getActiveBookingForLeadOrConversation(
  leadId?: string,
  leadEmail?: string,
  conversationId?: string
): Promise<Booking | null> {
  await warmSchedBrand();
  if (!isFirebaseConfigured || !db) return null;
  try {
    if (leadEmail && leadEmail.includes('@')) {
      const q = query(
        tenantRepo(getSchedCtx()).bookings(),
        where('leadEmail', '==', leadEmail.trim().toLowerCase()),
        where('status', 'in', ['BOOKED', 'RESCHEDULED']),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data() as Booking;
      }
    }

    if (leadId) {
      const q = query(
        tenantRepo(getSchedCtx()).bookings(),
        where('leadId', '==', leadId),
        where('status', 'in', ['BOOKED', 'RESCHEDULED']),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data() as Booking;
      }
    }

    if (conversationId) {
      const q = query(
        tenantRepo(getSchedCtx()).bookings(),
        where('conversationId', '==', conversationId),
        where('status', 'in', ['BOOKED', 'RESCHEDULED']),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data() as Booking;
      }
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
    /can\s+we\s+(meet|talk|have\s+a\s+call|schedule)/i,
    /when\s+can\s+we\s+(meet|see\s+demo)/i,
    /reschedule\s+(the\s+)?(demo|meeting|call)/i,
    /cancel\s+(the\s+)?(demo|meeting|call)/i,
  ];

  for (const p of patterns) {
    if (p.test(t)) return true;
  }

  // A day + a time only counts when it is also about meeting / a demo
  if (
    /(monday|tuesday|wednesday|thursday|friday|tomorrow|next\s+week)/i.test(t) &&
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
  // Booking only happens when the sender actually asks for it. Manual calls (Demo Scheduling tab)
  // always proceed; automated calls (inbound email / WhatsApp) proceed only on real booking intent,
  // judged on the sender's new text with quoted history stripped.
  if (params.manual !== true) {
    const newText = String(params.messageText || '');
    if (!detectDemoSchedulingIntent(newText)) {
      return { handled: false, replyText: '', action: 'NOT_DEMO_INTENT' };
    }
  }
  const messageText = params.messageText || '';
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

  const nowIst = getNowInIst();

  // 1. Check if user already has an active booking
  const activeBooking = await getActiveBookingForLeadOrConversation(
    leadId,
    leadEmail,
    conversationId
  );

  const lowerText = messageText.toLowerCase();

  // 2. Cancellation Intent
  if (/cancel\s+(the\s+)?(demo|meeting|booking|appointment|call)/i.test(lowerText)) {
    if (activeBooking) {
      await cancelDemoBooking(activeBooking.bookingId, 'Lead requested cancellation in conversation');
      return {
        handled: true,
        action: 'CANCELLED',
        replyText: `Your ${brandName()} demo scheduled for ${activeBooking.date} at ${activeBooking.startTime} ${TZL()} has been cancelled. The time slot has been freed up on our calendar. Whenever you're ready to explore ${brandName()} in the future, just let us know and we'll gladly schedule a fresh walkthrough!`,
      };
    } else {
      return {
        handled: true,
        action: 'CANCELLED',
        replyText: `You do not have any active demo scheduled currently. If you'd like to book one at any time between ${daysLabel().replace(' to ', ' and ')} (${hrShort(workStartH())} to ${hrShort(workEndH())} ${TZL()}), simply let me know!`,
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
        const slotLabel = formatSlotLabel(
          addRes.booking.date,
          parseInt((addRes.booking.startTime || '15:00').split(':')[0], 10)
        );
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
        replyText: `I'd be glad to invite ${freshEmailsInMsg.join(', ')} to the demo! Let's select a date and time for your walkthrough first. What day and time between ${fmtHour(workStartH())} and ${fmtHour(workEndH())} ${TZL()} (${daysLabel()}) works best for you? Once booked, I'll send the calendar invitation to both you and ${freshEmailsInMsg.join(', ')}.`,
      };
    }
  }

  // 4. Use AI to extract intent and slot parameters from the full conversation
  let nlpResult: {
    isDemoIntent: boolean;
    hasSpecificSlot: boolean;
    dateString?: string; // YYYY-MM-DD
    startHour?: number; // 10 - 18
    isWeekend?: boolean;
    isOutOfHours?: boolean;
    outOfHoursMessage?: string;
    preferredPeriod?: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY';
    userConfirmedSlot?: boolean;
  } = {
    isDemoIntent: detectDemoSchedulingIntent(messageText),
    hasSpecificSlot: false,
  };

  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const prompt = `You are the Demo Scheduling Agent for ${brandName()}.
Current Date and Time (${TZL()}, ${tz()}): ${nowIst.dateString}, ${nowIst.hour}:${String(nowIst.minute).padStart(2, '0')}.
Current Day of Week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nowIst.dayOfWeek]}.

Demo working rules:
- Demos are ${daysLabel()} only. ${closedDaysLabel()} are strictly unavailable.
- Working hours are ${fmtHour(workStartH())} to ${fmtHour(workEndH())} ${TZL()} (${workStartH()}:00 to ${workEndH()}:00).
- Demos are 60 minutes long. Fixed start hours: ${slotHours().join(', ')}.
- ${workEndH()}:00 (${hrShort(workEndH())}) is NOT valid because the demo would end at ${hrShort(workEndH() + 1)}, which is after ${hrShort(workEndH())}. Latest start is ${workEndH() - 1}:00 (${hrShort(workEndH() - 1)}).

Conversation context:
${conversationHistory.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
USER'S LATEST MESSAGE: "${messageText}"

Analyze the conversation and latest message. Output JSON only:
{
  "isDemoIntent": boolean (true if user wants to schedule, reschedule, meet, see software, or is answering scheduling questions),
  "hasSpecificSlot": boolean (true if user requested a specific day and hour or agreed to a proposed slot),
  "dateString": string (YYYY-MM-DD resolved to future date in the company timezone, or null),
  "startHour": number (${workStartH()} to ${workEndH() - 1} integer in 24hr format, or null),
  "isWeekend": boolean (true if resolved date falls on a non-working day: ${closedDaysLabel()}),
  "isOutOfHours": boolean (true if user requested time outside ${workStartH()}:00 - ${workEndH() - 1}:00, e.g. ${hrShort(workStartH() - 1)} or ${hrShort(workEndH())}),
  "preferredPeriod": "MORNING" | "AFTERNOON" | "EVENING" | "ANY",
  "userConfirmedSlot": boolean (true if user said "yes", "sure", "that works", "let's do it", "confirm" to a previously proposed slot)
}`;

      const candidateModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
      let parsed: any = null;

      for (const modelName of candidateModels) {
        try {
          const completion = await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          });

          const content = completion.choices[0]?.message?.content;
          if (content) {
            parsed = JSON.parse(content.trim());
            if (parsed) break;
          }
        } catch (mErr: any) {
          console.warn(`[Demo Scheduling OpenAI ${modelName}] Notice:`, mErr?.message || mErr);
        }
      }

      if (parsed) {
        nlpResult = { ...nlpResult, ...parsed };
      }
    } catch (aiErr) {
      console.warn('[Demo Scheduling AI Fallback]: Proceeding with rule-based slot parsing');
    }
  }

  // Rule-based fallback checks if AI parsing did not find a slot
  if (!nlpResult.hasSpecificSlot) {
    const lower = messageText.toLowerCase();

    // 1. Date resolution (today, tomorrow, weekdays, earliest requests)
    if (
      lower.includes('earliest') ||
      lower.includes('asap') ||
      lower.includes('soonest') ||
      lower.includes('next available') ||
      lower.includes('first available') ||
      lower.includes('available slots')
    ) {
      nlpResult.dateString = nowIst.dateString;
      nlpResult.isDemoIntent = true;
    } else if (lower.includes('today') || lower.includes('tonight') || lower.includes('this evening') || lower.includes('this afternoon')) {
      nlpResult.dateString = nowIst.dateString;
      nlpResult.isDemoIntent = true;
    } else if (lower.includes('tomorrow')) {
      const nextDay = new Date();
      nextDay.setDate(nextDay.getDate() + 1);
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz() });
      nlpResult.dateString = f.format(nextDay);
      nlpResult.isDemoIntent = true;
    } else {
      const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      for (let i = 0; i < weekdays.length; i++) {
        if (lower.includes(weekdays[i])) {
          nlpResult.isDemoIntent = true;
          let diff = i - nowIst.dayOfWeek;
          if (diff === 0) {
            // Same weekday as today
            diff = nowIst.hour < workEndH() - 1 ? 0 : 7;
          } else if (diff < 0) {
            diff += 7;
          }
          const targetD = new Date();
          targetD.setDate(targetD.getDate() + diff);
          const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz() });
          nlpResult.dateString = f.format(targetD);
          if (!sb().workingDays.includes(i)) nlpResult.isWeekend = true;
          break;
        }
      }
    }

    // 2. Time resolution (e.g. "6 - 7", "6 to 7", "6-7", "6pm", "6:00", "18:00")
    const rangeMatch = lower.match(/(\d{1,2})(?::\d{2})?\s*(?:-|to|–)\s*(\d{1,2})/i);
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

    let foundHour: number | undefined = undefined;

    if (rangeMatch) {
      let rawH = parseInt(rangeMatch[1], 10);
      if (rawH >= 1 && rawH <= workEndH() - 12 - 1) rawH += 12; // 6 -> 18 (6 PM)
      if (rawH >= workStartH() && rawH <= workEndH() - 1) {
        foundHour = rawH;
      } else if (rawH < workStartH() || rawH >= workEndH()) {
        nlpResult.isOutOfHours = true;
      }
    } else if (timeMatch) {
      let rawH = parseInt(timeMatch[1], 10);
      const ampm = timeMatch[3]?.toLowerCase();
      if (ampm === 'pm' && rawH < 12) rawH += 12;
      else if (ampm === 'am' && rawH === 12) rawH = 0;
      else if (!ampm && rawH >= 1 && rawH <= workEndH() - 12 - 1) rawH += 12; // 6 -> 18 (6 PM)

      if (rawH >= workStartH() && rawH <= workEndH() - 1) {
        foundHour = rawH;
      } else if (rawH < workStartH() || rawH >= workEndH()) {
        nlpResult.isOutOfHours = true;
      }
    }

    if (foundHour !== undefined) {
      nlpResult.startHour = foundHour;
      nlpResult.isDemoIntent = true;
    }

    if (!nlpResult.dateString && nlpResult.isDemoIntent && !nlpResult.isWeekend) {
      nlpResult.dateString = nowIst.dateString;
    }

    if (nlpResult.dateString && nlpResult.startHour !== undefined && !nlpResult.isOutOfHours && !nlpResult.isWeekend) {
      nlpResult.hasSpecificSlot = true;
    }
  }

  // If user has NO demo intent, return unhandled
  if (!nlpResult.isDemoIntent) {
    return {
      handled: false,
      replyText: '',
      action: 'NOT_DEMO_INTENT',
    };
  }

  // 5. Check Duplicate Booking: Lead asks for demo, but is already booked
  if (activeBooking && !isRescheduleIntent && !nlpResult.hasSpecificSlot) {
    return {
      handled: true,
      action: 'ALREADY_BOOKED',
      replyText: `You already have a ${brandName()} demo scheduled for ${activeBooking.date} from ${activeBooking.startTime} – ${activeBooking.endTime} ${TZL()}.\n\n• Google Meet Link: ${activeBooking.googleMeetLink}\n\nWould you like to reschedule it to another date or time?`,
    };
  }

  // 6. REQUIREMENT 2: When lead asks for demo scheduling, FIRST refer to Google Calendar,
  // check earliest available slots and suggest them!
  if (!nlpResult.hasSpecificSlot && !nlpResult.isWeekend && !nlpResult.isOutOfHours) {
    const suggestions = await findNextAvailableSlots({
      preferredDate: nlpResult.dateString,
      preferredPeriod: nlpResult.preferredPeriod,
      maxSlotsToReturn: 4,
      accessToken,
    });

    if (suggestions.length > 0) {
      const slotsText = suggestions.map((s) => `• ${s.label}`).join('\n');
      return {
        handled: true,
        action: 'OFFERED_ALTERNATIVES',
        replyText: `I would be glad to arrange a live walkthrough of ${brandName()} for ${companyName}! Here are our earliest available slots directly from our calendar:\n\n${slotsText}\n\nWhich of these works best for you? (Or let me know another preferred timing between ${fmtHour(workStartH())} and ${fmtHour(workEndH())} ${TZL()}, ${daysLabel()}).`,
      };
    }

    return {
      handled: true,
      action: 'ASKED_AVAILABILITY',
      replyText: `I would be happy to schedule a demo of ${brandName()} for ${companyName}! Our demo slots run ${daysLabel()} between ${fmtHour(workStartH())} and ${fmtHour(workEndH())} ${TZL()} (1-hour duration). What day and time work best for you?`,
    };
  }

  // 7. Weekend Validation
  if (nlpResult.isWeekend) {
    const suggestions = await findNextAvailableSlots({ maxSlotsToReturn: 3, accessToken });
    const alternativesText = suggestions.map((s) => `• ${s.label}`).join('\n');

    return {
      handled: true,
      action: 'WEEKEND_NOT_ALLOWED',
      replyText: `Our demo team operates ${daysLabel().replace(' to ', ' through ')} between ${hrShort(workStartH())} and ${hrShort(workEndH())} ${TZL()}, so ${closedDaysLabel()} are unavailable. I can offer these upcoming weekday slots instead:\n\n${alternativesText}\n\nWould one of these work for you?`,
    };
  }

  // 8. Business Hours Validation (10 AM to 7 PM IST, with 6 PM as latest start)
  if (nlpResult.isOutOfHours) {
    const suggestions = await findNextAvailableSlots({
      preferredDate: nlpResult.dateString || nowIst.dateString,
      maxSlotsToReturn: 3,
      accessToken,
    });
    const alternativesText = suggestions.map((s) => `• ${s.label}`).join('\n');

    return {
      handled: true,
      action: 'HOURS_NOT_ALLOWED',
      replyText: `Our demo hours are ${fmtHour(workStartH())} to ${fmtHour(workEndH())} ${TZL()} (${daysLabel()}). Since each demo is a full 60-minute walkthrough, the latest slot starts at ${fmtHour(workEndH() - 1)} (finishing at ${fmtHour(workEndH())}). Here are our available slots:\n\n${alternativesText}\n\nWhich slot would you prefer?`,
    };
  }

  // 9. Lead provided a specific valid slot: Check Google Calendar in REALTIME
  const targetDateStr = nlpResult.dateString || nowIst.dateString;
  const startH = nlpResult.startHour !== undefined ? nlpResult.startHour : 15;
  const startIso = createIstIsoString(targetDateStr, startH, 0);
  const endIso = createIstIsoString(targetDateStr, startH + 1, 0);
  const startTimeStr = `${String(startH).padStart(2, '0')}:00`;
  const endTimeStr = `${String(startH + 1).padStart(2, '0')}:00`;

  const availability = await checkRealtimeGoogleCalendarSlot(startIso, endIso, accessToken);

  // 10. IF SLOT IS AVAILABLE ON GOOGLE CALENDAR: BOOK IMMEDIATELY!
  if (availability.available) {
    if (isRescheduleIntent && activeBooking) {
      // Reschedule existing booking
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
        const slotLabel = formatSlotLabel(targetDateStr, startH);
        return {
          handled: true,
          action: 'RESCHEDULED',
          booking: resched.booking,
          replyText: `You're all set! Your ${brandName()} demo has been rescheduled to ${slotLabel}.\n\n• Google Meet Link: ${resched.booking.googleMeetLink}\n• Company: ${companyName}\n• Attendee: ${leadName} (${leadEmail || 'Email invite updated'})\n• Timezone: ${tzDisplay()}\n\nWe have sent the updated calendar invitation to your email. We look forward to demonstrating how ${sb().playbook === 'umrah360' ? 'Umrah360 automates your pilgrimage operations' : `${brandName()} can help your business`}!`,
        };
      }
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
      const slotLabel = formatSlotLabel(targetDateStr, startH);
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

      return {
        handled: true,
        action: 'CONFIRMED_BOOKING',
        booking: bookingResult.booking,
        replyText,
      };
    } else if (bookingResult.conflict) {
      // Slot was booked in a race condition
      const alternatives = await findNextAvailableSlots({
        preferredDate: targetDateStr,
        maxSlotsToReturn: 3,
        accessToken,
      });
      const altText = alternatives.map((s) => `• ${s.label}`).join('\n');

      return {
        handled: true,
        action: 'OFFERED_ALTERNATIVES',
        replyText: `That slot was just booked by another attendee. Here are our earliest available slots instead:\n\n${altText}\n\nWhich one would you prefer?`,
      };
    }
  }

  // 11. REQUIREMENT 2: IF SLOT IS OCCUPIED ON GOOGLE CALENDAR:
  // Reply that slot is already booked and suggest earliest available slots from Google Calendar!
  const slotLabel = formatSlotLabel(targetDateStr, startH);
  const alternatives = await findNextAvailableSlots({
    preferredDate: targetDateStr,
    maxSlotsToReturn: 4,
    accessToken,
  });

  const altList = alternatives.map((s) => `• ${s.label}`).join('\n');

  return {
    handled: true,
    action: 'OFFERED_ALTERNATIVES',
    replyText: `${slotLabel} is already booked on our calendar. Here are our earliest available slots instead:\n\n${altList}\n\nWhich one would you prefer?`,
  };
}

/**
 * Returns all stored demo bookings from Firestore.
 */
export async function getAllBookings(): Promise<Booking[]> {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const q = query(tenantRepo(getSchedCtx()).bookings(), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Booking);
  } catch (e) {
    console.warn('[Calendar Service Notice] Error listing bookings:', e);
    return [];
  }
}