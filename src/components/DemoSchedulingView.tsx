import React, { useState, useEffect } from 'react';
import { useBrand } from '../context/BrandContext';
import { brandTzLabel, brandWorkingDaysLabel, fmtHour } from '../shared/brand';
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
  CALENDAR_TARGET_ACCOUNT,
} from '../services/googleCalendarAuth.js';

interface DemoSchedulingViewProps {
  leads?: Lead[];
}

export const DemoSchedulingView: React.FC<DemoSchedulingViewProps> = ({ leads = [] }) => {
  const { brand } = useBrand();
  const tzl = brandTzLabel(brand);
  const dayRange = brandWorkingDaysLabel(brand).replace(' to ', '–').replace(/Monday/g, 'Mon').replace(/Tuesday/g, 'Tue').replace(/Wednesday/g, 'Wed').replace(/Thursday/g, 'Thu').replace(/Friday/g, 'Fri').replace(/Saturday/g, 'Sat').replace(/Sunday/g, 'Sun');
  const hoursLabel = `${fmtHour(brand.workingHoursStart)} – ${fmtHour(brand.workingHoursEnd)} ${tzl}`;
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [availableSlots, setAvailableSlots] = useState<
    Array<{ date: string; startHour: number; label: string; startIso: string; endIso: string }>
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
      const res = await fetch('/api/calendar/status');
      if (res.ok) {
        const data = await res.json();
        setCalendarConnected(Boolean(data.configured && data.connected));
      } else {
        setCalendarConnected(false);
      }
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
        setCalendarConnected(false);
        try {
          window.sessionStorage.removeItem('calendar_access_token');
        } catch {}
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
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Connect Google Calendar with popup
  const handleConnectGoogleCalendar = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const res = await signInWithGoogleCalendar();
      if (res?.accessToken) {
        setCalendarConnected(true);
        setBookingSuccessMsg(`Google Calendar & Meet connected (${CALENDAR_TARGET_ACCOUNT})! Real Google Meet links and calendar slot bookings are active.`);
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
          startTime: `${String(testSlot.startHour).padStart(2, '0')}:00`,
          endTime: `${String(testSlot.startHour + 1).padStart(2, '0')}:00`,
          accessToken: token || undefined,
        }),
      });

      const data = await bookRes.json();
      if (data.success && data.booking) {
        setBookingSuccessMsg(`Real Google Meet Created: ${data.booking.googleMeetLink} (Calendar ID: ${data.booking.calendarEventId})`);
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

      const startH = selectedSlot.startHour;
      const startTime = `${String(startH).padStart(2, '0')}:00`;
      const endTime = `${String(startH + 1).padStart(2, '0')}:00`;

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
        setBookingSuccessMsg(`Demo successfully booked on Google Calendar! Real Google Meet link: ${data.booking.googleMeetLink}`);
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

      const startH = slot.startHour;
      const startTime = `${String(startH).padStart(2, '0')}:00`;
      const endTime = `${String(startH + 1).padStart(2, '0')}:00`;

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

  return (
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
              Google Calendar Single Source of Truth
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl font-medium leading-relaxed">
              All demo requests across <strong className="text-slate-900 font-bold">Website, Email, WhatsApp, and Campaigns</strong> are validated in
              realtime against <strong className="text-slate-900 font-bold">{CALENDAR_TARGET_ACCOUNT}</strong>. Bookings generate authentic Google Meet rooms
              and reserve slots directly on Google Calendar ({dayRange}, {hoursLabel}).
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
                {calendarConnected ? 'Calendar Active & Synced' : 'Calendar Disconnected'}
              </span>
            </div>

            <button
              onClick={handleConnectGoogleCalendar}
              disabled={isAuthenticating}
              className="text-xs font-bold bg-white hover:bg-slate-50 text-slate-900 border border-slate-200/90 px-4 py-2 rounded-xl shadow-2xs hover:shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              <span>{isAuthenticating ? 'Authorizing...' : calendarConnected ? 'Re-sync Calendar' : 'Sync Calendar'}</span>
            </button>

            {calendarConnected && (
              <button
                onClick={handleTestGoogleBooking}
                disabled={isTestingBooking}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Book an automated test demo on the next free slot to verify authentic Google Meet creation"
              >
                <Video className={`w-3.5 h-3.5 ${isTestingBooking ? 'animate-pulse' : ''}`} />
                <span>{isTestingBooking ? 'Booking Test...' : 'Test Meet Booking'}</span>
              </button>
            )}

            <button
              onClick={() => setShowManualTokenInput(!showManualTokenInput)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-xl border border-slate-200/90 text-xs font-bold transition-colors cursor-pointer"
              title="Manual Token & Configuration Options"
            >
              Token Setup
            </button>
          </div>
        </div>

        {/* Unconnected Warning Alert Banner */}
        {!calendarConnected && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200/90 text-amber-900 text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-950 block text-sm mb-0.5 font-extrabold">Google Calendar & Real Google Meet Connection Required</strong>
                <span className="font-medium text-amber-800">
                  Connect your Google account (<strong>{CALENDAR_TARGET_ACCOUNT}</strong>) to enable authentic Google Meet video conference generation and reserve slots directly on your Google Calendar without dummy links.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleConnectGoogleCalendar}
                disabled={isAuthenticating}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-2xs text-xs transition-colors cursor-pointer"
              >
                {isAuthenticating ? 'Connecting...' : 'Connect Now'}
              </button>
              <button
                onClick={() => setShowManualTokenInput(true)}
                className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Paste Token
              </button>
            </div>
          </div>
        )}

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
                    key={`${slot.date}-${slot.startHour}-${i}`}
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
                      <div className="text-[11px] text-slate-500 font-medium">Duration: 60 min • Google Meet</div>
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
                      <th className="py-2.5 px-3">Google Meet</th>
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
                    <span>Confirm & Generate Google Meet Link</span>
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
                Google Calendar will immediately dispatch the official meeting invite and Google Meet link to these email addresses.
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
                        : simResponse.action === 'OFFERED_ALTERNATIVES'
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
              Response is automatically formatted for the target channel (Email / WhatsApp / Website) with Google Meet
              link.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};