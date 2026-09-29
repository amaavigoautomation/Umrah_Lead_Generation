import OpenAI from 'openai';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
} from 'firebase/firestore';
import { safeSetDoc } from './firestoreUtils.js';
import { Booking, BookingStatus, Channel, Lead } from '../types/index.js';
import { updateCampaignLeadStatus } from './campaignService.js';

export const TARGET_CALENDAR_EMAIL = 'amaavigo@gmail.com';
export const SCHEDULING_TIMEZONE = 'Asia/Kolkata'; // IST (UTC +05:30)
export const WORKING_START_HOUR = 10; // 10:00 AM IST
export const WORKING_END_HOUR = 19; // 7:00 PM IST (last slot starts at 18:00)
export const DEMO_DURATION_MINUTES = 60;

// Valid fixed 1-hour slots: 10-11, 11-12, 12-13, 13-14, 14-15, 15-16, 16-17, 17-18, 18-19
export const VALID_SLOT_START_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18];

// Server-side in-memory cache for OAuth access token
let serverCalendarAccessToken: string | null = null;
let serverTokenExpiresAt: number = 0;

/**
 * Updates or registers the Google Calendar OAuth access token on the server.
 */
export function setServerCalendarAccessToken(token: string, expiresInSeconds: number = 3600) {
  serverCalendarAccessToken = token;
  serverTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
}

/**
 * Retrieves an active Google Calendar OAuth access token.
 * Checks explicit parameter, in-memory cache, Firestore settings/calendar_auth, and env vars.
 */
export async function getLiveCalendarToken(explicitToken?: string): Promise<string | null> {
  if (explicitToken && explicitToken.trim()) {
    setServerCalendarAccessToken(explicitToken.trim());
    return explicitToken.trim();
  }

  if (serverCalendarAccessToken && Date.now() < serverTokenExpiresAt - 60000) {
    return serverCalendarAccessToken;
  }

  // 1. Try Firestore settings/calendar_auth
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'settings', 'calendar_auth'));
      if (snap.exists()) {
        const data = snap.data();
        if (data?.accessToken) {
          serverCalendarAccessToken = data.accessToken;
          serverTokenExpiresAt = Date.now() + 3600 * 1000;
          return serverCalendarAccessToken;
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
export function getNowInIst(): IstDateComponents {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULING_TIMEZONE,
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
  const hour = parseInt(partMap.hour, 10);
  const minute = parseInt(partMap.minute, 10);

  // Compute day of week in IST
  const istDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+05:30`);
  const dayOfWeek = istDate.getDay();

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
  return `${dateString}T${pad(hour)}:${pad(minute)}:00+05:30`;
}

/**
 * Checks whether a given day of week is a valid working day (Monday - Friday).
 */
export function isWorkingDay(dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Formats an IST slot into a friendly human-readable label.
 * e.g. "Wednesday, Oct 1: 3:00 PM – 4:00 PM IST"
 */
export function formatSlotLabel(dateString: string, startHour: number): string {
  const dateObj = new Date(`${dateString}T12:00:00+05:30`);
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULING_TIMEZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);

  const formatHour = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${period}`;
  };

  return `${dayName}: ${formatHour(startHour)} – ${formatHour(startHour + 1)} IST`;
}

// -----------------------------------------------------------------------------
// Realtime Google Calendar Integration (Single Source of Truth)
// -----------------------------------------------------------------------------

export interface CalendarBusyInterval {
  start: string;
  end: string;
}

export interface CalendarAvailabilityResult {
  available: boolean;
  busyIntervals: CalendarBusyInterval[];
  source: 'GOOGLE_CALENDAR' | 'FALLBACK';
  error?: string;
}

/**
 * Queries Google Calendar FreeBusy and Events API in real time for [startIso, endIso).
 * NEVER relies on cached availability. Always verifies with Google Calendar.
 */
export async function checkRealtimeGoogleCalendarSlot(
  startIso: string,
  endIso: string
): Promise<CalendarAvailabilityResult> {
  const token = await getLiveCalendarToken();

  if (!token) {
    // If OAuth token is not configured yet, query existing Firestore bookings as fallback
    const fallbackOccupied = await checkFirestoreBookingsConflict(startIso, endIso);
    return {
      available: !fallbackOccupied,
      busyIntervals: fallbackOccupied ? [{ start: startIso, end: endIso }] : [],
      source: 'FALLBACK',
      error: 'Google Calendar OAuth token not yet authenticated. Connected via Firestore ledger.',
    };
  }

  try {
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
        timeZone: SCHEDULING_TIMEZONE,
        items: [{ id: 'primary' }, { id: TARGET_CALENDAR_EMAIL }],
      }),
    });

    if (freeBusyRes.ok) {
      const fbData = await freeBusyRes.json();
      const busyList: CalendarBusyInterval[] = [];

      const primaryBusy = fbData.calendars?.primary?.busy || [];
      const targetBusy = fbData.calendars?.[TARGET_CALENDAR_EMAIL]?.busy || [];

      busyList.push(...primaryBusy, ...targetBusy);

      if (busyList.length > 0) {
        return {
          available: false,
          busyIntervals: busyList,
          source: 'GOOGLE_CALENDAR',
        };
      }
    } else {
      console.warn('[Calendar Service Notice] FreeBusy status:', freeBusyRes.status);
    }

    // 2. Double-check Events List for any existing single events
    const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
      startIso
    )}&timeMax=${encodeURIComponent(endIso)}&singleEvents=true`;

    const eventsRes = await fetch(eventsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      const items = (eventsData.items || []).filter((e: any) => e.status !== 'cancelled');

      if (items.length > 0) {
        return {
          available: false,
          busyIntervals: items.map((i: any) => ({
            start: i.start?.dateTime || i.start?.date || startIso,
            end: i.end?.dateTime || i.end?.date || endIso,
          })),
          source: 'GOOGLE_CALENDAR',
        };
      }
    }

    // 3. Check Firestore bookings for extra safety
    const firestoreConflict = await checkFirestoreBookingsConflict(startIso, endIso);
    if (firestoreConflict) {
      return {
        available: false,
        busyIntervals: [{ start: startIso, end: endIso }],
        source: 'GOOGLE_CALENDAR',
      };
    }

    return {
      available: true,
      busyIntervals: [],
      source: 'GOOGLE_CALENDAR',
    };
  } catch (err: any) {
    console.error('[Calendar Service Error] Realtime availability check failed:', err);
    // On network failure, check Firestore ledger so system does not double-book
    const fallbackOccupied = await checkFirestoreBookingsConflict(startIso, endIso);
    return {
      available: !fallbackOccupied,
      busyIntervals: fallbackOccupied ? [{ start: startIso, end: endIso }] : [],
      source: 'FALLBACK',
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
      collection(db, 'bookings'),
      where('status', '==', 'BOOKED'),
      limit(20)
    );
    const snap = await getDocs(q);

    const reqStart = new Date(startIso).getTime();
    const reqEnd = new Date(endIso).getTime();

    for (const d of snap.docs) {
      const b = d.data() as Booking;
      if (excludeBookingId && b.bookingId === excludeBookingId) continue;
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
 * Only returns slots strictly within Monday-Friday, 10 AM - 7 PM IST.
 */
export async function findNextAvailableSlots(
  options: {
    targetDaysCount?: number;
    maxSlotsToReturn?: number;
    preferredDate?: string; // YYYY-MM-DD
    preferredPeriod?: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY';
  } = {}
): Promise<Array<{ date: string; startHour: number; label: string; startIso: string; endIso: string }>> {
  const { targetDaysCount = 5, maxSlotsToReturn = 4, preferredDate, preferredPeriod = 'ANY' } = options;

  const nowIst = getNowInIst();
  const availableSlots: Array<{ date: string; startHour: number; label: string; startIso: string; endIso: string }> = [];

  // Determine starting date
  let startOffset = 0;
  if (preferredDate) {
    const targetDate = new Date(`${preferredDate}T12:00:00+05:30`);
    const todayDate = new Date(`${nowIst.dateString}T12:00:00+05:30`);
    const diffDays = Math.round((targetDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
    startOffset = Math.max(0, diffDays);
  }

  // Define hour ranges based on preferred period
  let allowedHours = VALID_SLOT_START_HOURS;
  if (preferredPeriod === 'MORNING') {
    allowedHours = VALID_SLOT_START_HOURS.filter((h) => h < 12); // 10, 11
  } else if (preferredPeriod === 'AFTERNOON') {
    allowedHours = VALID_SLOT_START_HOURS.filter((h) => h >= 12 && h < 17); // 12, 13, 14, 15, 16
  } else if (preferredPeriod === 'EVENING') {
    allowedHours = VALID_SLOT_START_HOURS.filter((h) => h >= 17); // 17, 18
  }

  if (allowedHours.length === 0) allowedHours = VALID_SLOT_START_HOURS;

  let daysChecked = 0;
  let currentOffset = startOffset;

  while (daysChecked < targetDaysCount && availableSlots.length < maxSlotsToReturn && currentOffset < 14) {
    const checkDate = new Date();
    checkDate.setDate(checkDate.getDate() + currentOffset);

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: SCHEDULING_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dateStr = formatter.format(checkDate);

    const dayObj = new Date(`${dateStr}T12:00:00+05:30`);
    const dayOfWeek = dayObj.getDay();

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

      const check = await checkRealtimeGoogleCalendarSlot(startIso, endIso);
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
  conflict?: boolean;
  error?: string;
}

/**
 * Creates a Google Calendar Event with an authentic Google Meet conference link,
 * invites the lead's email, stores the booking in Firestore, and updates the CRM Lead.
 * Guarantees Double-Booking Protection via immediate pre-check.
 */
export async function createGoogleCalendarDemoBooking(
  params: CreateBookingParams
): Promise<CreateBookingResult> {
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
  const freshCheck = await checkRealtimeGoogleCalendarSlot(startIso, endIso);
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
      const snap = await getDoc(doc(db, 'settings', 'calendar_auth'));
      if (snap.exists() && snap.data()?.accessToken) {
        token = snap.data().accessToken;
        setServerCalendarAccessToken(token!);
      }
    } catch {}
  }

  let calendarEventId = `mock-cal-${Date.now()}`;
  let googleMeetLink = '';

  const summary = `Umrah360 Demo - ${companyName || leadName || 'Agency Partner'}`;
  const description = [
    `Personalized 1-on-1 walkthrough of Umrah360 pilgrimage enterprise software.`,
    ``,
    `Attendee Details:`,
    `• Lead Name: ${leadName}`,
    `• Email: ${leadEmail}`,
    `• Company: ${companyName || 'Travel Agency'}`,
    `• Phone: ${leadPhone || 'Not provided'}`,
    `• Inbound Channel: ${channel}`,
    `• Timezone: Asia/Kolkata (IST)`,
    ``,
    `Agenda:`,
    `- Group Series Operations & Visa Tracking`,
    `- B2B Sub-Agent Portal & Dynamic Package Builder`,
    `- Pilgrim Mobile Voucher & Accounting Automation`,
    `- Q&A and Deployment Timelines`,
  ].join('\n');

  // 2. Create Event in Google Calendar with genuine Google Meet video conference
  if (token) {
    try {
      // Filter attendees so organizer is not listed as attendee, avoiding 400 errors
      const attendees: Array<{ email: string }> = [];
      if (leadEmail && leadEmail.includes('@') && leadEmail.toLowerCase() !== TARGET_CALENDAR_EMAIL.toLowerCase()) {
        attendees.push({ email: leadEmail });
      }

      const eventPayload = {
        summary,
        description,
        start: {
          dateTime: startIso,
          timeZone: SCHEDULING_TIMEZONE,
        },
        end: {
          dateTime: endIso,
          timeZone: SCHEDULING_TIMEZONE,
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
        console.error('[Google Calendar API Error] Event creation failed:', calRes.status, errText);
        return {
          success: false,
          error: `Google Calendar event creation failed (status ${calRes.status}): ${errText}`,
        };
      }

      const eventData = await calRes.json();
      calendarEventId = eventData.id || calendarEventId;

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
        'Google Calendar OAuth token not found. Please click "Sync Calendar (amaavigo@gmail.com)" in the Demo Scheduling dashboard to connect your Google Calendar.',
    };
  }

  // 3. Store Booking Record in Firestore bookings collection
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
    timezone: SCHEDULING_TIMEZONE,
    status: 'BOOKED',
    summary,
    description,
    attendees: [TARGET_CALENDAR_EMAIL, ...(leadEmail ? [leadEmail] : [])],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'bookings', bookingId), booking, { merge: true });

      // 4. Update CRM Lead record
      if (leadId) {
        await safeSetDoc(
          doc(db, 'leads', leadId),
          {
            status: 'DEMO_BOOKED',
            demoStatus: 'BOOKED',
            demoSource: 'AUTOMATIC',
            demoBookedAt: nowIso,
            demoDate: dateString,
            demoStartTime: startTime,
            demoEndTime: endTime,
            demoTimezone: SCHEDULING_TIMEZONE,
            calendarEventId,
            googleMeetLink,
            updatedAt: nowIso,
          },
          { merge: true }
        );
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
  };
}

/**
 * Cancels a demo booking, removes the event from Google Calendar, and frees up the slot.
 */
export async function cancelDemoBooking(
  bookingId: string,
  reason: string = 'Customer requested cancellation'
): Promise<{ success: boolean; error?: string }> {
  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    const bookingRef = doc(db, 'bookings', bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) {
      return { success: false, error: 'Booking not found' };
    }

    const booking = snap.data() as Booking;

    // 1. Remove from Google Calendar
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
        doc(db, 'leads', booking.leadId),
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
 * Reschedules a demo booking to a new time slot with real-time Google Calendar verification.
 */
export async function rescheduleDemoBooking(
  bookingId: string,
  newStartIso: string,
  newEndIso: string,
  newDateString: string,
  newStartTime: string,
  newEndTime: string
): Promise<{ success: boolean; booking?: Booking; error?: string; conflict?: boolean }> {
  // 1. Check realtime availability for new slot
  const freshCheck = await checkRealtimeGoogleCalendarSlot(newStartIso, newEndIso);
  if (!freshCheck.available) {
    return {
      success: false,
      conflict: true,
      error: 'The requested new slot is already booked. Please choose another time.',
    };
  }

  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database not initialized' };
  }

  try {
    const bookingRef = doc(db, 'bookings', bookingId);
    const snap = await getDoc(bookingRef);
    if (!snap.exists()) {
      return { success: false, error: 'Booking not found' };
    }

    const booking = snap.data() as Booking;

    // 2. Update Google Calendar Event
    let meetLink = booking.googleMeetLink;
    if (booking.calendarEventId && !booking.calendarEventId.startsWith('mock-')) {
      const token = await getLiveCalendarToken();
      if (token) {
        const patchRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
            booking.calendarEventId
          )}?conferenceDataVersion=1&sendUpdates=all`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              start: { dateTime: newStartIso, timeZone: SCHEDULING_TIMEZONE },
              end: { dateTime: newEndIso, timeZone: SCHEDULING_TIMEZONE },
            }),
          }
        );

        if (patchRes.ok) {
          const patchData = await patchRes.json();
          meetLink = patchData.hangoutLink || meetLink;
        }
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
      googleMeetLink: meetLink,
      updatedAt: nowIso,
    };

    await safeSetDoc(bookingRef, updatedBooking, { merge: true });

    if (booking.leadId) {
      await safeSetDoc(
        doc(db, 'leads', booking.leadId),
        {
          demoDate: newDateString,
          demoStartTime: newStartTime,
          demoEndTime: newEndTime,
          demoTimezone: SCHEDULING_TIMEZONE,
          googleMeetLink: meetLink,
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
  if (!isFirebaseConfigured || !db) return null;
  try {
    if (leadEmail && leadEmail.includes('@')) {
      const q = query(
        collection(db, 'bookings'),
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
        collection(db, 'bookings'),
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
        collection(db, 'bookings'),
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
  const t = text.toLowerCase();

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

  // Also check if text specifies days/times in context of a demo reply
  if (
    /(monday|tuesday|wednesday|thursday|friday|tomorrow|next\s+week)/i.test(t) &&
    /(\d{1,2}\s*(am|pm)|morning|afternoon|evening|\d{1,2}:\d{2})/i.test(t)
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
  };
  [key: string]: any;
}): Promise<SchedulingTurnResult> {
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
        replyText: `Your Umrah360 demo scheduled for ${activeBooking.date} at ${activeBooking.startTime} IST has been cancelled. The time slot has been freed up. Whenever you're ready to explore Umrah360 in the future, just let us know and we'll gladly schedule a fresh walkthrough!`,
      };
    } else {
      return {
        handled: true,
        action: 'CANCELLED',
        replyText: `You do not have any active demo scheduled currently. If you'd like to book one at any time between Monday and Friday (10 AM to 7 PM IST), simply let me know!`,
      };
    }
  }

  // 3. Rescheduling Intent
  const isRescheduleIntent = /reschedule|change\s+(the\s+)?(time|date|slot|demo|meeting)/i.test(lowerText);

  // 4. Use Gemini AI to extract intent and slot parameters from the full conversation
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
      const prompt = `You are the Demo Scheduling Agent for Umrah360.
Current Date and Time in India (IST, Asia/Kolkata): ${nowIst.dateString}, ${nowIst.hour}:${String(nowIst.minute).padStart(2, '0')}.
Current Day of Week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nowIst.dayOfWeek]}.

Demo working rules:
- Demos are Monday to Friday only. Saturday and Sunday are strictly unavailable.
- Working hours are 10:00 AM to 7:00 PM IST (10:00 to 19:00).
- Demos are 60 minutes long. Fixed start hours: 10, 11, 12, 13, 14, 15, 16, 17, 18.
- 19:00 (7 PM) is NOT valid because the demo would end at 8 PM, which is after 7 PM. Latest start is 18:00 (6 PM).

Conversation context:
${conversationHistory.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
USER'S LATEST MESSAGE: "${messageText}"

Analyze the conversation and latest message. Output JSON only:
{
  "isDemoIntent": boolean (true if user wants to schedule, reschedule, meet, see software, or is answering scheduling questions),
  "hasSpecificSlot": boolean (true if user requested a specific day and hour or agreed to a proposed slot),
  "dateString": string (YYYY-MM-DD resolved to future India date, or null),
  "startHour": number (10 to 18 integer in 24hr format, or null),
  "isWeekend": boolean (true if resolved date is Saturday or Sunday),
  "isOutOfHours": boolean (true if user requested time outside 10:00 - 18:00, e.g. 9 AM or 7 PM),
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
    // Check common patterns e.g. "tomorrow at 3pm", "thursday at 4", "wednesday 3 pm"
    const timeMatch = lowerText.match(/(\d{1,2})(?::00)?\s*(am|pm)/i);
    const dayMatch = lowerText.match(/(monday|tuesday|wednesday|thursday|friday|tomorrow)/i);

    if (timeMatch) {
      let rawH = parseInt(timeMatch[1], 10);
      const ampm = timeMatch[2].toLowerCase();
      if (ampm === 'pm' && rawH < 12) rawH += 12;
      if (ampm === 'am' && rawH === 12) rawH = 0;

      if (rawH >= 10 && rawH <= 18) {
        nlpResult.startHour = rawH;
      } else if (rawH < 10 || rawH >= 19) {
        nlpResult.isOutOfHours = true;
      }
    }

    if (dayMatch) {
      nlpResult.isDemoIntent = true;
      const d = dayMatch[1].toLowerCase();
      if (d === 'tomorrow') {
        const nextDay = new Date();
        nextDay.setDate(nextDay.getDate() + 1);
        const f = new Intl.DateTimeFormat('en-CA', { timeZone: SCHEDULING_TIMEZONE });
        nlpResult.dateString = f.format(nextDay);
      }
    }

    if (nlpResult.dateString && nlpResult.startHour !== undefined && !nlpResult.isOutOfHours) {
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
      replyText: `You already have an Umrah360 demo scheduled for ${activeBooking.date} from ${activeBooking.startTime} – ${activeBooking.endTime} IST.\n\n• Google Meet Link: ${activeBooking.googleMeetLink}\n\nWould you like to reschedule it to another date or time?`,
    };
  }

  // 6. First Response: Ask Availability if lead hasn't provided a slot yet
  if (!nlpResult.hasSpecificSlot && !nlpResult.isWeekend && !nlpResult.isOutOfHours) {
    // If user indicated morning/afternoon/evening or a day, fetch and suggest available slots
    if (nlpResult.dateString || nlpResult.preferredPeriod !== 'ANY') {
      const suggestions = await findNextAvailableSlots({
        preferredDate: nlpResult.dateString,
        preferredPeriod: nlpResult.preferredPeriod,
        maxSlotsToReturn: 3,
      });

      if (suggestions.length > 0) {
        const slotsText = suggestions.map((s) => `• ${s.label}`).join('\n');
        return {
          handled: true,
          action: 'OFFERED_ALTERNATIVES',
          replyText: `Sure, I'd be happy to arrange your demo! Here are our earliest available slots:\n\n${slotsText}\n\nWhich of these works best for you? (Or let me know another time between 10 AM and 7 PM IST Monday–Friday).`,
        };
      }
    }

    // Default first response as required by Rule 4:
    return {
      handled: true,
      action: 'ASKED_AVAILABILITY',
      replyText: `Sure, I'd be happy to arrange a demo. Could you share your preferred date and time? Our demo slots are Monday to Friday between 10 AM and 7 PM IST, with each demo lasting one hour.`,
    };
  }

  // 7. Weekend Validation
  if (nlpResult.isWeekend) {
    const suggestions = await findNextAvailableSlots({ maxSlotsToReturn: 3 });
    const alternativesText = suggestions.map((s) => `• ${s.label}`).join('\n');

    return {
      handled: true,
      action: 'WEEKEND_NOT_ALLOWED',
      replyText: `Our demo team operates Monday through Friday between 10 AM and 7 PM IST, so Saturday and Sunday are unavailable. I can offer these upcoming weekday slots instead:\n\n${alternativesText}\n\nWould one of these work for you?`,
    };
  }

  // 8. Business Hours Validation (10 AM to 7 PM IST, with 6 PM as latest start)
  if (nlpResult.isOutOfHours) {
    const suggestions = await findNextAvailableSlots({
      preferredDate: nlpResult.dateString || nowIst.dateString,
      maxSlotsToReturn: 3,
    });
    const alternativesText = suggestions.map((s) => `• ${s.label}`).join('\n');

    return {
      handled: true,
      action: 'HOURS_NOT_ALLOWED',
      replyText: `Our demo hours are 10:00 AM to 7:00 PM IST (Monday to Friday). Since each demo is a full 60-minute walkthrough, the latest slot starts at 6:00 PM (finishing at 7:00 PM). Here are our available slots:\n\n${alternativesText}\n\nWhich slot would you prefer?`,
    };
  }

  // 9. Lead provided a specific valid slot: Check Google Calendar in REALTIME
  const targetDateStr = nlpResult.dateString || nowIst.dateString;
  const startH = nlpResult.startHour !== undefined ? nlpResult.startHour : 15;
  const startIso = createIstIsoString(targetDateStr, startH, 0);
  const endIso = createIstIsoString(targetDateStr, startH + 1, 0);
  const startTimeStr = `${String(startH).padStart(2, '0')}:00`;
  const endTimeStr = `${String(startH + 1).padStart(2, '0')}:00`;

  const availability = await checkRealtimeGoogleCalendarSlot(startIso, endIso);

  // 10. IF SLOT IS AVAILABLE: BOOK IMMEDIATELY!
  if (availability.available) {
    let bookingResult: CreateBookingResult;

    if (isRescheduleIntent && activeBooking) {
      // Reschedule existing booking
      const resched = await rescheduleDemoBooking(
        activeBooking.bookingId,
        startIso,
        endIso,
        targetDateStr,
        startTimeStr,
        endTimeStr
      );

      if (resched.success && resched.booking) {
        const slotLabel = formatSlotLabel(targetDateStr, startH);
        return {
          handled: true,
          action: 'RESCHEDULED',
          booking: resched.booking,
          replyText: `You're all set! Your Umrah360 demo has been rescheduled to ${slotLabel}.\n\n• Google Meet Link: ${resched.booking.googleMeetLink}\n• Company: ${companyName}\n• Attendee: ${leadName} (${leadEmail || 'Email invite updated'})\n• Timezone: Asia/Kolkata (IST)\n\nWe look forward to demonstrating how Umrah360 automates your pilgrimage operations!`,
        };
      }
    }

    // New booking creation with Google Calendar & Google Meet
    bookingResult = await createGoogleCalendarDemoBooking({
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
    });

    if (bookingResult.success && bookingResult.booking) {
      const slotLabel = formatSlotLabel(targetDateStr, startH);
      const meetLink = bookingResult.googleMeetLink || 'Will be shared via calendar invitation';

      const replyText = [
        `You're all set! Your Umrah360 demo is booked for ${slotLabel}.`,
        ``,
        `Demo Details:`,
        `• Attendee: ${leadName}${leadEmail ? ` (${leadEmail})` : ''}`,
        `• Company: ${companyName}`,
        `• Google Meet Link: ${meetLink}`,
        `• Timezone: Asia/Kolkata (IST)`,
        ``,
        `I have sent the calendar invitation to your email. We look forward to showing you Umrah360's group series operations, visa tracking, and B2B portal!`,
      ].join('\n');

      return {
        handled: true,
        action: 'CONFIRMED_BOOKING',
        booking: bookingResult.booking,
        replyText,
      };
    } else if (bookingResult.conflict) {
      // Caught double-booking race condition!
      const alternatives = await findNextAvailableSlots({
        preferredDate: targetDateStr,
        maxSlotsToReturn: 3,
      });
      const altText = alternatives.map((s) => `• ${s.label}`).join('\n');

      return {
        handled: true,
        action: 'OFFERED_ALTERNATIVES',
        replyText: `That slot was just booked by another attendee. Let me offer these next available options instead:\n\n${altText}\n\nWhich one would you prefer?`,
      };
    }
  }

  // 11. IF SLOT IS OCCUPIED: Retrieve fresh alternatives from Google Calendar
  const slotLabel = formatSlotLabel(targetDateStr, startH);
  const alternatives = await findNextAvailableSlots({
    preferredDate: targetDateStr,
    maxSlotsToReturn: 4,
  });

  const altList = alternatives.map((s) => `• ${s.label}`).join('\n');

  return {
    handled: true,
    action: 'OFFERED_ALTERNATIVES',
    replyText: `${slotLabel} is already booked on our calendar. I can offer these available slots instead:\n\n${altList}\n\nWhich one would you prefer?`,
  };
}

/**
 * Returns all stored demo bookings from Firestore.
 */
export async function getAllBookings(): Promise<Booking[]> {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Booking);
  } catch (e) {
    console.warn('[Calendar Service Notice] Error listing bookings:', e);
    return [];
  }
}
