import * as XLSX from 'xlsx';
import React, { useState, useMemo, useEffect } from 'react';
import { useBrand } from '../context/BrandContext';
import {
  Users,
  Search,
  Filter,
  CheckCircle,
  Clock,
  Phone,
  Mail,
  Building,
  Target,
  FileText,
  Calendar,
  MessageCircle,
  Send,
  AlertTriangle,
  Flame,
  ArrowUpDown,
  Eye,
  X,
  Layers,
  Globe,
  SlidersHorizontal,
  Plus,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  PhoneOff,
  UserCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Trash2,
  Edit3,
  CalendarClock,
  CheckSquare,
  Square,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Tag,
  MapPin,
  Compass,
  Zap,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import {
  Lead,
  Contact,
  LeadActivity,
  LeadStatus,
  LeadType,
  LeadSource,
  AppUser,
} from '../types';
import { WebsiteLeadIntegrationModal } from './WebsiteLeadIntegrationModal';
import { findDuplicateContact } from '../services/dataService';

export interface CrmPipelineProps {
  leads: Lead[];
  contacts: Contact[];
  activities: LeadActivity[];
  onOpenConversation: (conversationId?: string, leadId?: string) => void;
  selectedLeadId?: string | null;
  onUpdateLeadStatus?: (leadId: string, newStatus: LeadStatus) => void;
  onUpdateLead?: (updatedLead: Lead) => void;
  onAddLead?: (newLead: Lead, newContact: Contact) => void;
  /** Workspace team members that leads can be assigned to (used for non-Umrah360 workspaces). */
  teamMembers?: { id: string; name: string; role?: string }[];
  users?: AppUser[];
}

// Umrah360's default telecallers. Other workspaces use their own team members (see `teamMembers` prop).
const UMRAH360_TELECALLERS = [
  { id: 'caller-1', name: 'Zeeshan Khan', role: 'Senior Sales Telecaller', avatarColor: 'bg-emerald-500' },
  { id: 'caller-2', name: 'Aisha Rahman', role: 'Umrah Package Specialist', avatarColor: 'bg-blue-500' },
  { id: 'caller-3', name: 'Tariq Malik', role: 'B2B & Group Lead Closer', avatarColor: 'bg-purple-500' },
  { id: 'caller-4', name: 'Sarah Ahmed', role: 'Inbound Verification Agent', avatarColor: 'bg-amber-500' },
];

const AVATAR_COLORS = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

// TeleCRM Core Statuses with colors & labels
const TELECRM_STAGES: { key: string; label: string; bg: string; text: string; border: string; dot: string }[] = [
  { key: 'ALL', label: 'All Leads', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', dot: 'bg-slate-400' },
  { key: 'NEW', label: 'Fresh / New', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', dot: 'bg-blue-500' },
  { key: 'FOLLOW_UP', label: 'Follow Up / Due', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', dot: 'bg-amber-500' },
  { key: 'CONTACTED', label: 'Contacted', bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300', dot: 'bg-cyan-500' },
  { key: 'ENGAGED', label: 'In Discussion', bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-300', dot: 'bg-indigo-500' },
  { key: 'QUALIFIED', label: 'Interested / Hot', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300', dot: 'bg-emerald-500' },
  { key: 'DEMO_BOOKED', label: 'Consultation Booked', bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-300', dot: 'bg-purple-500' },
  { key: 'CLOSED_WON', label: 'Won / Booking Done', bg: 'bg-green-100', text: 'text-green-900', border: 'border-green-400', dot: 'bg-green-600' },
  { key: 'CLOSED_LOST', label: 'Lost / Junk', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-300', dot: 'bg-rose-500' },
];

export const CrmPipeline: React.FC<CrmPipelineProps> = ({
  leads,
  contacts,
  activities,
  onOpenConversation,
  selectedLeadId: initialSelectedLeadId,
  onUpdateLeadStatus,
  onUpdateLead,
  onAddLead,
  teamMembers,
  users,
}) => {
  const { brand } = useBrand();
  const isUmrah = brand.playbook === 'umrah360';
  const telecallers = useMemo(() => {
    const salesUsers = (users || [])
      .filter((u) => (u.role === 'SALES' || (u as any).appRole === 'SALES') && u.isActive !== false)
      .map((u, i) => ({
        id: u.userId,
        name: u.name,
        role: 'Sales Representative',
        avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      }));

    const base = isUmrah
      ? UMRAH360_TELECALLERS
      : (teamMembers || []).map((m, i) => ({
          id: m.id,
          name: m.name,
          role: m.role || 'Sales Team',
          avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
        }));

    const combined = [...base];
    for (const su of salesUsers) {
      if (!combined.some((c) => c.name.toLowerCase() === su.name.toLowerCase())) {
        combined.push(su);
      }
    }
    return combined;
  }, [isUmrah, teamMembers, users]);
  const defaultCaller = telecallers[0]?.name || 'Unassigned';
  const defaultService = isUmrah ? 'Umrah Custom Package' : 'General Enquiry';
  const greet = (name: string) => (isUmrah ? `Assalamu Alaikum ${name}!` : `Hi ${name}!`);
  const fallbackName = isUmrah ? 'Brother/Sister' : 'there';

  // Selected lead for 360° Drawer
  const [activeDrawerLeadId, setActiveDrawerLeadId] = useState<string | null>(initialSelectedLeadId || null);

  // Modals
  const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
  const [addLeadMode, setAddLeadMode] = useState<'SINGLE' | 'BULK'>('SINGLE');
  const [bulkCsvText, setBulkCsvText] = useState<string>('');
  const [bulkUploadSuccessCount, setBulkUploadSuccessCount] = useState<number | null>(null);
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);
  const [bulkUploadDuplicateCount, setBulkUploadDuplicateCount] = useState(0);
  const [bulkUploadInvalidCount, setBulkUploadInvalidCount] = useState(0);
  const [isBulkUploadProcessing, setIsBulkUploadProcessing] = useState(false);

  const [isWebsiteModalOpen, setIsWebsiteModalOpen] = useState(false);
  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [whatsAppModalLead, setWhatsAppModalLead] = useState<Lead | null>(null);
  const [customFollowUpLead, setCustomFollowUpLead] = useState<Lead | null>(null);
  const [quickNoteLead, setQuickNoteLead] = useState<Lead | null>(null);

  // Checkbox multi-select
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // Filters according to TeleCRM
  const [stageTab, setStageTab] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'THIS_MONTH'>('ALL');
  const [callerFilter, setCallerFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [scoreFilter, setScoreFilter] = useState<'ALL' | 'HOT' | 'WARM' | 'COLD'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Default sorting: DATE NEWEST FIRST
  const [sortField, setSortField] = useState<'date' | 'score' | 'name' | 'followup'>('date');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Call simulator state
  const [callDuration, setCallDuration] = useState(0);
  const [callTimerActive, setCallTimerActive] = useState(false);
  const [callDisposition, setCallDisposition] = useState<string>('Connected - Interested');
  const [callNote, setCallNote] = useState<string>('');
  const [callNextFollowUp, setCallNextFollowUp] = useState<string>('');

  // WhatsApp quick sender state
  const [whatsAppMessage, setWhatsAppMessage] = useState<string>('');
  const [whatsAppSentSuccess, setWhatsAppSentSuccess] = useState<boolean>(false);

  // Active call timer
  useEffect(() => {
    let interval: any;
    if (callTimerActive) {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callTimerActive]);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const parseLeadDate = (isoStr?: string): Date => {
    if (!isoStr) return new Date();
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  const formatLeadDateTime = (isoStr?: string) => {
    if (!isoStr) return { date: 'Recent', time: '', relative: 'Just now' };
    const d = parseLeadDate(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let relative = 'Just now';
    if (diffMins > 0 && diffMins < 60) relative = `${diffMins}m ago`;
    else if (diffHours > 0 && diffHours < 24) relative = `${diffHours}h ago`;
    else if (diffDays === 1) relative = 'Yesterday';
    else if (diffDays > 1 && diffDays < 30) relative = `${diffDays}d ago`;

    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    return { date: dateStr, time: timeStr, relative };
  };

  const matchesDateFilter = (isoStr?: string): boolean => {
    if (dateFilter === 'ALL') return true;
    if (!isoStr) return false;
    const d = parseLeadDate(isoStr);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const last7DaysStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    if (dateFilter === 'TODAY') return d >= todayStart;
    if (dateFilter === 'YESTERDAY') return d >= yesterdayStart && d < todayStart;
    if (dateFilter === 'LAST_7_DAYS') return d >= last7DaysStart;
    if (dateFilter === 'THIS_MONTH') return d >= thisMonthStart;
    return true;
  };

  const contactsMap = useMemo(() => {
    const map = new Map<string, Contact>();
    contacts.forEach((c) => map.set(c.contactId, c));
    return map;
  }, [contacts]);

  const handleUpdateStatus = (leadId: string, newStatus: LeadStatus) => {
    if (onUpdateLeadStatus) {
      onUpdateLeadStatus(leadId, newStatus);
    } else if (onUpdateLead) {
      const target = leads.find((l) => l.leadId === leadId);
      if (target) {
        onUpdateLead({
          ...target,
          status: newStatus,
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        });
      }
    }
    // Keep the outbound-campaign record in sync when a demo is booked by hand
    if (newStatus === 'DEMO_BOOKED') {
      fetch(`/api/campaigns/lead/${leadId}/demo-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoStatus: 'BOOKED', demoSource: 'MANUAL' }),
      }).catch(() => {});
    }
  };

  const handleAssignCaller = (leadId: string, callerName: string) => {
    const target = leads.find((l) => l.leadId === leadId);
    if (!target) return;
    const updated: Lead = {
      ...target,
      assignedCaller: callerName,
      ownerId: callerName,
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    if (onUpdateLead) {
      onUpdateLead(updated);
    }
  };

  const handleSetFollowUp = (leadId: string, followUpIso: string) => {
    const target = leads.find((l) => l.leadId === leadId);
    if (!target) return;
    const updated: Lead = {
      ...target,
      nextFollowUpAt: followUpIso,
      status: target.status === 'NEW' ? 'FOLLOW_UP' : target.status,
      updatedAt: new Date().toISOString(),
    };
    if (onUpdateLead) {
      onUpdateLead(updated);
    }
    setCustomFollowUpLead(null);
  };

  const setQuickFollowUpPreset = (leadId: string, hoursAhead: number) => {
    const targetDate = new Date();
    targetDate.setHours(targetDate.getHours() + hoursAhead);
    handleSetFollowUp(leadId, targetDate.toISOString());
  };

  const handleSaveCallLog = () => {
    if (!callingLead) return;
    const newLog = {
      id: `call-${Date.now()}`,
      timestamp: new Date().toISOString(),
      durationSeconds: callDuration,
      outcome: callDisposition,
      notes: callNote || `Call completed with outcome: ${callDisposition}`,
      telecaller: callingLead.assignedCaller || defaultCaller,
    };

    const existingLogs = callingLead.callLogs || [];
    let updatedStatus: LeadStatus = callingLead.status;
    if (callDisposition.includes('Interested')) updatedStatus = 'QUALIFIED';
    else if (callDisposition.includes('Callback')) updatedStatus = 'FOLLOW_UP';
    else if (callDisposition.includes('Wrong Number') || callDisposition.includes('Not Interested')) updatedStatus = 'CLOSED_LOST';
    else if (callingLead.status === 'NEW') updatedStatus = 'CONTACTED';

    const updated: Lead = {
      ...callingLead,
      status: updatedStatus,
      callLogs: [newLog, ...existingLogs],
      nextFollowUpAt: callNextFollowUp || callingLead.nextFollowUpAt,
      lastActivityAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (onUpdateLead) {
      onUpdateLead(updated);
    }

    setCallTimerActive(false);
    setCallDuration(0);
    setCallNote('');
    setCallNextFollowUp('');
    setCallingLead(null);
  };

  const handleStartCall = (lead: Lead) => {
    setCallingLead(lead);
    setCallDuration(0);
    setCallTimerActive(true);
    setCallDisposition('Connected - Interested');
    setCallNote('');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(11, 0, 0, 0);
    setCallNextFollowUp(tomorrow.toISOString().slice(0, 16));
  };

  const handleOpenWhatsApp = (lead: Lead) => {
    setWhatsAppModalLead(lead);
    const contact = contactsMap.get(lead.contactId);
    const name = contact?.firstName || fallbackName;
    setWhatsAppMessage(
      isUmrah
        ? `${greet(name)} Greetings from ${brand.companyName}. We received your inquiry regarding Umrah packages. Would you like our 2026/2027 package details with direct Haramain transfers and 4/5-star Makkah hotels?`
        : `${greet(name)} Greetings from ${brand.companyName}. Thanks for your enquiry. When would be a good time for a quick call to understand what you need?`
    );
    setWhatsAppSentSuccess(false);
  };

  const handleSendWhatsApp = async () => {
    if (!whatsAppModalLead) return;
    const contact = contactsMap.get(whatsAppModalLead.contactId);
    const phone = contact?.phone || '';

    try {
      await fetch('/api/inbound/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: phone,
          fromName: `${contact?.firstName} ${contact?.lastName}`.trim(),
          body: whatsAppMessage,
          direction: 'OUTBOUND',
          senderType: 'AGENT',
        }),
      }).catch(() => {});
    } catch {}

    setWhatsAppSentSuccess(true);
    setTimeout(() => {
      setWhatsAppModalLead(null);
      setWhatsAppSentSuccess(false);
    }, 1200);
  };

  // Bulk CSV Template Download
  const handleDownloadCsvTemplate = () => {
    const sampleCallerA = telecallers[0]?.name || '';
    const sampleCallerB = telecallers[1]?.name || sampleCallerA;
    const templateCsv = 'FirstName,LastName,Phone,Email,City,AssignedTelecaller,Status,Notes\n' +
      `Tariq,Khan,+919810023456,tariq@example.com,Hyderabad,${sampleCallerA},NEW,${isUmrah ? 'Wants 14-day Deluxe Umrah package' : 'Asked for a callback about pricing'}\n` +
      `Ayesha,Siddiqui,+919820011223,ayesha@example.com,Mumbai,${sampleCallerB},FOLLOW_UP,Call back on Friday morning\n` +
      'Mohammad,,,mohammad@example.com,Delhi,,NEW,Single name lead without phone\n';

    const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'TeleCRM_Bulk_Leads_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Process Bulk CSV Upload with robust parsing, no dummy fallbacks, and auto-close on success
  const handleProcessBulkUpload = () => {
    if (isBulkUploadProcessing) return;
    setBulkUploadError(null);
    setBulkUploadSuccessCount(null);
    if (!bulkCsvText.trim()) {
      setBulkUploadError('Choose a CSV or Excel file first.');
      return;
    }

    setIsBulkUploadProcessing(true);
    try {
      const workbook = XLSX.read(bulkCsvText, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('No worksheet was found in this file.');
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
        header: 1,
        defval: '',
        raw: false,
      }) as unknown[][];
      if (rows.length < 1) throw new Error('The spreadsheet is empty.');

      const normalizeHeader = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const headers = (rows[0] || []).map(normalizeHeader);
      const aliases: Record<string, string[]> = {
        firstName: ['firstname', 'givenname', 'first', 'fname'],
        fullName: ['name', 'fullname', 'contactname', 'leadname', 'customername', 'clientname', 'pilgrimname'],
        lastName: ['lastname', 'surname', 'familyname', 'lname'],
        phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'whatsapp', 'whatsappnumber', 'contactno', 'cell', 'tel'],
        email: ['email', 'emailaddress', 'mail', 'emailid'],
        company: ['company', 'companyname', 'organization', 'organisation', 'business', 'businessname', 'package', 'service'],
        city: ['city', 'location', 'area', 'state', 'address'],
        caller: ['assignedtelecaller', 'assignedcaller', 'owner', 'assignedto', 'telecaller', 'caller', 'agent', 'salesrep'],
        status: ['status', 'leadstatus', 'stage'],
        notes: ['notes', 'note', 'remarks', 'description', 'requirement', 'requirements', 'comment', 'comments'],
      };

      let indexes = Object.fromEntries(
        Object.entries(aliases).map(([key, names]) => [key, headers.findIndex((h) => names.includes(h))])
      ) as Record<string, number>;

      let startRowIndex = 1;
      if (indexes.firstName < 0 && indexes.fullName < 0) {
        if (rows.length > 0 && (rows[0] || []).length > 0) {
          indexes.fullName = 0;
          const isHeaderLike = ['name', 'first', 'contact', 'lead', 'fullname', 'person', 'customer'].some((h) =>
            headers[0]?.includes(h)
          );
          startRowIndex = isHeaderLike ? 1 : 0;
        } else {
          throw new Error('No Name or First Name column found. Use the downloadable template or include a Name / First Name header.');
        }
      }

      const value = (row: unknown[], key: string) => (indexes[key] < 0 ? '' : String(row[indexes[key]] ?? '').trim());
      const nowIso = new Date().toISOString();
      const seenContacts = [...contacts];
      let created = 0;
      let duplicates = 0;
      let invalid = 0;
      const rowErrors: string[] = [];

      rows.slice(startRowIndex).forEach((row, index) => {
        if (!row || row.every((cell) => String(cell ?? '').trim() === '')) return;
        const rawFirst = value(row, 'firstName');
        const rawLast = value(row, 'lastName');
        const fullName = value(row, 'fullName');

        let firstName = rawFirst;
        let lastName = rawLast;
        if (!firstName && fullName) {
          const splitName = fullName.trim().split(/\s+/);
          firstName = splitName[0] || '';
          lastName = rawLast || (splitName.length > 1 ? splitName.slice(1).join(' ') : '');
        }

        if (!firstName) {
          invalid++;
          if (rowErrors.length < 3) rowErrors.push('Row ' + (index + 1 + startRowIndex) + ': name is missing.');
          return;
        }

        const phone = value(row, 'phone');
        const email = value(row, 'email');
        const companyName = value(row, 'company');
        const city = value(row, 'city');
        const caller = value(row, 'caller');
        const statusRaw = (value(row, 'status') || 'NEW').toUpperCase() as LeadStatus;
        const notes = value(row, 'notes');

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          invalid++;
          if (rowErrors.length < 3) rowErrors.push('Row ' + (index + 1 + startRowIndex) + ': email format is invalid.');
          return;
        }

        const duplicate = findDuplicateContact({ email, phone }, seenContacts);
        if (duplicate) {
          duplicates++;
          return;
        }

        const contactId = 'contact-bulk-' + Date.now() + '-' + (index + 1 + startRowIndex) + '-' + created;
        const leadId = 'lead-bulk-' + Date.now() + '-' + (index + 1 + startRowIndex) + '-' + created;

        const newContact: Contact = {
          contactId,
          firstName,
          lastName: lastName || '',
          email: email || '',
          phone: phone || '',
          companyName: companyName || '',
          city: city || '',
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        const newLead: Lead = {
          leadId,
          contactId,
          source: 'MANUAL',
          leadType: 'INBOUND',
          status: [
            'NEW',
            'CONTACTED',
            'FOLLOW_UP',
            'ENGAGED',
            'QUALIFIED',
            'DEMO_BOOKED',
            'CLOSED_WON',
            'CLOSED_LOST',
          ].includes(statusRaw)
            ? statusRaw
            : 'NEW',
          leadScore: 75,
          intent: 'HIGH',
          buyingStage: 'AWARENESS',
          serviceInterest: '',
          city: city || '',
          requirements: [],
          assignedCaller: caller || '',
          ownerId: caller || '',
          notes: notes || '',
          createdAt: nowIso,
          updatedAt: nowIso,
          lastActivityAt: nowIso,
        };

        if (typeof onAddLead !== 'function') {
          throw new Error('Lead creation is not connected. Please refresh and try again.');
        }

        onAddLead(newLead, newContact);
        seenContacts.push(newContact);
        created++;
      });

      setBulkUploadSuccessCount(created);
      setBulkUploadDuplicateCount(duplicates);
      setBulkUploadInvalidCount(invalid);

      if (created === 0) {
        setBulkUploadError(
          ('No leads were created. ' + duplicates + ' duplicate row(s), ' + invalid + ' invalid row(s). ' + rowErrors.join(' ')).trim()
        );
      } else {
        // Automatically close the Add Lead modal immediately once leads are successfully created
        setIsAddLeadModalOpen(false);
        setBulkCsvText('');
        setBulkUploadError(null);
        setBulkUploadSuccessCount(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error while reading the spreadsheet.';
      setBulkUploadError(message);
      console.error('[CRM bulk upload] Failed to create leads:', error);
    } finally {
      setIsBulkUploadProcessing(false);
    }
  };

  // 1. Pre-computed Search Index across ALL leads for instant, scalable multi-field querying
  const leadSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const lead of leads) {
      const contact = contactsMap.get(lead.contactId);
      const rawPhone = contact?.phone || '';
      const digitsPhone = rawPhone.replace(/[^0-9]/g, '');
      const parts = [
        contact?.firstName || '',
        contact?.lastName || '',
        `${contact?.firstName || ''} ${contact?.lastName || ''}`,
        rawPhone,
        digitsPhone,
        contact?.email || '',
        contact?.companyName || '',
        lead.serviceInterest || '',
        lead.city || contact?.city || '',
        lead.notes || '',
        lead.queryMessage || '',
        lead.assignedCaller || lead.ownerId || '',
        lead.source || '',
        lead.campaignName || '',
        lead.status || '',
        ...(Array.isArray(lead.requirements) ? lead.requirements : []),
      ];
      index.set(lead.leadId, parts.join(' ').toLowerCase());
    }
    return index;
  }, [leads, contactsMap]);

  // 2. Filter & Sort across ALL leads (Search operates on entire index)
  const processedLeads = useMemo(() => {
    let result = leads.filter((lead) => {
      // Outbound campaign leads MUST ONLY be shown in CRM if they have replied
      const isCampaignLead = Boolean(
        lead.campaignId || lead.campaignLeadId || (lead.leadType === 'OUTBOUND' && lead.source === 'EMAIL')
      );
      if (isCampaignLead && lead.replyStatus !== 'REPLIED') return false;

      // Stage tab filter
      if (stageTab !== 'ALL') {
        if (stageTab === 'FOLLOW_UP') {
          const hasFollowUp = Boolean(lead.nextFollowUpAt) || lead.status === 'FOLLOW_UP';
          if (!hasFollowUp) return false;
        } else if (lead.status !== stageTab) {
          return false;
        }
      }

      // Date filter
      if (!matchesDateFilter(lead.createdAt || lead.lastActivityAt)) {
        return false;
      }

      // Caller filter
      if (callerFilter !== 'ALL') {
        if (callerFilter === 'UNASSIGNED') {
          if (lead.assignedCaller && lead.assignedCaller !== 'Unassigned') return false;
        } else {
          if (lead.assignedCaller !== callerFilter && lead.ownerId !== callerFilter) return false;
        }
      }

      // Source filter
      if (sourceFilter !== 'ALL' && lead.source !== sourceFilter) {
        return false;
      }

      // Score filter
      if (scoreFilter !== 'ALL') {
        const score = lead.leadScore || 0;
        if (scoreFilter === 'HOT' && score < 80) return false;
        if (scoreFilter === 'WARM' && (score < 50 || score >= 80)) return false;
        if (scoreFilter === 'COLD' && score >= 50) return false;
      }

      // Fast Index Search across ALL leads
      if (searchQuery.trim()) {
        const queryTerms = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const indexedText = leadSearchIndex.get(lead.leadId) || '';
        const matchesAll = queryTerms.every((term) => indexedText.includes(term));
        if (!matchesAll) {
          return false;
        }
      }

      return true;
    });

    // Sorting across all filtered leads
    result.sort((a, b) => {
      const contactA = contactsMap.get(a.contactId);
      const contactB = contactsMap.get(b.contactId);

      let comparison = 0;
      if (sortField === 'date') {
        const dateA = parseLeadDate(a.createdAt || a.lastActivityAt).getTime();
        const dateB = parseLeadDate(b.createdAt || b.lastActivityAt).getTime();
        comparison = dateA - dateB;
      } else if (sortField === 'score') {
        comparison = (a.leadScore || 0) - (b.leadScore || 0);
      } else if (sortField === 'name') {
        const nameA = `${contactA?.firstName || ''} ${contactA?.lastName || ''}`.toLowerCase();
        const nameB = `${contactB?.firstName || ''} ${contactB?.lastName || ''}`.toLowerCase();
        comparison = nameA.localeCompare(nameB);
      } else if (sortField === 'followup') {
        const fA = a.nextFollowUpAt ? parseLeadDate(a.nextFollowUpAt).getTime() : Infinity;
        const fB = b.nextFollowUpAt ? parseLeadDate(b.nextFollowUpAt).getTime() : Infinity;
        comparison = fA - fB;
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [leads, contactsMap, leadSearchIndex, stageTab, dateFilter, callerFilter, sourceFilter, scoreFilter, searchQuery, sortField, sortAsc]);

  // 3. Pagination State (25 leads per page)
  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Auto-reset to Page 1 whenever search query, filters, or sorting change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, stageTab, dateFilter, callerFilter, sourceFilter, scoreFilter, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(processedLeads.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  // Current page leads slice
  const paginatedLeads = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return processedLeads.slice(start, start + PAGE_SIZE);
  }, [processedLeads, safePage]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: leads.length,
      NEW: 0,
      FOLLOW_UP: 0,
      CONTACTED: 0,
      ENGAGED: 0,
      QUALIFIED: 0,
      DEMO_BOOKED: 0,
      CLOSED_WON: 0,
      CLOSED_LOST: 0,
    };
    leads.forEach((l) => {
      if (l.status && counts[l.status] !== undefined) {
        counts[l.status]++;
      }
      if (l.nextFollowUpAt || l.status === 'FOLLOW_UP') {
        counts.FOLLOW_UP++;
      }
    });
    return counts;
  }, [leads]);

  const handleSelectAll = () => {
    const pageLeadIds = paginatedLeads.map((l) => l.leadId);
    const allSelectedOnPage = pageLeadIds.length > 0 && pageLeadIds.every((id) => selectedLeadIds.has(id));
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        pageLeadIds.forEach((id) => next.delete(id));
      } else {
        pageLeadIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectRow = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const handleBulkChangeStatus = (newStatus: LeadStatus) => {
    selectedLeadIds.forEach((id) => {
      handleUpdateStatus(id, newStatus);
    });
    setSelectedLeadIds(new Set());
  };

  const handleBulkAssignCaller = (callerName: string) => {
    selectedLeadIds.forEach((id) => {
      handleAssignCaller(id, callerName);
    });
    setSelectedLeadIds(new Set());
  };

  const handleExportCsv = () => {
    const leadsToExport = selectedLeadIds.size > 0
      ? processedLeads.filter((l) => selectedLeadIds.has(l.leadId))
      : processedLeads;

    const headers = [
      'Lead ID',
      'Created Date',
      'Name',
      'Phone',
      'Email',
      'Company/Package',
      'City',
      'Status',
      'Assigned Telecaller',
      'Next Follow-Up',
      'Lead Score',
      'Source',
      'Budget',
      'Notes',
    ];

    const rows = leadsToExport.map((l) => {
      const c = contactsMap.get(l.contactId);
      const name = `"${(c?.firstName || '')} ${(c?.lastName || '')}"`;
      const created = `"${l.createdAt || ''}"`;
      const phone = `"${c?.phone || ''}"`;
      const email = `"${c?.email || ''}"`;
      const pkg = `"${l.serviceInterest || c?.companyName || ''}"`;
      const city = `"${l.city || c?.city || ''}"`;
      const status = `"${l.status}"`;
      const caller = `"${l.assignedCaller || 'Unassigned'}"`;
      const followup = `"${l.nextFollowUpAt || ''}"`;
      const score = l.leadScore || 0;
      const source = `"${l.source}"`;
      const budget = `"${l.budget || ''}"`;
      const notes = `"${(l.notes || '').replace(/"/g, '""')}"`;

      return [l.leadId, created, name, phone, email, pkg, city, status, caller, followup, score, source, budget, notes].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${(isUmrah ? 'Umrah' : brand.companyName).replace(/[^A-Za-z0-9]+/g, '_')}_Leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const drawerLead = leads.find((l) => l.leadId === activeDrawerLeadId);
  const drawerContact = drawerLead ? contactsMap.get(drawerLead.contactId) : null;
  const drawerActivities = drawerLead ? activities.filter((a) => a.leadId === drawerLead.leadId) : [];

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-800 font-sans pb-16">
      {/* Sticky Header & Filter Container */}
      <div className="sticky -top-4 sm:-top-5 z-30 bg-slate-50/95 backdrop-blur-xs pt-3 pb-2 border-b border-slate-200/60 shadow-xs -mx-3 sm:-mx-5 px-3 sm:px-5">
        {/* 1. TeleCRM Top Header Bar */}
        <div className="bg-white border-b border-slate-200/95 shadow-2xs">
          <div className="max-w-[1700px] mx-auto px-4 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            {/* Logo & Title */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-500 to-orange-600 flex items-center justify-center text-white shadow-md shadow-orange-500/20">
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">TeleCRM</h1>
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-orange-50 text-orange-700 border border-orange-200 rounded-md">
                    Core Telecalling CRM
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-700 rounded-md">
                    {processedLeads.length} Leads
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  High-velocity lead management, click-to-call dialer & smart follow-up tracker
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 self-stretch md:self-auto flex-wrap gap-y-2">
              <button
                onClick={() => setIsWebsiteModalOpen(true)}
                className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 transition-colors"
                title="Webhook Form Integration & Simulation"
              >
                <Globe className="w-3.5 h-3.5 text-slate-600" />
                <span>Webhooks & Forms</span>
              </button>

              <button
                onClick={handleExportCsv}
                className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 transition-colors"
                title="Export filtered leads to Excel/CSV"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
                <span>Export CSV</span>
              </button>

              {/* Add Lead Button */}
              <button
                onClick={() => {
                  setAddLeadMode('SINGLE');
                  setIsAddLeadModalOpen(true);
                }}
                className="flex items-center space-x-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm shadow-orange-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Add Lead</span>
              </button>
            </div>
          </div>

          {/* 2. TeleCRM Signature Stage Counters Strip */}
          <div className="max-w-[1700px] mx-auto px-4 pt-1 pb-2 flex items-center space-x-2 overflow-x-auto no-scrollbar border-t border-slate-100">
            {TELECRM_STAGES.map((st) => {
              const isSelected = stageTab === st.key;
              const count = stageCounts[st.key] || 0;
              return (
                <button
                  key={st.key}
                  onClick={() => setStageTab(st.key)}
                  className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border ${
                    isSelected
                      ? `${st.bg} ${st.text} ${st.border} shadow-2xs ring-1 ring-orange-500/30 font-extrabold`
                      : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                  <span>{st.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[11px] font-mono tabular-nums ${
                      isSelected ? 'bg-white/80 shadow-2xs' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. TeleCRM Advanced Filter & Search Toolbar */}
        <div className="max-w-[1700px] mx-auto px-4 mt-3">
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by Name, Phone (+91...), Email, Package or City..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2 flex-wrap gap-y-2">
              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[11px] font-semibold text-slate-500">Date:</span>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as any)}
                  className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Time</option>
                  <option value="TODAY">Today</option>
                  <option value="YESTERDAY">Yesterday</option>
                  <option value="LAST_7_DAYS">Last 7 Days</option>
                  <option value="THIS_MONTH">This Month</option>
                </select>
              </div>

              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[11px] font-semibold text-slate-500">Sort:</span>
                <select
                  value={`${sortField}-${sortAsc ? 'asc' : 'desc'}`}
                  onChange={(e) => {
                    const [field, dir] = e.target.value.split('-');
                    setSortField(field as any);
                    setSortAsc(dir === 'asc');
                  }}
                  className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="date-desc">Date (Newest First) ★</option>
                  <option value="date-asc">Date (Oldest First)</option>
                  <option value="followup-asc">Follow-up Due (Earliest)</option>
                  <option value="score-desc">AI Score (High to Low)</option>
                  <option value="score-asc">AI Score (Low to High)</option>
                  <option value="name-asc">Name (A-Z)</option>
                </select>
              </div>

              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                <select
                  value={callerFilter}
                  onChange={(e) => setCallerFilter(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Telecallers</option>
                  <option value="UNASSIGNED">Unassigned Only</option>
                  {telecallers.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                <Compass className="w-3.5 h-3.5 text-slate-500" />
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Sources</option>
                  <option value="WEBSITE">Website Form</option>
                  <option value="WHATSAPP">WhatsApp Inbound</option>
                  <option value="INSTAGRAM">Instagram</option>
                  <option value="EMAIL">Inbound Email</option>
                  <option value="OUTBOUND">Campaign</option>
                  <option value="MANUAL">Manual / Walk-in</option>
                </select>
              </div>

              <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                <select
                  value={scoreFilter}
                  onChange={(e) => setScoreFilter(e.target.value as any)}
                  className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Scores</option>
                  <option value="HOT">Hot Leads (Score ≥ 80)</option>
                  <option value="WARM">Warm Leads (50-79)</option>
                  <option value="COLD">Cold Leads (&lt; 50)</option>
                </select>
              </div>

              {(dateFilter !== 'ALL' || callerFilter !== 'ALL' || sourceFilter !== 'ALL' || scoreFilter !== 'ALL' || searchQuery || stageTab !== 'ALL') && (
                <button
                  onClick={() => {
                    setDateFilter('ALL');
                    setCallerFilter('ALL');
                    setSourceFilter('ALL');
                    setScoreFilter('ALL');
                    setSearchQuery('');
                    setStageTab('ALL');
                    setSortField('date');
                    setSortAsc(false);
                  }}
                  className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg border border-rose-200 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4. TeleCRM Bulk Action Float Bar */}
      {selectedLeadIds.size > 0 && (
        <div className="max-w-[1700px] mx-auto px-4 mt-3">
          <div className="bg-slate-900 text-white rounded-xl p-2.5 px-4 shadow-lg flex items-center justify-between flex-wrap gap-2 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center space-x-3">
              <span className="px-2 py-0.5 bg-orange-500 text-white font-extrabold text-xs rounded-md">
                {selectedLeadIds.size} Selected
              </span>
              <span className="text-xs text-slate-300 font-medium">Apply bulk action to selected leads:</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <select
                  onChange={(e) => {
                    if (e.target.value) handleBulkAssignCaller(e.target.value);
                  }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Assign Telecaller...
                  </option>
                  {telecallers.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <select
                  onChange={(e) => {
                    if (e.target.value) handleBulkChangeStatus(e.target.value as any);
                  }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Change Status...
                  </option>
                  {TELECRM_STAGES.filter((s) => s.key !== 'ALL').map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleExportCsv}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg border border-slate-700 flex items-center space-x-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export ({selectedLeadIds.size})</span>
              </button>

              <button
                onClick={() => setSelectedLeadIds(new Set())}
                className="text-xs text-slate-400 hover:text-white px-2 py-1"
              >
                Deselect All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. The Pure TeleCRM Leads Table */}
      <div className="max-w-[1700px] mx-auto px-4 mt-3">
        <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider select-none">
                  <th className="py-3 px-3 w-10 text-center">
                    <button
                      onClick={handleSelectAll}
                      className="text-slate-500 hover:text-slate-800 transition-colors"
                      title="Select all"
                    >
                      {paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedLeadIds.has(l.leadId)) ? (
                        <CheckSquare className="w-4 h-4 text-orange-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-slate-900 min-w-[140px]"
                    onClick={() => {
                      if (sortField === 'date') setSortAsc(!sortAsc);
                      else {
                        setSortField('date');
                        setSortAsc(false);
                      }
                    }}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Date & Time</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      {sortField === 'date' && (
                        <span className="text-orange-600 font-extrabold">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-3 min-w-[220px]">Lead / Contact</th>
                  <th className="py-3 px-3 min-w-[210px]">Phone & Call Action</th>
                  <th className="py-3 px-3 min-w-[150px]">Status</th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-slate-900 min-w-[170px]"
                    onClick={() => {
                      if (sortField === 'followup') setSortAsc(!sortAsc);
                      else {
                        setSortField('followup');
                        setSortAsc(true);
                      }
                    }}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Next Follow-up</span>
                      <Clock className="w-3 h-3 text-slate-400" />
                      {sortField === 'followup' && (
                        <span className="text-orange-600 font-extrabold">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-3 min-w-[160px]">Assigned Telecaller</th>
                  <th className="py-3 px-3 min-w-[120px]">Source</th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-slate-900 min-w-[110px]"
                    onClick={() => {
                      if (sortField === 'score') setSortAsc(!sortAsc);
                      else {
                        setSortField('score');
                        setSortAsc(false);
                      }
                    }}
                  >
                    <div className="flex items-center space-x-1">
                      <span>AI Score</span>
                      <Flame className="w-3 h-3 text-orange-400" />
                      {sortField === 'score' && (
                        <span className="text-orange-600 font-extrabold">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-3 min-w-[180px]">Latest Note</th>
                  <th className="py-3 px-3 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {processedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <Users className="w-10 h-10 text-slate-300 stroke-[1.5]" />
                        <span className="text-sm font-semibold text-slate-600">No leads match your criteria</span>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Try resetting your filters, expanding your date range, or adding a new lead.
                        </p>
                        <button
                          onClick={() => {
                            setDateFilter('ALL');
                            setStageTab('ALL');
                            setCallerFilter('ALL');
                            setSourceFilter('ALL');
                            setScoreFilter('ALL');
                            setSearchQuery('');
                          }}
                          className="px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg font-bold text-xs hover:bg-orange-100"
                        >
                          Clear All Filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedLeads.map((lead) => {
                    const contact = contactsMap.get(lead.contactId);
                    const isSelected = selectedLeadIds.has(lead.leadId);
                    const dt = formatLeadDateTime(lead.createdAt || lead.lastActivityAt);
                    const currentStage =
                      TELECRM_STAGES.find((s) => s.key === lead.status) || TELECRM_STAGES[1];
                    const callerName = lead.assignedCaller || lead.ownerId || 'Unassigned';
                    const callerObj = telecallers.find((c) => c.name === callerName);
                    const followupDate = lead.nextFollowUpAt ? parseLeadDate(lead.nextFollowUpAt) : null;
                    const isFollowupOverdue = followupDate ? followupDate.getTime() < Date.now() : false;
                    const followupFormatted = followupDate
                      ? followupDate.toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : null;

                    return (
                      <tr
                        key={lead.leadId}
                        className={`hover:bg-slate-50/90 transition-colors group ${
                          isSelected ? 'bg-orange-50/50' : ''
                        }`}
                      >
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => toggleSelectRow(lead.leadId)}
                            className="text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-orange-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-800 text-[11px] font-mono">{dt.date}</span>
                            <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 font-medium">
                              <span>{dt.time}</span>
                              <span>•</span>
                              <span className="text-orange-700 font-semibold bg-orange-50 px-1 py-0.2 rounded text-[9px]">
                                {dt.relative}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center space-x-2.5">
                            <div
                              onClick={() => setActiveDrawerLeadId(lead.leadId)}
                              className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer hover:ring-2 hover:ring-orange-500 transition-all shadow-2xs"
                            >
                              {(contact?.firstName?.[0] || 'U') + (contact?.lastName?.[0] || '')}
                            </div>
                            <div className="min-w-0">
                              <div
                                onClick={() => setActiveDrawerLeadId(lead.leadId)}
                                className="font-bold text-slate-900 hover:text-orange-700 cursor-pointer truncate max-w-[180px]"
                                title={`${contact?.firstName} ${contact?.lastName}`}
                              >
                                {[contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Unnamed Lead'}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                                {contact?.email || lead.serviceInterest || contact?.companyName || "—"}
                              </div>
                              {(lead.city || contact?.city) && (
                                <div className="flex items-center space-x-1 text-[10px] text-slate-400 mt-0.5">
                                  <MapPin className="w-2.5 h-2.5 text-slate-400" />
                                  <span>{lead.city || contact?.city}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex flex-col space-y-1">
                            <span className={contact?.phone ? "font-mono text-xs font-semibold text-slate-800" : "text-xs text-slate-400 font-normal"}>
                              {contact?.phone || "—"}
                            </span>
                            <div className="flex items-center space-x-1.5">
                              {contact?.phone ? (
                                <>
                                  <button
                                    onClick={() => handleStartCall(lead)}
                                    className="px-2 py-0.8 bg-orange-500 hover:bg-orange-600 text-white rounded-md text-[11px] font-bold flex items-center space-x-1 shadow-2xs transition-all hover:scale-105 active:scale-95"
                                    title="Click to Call via TeleCRM Dialer"
                                  >
                                    <PhoneCall className="w-3 h-3" />
                                    <span>Call</span>
                                  </button>
                                  <button
                                    onClick={() => handleOpenWhatsApp(lead)}
                                    className="px-2 py-0.8 bg-green-500 hover:bg-green-600 text-white rounded-md text-[11px] font-bold flex items-center space-x-1 shadow-2xs transition-all hover:scale-105 active:scale-95"
                                    title="Send WhatsApp Message"
                                  >
                                    <MessageCircle className="w-3 h-3" />
                                    <span>WhatsApp</span>
                                  </button>
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">No phone added</span>
                              )}

                              <button
                                onClick={() => onOpenConversation(undefined, lead.leadId)}
                                className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
                                title="Open in Unified Inbox"
                              >
                                <Mail className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="relative inline-block">
                            <select
                              value={lead.status}
                              onChange={(e) => handleUpdateStatus(lead.leadId, e.target.value as LeadStatus)}
                              className={`appearance-none font-bold text-xs px-2.5 py-1 pr-6 rounded-lg border cursor-pointer focus:outline-none transition-all ${currentStage.bg} ${currentStage.text} ${currentStage.border}`}
                            >
                              {TELECRM_STAGES.filter((s) => s.key !== 'ALL').map((s) => (
                                <option key={s.key} value={s.key} className="bg-white text-slate-800">
                                  {s.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {followupFormatted ? (
                            <div className="flex flex-col space-y-0.5">
                              <div
                                onClick={() => setCustomFollowUpLead(lead)}
                                className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-bold border cursor-pointer ${
                                  isFollowupOverdue
                                    ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse'
                                    : 'bg-amber-50 text-amber-800 border-amber-300'
                                }`}
                                title="Click to reschedule callback"
                              >
                                <CalendarClock className="w-3 h-3" />
                                <span>{followupFormatted}</span>
                              </div>
                              {isFollowupOverdue && (
                                <span className="text-[10px] text-rose-600 font-bold">Callback Overdue!</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => setQuickFollowUpPreset(lead.leadId, 2)}
                                className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold rounded border border-slate-200"
                                title="Follow up in 2 hours"
                              >
                                +2h
                              </button>
                              <button
                                onClick={() => setQuickFollowUpPreset(lead.leadId, 24)}
                                className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold rounded border border-slate-200"
                                title="Follow up tomorrow"
                              >
                                +1d
                              </button>
                              <button
                                onClick={() => setCustomFollowUpLead(lead)}
                                className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-bold rounded border border-amber-200 flex items-center space-x-1"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                <span>Set Callback</span>
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5">
                            <div
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${
                                callerObj?.avatarColor || 'bg-slate-400'
                              }`}
                            >
                              {callerName[0] || 'U'}
                            </div>
                            <select
                              value={callerName}
                              onChange={(e) => handleAssignCaller(lead.leadId, e.target.value)}
                              className="text-xs font-semibold text-slate-700 bg-transparent border-0 hover:bg-slate-100 rounded px-1 py-0.5 focus:outline-none cursor-pointer"
                            >
                              <option value="Unassigned">Unassigned</option>
                              {telecallers.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-bold border border-slate-200">
                            {lead.source === 'WHATSAPP' && <MessageCircle className="w-2.5 h-2.5 text-green-600" />}
                            {lead.source === 'WEBSITE' && <Globe className="w-2.5 h-2.5 text-blue-600" />}
                            {lead.source === 'INSTAGRAM' && <Share2 className="w-2.5 h-2.5 text-pink-600" />}
                            {lead.source === 'EMAIL' && <Mail className="w-2.5 h-2.5 text-slate-600" />}
                            {lead.source === 'OUTBOUND' && <Send className="w-2.5 h-2.5 text-purple-600" />}
                            <span>{lead.source}</span>
                          </span>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center space-x-1">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold font-mono tabular-nums ${
                                (lead.leadScore || 0) >= 80
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (lead.leadScore || 0) >= 50
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {lead.leadScore || 50}
                            </span>
                            {(lead.leadScore || 0) >= 80 && <Flame className="w-3.5 h-3.5 text-orange-500" />}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div
                            onClick={() => setQuickNoteLead(lead)}
                            className="cursor-pointer group-hover:text-slate-900 text-slate-500 truncate max-w-[200px] text-[11px] hover:underline"
                            title={lead.notes || lead.queryMessage || 'Click to add note'}
                          >
                            {lead.notes || lead.queryMessage || '+ Add call note...'}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => setActiveDrawerLeadId(lead.leadId)}
                            className="p-1.5 text-slate-400 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors"
                            title="View Lead 360° Profile"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination & Status Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-medium">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span>
                Showing <strong className="text-slate-800 font-bold">{processedLeads.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}</strong> - <strong className="text-slate-800 font-bold">{Math.min(safePage * PAGE_SIZE, processedLeads.length)}</strong> of{' '}
                <strong className="text-slate-800 font-bold">{processedLeads.length}</strong> matching leads
                {processedLeads.length !== leads.length && (
                  <span className="text-slate-400 font-normal"> (from {leads.length} total)</span>
                )}
              </span>
              <span className="px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-200 rounded text-[10px] font-bold">
                25 per page
              </span>
            </div>

            {/* Pagination Buttons */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1 transition-all"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center space-x-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((pageNum) => {
                      return pageNum === 1 || pageNum === totalPages || Math.abs(pageNum - safePage) <= 1;
                    })
                    .map((pageNum, idx, arr) => {
                      const prev = arr[idx - 1];
                      const showEllipsis = prev && pageNum - prev > 1;
                      const isActive = pageNum === safePage;
                      return (
                        <React.Fragment key={pageNum}>
                          {showEllipsis && <span className="px-1 text-slate-400 text-xs">...</span>}
                          <button
                            onClick={() => setCurrentPage(pageNum)}
                            className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                              isActive
                                ? 'bg-orange-500 text-white shadow-2xs font-extrabold'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            {pageNum}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1 transition-all"
                  title="Next Page"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="hidden md:flex items-center space-x-3 text-[11px]">
              <span className="flex items-center space-x-1 text-emerald-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Search Indexed Across All {leads.length} Leads</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Calling Modal */}
      {callingLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95">
            <div className="bg-gradient-to-r from-orange-600 to-orange-500 text-white p-6 text-center relative">
              <button
                onClick={() => setCallingLead(null)}
                className="absolute top-4 right-4 text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-16 h-16 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center mx-auto mb-3 animate-pulse">
                <PhoneCall className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold">
                {contactsMap.get(callingLead.contactId)?.firstName}{' '}
                {contactsMap.get(callingLead.contactId)?.lastName}
              </h3>
              <p className="text-sm font-mono text-orange-100 mt-0.5">
                {contactsMap.get(callingLead.contactId)?.phone}
              </p>
              <div className="mt-3 inline-flex items-center space-x-2 px-3 py-1 bg-black/20 rounded-full text-xs font-mono">
                <span className="w-2 h-2 rounded-full bg-orange-200 animate-ping" />
                <span>Call Duration: {formatTimer(callDuration)}</span>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Call Disposition (Outcome):
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    'Connected - Interested',
                    'Connected - Callback Req.',
                    'Ringing No Response (RNR)',
                    'Busy / Call Later',
                    'Switched Off / Not Reachable',
                    'Wrong Number / Junk',
                  ].map((disp) => (
                    <button
                      key={disp}
                      type="button"
                      onClick={() => setCallDisposition(disp)}
                      className={`p-2 rounded-lg text-left font-semibold border transition-all ${
                        callDisposition === disp
                          ? 'bg-orange-50 text-orange-800 border-orange-400 ring-2 ring-orange-500/20'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {disp}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Next Callback Date & Time:
                </label>
                <input
                  type="datetime-local"
                  value={callNextFollowUp}
                  onChange={(e) => setCallNextFollowUp(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Call Notes:
                </label>
                <textarea
                  rows={3}
                  value={callNote}
                  onChange={(e) => setCallNote(e.target.value)}
                  placeholder="E.g., Customer requested 15 days Ramadan package for 4 adults. Send quotation on WhatsApp..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCallingLead(null)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-bold"
                >
                  Discard Call
                </button>
                <button
                  type="button"
                  onClick={handleSaveCallLog}
                  className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm shadow-orange-500/25 transition-all hover:scale-105 active:scale-95"
                >
                  Save Call Log & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. WhatsApp Quick Sender Modal */}
      {whatsAppModalLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95">
            <div className="bg-emerald-600 text-white p-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <MessageCircle className="w-5 h-5" />
                <h3 className="font-bold text-sm">Send WhatsApp to Lead</h3>
              </div>
              <button
                onClick={() => setWhatsAppModalLead(null)}
                className="text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs">
                <span className="text-emerald-800 font-bold block">
                  Recipient: {contactsMap.get(whatsAppModalLead.contactId)?.firstName}{' '}
                  {contactsMap.get(whatsAppModalLead.contactId)?.lastName}
                </span>
                <span className="text-emerald-700 font-mono">
                  {contactsMap.get(whatsAppModalLead.contactId)?.phone}
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Insert Quick Template:
                </label>
                <div className="flex items-center space-x-1.5 flex-wrap gap-y-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const name = contactsMap.get(whatsAppModalLead.contactId)?.firstName || (isUmrah ? 'Valued Pilgrim' : 'there');
                      setWhatsAppMessage(
                        isUmrah
                          ? `${greet(name)} Here are our Deluxe Umrah 2026/27 packages featuring 5-star Clock Tower hotels in Makkah and direct transfers. Would you like a customized quote?`
                          : `${greet(name)} Thanks for your interest in ${brand.companyName}. Here is a quick overview of what we offer. Would you like a tailored proposal?`
                      );
                    }}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded-md font-semibold border border-slate-200"
                  >
                    {isUmrah ? 'Deluxe Package' : 'Intro Message'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const name = contactsMap.get(whatsAppModalLead.contactId)?.firstName || (isUmrah ? 'Valued Pilgrim' : 'there');
                      setWhatsAppMessage(
                        isUmrah
                          ? `${greet(name)} Thank you for speaking with our sales team today. As discussed, I have attached our complete itinerary and pricing details.`
                          : `${greet(name)} Thank you for speaking with our team today. As discussed, I will share the details and next steps shortly.`
                      );
                    }}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded-md font-semibold border border-slate-200"
                  >
                    Post-Call Follow-up
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Message:
                </label>
                <textarea
                  rows={4}
                  value={whatsAppMessage}
                  onChange={(e) => setWhatsAppMessage(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                />
              </div>

              {whatsAppSentSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold text-center flex items-center justify-center space-x-1.5 animate-in fade-in">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>WhatsApp message dispatched successfully!</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    const phone = (contactsMap.get(whatsAppModalLead.contactId)?.phone || '').replace(/[^0-9]/g, '');
                    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(whatsAppMessage)}`, '_blank');
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold flex items-center space-x-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open WhatsApp Web</span>
                </button>
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm shadow-orange-500/25 transition-all"
                >
                  Send via CRM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. Custom Follow-up Callback Modal */}
      {customFollowUpLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-1.5">
                <CalendarClock className="w-4 h-4 text-orange-600" />
                <span>Schedule Telecalling Callback</span>
              </h3>
              <button
                onClick={() => setCustomFollowUpLead(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Set the exact date & time when the assigned telecaller should call{' '}
              <strong>{contactsMap.get(customFollowUpLead.contactId)?.firstName}</strong> back.
            </p>

            <input
              type="datetime-local"
              id="followup-picker"
              defaultValue={
                customFollowUpLead.nextFollowUpAt
                  ? customFollowUpLead.nextFollowUpAt.slice(0, 16)
                  : new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16)
              }
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
            />

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setCustomFollowUpLead(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById('followup-picker') as HTMLInputElement;
                  if (input?.value) {
                    handleSetFollowUp(customFollowUpLead.leadId, new Date(input.value).toISOString());
                  }
                }}
                className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                Save Callback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Quick Note Modal */}
      {quickNoteLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-1.5">
                <Edit3 className="w-4 h-4 text-orange-600" />
                <span>Add / Edit Lead Note</span>
              </h3>
              <button onClick={() => setQuickNoteLead(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              id="quick-note-text"
              rows={4}
              defaultValue={quickNoteLead.notes || ''}
              placeholder="Enter internal telecalling notes..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
            />
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setQuickNoteLead(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById('quick-note-text') as HTMLTextAreaElement;
                  if (input && onUpdateLead) {
                    onUpdateLead({
                      ...quickNoteLead,
                      notes: input.value,
                      updatedAt: new Date().toISOString(),
                    });
                  }
                  setQuickNoteLead(null);
                }}
                className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Add New Lead Modal (Single or Bulk Excel/CSV upload) */}
      {isAddLeadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95">
            {/* Modal Header with Single / Bulk Toggle */}
            <div className="bg-orange-500 text-white p-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Plus className="w-5 h-5" />
                <h3 className="font-bold text-sm">Add Lead to TeleCRM</h3>
              </div>
              <button
                onClick={() => setIsAddLeadModalOpen(false)}
                className="text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selector Tabs */}
            <div className="bg-slate-100 p-2 border-b border-slate-200 flex items-center space-x-2">
              <button
                onClick={() => setAddLeadMode('SINGLE')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  addLeadMode === 'SINGLE'
                    ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Single Lead Form
              </button>
              <button
                onClick={() => setAddLeadMode('BULK')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
                  addLeadMode === 'BULK'
                    ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 text-orange-600" />
                <span>Bulk Lead Upload (CSV / Excel)</span>
              </button>
            </div>

            {addLeadMode === 'SINGLE' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const firstName = (fd.get('firstName') as string)?.trim() || 'Lead';
                  const lastName = (fd.get('lastName') as string)?.trim() || '';
                  const phone = (fd.get('phone') as string)?.trim() || '';
                  const email = (fd.get('email') as string)?.trim() || '';
                  const pkg = defaultService;
                  const city = (fd.get('city') as string)?.trim() || '';
                  const caller = (fd.get('caller') as string)?.trim() || '';
                  const status = (fd.get('status') as LeadStatus) || 'NEW';
                  const source = (fd.get('source') as LeadSource) || 'MANUAL';
                  const notes = (fd.get('notes') as string) || '';

                  const nowIso = new Date().toISOString();
                  const contactId = `contact-manual-${Date.now()}`;
                  const leadId = `lead-manual-${Date.now()}`;

                  const newContact: Contact = {
                    contactId,
                    firstName,
                    lastName,
                    email,
                    phone,
                    companyName: pkg,
                    city,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                  };

                  const newLead: Lead = {
                    leadId,
                    contactId,
                    source,
                    leadType: 'INBOUND',
                    status,
                    leadScore: 75,
                    intent: 'HIGH',
                    buyingStage: 'AWARENESS',
                    serviceInterest: pkg,
                    city,
                    requirements: [pkg],
                    assignedCaller: caller,
                    ownerId: caller,
                    notes,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    lastActivityAt: nowIso,
                  };

                  if (onAddLead) {
                    onAddLead(newLead, newContact);
                  }

                  setIsAddLeadModalOpen(false);
                }}
                className="p-5 space-y-3.5 max-h-[70vh] overflow-y-auto"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      First Name *
                    </label>
                    <input
                      name="firstName"
                      required
                      placeholder="First name"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Last Name
                    </label>
                    <input
                      name="lastName"
                      placeholder="e.g. Khan"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Phone Number *
                    </label>
                    <input
                      name="phone"
                      required
                      placeholder="+91 98100 23456"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Email Address
                    </label>
                    <input
                      name="email"
                      type="email"
                      placeholder="tariq@example.com"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      City / Location
                    </label>
                    <input
                      name="city"
                      placeholder="e.g. Hyderabad"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Assign Telecaller
                    </label>
                    <select
                      name="caller"
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    >
                      <option value="">Unassigned</option>
                      {telecallers.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Status
                    </label>
                    <select
                      name="status"
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    >
                      <option value="NEW">Fresh / New</option>
                      <option value="CONTACTED">Contacted</option>
                      <option value="FOLLOW_UP">Follow Up Due</option>
                      <option value="QUALIFIED">Interested / Hot</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Source
                    </label>
                    <select
                      name="source"
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    >
                      <option value="MANUAL">Manual / Walk-in</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="WEBSITE">Website Form</option>
                      <option value="EMAIL">Email</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Inquiry Notes
                  </label>
                  <textarea
                    name="notes"
                    rows={2}
                    placeholder="E.g. Wants 4 star hotels near Haram for 3 pax in November..."
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsAddLeadModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm"
                  >
                    Create Lead
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-5 space-y-4">
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-xs text-orange-900">Bulk Excel / CSV Lead Upload</h4>
                    <p className="text-[11px] text-orange-700 mt-0.5">
                      Download the template CSV, fill in your leads, and paste or upload below to import instantly.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadCsvTemplate}
                    className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-xs flex items-center space-x-1 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Template</span>
                  </button>
                </div>

                <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50 hover:bg-orange-50/30 transition-all">
                  <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-xs text-slate-900 mb-1">Upload CSV or Excel (.csv, .xlsx) file</h4>
                  <p className="text-[11px] text-slate-500 mb-4">Select your formatted lead spreadsheet from your computer</p>
                  <label className="cursor-pointer inline-flex items-center space-x-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg shadow-sm transition-all">
                    <span>Browse Spreadsheet File</span>
                    <input
                      type="file"
                      accept=".csv,.txt,.xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const buffer = evt.target?.result;
                          if (buffer) {
                            try {
                              const workbook = XLSX.read(buffer, { type: 'array' });
                              const sheet = workbook.Sheets[workbook.SheetNames[0]];
                              const csv = XLSX.utils.sheet_to_csv(sheet);
                              setBulkCsvText(csv);
                            } catch {
                              if (typeof buffer === 'string') setBulkCsvText(buffer);
                            }
                          }
                        };
                        reader.readAsArrayBuffer(file);
                      }}
                    />
                  </label>
                  {bulkCsvText && (
                    <div className="mt-3 text-xs font-semibold text-emerald-700 bg-emerald-50 py-1.5 px-3 rounded-lg inline-block border border-emerald-200">
                      File loaded successfully! Ready to create leads.
                    </div>
                  )}
                </div>

                {bulkUploadError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-medium">
                    {bulkUploadError}
                  </div>
                )}
                {bulkUploadSuccessCount !== null && (
                  <div className="p-3 bg-emerald-100 text-emerald-900 rounded-lg text-xs font-bold text-center flex items-center justify-center space-x-1.5 animate-in fade-in">
                    <CheckCircle className="w-4 h-4 text-emerald-700" />
                    <span>Successfully created {bulkUploadSuccessCount} leads in TeleCRM!</span>
                  </div>
                )}

                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setIsAddLeadModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleProcessBulkUpload}
                    disabled={!bulkCsvText.trim()}
                    className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                  >
                    Upload & Create Leads
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 11. TeleCRM Lead 360° Slide-over Drawer (Right Sheet) */}
      {drawerLead && drawerContact && (
        <div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-2xs flex justify-end">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-base shadow-sm">
                  {(drawerContact.firstName?.[0] || 'U') + (drawerContact.lastName?.[0] || '')}
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    {[drawerContact.firstName, drawerContact.lastName].filter(Boolean).join(' ') || 'Unnamed Lead'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {drawerLead.serviceInterest || drawerContact.companyName || '—'}
                  </p>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="text-xs font-mono font-bold text-slate-700">{drawerContact.phone || 'No phone'}</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-xs text-slate-600">{drawerContact.email || 'No email'}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveDrawerLeadId(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action Bar inside Drawer */}
            <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => drawerContact.phone && handleStartCall(drawerLead)}
                  disabled={!drawerContact.phone}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow-2xs"
                  title={drawerContact.phone ? 'Call Now' : 'No phone number available'}
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Call Now</span>
                </button>
                <button
                  onClick={() => drawerContact.phone && handleOpenWhatsApp(drawerLead)}
                  disabled={!drawerContact.phone}
                  className="px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow-2xs"
                  title={drawerContact.phone ? 'WhatsApp' : 'No phone number available'}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>
                <button
                  onClick={() => onOpenConversation(undefined, drawerLead.leadId)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-200"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Inbox</span>
                </button>
              </div>

              {/* Status Selector */}
              <div className="flex items-center space-x-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Stage:</span>
                <select
                  value={drawerLead.status}
                  onChange={(e) => handleUpdateStatus(drawerLead.leadId, e.target.value as LeadStatus)}
                  className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none"
                >
                  {TELECRM_STAGES.filter((s) => s.key !== 'ALL').map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-1.5">
                  <PhoneForwarded className="w-3.5 h-3.5 text-orange-600" />
                  <span>Telecalling & Follow-up Tracker</span>
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 block font-medium">Assigned Caller:</span>
                    <span className="font-bold text-slate-800">{drawerLead.assignedCaller || 'Unassigned'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-medium">Next Scheduled Callback:</span>
                    <span className="font-bold text-orange-700">
                      {drawerLead.nextFollowUpAt
                        ? new Date(drawerLead.nextFollowUpAt).toLocaleString('en-IN')
                        : 'No callback set'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-medium">AI Intent & Score:</span>
                    <span className="font-bold text-slate-800">
                      {drawerLead.leadScore}/100 ({drawerLead.intent} Intent)
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-medium">Lead Created:</span>
                    <span className="font-mono text-slate-600">
                      {drawerLead.createdAt ? new Date(drawerLead.createdAt).toLocaleString('en-IN') : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Package Requirements & Details
                </h4>
                <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Service Requested:</span>
                    <span className="font-bold text-slate-800">{drawerLead.serviceInterest || defaultService}</span>
                  </div>
                  {drawerLead.budget && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Budget:</span>
                      <span className="font-bold text-slate-800">{drawerLead.budget}</span>
                    </div>
                  )}
                  {(drawerLead.branches || drawerContact.branches) && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Branches:</span>
                      <span className="font-bold text-slate-800">{drawerLead.branches || drawerContact.branches}</span>
                    </div>
                  )}
                  {(drawerLead.teamSize || drawerContact.teamSize) && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Team Size:</span>
                      <span className="font-bold text-slate-800">{drawerLead.teamSize || drawerContact.teamSize}</span>
                    </div>
                  )}
                  {drawerLead.campaignName && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Campaign:</span>
                      <span className="font-bold text-slate-800">{drawerLead.campaignName}</span>
                    </div>
                  )}
                  {drawerLead.city && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">City / Airport:</span>
                      <span className="font-bold text-slate-800">{drawerLead.city}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-100 flex items-start justify-between">
                    <div className="flex-1 mr-2">
                      <span className="text-slate-400 block text-[11px] font-bold mb-1">Latest Telecaller Note:</span>
                      <p className="text-slate-700 bg-slate-50 p-2.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap">
                        {drawerLead.notes || 'No notes added yet.'}
                      </p>
                    </div>
                    <button
                      onClick={() => setQuickNoteLead(drawerLead)}
                      className="px-2.5 py-1 text-[11px] font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md border border-orange-200 shrink-0 mt-3 transition-colors"
                    >
                      {drawerLead.notes ? 'Edit Note' : '+ Add Note'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-1.5">
                    <PhoneCall className="w-3.5 h-3.5 text-orange-600" />
                    <span>Call History Logs ({(drawerLead.callLogs || []).length})</span>
                  </h4>
                  <button
                    onClick={() => handleStartCall(drawerLead)}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    + Log Call
                  </button>
                </div>

                <div className="space-y-2">
                  {(drawerLead.callLogs || []).length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-400">
                      No calls logged yet. Click &apos;Call Now&apos; to initiate a simulated call.
                    </div>
                  ) : (
                    (drawerLead.callLogs || []).map((log) => (
                      <div
                        key={log.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-1 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">{log.outcome}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px]">{log.notes}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                          <span>Caller: {log.telecaller}</span>
                          <span>Duration: {log.durationSeconds}s</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Recent Activities & Touchpoints
                </h4>
                <div className="space-y-2">
                  {drawerActivities.length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-400">
                      Lead created via {drawerLead.source}
                    </div>
                  ) : (
                    drawerActivities.slice(0, 5).map((act) => (
                      <div
                        key={act.activityId}
                        className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span>{act.type.replace(/_/g, ' ')}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(act.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px]">{act.description}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 12. Website Lead Integration Modal */}
      {isWebsiteModalOpen && (
        <WebsiteLeadIntegrationModal
          isOpen={isWebsiteModalOpen}
          onClose={() => setIsWebsiteModalOpen(false)}
        />
      )}
    </div>
  );
};
