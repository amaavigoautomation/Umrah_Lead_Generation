import React, { useState, useEffect } from 'react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { DAY_NAMES, brandTzLabel, brandWorkingDaysLabel, brandWorkingWindowLabel, fmtHour, workingHoursForDay } from '../shared/brand';
import {
  Calendar as CalendarIcon,
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
} from 'lucide-react';
import { Booking, Channel, Lead } from '../types/index.js';
import {
  signInWithGoogleCalendar,
  getCalendarAccessToken,
  registerCalendarAccessToken,
  initCalendarAuth,
  hasCalendarToken,
  CALENDAR_TARGET_ACCOUNT,
} from '../services/googleCalendarAuth.js';

interface DemoSchedulingViewProps {
  leads?: Lead[];
  tenantId: string;
  canEditSettings: boolean;
}

export const DemoSchedulingView: React.FC<DemoSchedulingViewProps> = ({ leads = [], tenantId, canEditSettings }) => {
  const { brand, setBrand } = useBrand();
  const [availabilityDraft, setAvailabilityDraft] = useState<TenantBrand>(brand);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [availabilitySaveMessage, setAvailabilitySaveMessage] = useState<string | null>(null);
  useEffect(() => setAvailabilityDraft(brand), [brand]);

  const updateAvailabilityText = (field: 'timezone' | 'timezoneLabel' | 'calendarEmail', value: string) => {
    setAvailabilityDraft((current) => ({ ...current, [field]: value }));
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
        body: JSON.stringify({ brand: availabilityDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setBrand(data.brand);
      setAvailabilityDraft(data.brand);
      setAvailabilitySaveMessage('Demo booking availability saved.');
      fetchAvailability();
    } catch (err: any) {
      setAvailabilitySaveMessage(err?.message || 'Could not save demo booking availability.');
    } finally {
      setIsSavingAvailability(false);
    }
  };
  const tzl = brandTzLabel(brand);
  const dayRange = brandWorkingDaysLabel(brand).replace(' to ', '–').replace(/Monday/g, 'Mon').replace(/Tuesday/g, 'Tue').replace(/Wednesday/g, 'Wed').replace(/Thursday/g, 'Thu').replace(/Friday/g, 'Fri').replace(/Saturday/g, 'Sat').replace(/Sunday/g, 'Sun');
  const hoursLabel = brandWorkingWindowLabel(brand);
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

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);

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
  // Manual Meeting Intelligence proof-of-concept. This does not auto-join booked demos.
  const [meetingBotTestUrl, setMeetingBotTestUrl] = useState('');
  const [meetingBotTestSeconds, setMeetingBotTestSeconds] = useState(15);
  const [meetingBotTestConsent, setMeetingBotTestConsent] = useState(false);
  const [isMeetingBotTestRunning, setIsMeetingBotTestRunning] = useState(false);
  const [meetingBotTestError, setMeetingBotTestError] = useState<string | null>(null);
  const [meetingBotTestResult, setMeetingBotTestResult] = useState<any | null>(null);
  const [meetingBotGoogleSession, setMeetingBotGoogleSession] = useState<any | null>(null);
  const [isMeetingBotSessionLoading, setIsMeetingBotSessionLoading] = useState(false);
  const [isMeetingBotSessionSaving, setIsMeetingBotSessionSaving] = useState(false);
  const [meetingBotSessionMessage, setMeetingBotSessionMessage] = useState<string | null>(null);



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
  const fetchAvailability = async () => {
    setIsLoadingSlots(true);
    try {
      const token = await getCalendarAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['X-Google-Access-Token'] = token;

      const res = await fetch('/api/calendar/availability?count=8', { headers });
      if (res.status === 401) {
        // A 401 can come from the app's own login check, not only from Google. Do not throw the token
        // away on it: let the status check (which asks Google directly) decide.
        console.warn('[Calendar] availability returned 401, re-checking status');
        checkStatus();
      } else if (res.ok) {
        const data = await res.json();
        setAvailableSlots(data.slots || []);
      }
    } catch (e) {
      console.warn('Error fetching calendar availability:', e);
    } finally {
      setIsLoadingSlots(false);
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
          fetchAvailability();
          fetchBookings();
        }
      },
      () => {
        checkStatus();
      }
    );
    checkStatus();
    fetchAvailability();
    fetchBookings();

    // Booking changes may be made by the AI from email/WhatsApp while this page is open.
    // Refresh the table periodically and whenever the operator returns to this tab.
    const refreshCalendarData = () => {
      if (document.visibilityState !== 'visible') return;
      fetchBookings();
      fetchAvailability();
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
      const slotsRes = await fetch('/api/calendar/availability?count=1');
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
        setBookingSuccessMsg(`Demo booked. ${videoLabel} link: ${data.booking.googleMeetLink}`);
        setSelectedSlot(null);
        fetchAvailability();
        fetchBookings();
      } else {
        alert(data.error || 'Failed to book slot on Google Calendar');
      }
    } catch (err: any) {
      alert(err?.message || 'Booking failed');
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
      if (res.ok) {
        fetchBookings();
        fetchAvailability();
      }
    } catch (err) {
      console.warn('Error cancelling:', err);
    }
  };

  // Handle Reschedule
  const handleRescheduleBooking = async (bookingId: string, slot: any) => {
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

      if (res.ok) {
        setRescheduleBookingId(null);
        setBookingSuccessMsg(`Demo rescheduled on Google Calendar!`);
        fetchBookings();
        fetchAvailability();
      }
    } catch (e) {
      console.warn('Error rescheduling:', e);
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


  // Short, consented Google Meet audio-capture test on Vercel serverless Chromium.
  const handleMeetingBotTrial = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!meetingBotTestUrl.trim() || !meetingBotTestConsent) return;
    setIsMeetingBotTestRunning(true);
    setMeetingBotTestError(null);
    setMeetingBotTestResult(null);
    try {
      const response = await fetch('/api/meeting-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingUrl: meetingBotTestUrl.trim(),
          recordingSeconds: meetingBotTestSeconds,
          consentConfirmed: meetingBotTestConsent,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMeetingBotTestResult(data);
        throw new Error(data?.error || 'Meeting bot test failed.');
      }
      setMeetingBotTestResult(data);
    } catch (error: any) {
      setMeetingBotTestError(error?.message || 'Meeting bot test failed.');
    } finally {
      setIsMeetingBotTestRunning(false);
    }
  };

  const refreshMeetingBotGoogleSession = async () => {
    setIsMeetingBotSessionLoading(true);
    try {
      const response = await fetch('/api/meeting-intelligence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'session-status' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not read Google bot account status.');
      setMeetingBotGoogleSession(data.session || { configured: false });
    } catch (error: any) {
      setMeetingBotSessionMessage(error?.message || 'Could not read Google bot account status.');
    } finally {
      setIsMeetingBotSessionLoading(false);
    }
  };

  useEffect(() => {
    if (canEditSettings) refreshMeetingBotGoogleSession();
  }, [tenantId, canEditSettings]);

  const handleMeetingBotSessionUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1_500_000) {
      setMeetingBotSessionMessage('Session export is too large. Re-export the account session and try again.');
      return;
    }
    setIsMeetingBotSessionSaving(true);
    setMeetingBotSessionMessage(null);
    try {
      const session = JSON.parse(await file.text());
      const response = await fetch('/api/meeting-intelligence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'session-upload', session }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not save the Google bot account session.');
      setMeetingBotGoogleSession(data.session || { configured: true });
      setMeetingBotSessionMessage('Dedicated Google account session encrypted and saved for this workspace.');
    } catch (error: any) {
      setMeetingBotSessionMessage(error?.message || 'Could not upload this Google session export.');
    } finally {
      setIsMeetingBotSessionSaving(false);
    }
  };

  const handleMeetingBotSessionDelete = async () => {
    if (!window.confirm('Disconnect the saved Google bot account session for this workspace?')) return;
    setIsMeetingBotSessionSaving(true);
    setMeetingBotSessionMessage(null);
    try {
      const response = await fetch('/api/meeting-intelligence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'session-delete' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not remove the saved Google bot session.');
      setMeetingBotGoogleSession(data.session || { configured: false });
      setMeetingBotSessionMessage('Google bot account disconnected. The encrypted session was deleted.');
    } catch (error: any) {
      setMeetingBotSessionMessage(error?.message || 'Could not remove the saved Google bot session.');
    } finally {
      setIsMeetingBotSessionSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {canEditSettings && (
        <section className="bg-white border border-indigo-200 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900">Meeting Intelligence — Trial 1</h2>
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-extrabold uppercase">Experimental</span>
              </div>
              <p className="text-xs text-slate-600 max-w-3xl">
                Test whether serverless Chromium can join Google Meet using a dedicated, authenticated Google account and capture incoming participant audio through WebRTC.
                This remains a short manual test; it does not automatically join booked demos.
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-2.5 py-1">
              Vercel runtime test
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">Dedicated Google bot account</div>
                <p className="mt-1 text-xs text-slate-600">
                  Sign in manually to a dedicated Google account on your computer, then upload its temporary browser-session export here.
                  The password and 2-step verification code are never entered into this app.
                </p>
              </div>
              <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase text-slate-700">
                {isMeetingBotSessionLoading ? 'Checking account' : meetingBotGoogleSession?.configured ? 'Account connected' : 'Account not connected'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-white border border-slate-200 p-3">
                <div className="font-bold text-slate-700">1. Sign in locally</div>
                <div className="mt-1 text-slate-500">From your local trial-1 repository, run:</div>
                <code className="mt-2 block rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-800">npm run meeting-bot:login</code>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-3">
                <div className="font-bold text-slate-700">2. Upload session</div>
                <div className="mt-1 text-slate-500">Chrome opens for manual Google sign-in and creates a JSON export.</div>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {isMeetingBotSessionSaving ? 'Saving session…' : 'Upload Google session JSON'}
                  <input type="file" accept="application/json,.json" className="hidden"
                    disabled={isMeetingBotSessionSaving || !canEditSettings}
                    onChange={handleMeetingBotSessionUpload} />
                </label>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-3">
                <div className="font-bold text-slate-700">3. Invite this account</div>
                <div className="mt-1 text-slate-500">Add the bot email as an attendee to the Google Calendar event that owns the Meet link.</div>
                <div className="mt-2 text-slate-800 font-semibold break-all">
                  {meetingBotGoogleSession?.accountEmail || 'Available after account upload'}
                </div>
              </div>
            </div>
            {meetingBotGoogleSession?.configured && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
                <div className="text-emerald-800">
                  <strong>{meetingBotGoogleSession.accountEmail}</strong>
                  <span className="ml-2 text-emerald-700">Encrypted session saved · {meetingBotGoogleSession.cookieCount || 0} cookies</span>
                </div>
                <button type="button" onClick={handleMeetingBotSessionDelete}
                  disabled={isMeetingBotSessionSaving}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Disconnect account
                </button>
              </div>
            )}
            {meetingBotSessionMessage && (
              <p className="text-xs text-slate-700" role="status">{meetingBotSessionMessage}</p>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500">
              Security: the export contains reusable Google sign-in cookies. It is sent over HTTPS and encrypted with a trial-only server key before being stored in this workspace’s private secrets collection.
              After upload, securely delete the JSON export and keep the local Chrome profile private. Re-export if Google expires or revokes the session.
            </p>
          </div>

          <form onSubmit={handleMeetingBotTrial} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-3">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-700 mb-1">Google Meet URL</span>
                <input type="url" required value={meetingBotTestUrl}
                  onChange={(e) => setMeetingBotTestUrl(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  disabled={isMeetingBotTestRunning}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-500 disabled:bg-slate-100" />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-slate-700 mb-1">Audio sample length</span>
                <select value={meetingBotTestSeconds}
                  onChange={(e) => setMeetingBotTestSeconds(Number(e.target.value))}
                  disabled={isMeetingBotTestRunning}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 disabled:bg-slate-100">
                  <option value={10}>10 seconds</option>
                  <option value={15}>15 seconds</option>
                  <option value={20}>20 seconds</option>
                </select>
              </label>
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
              <input type="checkbox" required checked={meetingBotTestConsent}
                onChange={(e) => setMeetingBotTestConsent(e.target.checked)}
                disabled={isMeetingBotTestRunning} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span className="text-xs text-slate-700 leading-relaxed">
                I have informed everyone in this meeting that the clearly identified test bot will join and capture meeting audio, and they have agreed.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit"
                disabled={isMeetingBotTestRunning || !meetingBotTestConsent || !meetingBotTestUrl.trim() || !meetingBotGoogleSession?.configured}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2.5">
                <Video className="w-4 h-4" />
                {isMeetingBotTestRunning ? 'Launching bot and testing audio…' : 'Join Meet & capture sample'}
              </button>
              <span className="text-[11px] text-slate-500">Signed in as: {meetingBotGoogleSession?.accountEmail || 'Connect a bot account first'}</span>
            </div>
          </form>

          {isMeetingBotTestRunning && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-xs text-indigo-800">
              Chromium is restoring the dedicated Google account session, joining the invited meeting and capturing the short audio sample. Keep a participant speaking.
            </div>
          )}

          {meetingBotTestError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <strong>Test failed:</strong> {meetingBotTestError}
              {meetingBotTestResult?.code && <div className="mt-1 font-mono text-[10px]">Code: {meetingBotTestResult.code}</div>}
              {Array.isArray(meetingBotTestResult?.diagnostics) && meetingBotTestResult.diagnostics.length > 0 && (
                <ul className="mt-2 list-disc pl-4 space-y-1">
                  {meetingBotTestResult.diagnostics.map((item: string, index: number) => <li key={index}>{item}</li>)}
                </ul>
              )}
            </div>
          )}

          {meetingBotTestResult?.success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="w-4 h-4" /> Audio sample captured
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><span className="block text-slate-500">Meet status</span><strong className="text-slate-900">Joined</strong></div>
                <div><span className="block text-slate-500">Remote audio tracks</span><strong className="text-slate-900">{meetingBotTestResult.audioTrackCount}</strong></div>
                <div><span className="block text-slate-500">Sample length</span><strong className="text-slate-900">{Math.round(meetingBotTestResult.recordingMs / 1000)} sec</strong></div>
                <div><span className="block text-slate-500">Audio size</span><strong className="text-slate-900">{Math.max(1, Math.round(meetingBotTestResult.recordingBytes / 1024))} KB</strong></div>
              </div>
              {meetingBotTestResult.audioDataUrl && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">Captured meeting audio</label>
                  <audio controls preload="none" src={meetingBotTestResult.audioDataUrl} className="w-full" />
                  <p className="text-[11px] text-slate-600">Play this sample to confirm that participant speech—not just an empty recording—was captured. The test recording is not saved to Firestore.</p>
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            Privacy: run this only with participant consent. The dedicated bot account joins as an invited participant with microphone and camera off. Temporary test audio is returned for playback and is not saved to Firestore.
          </p>
        </section>
      )}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-600" />
          <h2 className="text-base font-bold text-slate-900">Demo booking availability</h2>
        </div>
        <p className="text-xs text-slate-500">
          Choose the session length first. Start times repeat at that interval, and the full session must fit inside each day's working window.
        </p>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 mb-1">Demo duration (minutes)</span>
            <input type="number" min={5} max={240} step={1}
              disabled={!canEditSettings || isSavingAvailability}
              value={availabilityDraft.demoDurationMinutes}
              onChange={(e) => setAvailabilityDraft((current) => ({ ...current, demoDurationMinutes: Number(e.target.value) }))}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-orange-500 disabled:bg-slate-100" />
            <span className="block text-[11px] text-slate-400 mt-1">Examples: 20, 30, 45 or 60 minutes.</span>
          </label>
          {([
            ['timezone', 'Timezone (IANA)', 'Asia/Kolkata'],
            ['timezoneLabel', 'Timezone label shown to customers', 'IST'],
            ['calendarEmail', 'Calendar email for demo invites', 'you@company.com'],
          ] as const).map(([field, label, placeholder]) => (
            <label key={field} className="block">
              <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>
              <input type="text" disabled={!canEditSettings || isSavingAvailability}
                value={availabilityDraft[field]} placeholder={placeholder}
                onChange={(e) => updateAvailabilityText(field, e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-orange-500 disabled:bg-slate-100" />
            </label>
          ))}
        </div>
        <div className="space-y-2">
          {DAY_NAMES.map((day, dayIndex) => {
            const enabled = availabilityDraft.workingDays.includes(dayIndex);
            const hours = workingHoursForDay(availabilityDraft, dayIndex);
            return (
              <div key={day} className="grid grid-cols-1 sm:grid-cols-[minmax(130px,1fr)_1fr_1fr] gap-3 items-center rounded-lg border border-slate-100 p-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" disabled={!canEditSettings || isSavingAvailability}
                    checked={enabled} onChange={() => toggleAvailabilityDay(dayIndex)}
                    className="h-4 w-4 accent-orange-600" />
                  {day}
                  {!enabled && <span className="text-xs font-normal text-slate-400">Closed</span>}
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">Start time</span>
                  <select
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                    disabled={!canEditSettings || isSavingAvailability || !enabled}
                    value={hours.start} onChange={(e) => updateAvailabilityHours(dayIndex, 'start', Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{fmtHour(hour)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">End time</span>
                  <select
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                    disabled={!canEditSettings || isSavingAvailability || !enabled}
                    value={hours.end} onChange={(e) => updateAvailabilityHours(dayIndex, 'end', Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) =>
                      <option key={hour} value={hour}>{hour === 24 ? '12:00 AM (midnight)' : fmtHour(hour)}</option>
                    )}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          Customers will see: {brandWorkingWindowLabel(availabilityDraft)}. Each demo is {availabilityDraft.demoDurationMinutes} minutes; start times repeat every {availabilityDraft.demoDurationMinutes} minutes.
        </p>
        {!canEditSettings && <p className="text-xs text-slate-500">Only an administrator can change demo booking availability.</p>}
        {availabilitySaveMessage && (
          <p className={`text-xs ${availabilitySaveMessage === 'Demo booking availability saved.' ? 'text-emerald-700' : 'text-red-600'}`}>
            {availabilitySaveMessage}
          </p>
        )}
        {canEditSettings && (
          <button type="button" onClick={saveDemoAvailability} disabled={isSavingAvailability}
            className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2">
            {isSavingAvailability ? 'Saving…' : 'Save demo availability'}
          </button>
        )}
      </section>
      <div className="space-y-6">
      {/* Top Banner / Calendar Integration Status */}
      <div className="bg-gradient-to-r from-orange-50/80 via-white to-amber-50/40 border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 bg-orange-500 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-2xs">
                <ShieldCheck className="w-3.5 h-3.5" />
                CENTRAL DEMO SCHEDULING AGENT
              </span>
              <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200/90 text-xs rounded-lg font-bold">
                {brand.timezone}{brand.timezoneLabel ? ` (${brand.timezoneLabel})` : ''}
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-orange-500" />
              Demo calendar (Google or Microsoft)
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl font-medium leading-relaxed">
              All demo requests across <strong className="text-slate-900 font-bold">Website, Email, WhatsApp, and Campaigns</strong> use one connected calendar.
              Google → <strong>Google Meet</strong>. Microsoft 365 → <strong>Microsoft Teams</strong>. Only one can be connected at a time
              ({dayRange}, {hoursLabel} · {brand.demoDurationMinutes} min per demo
              {connectedEmail ? <> · {connectedEmail}</> : CALENDAR_TARGET_ACCOUNT ? <> · {CALENDAR_TARGET_ACCOUNT}</> : null}).
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 text-xs bg-slate-900 text-white px-3.5 py-2 rounded-xl border border-slate-800 shadow-2xs">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  calendarConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="font-bold">
                {calendarConnected
                  ? `Active · ${calendarProvider === 'microsoft' ? 'Microsoft / Teams' : 'Google / Meet'}`
                  : 'No calendar connected'}
              </span>
            </div>
            {calendarConnected && (
              <button
                onClick={handleTestGoogleBooking}
                disabled={isTestingBooking}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title={`Book a test demo on the next free slot to verify ${videoLabel}`}
              >
                <Video className={`w-3.5 h-3.5 ${isTestingBooking ? 'animate-pulse' : ''}`} />
                <span>{isTestingBooking ? 'Booking Test...' : `Test ${calendarProvider === 'microsoft' ? 'Teams' : 'Meet'} Booking`}</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            className={`rounded-xl border p-4 space-y-3 ${
              googleActive ? 'border-emerald-300 bg-emerald-50/70' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Google Calendar sync</h3>
                <p className="text-xs text-slate-600 mt-0.5 font-medium">
                  Books on Google Calendar. Invite includes a <strong>Google Meet</strong> link.
                </p>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${
                  googleActive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {googleActive ? 'Connected' : 'Off'}
              </span>
            </div>
            {googleActive && connectedEmail && (
              <p className="text-[11px] text-slate-600 font-medium break-all">{connectedEmail}</p>
            )}
            {microsoftActive && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                Connecting Google will disconnect Microsoft Calendar.
              </p>
            )}
            {googleActive && googleAutoRenew === true && (
              <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5">
                Renews automatically. No need to re-sync.
              </p>
            )}
            {googleActive && googleAutoRenew === false && googleOAuthAvailable !== false && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                This connection expires after about an hour. Click Re-sync once to switch to automatic renewal.
              </p>
            )}
            {googleOAuthAvailable === false && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                Automatic renewal is not set up on this server (GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, APP_URL), so Google disconnects after about an hour.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleConnectGoogleCalendar}
                disabled={isAuthenticating || isMsAuthenticating}
                className="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-lg disabled:opacity-50"
              >
                {isAuthenticating ? 'Authorizing…' : googleActive ? 'Re-sync Google Calendar' : 'Sync Google Calendar'}
              </button>
              {googleActive && (
                <button onClick={handleDisconnectCalendar} className="text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-lg">
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowManualTokenInput(!showManualTokenInput)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 px-2 py-2"
              >
                Paste Google token
              </button>
            </div>
          </div>

          <div
            className={`rounded-xl border p-4 space-y-3 ${
              microsoftActive ? 'border-emerald-300 bg-emerald-50/70' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Microsoft Calendar sync</h3>
                <p className="text-xs text-slate-600 mt-0.5 font-medium">
                  Books on Outlook / Microsoft 365. Invite includes a <strong>Microsoft Teams</strong> link.
                </p>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${
                  microsoftActive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {microsoftActive ? 'Connected' : 'Off'}
              </span>
            </div>
            {microsoftActive && connectedEmail && (
              <p className="text-[11px] text-slate-600 font-medium break-all">{connectedEmail}</p>
            )}
            {googleActive && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                Connecting Microsoft will disconnect Google Calendar.
              </p>
            )}
            {!microsoftAvailable && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                Microsoft Calendar is not set up on this server yet (MICROSOFT_CLIENT_ID, SECRET, APP_URL).
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleConnectMicrosoftCalendar}
                disabled={isAuthenticating || isMsAuthenticating || !microsoftAvailable}
                className="text-xs font-bold bg-[#5B5FC7] hover:bg-[#4B4FAE] text-white px-3.5 py-2 rounded-lg disabled:opacity-50"
              >
                {isMsAuthenticating ? 'Redirecting…' : microsoftActive ? 'Re-sync Microsoft Calendar' : 'Sync Microsoft Calendar'}
              </button>
              {microsoftActive && (
                <button onClick={handleDisconnectCalendar} className="text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-lg">
                  Disconnect
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Manual Token Setup Accordion */}
        {showManualTokenInput && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Google Calendar OAuth Token Manual Override
              </h4>
              <button onClick={() => setShowManualTokenInput(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer font-bold">
                ✕
              </button>
            </div>
            <p className="text-slate-600 font-medium">
              If browser popup was blocked in preview iframe, you can paste a Google OAuth Access Token here. It will immediately be synchronized with the server engine and stored in Firestore for background scheduling pipelines.
            </p>
            <form onSubmit={handleManualTokenSubmit} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="ya29.a0..."
                className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono text-xs focus:outline-none focus:border-emerald-500 shadow-2xs"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer shrink-0 shadow-2xs"
              >
                Save & Activate Token
              </button>
            </form>
            {manualTokenStatus && (
              <div className="text-emerald-700 text-xs font-mono font-bold">{manualTokenStatus}</div>
            )}
          </div>
        )}

        {authError && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2 font-medium shadow-2xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{authError}</span>
          </div>
        )}

        {bookingSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl flex items-center justify-between gap-2 font-medium shadow-2xs">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              {bookingSuccessMsg}
            </span>
            <button onClick={() => setBookingSuccessMsg(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer font-bold">
              ×
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: Realtime Available Slots & Confirmed Bookings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Realtime Google Calendar Slots (Mon–Fri 10–19 IST) */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                <h3 className="font-extrabold text-slate-900 text-base">Realtime Free Slots</h3>
              </div>
              <button
                onClick={fetchAvailability}
                disabled={isLoadingSlots}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Refresh Availability from Google Calendar"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingSlots ? 'animate-spin text-orange-500' : ''}`} />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4 font-medium leading-relaxed">
              Queried directly from Google Calendar API. {dayRange}, {hoursLabel} only. Click any slot to quick-book
              or reschedule.
            </p>

            {isLoadingSlots && availableSlots.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 font-medium animate-pulse">
                Querying Google Calendar freebusy...
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl p-4 font-medium border border-slate-100">
                No open slots found for the upcoming 5 days.
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {availableSlots.map((slot, i) => (
                  <div
                    key={`${slot.date}-${slot.startHour}-${slot.startMinute}-${i}`}
                    onClick={() => {
                      if (rescheduleBookingId) {
                        handleRescheduleBooking(rescheduleBookingId, slot);
                      } else {
                        setSelectedSlot(slot);
                      }
                    }}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                      selectedSlot?.startIso === slot.startIso
                        ? 'bg-orange-50 border-orange-400 text-orange-950 font-bold shadow-2xs'
                        : 'bg-slate-50/80 border-slate-200/90 hover:border-orange-300 hover:bg-orange-50/40 text-slate-800'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-900">{slot.label}</div>
                      <div className="text-[11px] text-slate-500 font-medium">Duration: {slot.durationMinutes || brand.demoDurationMinutes} min • {videoLabel}</div>
                    </div>
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-800 border border-orange-200/80 rounded text-[10px] font-bold">
                      {rescheduleBookingId ? 'Reschedule' : 'Select'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between font-medium">
            <span>Hours: {hoursLabel}</span>
            <span className="text-orange-600 font-bold font-mono tabular-nums">{availableSlots.length} available</span>
          </div>
        </div>

        {/* Middle & Right Column: Confirmed Bookings Table */}
        <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-orange-500" />
                <h3 className="font-extrabold text-slate-900 text-base">Confirmed Demo Meetings</h3>
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-800 text-xs rounded-full border border-slate-200 font-bold font-mono tabular-nums">
                  {bookings.length}
                </span>
              </div>
              <button
                onClick={fetchBookings}
                disabled={isLoadingBookings}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Refresh Bookings Ledger"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingBookings ? 'animate-spin text-orange-500' : ''}`} />
              </button>
            </div>

            {rescheduleBookingId && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between font-medium">
                <span>Click any free slot on the left to reschedule booking #{rescheduleBookingId.slice(-6)}.</span>
                <button
                  onClick={() => setRescheduleBookingId(null)}
                  className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-[11px] font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
              </div>
            )}

            {isLoadingBookings && bookings.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 font-medium animate-pulse">Loading demo bookings...</div>
            ) : bookings.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 bg-slate-50 rounded-xl p-6 font-medium border border-slate-100">
                No demo appointments booked yet. Use the simulator below or select a slot to test.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[380px] overflow-y-auto pr-1">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/90 text-slate-700 uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-sm font-extrabold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Lead & Company</th>
                      <th className="py-2.5 px-3">Attendees & Invites</th>
                      <th className="py-2.5 px-3">Date & Time ({tzl})</th>
                      <th className="py-2.5 px-3">Channel</th>
                      <th className="py-2.5 px-3">{videoLabel}</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {bookings.map((b) => {
                      const additionalAttendees = (b.attendees || []).filter(
                        (a) => a && a.toLowerCase() !== b.leadEmail?.toLowerCase() && a.toLowerCase() !== CALENDAR_TARGET_ACCOUNT.toLowerCase()
                      );
                      return (
                        <tr key={b.bookingId} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900">{b.leadName}</div>
                            <div className="text-[11px] text-slate-600 font-medium">{b.companyName}</div>
                            <div className="text-[10px] text-slate-400 font-medium">{b.leadEmail}</div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-700 font-medium">
                                <Users className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                                <span>1 Lead + {additionalAttendees.length} Guest{additionalAttendees.length === 1 ? '' : 's'}</span>
                              </div>
                              {additionalAttendees.length > 0 && (
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {additionalAttendees.map((att, idx) => (
                                    <span
                                      key={idx}
                                      className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[9px] font-mono border border-slate-200/80 truncate max-w-[190px]"
                                      title={att}
                                    >
                                      {att}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {b.status !== 'CANCELLED' && (
                                <button
                                  onClick={() => {
                                    setAttendeeModalBooking(b);
                                    setNewAttendeeEmailInput('');
                                    setAddAttendeeSuccess(null);
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] text-orange-600 hover:text-orange-700 font-bold hover:underline cursor-pointer pt-0.5"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  <span>+ Add Attendee</span>
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-emerald-700">{b.date}</div>
                            <div className="text-[11px] text-slate-600 font-mono">
                              {b.startTime} – {b.endTime} {tzl}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold border border-slate-200/80">
                              {b.channel}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            {b.googleMeetLink ? (
                              <div className="flex flex-col gap-1 items-start">
                                <a
                                  href={b.googleMeetLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer shadow-2xs"
                                >
                                  <Video className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Join Meet</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                b.status === 'BOOKED'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : b.status === 'RESCHEDULED'
                                  ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                  : 'bg-red-50 text-red-800 border border-red-200'
                              }`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            {b.status !== 'CANCELLED' ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setRescheduleBookingId(b.bookingId)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[10px] font-bold cursor-pointer transition border border-slate-200"
                                >
                                  Reschedule
                                </button>
                                <button
                                  onClick={() => handleCancelBooking(b.bookingId)}
                                  className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-[10px] font-bold cursor-pointer transition border border-red-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px] font-medium">Cancelled</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Booking Modal (when slot is selected on the left) */}
      {selectedSlot && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-orange-500" />
              <h3 className="font-extrabold text-slate-900 text-base">
                Book Demo for Slot: <span className="text-orange-600">{selectedSlot.label}</span>
              </h3>
            </div>
            <button
              onClick={() => setSelectedSlot(null)}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer font-bold"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleQuickBook} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1 font-bold">Lead Name *</label>
              <input
                type="text"
                required
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                placeholder="e.g. Wasim Saikh"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:bg-white shadow-2xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-600 mb-1 font-bold">Lead Email *</label>
              <input
                type="email"
                required
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                placeholder="lead@bakhlatours.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:bg-white shadow-2xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-600 mb-1 font-bold">Company / Agency *</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Bakhla Tours & Travels"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:bg-white shadow-2xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-600 mb-1 font-bold">Origin Channel</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:border-orange-500 focus:bg-white shadow-2xs"
              >
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="WEBSITE">Website</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBooking}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isBooking ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Booking on Google Calendar...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm & Generate {videoLabel} Link</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Attendee to Demo Meeting Modal */}
      {attendeeModalBooking && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-orange-500" />
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">
                  Add Attendee to Demo Meeting
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {attendeeModalBooking.companyName} ({attendeeModalBooking.leadName}) • {attendeeModalBooking.date} ({attendeeModalBooking.startTime} – {attendeeModalBooking.endTime} {tzl})
                </p>
              </div>
            </div>
            <button
              onClick={() => setAttendeeModalBooking(null)}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer font-bold"
            >
              ✕
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] text-slate-600 mb-1.5 font-bold">Currently Invited Attendees:</label>
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
              {(attendeeModalBooking.attendees || [attendeeModalBooking.leadEmail]).map((att, i) => (
                <span key={i} className="px-2 py-1 bg-white text-slate-800 rounded-lg text-xs font-mono border border-slate-200 flex items-center gap-1.5 shadow-2xs font-bold">
                  <User className="w-3 h-3 text-slate-400" />
                  {att}
                </span>
              ))}
            </div>
          </div>

          <form onSubmit={handleAddAttendeeSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1 font-bold">
                New Colleague / Guest Email Address(es) *
              </label>
              <input
                type="text"
                required
                value={newAttendeeEmailInput}
                onChange={(e) => setNewAttendeeEmailInput(e.target.value)}
                placeholder="e.g. tariq@bakhla.com, partner@umrahagency.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:bg-white shadow-2xs"
              />
              <p className="text-[11px] text-slate-500 mt-1 font-medium">
                The connected calendar will send the invite and {videoLabel} link to these email addresses.
              </p>
            </div>

            {addAttendeeSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{addAttendeeSuccess}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAttendeeModalBooking(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAddingAttendee}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isAddingAttendee ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending Calendar Invite...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Attendee & Send Google Calendar Invite</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bottom Section: Omnichannel Scheduling Agent Interactive Simulator */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-5 h-5 text-orange-500" />
          <h3 className="font-extrabold text-slate-900 text-base">Omnichannel Scheduling Agent Interactive Simulator</h3>
        </div>
        <p className="text-xs text-slate-500 mb-5 font-medium leading-relaxed max-w-3xl">
          Test conversational scheduling requests across Website, Email, or WhatsApp. The agent parses intent,
          converts natural relative dates ("Tomorrow afternoon", "Wednesday 3 PM") into {tzl}, checks Google Calendar in
          realtime, and creates meetings or suggests alternatives.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="space-y-4 bg-slate-50/80 p-4 rounded-xl border border-slate-200/80">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1 font-bold">Channel</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs bg-white p-0.5 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setSimChannel('EMAIL')}
                    className={`flex-1 py-1 text-center cursor-pointer font-bold rounded-md transition-colors ${
                      simChannel === 'EMAIL' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimChannel('WHATSAPP')}
                    className={`flex-1 py-1 text-center cursor-pointer font-bold rounded-md transition-colors ${
                      simChannel === 'WHATSAPP' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimChannel('WEBSITE')}
                    className={`flex-1 py-1 text-center cursor-pointer font-bold rounded-md transition-colors ${
                      simChannel === 'WEBSITE' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Website
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1 font-bold">Lead Name</label>
                <input
                  type="text"
                  value={simLeadName}
                  onChange={(e) => setSimLeadName(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:border-orange-500 shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1 font-bold">Email</label>
                <input
                  type="email"
                  value={simLeadEmail}
                  onChange={(e) => setSimLeadEmail(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:border-orange-500 shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-600 mb-1 font-bold">Simulated Incoming Message</label>
              <textarea
                rows={3}
                value={simMessage}
                onChange={(e) => setSimMessage(e.target.value)}
                placeholder="e.g. Can we schedule a demo on Thursday at 3 PM?"
                className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-900 font-medium placeholder-slate-400 focus:outline-none focus:border-orange-500 shadow-2xs"
              />
            </div>

            {/* Quick Sample Prompts */}
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="text-slate-500 self-center font-bold">Try:</span>
              <button
                type="button"
                onClick={() => setSimMessage('I would like to schedule a demo.')}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 cursor-pointer font-medium shadow-2xs transition"
              >
                "I want a demo"
              </button>
              <button
                type="button"
                onClick={() => setSimMessage('Can we do Thursday at 3 PM?')}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 cursor-pointer font-medium shadow-2xs transition"
              >
                "Thursday at 3 PM"
              </button>
              <button
                type="button"
                onClick={() => setSimMessage('Can we schedule for Saturday morning?')}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 cursor-pointer font-medium shadow-2xs transition"
              >
                "Saturday" (Weekend policy)
              </button>
              <button
                type="button"
                onClick={() => setSimMessage('Please also add my colleague Tariq at tariq@bakhla.com to the meeting')}
                className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-lg border border-orange-200 cursor-pointer font-bold shadow-2xs transition flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3 text-orange-600" />
                <span>"Add Colleague (Tariq)"</span>
              </button>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleRunSimulator}
                disabled={isSimulating}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSimulating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing with Google Calendar Agent...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Test Demo Scheduling Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Agent Output Panel */}
          <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-orange-500" />
                  Agent Response ({simChannel})
                </span>
                {simResponse?.action && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      simResponse.action === 'CONFIRMED_BOOKING'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : simResponse.action === 'OFFERED_ALTERNATIVES' || simResponse.action === 'AWAITING_CONFIRMATION'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-blue-50 text-blue-800 border border-blue-200'
                    }`}
                  >
                    Action: {simResponse.action}
                  </span>
                )}
              </div>

              {simResponse ? (
                <div className="space-y-3">
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200 text-xs text-slate-900 whitespace-pre-wrap leading-relaxed shadow-2xs font-medium">
                    {simResponse.replyText}
                  </div>

                  {simResponse.booking && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
                      <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Google Calendar Event Created!
                      </div>
                      <div className="text-[11px] text-slate-700 font-medium">
                        Date: {simResponse.booking.date} | {simResponse.booking.startTime} –{' '}
                        {simResponse.booking.endTime} {tzl}
                      </div>
                      <div className="text-[11px] text-emerald-800 font-mono font-bold break-all">
                        Meet: {simResponse.booking.googleMeetLink}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-16 text-center text-xs text-slate-400 font-medium">
                  Agent response preview will appear here when you run the simulator.
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-400 pt-3 border-t border-slate-200 font-medium">
              Response is automatically formatted for the target channel (Email / WhatsApp / Website) with {videoLabel}
              link.
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};
