import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { DAY_NAMES, brandTzLabel, brandWorkingDaysLabel, brandWorkingWindowLabel, fmtHour, workingHoursForDay, timezoneLabelFor } from '../shared/brand';
import {
  Calendar,
  Video,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  XCircle,
  User,
  Mail,
  Building,
  Phone,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Globe,
  UserPlus,
  Users,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CalendarClock,
  Search,
  List,
  CalendarDays,
  Settings2,
  Link2,
  Check,
  X,
  ClipboardList,
  Copy,
  Filter,
  ArrowUpRight,
  AlertTriangle,
  Building2,
  UserRoundCheck,
} from 'lucide-react';
import { Booking, Channel, Contact, Lead } from '../types/index.js';
import {
  signInWithGoogleCalendar,
  getCalendarAccessToken,
  registerCalendarAccessToken,
  initCalendarAuth,
  hasCalendarToken,
  CALENDAR_TARGET_ACCOUNT,
} from '../services/googleCalendarAuth.js';

type SchedulingView = 'CALENDAR' | 'BOOKINGS' | 'AVAILABILITY' | 'INTEGRATIONS' | 'SIMULATOR';
type SchedulingCalendarMode = 'WEEK' | 'DAY' | 'AGENDA';

const dateKeyInTimezone = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (key: string) => parts.find((entry) => entry.type === key)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const addDateKeyDays = (dateKey: string, amount: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount, 12)).toISOString().slice(0, 10);
};
const mondayOfDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return addDateKeyDays(dateKey, -((weekday + 6) % 7));
};
const formatDateKey = (dateKey: string, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...options }).format(new Date(`${dateKey}T12:00:00.000Z`));

const getIanaTimeZones = (): string[] => {
  const intlWithTimeZones = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const supported = intlWithTimeZones.supportedValuesOf?.('timeZone') || [
    'Africa/Cairo', 'Africa/Johannesburg', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/New_York', 'America/Phoenix', 'America/Sao_Paulo',
    'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Kuala_Lumpur',
    'Asia/Riyadh', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo',
    'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Melbourne', 'Australia/Perth',
    'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Dublin', 'Europe/London',
    'Europe/Madrid', 'Europe/Paris', 'Europe/Rome', 'Europe/Zurich',
    'Pacific/Auckland', 'Pacific/Honolulu',
  ];
  return Array.from(new Set(['UTC', 'Asia/Kolkata', ...supported])).sort((a, b) => a.localeCompare(b));
};

const IANA_TIME_ZONES = getIanaTimeZones();

interface DemoSchedulingViewProps {
  leads?: Lead[];
  contacts?: Contact[];
  tenantId: string;
  canEditSettings: boolean;
  onLeadDemoBooked?: (leadId: string, booking: Booking) => void;
}

export const DemoSchedulingView: React.FC<DemoSchedulingViewProps> = ({ leads = [], contacts = [], tenantId, canEditSettings, onLeadDemoBooked }) => {
  const { brand, setBrand } = useBrand();
  const [availabilityDraft, setAvailabilityDraft] = useState<TenantBrand>(brand);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [availabilitySaveMessage, setAvailabilitySaveMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<SchedulingView>('CALENDAR');
  const [calendarMode, setCalendarMode] = useState<SchedulingCalendarMode>('DAY');
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => dateKeyInTimezone(new Date(), brand.timezone || 'Asia/Kolkata'));
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<'ALL' | 'UPCOMING' | Booking['status']>('ALL');
  const [bookingChannelFilter, setBookingChannelFilter] = useState<'ALL' | Channel>('ALL');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [bookingDetailsTab, setBookingDetailsTab] = useState<'DETAILS' | 'ATTENDEES'>('DETAILS');
  useEffect(() => setAvailabilityDraft(brand), [brand]);

  const updateAvailabilityText = (field: 'calendarEmail', value: string) => {
    setAvailabilityDraft((current) => ({ ...current, [field]: value }));
  };
  const updateAvailabilityTimezone = (timezone: string) => {
    setAvailabilityDraft((current) => ({ ...current, timezone, timezoneLabel: timezoneLabelFor(timezone) }));
  };
  const toggleAvailabilityDay = (dayIndex: number) => {
    setAvailabilityDraft((current) => ({
      ...current,
      workingDays: current.workingDays.includes(dayIndex)
        ? current.workingDays.filter((day) => day !== dayIndex)
        : [...current.workingDays, dayIndex].sort((a, b) => a - b),
    }));
  };
  const updateAvailabilityHours = (dayIndex: number, field: 'start' | 'end', value: number) => {
    setAvailabilityDraft((current) => {
      const hours = workingHoursForDay(current, dayIndex);
      return { ...current, workingHoursByDay: { ...current.workingHoursByDay, [dayIndex]: { ...hours, [field]: value } } };
    });
  };
  const saveDemoAvailability = async () => {
    if (!timezoneLabelFor(availabilityDraft.timezone)) {
      setAvailabilitySaveMessage('Select a valid IANA timezone.');
      return;
    }
    if (!Number.isInteger(availabilityDraft.demoDurationMinutes) || availabilityDraft.demoDurationMinutes < 5 || availabilityDraft.demoDurationMinutes > 240) {
      setAvailabilitySaveMessage('Demo duration must be a whole number between 5 and 240 minutes.');
      return;
    }
    if (availabilityDraft.workingDays.length === 0) {
      setAvailabilitySaveMessage('Enable at least one day for demo bookings.');
      return;
    }
    for (const day of availabilityDraft.workingDays) {
      const hours = workingHoursForDay(availabilityDraft, day);
      if (hours.start < 0 || hours.start > 23 || hours.end < 1 || hours.end > 24 || hours.start >= hours.end) {
        setAvailabilitySaveMessage(`Please choose a valid start and end time for ${DAY_NAMES[day]}.`);
        return;
      }
    }
    setIsSavingAvailability(true);
    setAvailabilitySaveMessage(null);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/brand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: { ...availabilityDraft, timezoneLabel: timezoneLabelFor(availabilityDraft.timezone) } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setBrand(data.brand);
      setAvailabilityDraft(data.brand);
      const nextCalendarDate = dateKeyInTimezone(new Date(), data.brand.timezone || 'Asia/Kolkata');
      setCalendarAnchorDate(nextCalendarDate);
      setAvailabilitySaveMessage('Demo booking availability saved.');
      fetchAvailability(mondayOfDateKey(nextCalendarDate));
    } catch (err: any) {
      setAvailabilitySaveMessage(err?.message || 'Could not save demo booking availability.');
    } finally {
      setIsSavingAvailability(false);
    }
  };
  const tzl = brandTzLabel(brand);
  const [calendarConnected, setCalendarConnected] = useState(() => hasCalendarToken());
  const [calendarProvider, setCalendarProvider] = useState<'google' | 'microsoft' | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string>('');
  const [microsoftAvailable, setMicrosoftAvailable] = useState(true);
  // Server-side Google connection (refresh token): no hourly reconnect. null = not known yet.
  const [googleAutoRenew, setGoogleAutoRenew] = useState<boolean | null>(null);
  const [googleOAuthAvailable, setGoogleOAuthAvailable] = useState<boolean | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isMsAuthenticating, setIsMsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [availableSlots, setAvailableSlots] = useState<
    Array<{ date: string; startHour: number; startMinute: number; startTime: string; endTime: string; durationMinutes: number; label: string; startIso: string; endIso: string }>
  >([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);

  const calendarWeekStart = useMemo(() => mondayOfDateKey(calendarAnchorDate), [calendarAnchorDate]);
  const calendarWeekStartRef = useRef(calendarWeekStart);
  const availabilityRequestRef = useRef(0);
  useEffect(() => { calendarWeekStartRef.current = calendarWeekStart; }, [calendarWeekStart]);
  const calendarWeekEnd = useMemo(() => addDateKeyDays(calendarWeekStart, 6), [calendarWeekStart]);
  const calendarDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDateKeyDays(calendarWeekStart, index)), [calendarWeekStart]);
  const calendarVisibleDays = calendarMode === 'DAY' ? [calendarAnchorDate] : calendarDays;
  const todayKey = dateKeyInTimezone(new Date(), brand.timezone || 'Asia/Kolkata');
  const selectedBooking = useMemo(() => bookings.find((booking) => booking.bookingId === selectedBookingId) || null, [bookings, selectedBookingId]);
  const filteredBookings = useMemo(() => {
    const query = bookingSearch.trim().toLowerCase();
    return [...bookings]
      .filter((booking) => {
        if (bookingStatusFilter === 'ALL') return true;
        if (bookingStatusFilter === 'UPCOMING') {
          return booking.date >= todayKey && (booking.status === 'BOOKED' || booking.status === 'RESCHEDULED');
        }
        return booking.status === bookingStatusFilter;
      })
      .filter((booking) => bookingChannelFilter === 'ALL' || booking.channel === bookingChannelFilter)
      .filter((booking) => !query || [booking.leadName, booking.leadEmail, booking.companyName, booking.leadPhone, booking.bookingId].some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(a.startDateTimeIso || a.date).localeCompare(String(b.startDateTimeIso || b.date)));
  }, [bookings, bookingSearch, bookingStatusFilter, bookingChannelFilter, todayKey]);
  const currentWeekStart = mondayOfDateKey(todayKey);
  const currentWeekEnd = addDateKeyDays(currentWeekStart, 6);
  const bookingStats = useMemo(() => {
    const activeUpcoming = (booking: Booking) => booking.date >= todayKey && (booking.status === 'BOOKED' || booking.status === 'RESCHEDULED');
    return {
      today: bookings.filter((booking) => booking.date === todayKey && activeUpcoming(booking)).length,
      thisWeek: bookings.filter((booking) => booking.date >= currentWeekStart && booking.date <= currentWeekEnd && activeUpcoming(booking)).length,
      upcoming: bookings.filter(activeUpcoming).length,
      completed: bookings.filter((booking) => booking.status === 'COMPLETED').length,
      cancelled: bookings.filter((booking) => booking.status === 'CANCELLED').length,
    };
  }, [bookings, todayKey, currentWeekStart, currentWeekEnd]);
  const calendarSlots = useMemo(
    () => availableSlots.filter((slot) => slot.date >= calendarWeekStart && slot.date <= calendarWeekEnd),
    [availableSlots, calendarWeekStart, calendarWeekEnd]
  );

  const navigateCalendar = (direction: -1 | 1) => {
    const navigationBase = calendarMode === 'DAY' ? calendarAnchorDate : calendarWeekStart;
    const amount = calendarMode === 'DAY' ? 1 : 7;
    setCalendarAnchorDate(addDateKeyDays(navigationBase, amount * direction));
  };
  const goToToday = () => {
    setCalendarAnchorDate(dateKeyInTimezone(new Date(), brand.timezone || 'Asia/Kolkata'));
  };
  const selectCrmLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    if (!leadId) return;
    const lead = leads.find((item) => item.leadId === leadId);
    if (!lead) return;
    const contact = contacts.find((item) => item.contactId === lead.contactId);
    setLeadName([contact?.firstName, contact?.lastName].filter(Boolean).join(' '));
    setLeadEmail(contact?.email || '');
    setLeadPhone(contact?.phone || '');
    setCompanyName(contact?.companyName || '');
    const sourceChannel: Record<string, Channel> = {
      EMAIL: 'EMAIL', WHATSAPP: 'WHATSAPP', WEBSITE: 'WEBSITE',
      INSTAGRAM: 'INSTAGRAM', FACEBOOK: 'FACEBOOK', LINKEDIN: 'LINKEDIN',
    };
    setChannel(sourceChannel[lead.source] || 'EMAIL');
  };

  // Manual Token / Settings State
  const [showManualTokenInput, setShowManualTokenInput] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualTokenStatus, setManualTokenStatus] = useState<string | null>(null);
  const [isTestingBooking, setIsTestingBooking] = useState(false);

  // Manual Quick-Book Modal / Form State
  const [selectedSlot, setSelectedSlot] = useState<{
    date: string;
    startHour: number;
    startMinute: number;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    label: string;
    startIso: string;
    endIso: string;
  } | null>(null);
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccessMsg, setBookingSuccessMsg] = useState<string | null>(null);

  // Simulator State
  const [simChannel, setSimChannel] = useState<Channel>('EMAIL');
  const [simLeadEmail, setSimLeadEmail] = useState('lead.demo@bakhlatours.com');
  const [simLeadName, setSimLeadName] = useState('Wasim Saikh');
  const [simCompanyName, setSimCompanyName] = useState('Bakhla Tours & Travels');
  const [simMessage, setSimMessage] = useState('I want to schedule a demo for Thursday at 3 PM');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResponse, setSimResponse] = useState<any | null>(null);

  // Reschedule Modal State
  const [rescheduleBookingId, setRescheduleBookingId] = useState<string | null>(null);

  // Add Attendee Modal State
  const [attendeeModalBooking, setAttendeeModalBooking] = useState<Booking | null>(null);
  const [newAttendeeEmailInput, setNewAttendeeEmailInput] = useState('');
  const [isAddingAttendee, setIsAddingAttendee] = useState(false);
  const [addAttendeeSuccess, setAddAttendeeSuccess] = useState<string | null>(null);

  // 1. Check Initial Status
  const checkStatus = async () => {
    try {
      // Send this browser's token with the check. Without it, the check depended on which server
      // instance answered (each keeps its own copy in memory), so coming back to this page could
      // report "not connected" for a token that was still valid.
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['X-Google-Access-Token'] = token;
      const res = await fetch('/api/calendar/status', { headers });
      if (res.ok) {
        const data = await res.json();
        const connected = Boolean(data.configured && data.connected);
        setCalendarConnected(connected);
        setCalendarProvider(data.provider === 'microsoft' || data.provider === 'google' ? data.provider : connected ? 'google' : null);
        setConnectedEmail(data.email || data.targetAccount || '');
        setMicrosoftAvailable(data.microsoftAvailable !== false);
        setGoogleAutoRenew(typeof data.autoRenew === 'boolean' ? data.autoRenew : null);
        setGoogleOAuthAvailable(typeof data.googleOAuthAvailable === 'boolean' ? data.googleOAuthAvailable : null);
        if (!connected) {
          console.warn('[Calendar] status says not connected', { configured: data.configured, connected: data.connected, hadToken: Boolean(token) });
        }
      }
      // Non-OK (e.g. login check hiccup): keep the current state instead of showing "Disconnected".
    } catch {
      // offline or dev
    }
  };

  // 2. Fetch Realtime Slots from Google Calendar
  const fetchAvailability = async (preferredDate: string = calendarWeekStart) => {
    const requestId = ++availabilityRequestRef.current;
    setIsLoadingSlots(true);
    setAvailabilityError(null);
    try {
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['X-Google-Access-Token'] = token;

      // Request enough slots for the whole visible week rather than a small next-slot shortlist.
      const query = new URLSearchParams({ count: '1000', days: '7', preferredDate });
      const res = await fetch('/api/calendar/availability?' + query.toString(), { headers });
      if (res.status === 401) {
        console.warn('[Calendar] availability returned 401, re-checking status');
        checkStatus();
        if (requestId === availabilityRequestRef.current) {
          setAvailableSlots([]);
          setAvailabilityError('Calendar authorization expired. Reconnect your calendar to see available slots.');
        }
      } else if (res.ok) {
        const data = await res.json();
        if (requestId === availabilityRequestRef.current) setAvailableSlots(data.slots || []);
      } else {
        const data = await res.json().catch(() => ({}));
        if (requestId === availabilityRequestRef.current) {
          setAvailableSlots([]);
          setAvailabilityError(data?.error || `Could not verify calendar availability (${res.status}).`);
        }
      }
    } catch (e) {
      console.warn('Error fetching calendar availability:', e);
      if (requestId === availabilityRequestRef.current) {
        setAvailableSlots([]);
        setAvailabilityError(e instanceof Error ? e.message : 'Could not verify calendar availability.');
      }
    } finally {
      if (requestId === availabilityRequestRef.current) setIsLoadingSlots(false);
    }
  };

  // 3. Fetch Bookings from Firestore
  const fetchBookings = async () => {
    setIsLoadingBookings(true);
    try {
      const res = await fetch('/api/calendar/bookings');
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
      }
    } catch (e) {
      console.warn('Error fetching bookings:', e);
    } finally {
      setIsLoadingBookings(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const cal = params.get('calendar');
    if (!cal) return;
    if (cal === 'microsoft') {
      setBookingSuccessMsg('Microsoft Calendar connected. Demos will now use Microsoft Teams links. Google Calendar was disconnected.');
      setCalendarProvider('microsoft');
      setCalendarConnected(true);
    } else if (cal === 'google') {
      setBookingSuccessMsg('Google Calendar connected. It renews itself automatically, so you will not need to re-sync it.');
      setCalendarProvider('google');
      setCalendarConnected(true);
      setGoogleAutoRenew(true);
      checkStatus();
      fetchAvailability();
    } else {
      setAuthError(params.get('calendar_message') || 'The calendar could not be connected.');
    }
    params.delete('calendar');
    params.delete('calendar_message');
    const next = window.location.pathname + (params.toString() ? `?${params.toString()}` : '') + window.location.hash;
    window.history.replaceState({}, '', next);
  }, []);

  useEffect(() => {
    const unsub = initCalendarAuth(
      (_user, token) => {
        if (token) {
          setCalendarConnected(true);
          fetchAvailability(calendarWeekStart);
          fetchBookings();
        }
      },
      () => {
        checkStatus();
      }
    );
    checkStatus();
    fetchBookings();

    // Booking changes may be made by the AI from email/WhatsApp while this page is open.
    // Refresh the table periodically and whenever the operator returns to this tab.
    const refreshCalendarData = () => {
      if (document.visibilityState !== 'visible') return;
      fetchBookings();
      fetchAvailability(calendarWeekStartRef.current);
    };
    const refreshTimer = window.setInterval(refreshCalendarData, 30000);
    window.addEventListener('focus', refreshCalendarData);
    document.addEventListener('visibilitychange', refreshCalendarData);

    return () => {
      if (unsub) unsub();
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshCalendarData);
      document.removeEventListener('visibilitychange', refreshCalendarData);
    };
  }, []);

  useEffect(() => {
    fetchAvailability(calendarWeekStart);
  }, [calendarWeekStart]);

  const videoLabel = calendarProvider === 'microsoft' ? 'Microsoft Teams' : 'Google Meet';
  const googleActive = calendarConnected && calendarProvider === 'google';
  const microsoftActive = calendarConnected && calendarProvider === 'microsoft';

  const handleDisconnectCalendar = async () => {
    setAuthError(null);
    try {
      await fetch('/api/calendar/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setCalendarConnected(false);
      setCalendarProvider(null);
      setConnectedEmail('');
      setBookingSuccessMsg('Calendar disconnected.');
    } catch (err: any) {
      setAuthError(err?.message || 'Could not disconnect the calendar.');
    }
  };

  const handleConnectMicrosoftCalendar = async () => {
    setIsMsAuthenticating(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/calendar/microsoft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not start Microsoft Calendar sign-in');
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to start Microsoft Calendar sign-in.');
      setIsMsAuthenticating(false);
    }
  };

  // Connect Google Calendar with popup
  const handleConnectGoogleCalendar = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      // Preferred: server-side sign-in that saves a refresh token, so the calendar never needs re-syncing.
      if (googleOAuthAvailable !== false) {
        const startRes = await fetch('/api/calendar/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const startData = await startRes.json().catch(() => ({}));
        if (startRes.ok && startData?.authorizationUrl) {
          window.location.href = startData.authorizationUrl;
          return; // page is leaving; keep the "Authorizing…" state
        }
        // 503 = not configured on this server: fall back to the popup below. Anything else is a real error.
        if (startRes.status !== 503) throw new Error(startData?.error || 'Could not start Google Calendar sign-in');
        setGoogleOAuthAvailable(false);
      }
      const res = await signInWithGoogleCalendar();
      if (res?.accessToken) {
        setCalendarConnected(true);
        setCalendarProvider('google');
        setBookingSuccessMsg(`Google Calendar & Meet connected. Microsoft Calendar was disconnected (only one calendar at a time).`);
        fetchAvailability();
        fetchBookings();
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to authenticate Google Calendar. Ensure popups are allowed or use Manual Token option.';
      setAuthError(msg);
      if (msg.includes('unauthorized-domain') || msg.includes('Unauthorized Domain')) {
        setShowManualTokenInput(true);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Handle Manual Token Submission
  const handleManualTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setManualTokenStatus('Registering token with server and Firestore...');
    const ok = await registerCalendarAccessToken(manualToken.trim());
    if (ok) {
      setCalendarConnected(true);
      setManualTokenStatus('Google Calendar token successfully registered! Live Google Meet generation is enabled.');
      setBookingSuccessMsg('Google Calendar connected! Real Google Meet links are active.');
      fetchAvailability();
      fetchBookings();
      setTimeout(() => setShowManualTokenInput(false), 2500);
    } else {
      setManualTokenStatus('Failed to register token. Please check format.');
    }
  };

  // Test Real Google Meet Booking
  const handleTestGoogleBooking = async () => {
    setIsTestingBooking(true);
    try {
      const token = await getCalendarAccessToken();
      const slotsRes = await fetch('/api/calendar/availability?count=1&preferredDate=' + encodeURIComponent(calendarWeekStart));
      const slotsData = await slotsRes.json();
      const testSlot = slotsData.slots?.[0] || availableSlots[0];
      if (!testSlot) {
        alert('No slot available for test.');
        setIsTestingBooking(false);
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['X-Google-Access-Token'] = token;

      const bookRes = await fetch('/api/calendar/book', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          leadName: 'Wasim Bakhla (Demo Test)',
          leadEmail: 'wasim.bakhla@umrahagency.com',
          companyName: 'Bakhla Tours & Travels Test',
          channel: 'EMAIL',
          startIso: testSlot.startIso,
          endIso: testSlot.endIso,
          dateString: testSlot.date,
          startTime: testSlot.startTime,
          endTime: testSlot.endTime,
          accessToken: token || undefined,
        }),
      });

      const data = await bookRes.json();
      if (data.success && data.booking) {
        setBookingSuccessMsg(`${videoLabel} created: ${data.booking.googleMeetLink} (Calendar ID: ${data.booking.calendarEventId})`);
        fetchBookings();
        fetchAvailability();
      } else {
        alert(data.error || 'Test booking failed.');
      }
    } catch (e: any) {
      alert(e?.message || 'Test booking failed');
    } finally {
      setIsTestingBooking(false);
    }
  };

  // Handle Quick Book
  const handleQuickBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !leadEmail) return;

    setIsBooking(true);
    setBookingSuccessMsg(null);
    setBookingError(null);
    try {
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['X-Google-Access-Token'] = token;

      const startTime = selectedSlot.startTime;
      const endTime = selectedSlot.endTime;

      const res = await fetch('/api/calendar/book', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          leadName,
          leadEmail,
          companyName,
          leadPhone,
          channel,
          leadId: selectedLeadId || undefined,
          contactId: leads.find((lead) => lead.leadId === selectedLeadId)?.contactId || undefined,
          startIso: selectedSlot.startIso,
          endIso: selectedSlot.endIso,
          dateString: selectedSlot.date,
          startTime,
          endTime,
          accessToken: token || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.booking) {
        if (data.crmLeadUpdated && data.booking.leadId) {
          onLeadDemoBooked?.(data.booking.leadId, data.booking as Booking);
        }
        const crmSyncMessage = data.crmLeadUpdated
          ? ' CRM status updated to Demo Booked.'
          : selectedLeadId
            ? ' The booking is confirmed, but CRM status sync could not be verified. Please refresh the lead in CRM.'
            : '';
        setBookingSuccessMsg(`Demo booked.${crmSyncMessage} ${videoLabel} link: ${data.booking.googleMeetLink}`);
        setSelectedSlot(null);
        setSelectedLeadId('');
        setSelectedBookingId(data.booking.bookingId || null);
        fetchAvailability(calendarWeekStart);
        fetchBookings();
      } else {
        setBookingError(data.error || 'The selected time could not be booked. Please choose another available slot.');
        if (res.status === 409) fetchAvailability(calendarWeekStart);
      }
    } catch (err: any) {
      setBookingError(err?.message || 'Booking failed. Please try again.');
    } finally {
      setIsBooking(false);
    }
  };

  // Handle Cancel Booking
  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('Are you sure you want to cancel this demo booking and free up the Google Calendar slot?')) {
      return;
    }
    try {
      const res = await fetch('/api/calendar/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, reason: 'Operator cancelled from CRM UI' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not cancel this meeting.');
      setBookingSuccessMsg('Meeting cancelled and the calendar slot has been released.');
      setBookingError(null);
      setSelectedBookingId(null);
      fetchBookings();
      fetchAvailability(calendarWeekStart);
    } catch (err: any) {
      setBookingError(err?.message || 'Error cancelling meeting.');
    }
  };

  // Handle Reschedule
  const handleRescheduleBooking = async (bookingId: string, slot: any) => {
    setIsRescheduling(true);
    setBookingError(null);
    try {
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['X-Google-Access-Token'] = token;

      const startTime = slot.startTime;
      const endTime = slot.endTime;

      const res = await fetch('/api/calendar/reschedule', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bookingId,
          newStartIso: slot.startIso,
          newEndIso: slot.endIso,
          newDateString: slot.date,
          newStartTime: startTime,
          newEndTime: endTime,
          accessToken: token || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setBookingError(data.error || 'Could not move the meeting. The original booking remains unchanged.');
        if (res.status === 409) fetchAvailability(calendarWeekStart);
        return;
      }
      setRescheduleBookingId(null);
      setSelectedBookingId(data.booking?.bookingId || bookingId);
      setBookingSuccessMsg('Demo successfully rescheduled.');
      fetchBookings();
      fetchAvailability(calendarWeekStart);
    } catch (e: any) {
      setBookingError(e?.message || 'Error rescheduling meeting.');
    } finally {
      setIsRescheduling(false);
    }
  };

  // Handle Add Attendee to Google Calendar Meeting
  const handleAddAttendeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendeeModalBooking || !newAttendeeEmailInput.trim()) return;

    setIsAddingAttendee(true);
    setAddAttendeeSuccess(null);
    try {
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['X-Google-Access-Token'] = token;

      const rawEmails = newAttendeeEmailInput
        .split(/[,;\s]+/)
        .map((em) => em.trim().toLowerCase())
        .filter((em) => em.includes('@'));

      if (rawEmails.length === 0) {
        alert('Please enter a valid email address.');
        setIsAddingAttendee(false);
        return;
      }

      const res = await fetch('/api/calendar/add-attendee', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bookingId: attendeeModalBooking.bookingId,
          attendeeEmails: rawEmails,
          accessToken: token || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.booking) {
        setAddAttendeeSuccess(`Added ${rawEmails.join(', ')}! Google Calendar invitation sent.`);
        setBookingSuccessMsg(`Attendee(s) ${rawEmails.join(', ')} added to demo meeting! Google Calendar invite dispatched.`);
        setNewAttendeeEmailInput('');
        fetchBookings();
        setTimeout(() => {
          setAttendeeModalBooking(null);
          setAddAttendeeSuccess(null);
        }, 2200);
      } else {
        alert(data.error || 'Failed to add attendee to Google Calendar');
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to add attendee');
    } finally {
      setIsAddingAttendee(false);
    }
  };

  // Run Scheduling Agent Simulator
  const handleRunSimulator = async () => {
    setIsSimulating(true);
    setSimResponse(null);
    try {
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['X-Google-Access-Token'] = token;

      const res = await fetch('/api/calendar/schedule-turn', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          manual: true,
          messageText: simMessage,
          conversationHistory: [],
          accessToken: token || undefined,
          leadContext: {
            leadName: simLeadName,
            leadEmail: simLeadEmail,
            companyName: simCompanyName,
            channel: simChannel,
            accessToken: token || undefined,
          },
        }),
      });
      const data = await res.json();
      setSimResponse(data);
      if (data.action === 'CONFIRMED_BOOKING' || data.action === 'RESCHEDULED' || data.action === 'CANCELLED') {
        fetchBookings();
        fetchAvailability();
      }
    } catch (e: any) {
      setSimResponse({ handled: false, replyText: e?.message || 'Simulation error' });
    } finally {
      setIsSimulating(false);
    }
  };

  const chooseSlot = (slot: (typeof availableSlots)[number]) => {
    if (rescheduleBookingId) {
      void handleRescheduleBooking(rescheduleBookingId, slot);
      return;
    }
    setBookingError(null);
    setSelectedLeadId('');
    setLeadName('');
    setLeadEmail('');
    setCompanyName('');
    setLeadPhone('');
    setChannel('EMAIL');
    setSelectedSlot(slot);
  };
  const visibleCalendarBookings = (dateKey: string) => bookings
    // Cancelled meetings no longer occupy a calendar slot. Their history remains in Bookings.
    .filter((booking) => booking.date === dateKey && booking.status !== 'CANCELLED')
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  const renderBookingStatus = (status: Booking['status']) => {
    const styles: Record<Booking['status'], string> = {
      BOOKED: 'is-booked', RESCHEDULED: 'is-rescheduled', COMPLETED: 'is-completed', CANCELLED: 'is-cancelled',
    };
    return <span className={'schedule-status ' + styles[status]}>{status.toLowerCase().replace('_', ' ')}</span>;
  };
  const openBookingAttendees = (booking: Booking) => {
    setAttendeeModalBooking(booking);
    setNewAttendeeEmailInput('');
    setAddAttendeeSuccess(null);
  };

  return (
    <div data-umrah360-module="scheduling" className="demo-scheduling-workspace ai-suite-module">
      <header className="schedule-page-header">
        <div className="schedule-heading">
          <div className="schedule-heading-icon"><CalendarDays className="h-5 w-5" /></div>
          <div><div className="schedule-eyebrow">AI &amp; AUTOMATION</div><h1>Demo Scheduling Agent</h1><p>Qualify demo requests, manage availability and book meetings from one workspace.</p></div>
        </div>
        <div className="schedule-header-actions">
          <div className={'schedule-calendar-connection ' + (calendarConnected ? 'is-connected' : 'is-disconnected')}><span className="schedule-connection-dot" /><span>{calendarConnected ? (calendarProvider === 'microsoft' ? 'Microsoft Teams connected' : 'Google Meet connected') : 'Calendar not connected'}</span></div>
          <button type="button" className="schedule-primary-button" onClick={() => { const nextSlot = calendarSlots.find((slot) => slot.startIso && Date.parse(slot.startIso) > Date.now()); if (nextSlot) chooseSlot(nextSlot); else setActiveView('CALENDAR'); }} disabled={!calendarConnected || (isLoadingSlots && calendarSlots.length === 0)}><CalendarDays className="h-4 w-4" /> Book Demo</button>
        </div>
      </header>

      <section className="schedule-stats-grid" aria-label="Meeting overview">
        <button type="button" className="schedule-stat-card" onClick={() => { setActiveView('CALENDAR'); setCalendarMode('DAY'); setCalendarAnchorDate(todayKey); }}><span className="schedule-stat-icon violet"><CalendarDays className="h-4 w-4" /></span><span className="schedule-stat-copy"><span>Today's meetings</span><strong>{bookingStats.today}</strong></span><span className="schedule-stat-foot">Scheduled for today</span></button>
        <button type="button" className="schedule-stat-card" onClick={() => { setActiveView('CALENDAR'); setCalendarMode('WEEK'); goToToday(); }}><span className="schedule-stat-icon blue"><Calendar className="h-4 w-4" /></span><span className="schedule-stat-copy"><span>This week</span><strong>{bookingStats.thisWeek}</strong></span><span className="schedule-stat-foot">Upcoming this week</span></button>
        <button type="button" className="schedule-stat-card" onClick={() => { setActiveView('BOOKINGS'); setBookingStatusFilter('UPCOMING'); }}><span className="schedule-stat-icon green"><CheckCircle2 className="h-4 w-4" /></span><span className="schedule-stat-copy"><span>Upcoming</span><strong>{bookingStats.upcoming}</strong></span><span className="schedule-stat-foot">Booked or rescheduled</span></button>
        <button type="button" className="schedule-stat-card" onClick={() => { setActiveView('BOOKINGS'); setBookingStatusFilter('COMPLETED'); }}><span className="schedule-stat-icon teal"><ClipboardList className="h-4 w-4" /></span><span className="schedule-stat-copy"><span>Completed</span><strong>{bookingStats.completed}</strong></span><span className="schedule-stat-foot">Past completed meetings</span></button>
        <button type="button" className="schedule-stat-card" onClick={() => { setActiveView('BOOKINGS'); setBookingStatusFilter('CANCELLED'); }}><span className="schedule-stat-icon rose"><XCircle className="h-4 w-4" /></span><span className="schedule-stat-copy"><span>Cancelled</span><strong>{bookingStats.cancelled}</strong></span><span className="schedule-stat-foot">Cancelled bookings</span></button>
      </section>

      <nav className="schedule-workspace-tabs" aria-label="Scheduling sections">
        {([
          ['CALENDAR', 'Calendar', CalendarDays],
          ['BOOKINGS', 'Bookings', ClipboardList],
          ['AVAILABILITY', 'Availability', Clock],
          ['INTEGRATIONS', 'Integrations', Link2],
          ['SIMULATOR', 'Agent Simulator', Sparkles],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setActiveView(key)} className={activeView === key ? 'is-active' : ''} aria-current={activeView === key ? 'page' : undefined}><Icon className="h-4 w-4" /> {label}{key === 'BOOKINGS' && <span className="schedule-tab-count">{bookings.length}</span>}</button>
        ))}
      </nav>

      {(bookingSuccessMsg || bookingError || authError) && (
        <div className="schedule-feedback-stack" role="status" aria-live="polite">
          {bookingSuccessMsg && <div className="schedule-feedback success"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>{bookingSuccessMsg}</span><button type="button" onClick={() => setBookingSuccessMsg(null)} aria-label="Dismiss success"><X className="h-4 w-4" /></button></div>}
          {(bookingError || authError) && <div className="schedule-feedback error"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{bookingError || authError}</span><button type="button" onClick={() => { setBookingError(null); setAuthError(null); }} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}
        </div>
      )}

      {activeView === 'CALENDAR' && (
        <section className="schedule-content-panel">
          <div className="schedule-calendar-toolbar">
            <div className="schedule-calendar-title-group">
              <div><h2>{calendarMode === 'DAY' ? formatDateKey(calendarAnchorDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : formatDateKey(calendarWeekStart, { day: 'numeric', month: 'short' }) + ' – ' + formatDateKey(calendarWeekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}</h2><p><Globe className="h-3.5 w-3.5" /> {tzl} · {availabilityDraft.demoDurationMinutes || brand.demoDurationMinutes} minute sessions</p></div>
              <div className="schedule-date-nav"><button type="button" onClick={() => navigateCalendar(-1)} aria-label="Previous date range"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={goToToday}>Today</button><button type="button" onClick={() => navigateCalendar(1)} aria-label="Next date range"><ChevronRight className="h-4 w-4" /></button></div>
            </div>
            <div className="schedule-calendar-tools">
              <div className="schedule-calendar-mode" role="group" aria-label="Calendar view">{(['WEEK', 'DAY', 'AGENDA'] as SchedulingCalendarMode[]).map((mode) => <button key={mode} type="button" onClick={() => setCalendarMode(mode)} className={calendarMode === mode ? 'is-active' : ''}>{mode === 'WEEK' ? 'Week' : mode === 'DAY' ? 'Day' : 'Agenda'}</button>)}</div>
              <span className="schedule-timezone-chip">{brand.timezoneLabel || brand.timezone || 'Workspace timezone'}</span>
              <button type="button" className="schedule-icon-button" onClick={() => { fetchBookings(); fetchAvailability(calendarWeekStart); }} disabled={isLoadingBookings || isLoadingSlots} title="Refresh calendar and bookings"><RefreshCw className={'h-4 w-4 ' + (isLoadingBookings || isLoadingSlots ? 'animate-spin' : '')} /></button>
            </div>
          </div>

          {rescheduleBookingId && <div className="schedule-reschedule-banner"><div><RefreshCw className="h-4 w-4" /><span>Choose a live available slot to reschedule booking <strong>#{rescheduleBookingId.slice(-6)}</strong>.</span></div><button type="button" onClick={() => setRescheduleBookingId(null)}>Exit reschedule</button></div>}

          <div className="schedule-calendar-layout">
            <div className={'schedule-calendar-days ' + (calendarMode === 'DAY' ? 'is-day' : calendarMode === 'AGENDA' ? 'is-agenda' : '')}>
              {calendarVisibleDays.map((dateKey) => {
                const dayBookings = visibleCalendarBookings(dateKey);
                const daySlots = calendarSlots.filter((slot) => slot.date === dateKey);
                const dayItems = [
                  ...dayBookings.map((booking) => ({ kind: 'booking' as const, sortAt: Date.parse(booking.startDateTimeIso || `${dateKey}T${booking.startTime}:00`), booking })),
                  ...(calendarConnected ? daySlots : []).map((slot) => ({ kind: 'slot' as const, sortAt: Date.parse(slot.startIso), slot })),
                ].sort((a, b) => a.sortAt - b.sortAt);
                const isToday = dateKey === todayKey;
                return (
                  <section key={dateKey} className={'schedule-calendar-day ' + (isToday ? 'is-today' : '')}>
                    <header className="schedule-day-header">
                      <button type="button" className="schedule-day-label" onClick={() => { setCalendarAnchorDate(dateKey); setCalendarMode('DAY'); }}><span>{formatDateKey(dateKey, { weekday: 'short' })}</span><strong>{formatDateKey(dateKey, { day: 'numeric' })}</strong></button>
                      <div className="schedule-day-counts"><span>{dayBookings.length} meetings</span>{isToday && <em>Today</em>}</div>
                    </header>
                    <div className="schedule-day-content">
                      {dayItems.map((item) => item.kind === 'booking' ? (
                        <article key={`booking-${item.booking.bookingId}`} className={'schedule-event-card ' + (item.booking.status === 'COMPLETED' ? 'is-completed' : item.booking.status === 'RESCHEDULED' ? 'is-rescheduled' : 'is-booked')} onClick={() => { setSelectedBookingId(item.booking.bookingId); setBookingDetailsTab('DETAILS'); }}>
                          <div className="schedule-event-time">{item.booking.startTime} – {item.booking.endTime}</div>
                          <strong>{item.booking.leadName || 'Demo meeting'}</strong>
                          <span>{item.booking.companyName || item.booking.leadEmail}</span>
                          <div className="schedule-event-footer"><span>{item.booking.channel}</span>{renderBookingStatus(item.booking.status)}</div>
                        </article>
                      ) : (
                        <button type="button" key={`slot-${item.slot.startIso}`} className={'schedule-open-slot ' + (rescheduleBookingId ? 'is-reschedule' : '')} onClick={() => chooseSlot(item.slot)} disabled={isRescheduling}>
                          <span><CircleDot className="h-3.5 w-3.5" /> {item.slot.startTime} – {item.slot.endTime}</span>
                          <em>{rescheduleBookingId ? 'Move here' : 'Available'}</em>
                        </button>
                      ))}
                      {!calendarConnected && dayBookings.length === 0 && <div className="schedule-day-empty">Connect a calendar to load live availability.</div>}
                      {calendarConnected && availabilityError && dateKey === calendarVisibleDays[0] && <div className="schedule-inline-message error">Live calendar availability could not be verified: {availabilityError}</div>}
                      {calendarConnected && !availabilityError && dayBookings.length === 0 && daySlots.length === 0 && <div className="schedule-day-empty">{isLoadingSlots ? 'Checking live availability…' : 'No free slots returned for this date.'}</div>}
                    </div>
                  </section>
                );
              })}
            </div>
            <aside className="schedule-calendar-sidebar">
              <div className="schedule-sidebar-card schedule-calendar-health">
                <div className="schedule-card-title"><span>Calendar connection</span><Settings2 className="h-4 w-4" /></div>
                <div className="schedule-provider-row"><span className={'schedule-provider-icon ' + (calendarConnected ? 'is-active' : '')}>{calendarProvider === 'microsoft' ? 'M' : 'G'}</span><div><strong>{calendarConnected ? (calendarProvider === 'microsoft' ? 'Microsoft 365' : 'Google Calendar') : 'Not connected'}</strong><span>{connectedEmail || 'Connect a calendar to begin'}</span></div><span className={'schedule-health-dot ' + (calendarConnected ? 'is-online' : '')} /></div>
                <button type="button" className="schedule-text-link" onClick={() => setActiveView('INTEGRATIONS')}>{calendarConnected ? 'Manage integration' : 'Connect calendar'} <ArrowUpRight className="h-3 w-3" /></button>
              </div>
              <div className="schedule-sidebar-card">
                <div className="schedule-card-title"><span>Availability summary</span><Clock className="h-4 w-4" /></div>
                <div className="schedule-summary-row"><span>Working days</span><strong>{brandWorkingDaysLabel(brand)}</strong></div>
                <div className="schedule-summary-row"><span>Working hours</span><strong>{brandWorkingWindowLabel(brand)}</strong></div>
                <div className="schedule-summary-row"><span>Session duration</span><strong>{brand.demoDurationMinutes} min</strong></div>
                <div className="schedule-summary-row"><span>Live free slots this week</span><strong>{calendarSlots.length}</strong></div>
                <button type="button" className="schedule-text-link" onClick={() => setActiveView('AVAILABILITY')}>Edit availability <ArrowUpRight className="h-3 w-3" /></button>
              </div>
              <div className="schedule-sidebar-card schedule-legend-card"><div className="schedule-card-title"><span>Calendar legend</span></div><div className="schedule-legend-row"><i className="legend-booked" /> Booked meeting</div><div className="schedule-legend-row"><i className="legend-rescheduled" /> Rescheduled</div><div className="schedule-legend-row"><i className="legend-completed" /> Completed</div><div className="schedule-legend-row"><i className="legend-available" /> Live available slot</div></div>
              {calendarConnected && <button type="button" className="schedule-test-booking-button" onClick={handleTestGoogleBooking} disabled={isTestingBooking}><Video className="h-4 w-4" /> {isTestingBooking ? 'Creating test event…' : 'Create real ' + (calendarProvider === 'microsoft' ? 'Teams' : 'Meet') + ' test booking'}</button>}
            </aside>
          </div>
        </section>
      )}

      {activeView === 'BOOKINGS' && (
        <section className="schedule-content-panel">
          <div className="schedule-section-heading"><div><h2>Bookings</h2><p>Manage confirmed, completed, rescheduled and cancelled meetings.</p></div><button type="button" className="schedule-icon-button" onClick={fetchBookings} disabled={isLoadingBookings} title="Refresh bookings"><RefreshCw className={'h-4 w-4 ' + (isLoadingBookings ? 'animate-spin' : '')} /></button></div>
          <div className="schedule-booking-filters">
            <label className="schedule-booking-search"><Search className="h-4 w-4" /><input value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} placeholder="Search lead, company, email or booking ID…" /></label>
            <label className="schedule-filter-select"><Filter className="h-3.5 w-3.5" /><select value={bookingStatusFilter} onChange={(event) => setBookingStatusFilter(event.target.value as 'ALL' | 'UPCOMING' | Booking['status'])}><option value="ALL">All statuses</option><option value="UPCOMING">Upcoming</option><option value="BOOKED">Booked</option><option value="RESCHEDULED">Rescheduled</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
            <label className="schedule-filter-select"><List className="h-3.5 w-3.5" /><select value={bookingChannelFilter} onChange={(event) => setBookingChannelFilter(event.target.value as 'ALL' | Channel)}><option value="ALL">All channels</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="WEBSITE">Website</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook</option><option value="LINKEDIN">LinkedIn</option></select></label>
            <span className="schedule-results-count">{filteredBookings.length} of {bookings.length} bookings</span>
          </div>
          {isLoadingBookings && bookings.length === 0 ? <div className="schedule-empty-state"><RefreshCw className="h-5 w-5 animate-spin" /><strong>Loading bookings</strong><span>Fetching the latest booking records.</span></div> : filteredBookings.length === 0 ? <div className="schedule-empty-state"><CalendarDays className="h-6 w-6" /><strong>No matching bookings</strong><span>Try another search or status filter.</span><button type="button" onClick={() => { setBookingSearch(''); setBookingStatusFilter('ALL'); setBookingChannelFilter('ALL'); }}>Clear filters</button></div> : (
            <div className="schedule-bookings-table-wrap"><table className="schedule-bookings-table"><thead><tr><th>Lead / Company</th><th>Date & time</th><th>Channel</th><th>Meeting</th><th>Attendees</th><th>Status</th><th /></tr></thead><tbody>
              {filteredBookings.map((booking) => {
                const guests = (booking.attendees || []).filter((attendee) => attendee && attendee.toLowerCase() !== booking.leadEmail?.toLowerCase() && attendee.toLowerCase() !== CALENDAR_TARGET_ACCOUNT.toLowerCase());
                return <tr key={booking.bookingId} onClick={() => { setSelectedBookingId(booking.bookingId); setBookingDetailsTab('DETAILS'); }}><td><strong>{booking.leadName}</strong><span>{booking.companyName || 'Company not provided'}</span><small>{booking.leadEmail}</small></td><td><strong>{formatDateKey(booking.date, { day: 'numeric', month: 'short', year: 'numeric' })}</strong><span>{booking.startTime} – {booking.endTime} {tzl}</span></td><td><span className="schedule-channel-chip">{booking.channel}</span></td><td>{booking.googleMeetLink ? <a className="schedule-join-link" href={booking.googleMeetLink} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Video className="h-3.5 w-3.5" /> Join meeting <ArrowUpRight className="h-3 w-3" /></a> : <span className="schedule-table-muted">Link unavailable</span>}</td><td><span className="schedule-attendee-count"><Users className="h-3.5 w-3.5" /> {1 + guests.length}</span></td><td>{renderBookingStatus(booking.status)}</td><td><button type="button" className="schedule-row-open" onClick={(event) => { event.stopPropagation(); setSelectedBookingId(booking.bookingId); setBookingDetailsTab('DETAILS'); }} aria-label="Open booking details"><ArrowUpRight className="h-4 w-4" /></button></td></tr>;
              })}
            </tbody></table></div>
          )}
          <div className="schedule-list-footnote">Booking history is retrieved from the workspace booking service (up to the latest 100 records).</div>
        </section>
      )}

      {activeView === 'AVAILABILITY' && (
        <section className="schedule-content-panel">
          <div className="schedule-section-heading"><div><h2>Availability</h2><p>Control when customers can request and book a demo.</p></div>{canEditSettings && <button type="button" className="schedule-primary-button" onClick={saveDemoAvailability} disabled={isSavingAvailability}><Check className="h-4 w-4" /> {isSavingAvailability ? 'Saving…' : 'Save availability'}</button>}</div>
          <div className="schedule-availability-layout">
            <div className="schedule-settings-card">
              <div className="schedule-card-title"><span>Meeting configuration</span><Settings2 className="h-4 w-4" /></div>
              <div className="schedule-settings-grid">
                <label><span>Session duration</span><div className="schedule-input-with-suffix"><input type="number" min={5} max={240} step={1} disabled={!canEditSettings || isSavingAvailability} value={availabilityDraft.demoDurationMinutes} onChange={(event) => setAvailabilityDraft((current) => ({ ...current, demoDurationMinutes: Number(event.target.value) }))} /><em>minutes</em></div></label>
                <label><span>Timezone (IANA)</span><select disabled={!canEditSettings || isSavingAvailability} value={availabilityDraft.timezone} onChange={(event) => updateAvailabilityTimezone(event.target.value)}>{IANA_TIME_ZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
                <label><span>Timezone label (automatic)</span><input type="text" readOnly aria-readonly="true" value={timezoneLabelFor(availabilityDraft.timezone) || 'Select a valid timezone'} /></label>
                <label><span>Calendar invite email</span><input type="email" disabled={!canEditSettings || isSavingAvailability} value={availabilityDraft.calendarEmail} onChange={(event) => updateAvailabilityText('calendarEmail', event.target.value)} placeholder="calendar@company.com" /></label>
              </div>
              <p className="schedule-settings-hint">The full session must fit inside a working window. Start times repeat at the selected session duration.</p>
            </div>
            <div className="schedule-settings-card">
              <div className="schedule-card-title"><span>Weekly working hours</span><span className="schedule-card-subtitle">{availabilityDraft.workingDays.length} days enabled</span></div>
              <div className="schedule-working-days">
                {DAY_NAMES.map((day, dayIndex) => {
                  const enabled = availabilityDraft.workingDays.includes(dayIndex);
                  const hours = workingHoursForDay(availabilityDraft, dayIndex);
                  return <div className={'schedule-working-day ' + (!enabled ? 'is-disabled' : '')} key={day}><label className="schedule-day-toggle"><input type="checkbox" disabled={!canEditSettings || isSavingAvailability} checked={enabled} onChange={() => toggleAvailabilityDay(dayIndex)} /><strong>{day.slice(0, 3)}</strong><span>{enabled ? 'Open' : 'Closed'}</span></label><label><span>From</span><select disabled={!canEditSettings || isSavingAvailability || !enabled} value={hours.start} onChange={(event) => updateAvailabilityHours(dayIndex, 'start', Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{fmtHour(hour)}</option>)}</select></label><label><span>To</span><select disabled={!canEditSettings || isSavingAvailability || !enabled} value={hours.end} onChange={(event) => updateAvailabilityHours(dayIndex, 'end', Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{hour === 24 ? '12:00 AM' : fmtHour(hour)}</option>)}</select></label></div>;
                })}
              </div>
              <div className="schedule-availability-preview"><Clock className="h-4 w-4" /><span>Customers see: <strong>{brandWorkingWindowLabel(availabilityDraft)}</strong> · {availabilityDraft.demoDurationMinutes} minute sessions · {timezoneLabelFor(availabilityDraft.timezone) || availabilityDraft.timezone}</span></div>
              {!canEditSettings && <p className="schedule-readonly-note"><ShieldCheck className="h-3.5 w-3.5" /> Only administrators can change demo booking availability.</p>}
              {availabilitySaveMessage && <p className={'schedule-inline-message ' + (availabilitySaveMessage === 'Demo booking availability saved.' ? 'success' : 'error')}>{availabilitySaveMessage}</p>}
            </div>
          </div>
        </section>
      )}

      {activeView === 'INTEGRATIONS' && (
        <section className="schedule-content-panel">
          <div className="schedule-section-heading"><div><h2>Calendar integrations</h2><p>Connect one calendar provider to create meeting events and video links automatically.</p></div><div className={'schedule-integration-state ' + (calendarConnected ? 'is-connected' : 'is-disconnected')}><span className="schedule-connection-dot" />{calendarConnected ? 'One calendar connected' : 'No calendar connected'}</div></div>
          <div className="schedule-integration-notice"><AlertTriangle className="h-4 w-4" /><span>Only one calendar provider can be active at a time. Connecting Google will disconnect Microsoft, and connecting Microsoft will disconnect Google.</span></div>
          <div className="schedule-integrations-grid">
            <article className={'schedule-integration-card ' + (googleActive ? 'is-active' : '')}>
              <div className="schedule-integration-card-head"><div className="schedule-brand-icon google">G</div><div><h3>Google Calendar</h3><p>Google Calendar events with Google Meet links.</p></div><span className={'schedule-status ' + (googleActive ? 'is-booked' : 'is-neutral')}>{googleActive ? 'Connected' : 'Disconnected'}</span></div>
              {googleActive && <div className="schedule-connected-account"><Mail className="h-3.5 w-3.5" /> {connectedEmail || 'Connected Google account'}</div>}
              {googleActive && googleAutoRenew === true && <div className="schedule-integration-health success"><CheckCircle2 className="h-3.5 w-3.5" /> Automatic token renewal is enabled.</div>}
              {googleActive && googleAutoRenew === false && googleOAuthAvailable !== false && <div className="schedule-integration-health warning"><AlertTriangle className="h-3.5 w-3.5" /> This connection may expire after about an hour. Re-sync to enable automatic renewal.</div>}
              {googleOAuthAvailable === false && <div className="schedule-integration-health warning"><AlertTriangle className="h-3.5 w-3.5" /> Server-side automatic renewal is not configured. The manual token fallback remains available.</div>}
              <div className="schedule-integration-actions"><button type="button" className="schedule-primary-button" onClick={handleConnectGoogleCalendar} disabled={isAuthenticating || isMsAuthenticating}>{isAuthenticating ? 'Authorizing…' : googleActive ? 'Re-sync Google' : 'Connect Google'}</button>{googleActive && <button type="button" className="schedule-secondary-button" onClick={handleDisconnectCalendar}>Disconnect</button>}</div>
            </article>
            <article className={'schedule-integration-card ' + (microsoftActive ? 'is-active' : '')}>
              <div className="schedule-integration-card-head"><div className="schedule-brand-icon microsoft">M</div><div><h3>Microsoft 365</h3><p>Outlook calendar events with Microsoft Teams links.</p></div><span className={'schedule-status ' + (microsoftActive ? 'is-booked' : 'is-neutral')}>{microsoftActive ? 'Connected' : 'Disconnected'}</span></div>
              {microsoftActive && <div className="schedule-connected-account"><Mail className="h-3.5 w-3.5" /> {connectedEmail || 'Connected Microsoft account'}</div>}
              {!microsoftAvailable && <div className="schedule-integration-health warning"><AlertTriangle className="h-3.5 w-3.5" /> Microsoft Calendar is not configured on this server.</div>}
              <div className="schedule-integration-actions"><button type="button" className="schedule-primary-button microsoft-button" onClick={handleConnectMicrosoftCalendar} disabled={isAuthenticating || isMsAuthenticating || !microsoftAvailable}>{isMsAuthenticating ? 'Redirecting…' : microsoftActive ? 'Re-sync Microsoft' : 'Connect Microsoft'}</button>{microsoftActive && <button type="button" className="schedule-secondary-button" onClick={handleDisconnectCalendar}>Disconnect</button>}</div>
            </article>
          </div>
          <div className="schedule-settings-card schedule-advanced-integration">
            <button type="button" className="schedule-advanced-toggle" onClick={() => setShowManualTokenInput((current) => !current)} aria-expanded={showManualTokenInput}><span><ShieldCheck className="h-4 w-4" /> Advanced troubleshooting</span><span>{showManualTokenInput ? 'Hide' : 'Show'} <ChevronRight className={'h-4 w-4 ' + (showManualTokenInput ? 'rotate-90' : '')} /></span></button>
            {showManualTokenInput && <div className="schedule-manual-token"><p>Use this fallback only when the Google sign-in flow is blocked by a browser or authorized-domain issue. The token is registered with the calendar service.</p><form onSubmit={handleManualTokenSubmit}><input type="password" value={manualToken} onChange={(event) => setManualToken(event.target.value)} placeholder="Paste Google OAuth access token" autoComplete="off" /><button type="submit" disabled={!manualToken.trim()}>Register token</button></form>{manualTokenStatus && <span className="schedule-inline-message">{manualTokenStatus}</span>}</div>}
          </div>
          <div className="schedule-live-test-warning"><AlertTriangle className="h-4 w-4" /><span><strong>Test booking creates a real calendar event.</strong> It is not a dry-run. Use it only when you are comfortable sending an actual calendar invitation.</span><button type="button" onClick={handleTestGoogleBooking} disabled={!calendarConnected || isTestingBooking}>{isTestingBooking ? 'Creating…' : 'Run test booking'}</button></div>
        </section>
      )}

      {activeView === 'SIMULATOR' && (
        <section className="schedule-content-panel">
          <div className="schedule-section-heading"><div><h2>Scheduling Agent Simulator</h2><p>Test how the agent interprets natural-language meeting requests from each inbound channel.</p></div><span className="schedule-live-test-warning-chip"><AlertTriangle className="h-3.5 w-3.5" /> Live endpoint</span></div>
          <div className="schedule-simulator-warning"><AlertTriangle className="h-4 w-4" /><span>This calls the live scheduling endpoint. A request that the agent confirms can create or change a real calendar event and send invitations.</span></div>
          <div className="schedule-simulator-layout">
            <div className="schedule-simulator-form">
              <div className="schedule-card-title"><span>Incoming customer request</span><MessageSquare className="h-4 w-4" /></div>
              <div className="schedule-settings-grid simulator-fields">
                <label><span>Channel</span><select value={simChannel} onChange={(event) => setSimChannel(event.target.value as Channel)}><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="WEBSITE">Website</option></select></label>
                <label><span>Customer name</span><input value={simLeadName} onChange={(event) => setSimLeadName(event.target.value)} /></label>
                <label><span>Customer email</span><input type="email" value={simLeadEmail} onChange={(event) => setSimLeadEmail(event.target.value)} /></label>
                <label><span>Company / agency</span><input value={simCompanyName} onChange={(event) => setSimCompanyName(event.target.value)} /></label>
              </div>
              <label className="schedule-simulator-message"><span>Incoming message</span><textarea rows={5} value={simMessage} onChange={(event) => setSimMessage(event.target.value)} placeholder="Can we schedule a demo on Thursday at 3 PM?" /></label>
              <div className="schedule-simulator-prompts"><span>Try a prompt</span><button type="button" onClick={() => setSimMessage('I would like to schedule a demo.')}>Request a demo</button><button type="button" onClick={() => setSimMessage('Can we do Thursday at 3 PM?')}>Specific date and time</button><button type="button" onClick={() => setSimMessage('Can we schedule for Saturday morning?')}>Non-working day</button><button type="button" onClick={() => setSimMessage('Please add my colleague Tariq at tariq@bakhla.com to the meeting')}>Add a colleague</button></div>
              <button type="button" className="schedule-primary-button schedule-run-simulator" onClick={handleRunSimulator} disabled={isSimulating || !simMessage.trim()}><Sparkles className="h-4 w-4" /> {isSimulating ? 'Running scheduling agent…' : 'Run live agent test'}</button>
            </div>
            <div className="schedule-simulator-result">
              <div className="schedule-card-title"><span>Agent execution result</span><span className="schedule-simulator-channel">{simChannel}</span></div>
              {simResponse ? <div className="schedule-simulator-output">
                {simResponse.action && <div className="schedule-action-result"><span>Detected action</span><strong>{String(simResponse.action).replace(/_/g, ' ')}</strong></div>}
                <div className="schedule-agent-reply"><span>Customer-facing response</span><p>{simResponse.replyText || simResponse.error || 'The agent returned without a reply.'}</p></div>
                {simResponse.booking && <div className="schedule-agent-booking"><div><CheckCircle2 className="h-4 w-4" /><strong>Calendar event created</strong></div><span>{simResponse.booking.date} · {simResponse.booking.startTime} – {simResponse.booking.endTime} {tzl}</span>{simResponse.booking.googleMeetLink && <a href={simResponse.booking.googleMeetLink} target="_blank" rel="noreferrer">Open meeting link <ArrowUpRight className="h-3 w-3" /></a>}</div>}
                {simResponse.handled === false && <div className="schedule-integration-health warning"><AlertTriangle className="h-3.5 w-3.5" /> The scheduling agent did not complete this request.</div>}
              </div> : <div className="schedule-simulator-placeholder"><Sparkles className="h-7 w-7" /><strong>Waiting for a test</strong><span>Run a customer request to inspect the agent's reply and calendar action.</span></div>}
            </div>
          </div>
        </section>
      )}

      {selectedSlot && (
        <div className="schedule-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSlot(null); }}>
          <section className="schedule-booking-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-booking-title">
            <div className="schedule-modal-header"><div><span className="schedule-eyebrow">NEW MEETING</span><h2 id="schedule-booking-title">Book a demo</h2><p>{formatDateKey(selectedSlot.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {selectedSlot.startTime} – {selectedSlot.endTime} {tzl}</p></div><button type="button" className="schedule-icon-button" onClick={() => setSelectedSlot(null)} aria-label="Close booking modal"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleQuickBook} className="schedule-booking-form">
              {leads.length > 0 && <label className="schedule-full-field"><span>Select existing CRM lead (optional)</span><select value={selectedLeadId} onChange={(event) => selectCrmLead(event.target.value)}><option value="">Create a new contact / enter details manually</option>{leads.map((lead) => { const contact = contacts.find((item) => item.contactId === lead.contactId); return <option key={lead.leadId} value={lead.leadId}>{[contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Unnamed lead'} · {contact?.companyName || contact?.email || lead.leadId}</option>; })}</select></label>}
              <label><span>Lead name *</span><input required value={leadName} onChange={(event) => setLeadName(event.target.value)} placeholder="Customer name" /></label>
              <label><span>Email address *</span><input type="email" required value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)} placeholder="customer@agency.com" /></label>
              <label><span>Company / agency *</span><input required value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Agency name" /></label>
              <label><span>Phone number</span><input value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} placeholder="+91…" /></label>
              <label><span>Origin channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="WEBSITE">Website</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook</option><option value="LINKEDIN">LinkedIn</option></select></label>
              <div className="schedule-booking-confirmation"><CalendarDays className="h-4 w-4" /><span>{videoLabel} · {brand.demoDurationMinutes} minutes · {tzl}</span></div>
              {bookingError && <div className="schedule-inline-message error">{bookingError}</div>}
              <div className="schedule-modal-actions"><button type="button" className="schedule-secondary-button" onClick={() => { setSelectedSlot(null); setSelectedLeadId(''); }}>Cancel</button><button type="submit" className="schedule-primary-button" disabled={isBooking}>{isBooking ? <><RefreshCw className="h-4 w-4 animate-spin" /> Booking…</> : <><CheckCircle2 className="h-4 w-4" /> Confirm and send invite</>}</button></div>
            </form>
          </section>
        </div>
      )}

      {selectedBooking && (
        <div className="schedule-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedBookingId(null); }}>
          <aside className="schedule-booking-detail" role="dialog" aria-modal="true" aria-label="Booking details">
            <header className="schedule-detail-header"><div><span className="schedule-eyebrow">MEETING DETAILS</span><h2>{selectedBooking.leadName || 'Demo meeting'}</h2><p>{selectedBooking.companyName || selectedBooking.leadEmail}</p></div><button type="button" className="schedule-icon-button" onClick={() => setSelectedBookingId(null)} aria-label="Close booking details"><X className="h-4 w-4" /></button></header>
            <div className="schedule-detail-tabs"><button type="button" className={bookingDetailsTab === 'DETAILS' ? 'is-active' : ''} onClick={() => setBookingDetailsTab('DETAILS')}>Overview</button><button type="button" className={bookingDetailsTab === 'ATTENDEES' ? 'is-active' : ''} onClick={() => setBookingDetailsTab('ATTENDEES')}>Attendees ({selectedBooking.attendees?.length || 1})</button></div>
            {bookingDetailsTab === 'DETAILS' ? <div className="schedule-detail-body">
              <div className="schedule-detail-date"><CalendarDays className="h-5 w-5" /><div><strong>{formatDateKey(selectedBooking.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong><span>{selectedBooking.startTime} – {selectedBooking.endTime} · {selectedBooking.timezone || tzl}</span></div></div>
              <div className="schedule-detail-facts"><div><span>Status</span>{renderBookingStatus(selectedBooking.status)}</div><div><span>Channel</span><strong>{selectedBooking.channel}</strong></div><div><span>Platform</span><strong>{selectedBooking.calendarProvider === 'microsoft' ? 'Microsoft Teams' : 'Google Meet'}</strong></div><div><span>Email</span><strong>{selectedBooking.leadEmail || '—'}</strong></div><div><span>Phone</span><strong>{selectedBooking.leadPhone || '—'}</strong></div><div><span>Booking ID</span><strong>{selectedBooking.bookingId}</strong></div></div>
              {selectedBooking.googleMeetLink && <a className="schedule-detail-join" href={selectedBooking.googleMeetLink} target="_blank" rel="noreferrer"><Video className="h-4 w-4" /> Join {selectedBooking.calendarProvider === 'microsoft' ? 'Teams' : 'Meet'} <ArrowUpRight className="h-3.5 w-3.5" /></a>}
              {selectedBooking.notes && <div className="schedule-detail-note"><strong>Notes</strong><p>{selectedBooking.notes}</p></div>}
            </div> : <div className="schedule-detail-body">
              <div className="schedule-attendee-primary"><User className="h-4 w-4" /><div><strong>{selectedBooking.leadName}</strong><span>{selectedBooking.leadEmail}</span></div><em>Lead</em></div>
              {(selectedBooking.attendees || []).filter((attendee) => attendee && attendee.toLowerCase() !== selectedBooking.leadEmail?.toLowerCase() && attendee.toLowerCase() !== CALENDAR_TARGET_ACCOUNT.toLowerCase()).map((attendee) => <div className="schedule-attendee-primary" key={attendee}><Mail className="h-4 w-4" /><div><strong>{attendee}</strong><span>Invited guest</span></div></div>)}
              {selectedBooking.status !== 'CANCELLED' && selectedBooking.status !== 'COMPLETED' && <button type="button" className="schedule-secondary-button" onClick={() => openBookingAttendees(selectedBooking)}><UserPlus className="h-4 w-4" /> Add attendees</button>}
            </div>}
            <footer className="schedule-detail-actions">
              {selectedBooking.status !== 'CANCELLED' && selectedBooking.status !== 'COMPLETED' ? <><button type="button" className="schedule-secondary-button" onClick={() => { setRescheduleBookingId(selectedBooking.bookingId); setSelectedBookingId(null); setActiveView('CALENDAR'); setCalendarMode('WEEK'); }}><CalendarClock className="h-4 w-4" /> Reschedule</button><button type="button" className="schedule-danger-button" onClick={() => handleCancelBooking(selectedBooking.bookingId)}><XCircle className="h-4 w-4" /> Cancel meeting</button></> : <span className="schedule-detail-closed">This booking is {selectedBooking.status.toLowerCase()}.</span>}
            </footer>
          </aside>
        </div>
      )}

      {attendeeModalBooking && (
        <div className="schedule-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAttendeeModalBooking(null); }}>
          <section className="schedule-booking-modal schedule-attendee-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-attendee-title">
            <div className="schedule-modal-header"><div><span className="schedule-eyebrow">MEETING INVITATIONS</span><h2 id="schedule-attendee-title">Manage attendees</h2><p>{attendeeModalBooking.leadName} · {attendeeModalBooking.date} · {attendeeModalBooking.startTime}</p></div><button type="button" className="schedule-icon-button" onClick={() => setAttendeeModalBooking(null)} aria-label="Close"><X className="h-4 w-4" /></button></div>
            <div className="schedule-current-attendees"><strong>Current invitees</strong>{(attendeeModalBooking.attendees || [attendeeModalBooking.leadEmail]).map((attendee) => <span key={attendee}><Mail className="h-3.5 w-3.5" />{attendee}</span>)}</div>
            <form onSubmit={handleAddAttendeeSubmit} className="schedule-booking-form">
              <label className="schedule-full-field"><span>Additional attendee emails</span><textarea rows={3} value={newAttendeeEmailInput} onChange={(event) => setNewAttendeeEmailInput(event.target.value)} placeholder="colleague@agency.com, manager@agency.com" required /></label>
              <p className="schedule-settings-hint">Separate multiple email addresses with commas or spaces. The calendar provider will send the invitation.</p>
              {addAttendeeSuccess && <div className="schedule-inline-message success">{addAttendeeSuccess}</div>}
              <div className="schedule-modal-actions"><button type="button" className="schedule-secondary-button" onClick={() => setAttendeeModalBooking(null)}>Close</button><button type="submit" className="schedule-primary-button" disabled={isAddingAttendee}>{isAddingAttendee ? 'Sending invitations…' : 'Add attendees and send invites'}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};
