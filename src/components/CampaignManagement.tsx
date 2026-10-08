import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useBrand } from '../context/BrandContext';
import * as XLSX from 'xlsx';
import {
  Send,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Clock,
  Mail,
  User,
  Building2,
  Calendar,
  Layers,
  FileText,
  Search,
  Filter,
  ArrowRight,
  Eye,
  Trash2,
  Edit3,
  RefreshCw,
  Sparkles,
  ExternalLink,
  MessageSquare,
  ChevronRight,
  HelpCircle,
  X,
  Phone,
  Briefcase,
  AlertTriangle,
  Database,
  Check,
  Copy,
  Paperclip,
  Code,
  File,
  Users,
} from 'lucide-react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import {
  Campaign,
  CampaignLead,
  CampaignRun,
  EmailTemplate,
  TemplateAttachment,
  DemoStatus,
  DemoSource,
  Conversation,
  Lead,
  Contact,
  OutboundCampaign,
  OutboundProspect,
} from '../types/index.js';
import { EmailTemplateEditorModal } from './EmailTemplateEditorModal.js';
import { INITIAL_CAMPAIGN } from '../services/dataService.js';

interface CampaignManagementProps {
  onOpenConversation?: (conversationId: string) => void;
  conversations?: Conversation[];
  leads?: Lead[];
  contacts?: Contact[];
  prospects?: OutboundProspect[];
  outboundCampaigns?: OutboundCampaign[];
  onAddProspect?: (prospect: OutboundProspect) => void;
  onSendColdEmail?: (prospectId: string, customSubject?: string, customBody?: string) => void;
  onToggleCampaignStatus?: (campaignId: string) => void;
  tenantId?: string;
}

export const CampaignManagement: React.FC<CampaignManagementProps> = ({
  onOpenConversation,
  conversations = [],
  leads = [],
  contacts = [],
  prospects = [],
  outboundCampaigns = [],
  onAddProspect,
  onSendColdEmail,
  onToggleCampaignStatus,
  tenantId = '',
}) => {
  const { brand } = useBrand();
  const isUmrah = brand.playbook === 'umrah360';
  // Email templates live under the workspace, never in a shared root collection.
  const tplCol = () => collection(db, 'tenants', tenantId, 'email_templates');
  const tplDoc = (id: string) => doc(db, 'tenants', tenantId, 'email_templates', id);
  // Navigation sub-tabs
  const [activeTab, setActiveTab] = useState<'CAMPAIGNS' | 'TEMPLATES'>('CAMPAIGNS');

  // Campaigns state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const campaignsRef = useRef<Campaign[]>([]);
  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const selectedCampaignIdRef = useRef<string | null>(selectedCampaignId);
  useEffect(() => {
    selectedCampaignIdRef.current = selectedCampaignId;
  }, [selectedCampaignId]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignLeads, setCampaignLeads] = useState<CampaignLead[]>([]);
  const [campaignRuns, setCampaignRuns] = useState<CampaignRun[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [leadStatusFilter, setLeadStatusFilter] = useState<'ALL' | 'PENDING' | 'SENT' | 'REPLIED' | 'DEMO_BOOKED' | 'FAILED'>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [campaignNotification, setCampaignNotification] = useState<{
    type: 'info' | 'success' | 'warning';
    title: string;
    message: string;
    subtext?: string;
  } | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [templateSaveFeedback, setTemplateSaveFeedback] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<EmailTemplate | null>(null);
  const [isDeleteTemplateModalOpen, setIsDeleteTemplateModalOpen] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);

  // Create Campaign Wizard State
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignType, setNewCampaignType] = useState<'EMAIL' | 'WHATSAPP' | 'WHATSAPP_EMAIL'>('EMAIL');
  const [campaignMode, setCampaignMode] = useState<'PREDEFINED' | 'AI_GENERATED'>('PREDEFINED');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const selectedTemplateIdRef = useRef<string>(selectedTemplateId);
  const [selectedTemplateFromDb, setSelectedTemplateFromDb] = useState<EmailTemplate | null>(null);
  const [isLoadingTemplateFromDb, setIsLoadingTemplateFromDb] = useState(false);

  useEffect(() => {
    selectedTemplateIdRef.current = selectedTemplateId;
  }, [selectedTemplateId]);

  // Fetch all templates directly from Firestore DB & API
  const fetchTemplatesDirectlyFromDb = async (): Promise<EmailTemplate[]> => {
    let list: EmailTemplate[] = [];
    try {
      if (isFirebaseConfigured && db && tenantId) {
        const snap = await getDocs(tplCol());
        const dbTpls: EmailTemplate[] = [];
        snap.forEach((d) => {
          const data = d.data() as EmailTemplate;
          if (data && data.templateId) dbTpls.push(data);
        });
        list = dbTpls;
      }
    } catch (e) {
      console.warn('[DB Template] Note fetching templates from Firestore DB:', e);
    }
    if (list.length === 0) {
      try {
        const res = await fetch('/api/templates');
        const data = await res.json();
        if (data.templates && Array.isArray(data.templates)) {
          list = data.templates;
        }
      } catch (e) {}
    }

    const sorted = list.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    setTemplates(sorted);
    return sorted;
  };

  // Fetch a specific template document directly from Firestore DB
  const loadTemplateDirectlyFromDb = async (templateId: string): Promise<EmailTemplate | null> => {
    if (!templateId) return null;
    setIsLoadingTemplateFromDb(true);
    try {
      if (isFirebaseConfigured && db && tenantId) {
        const snap = await getDoc(tplDoc(templateId));
        if (snap.exists()) {
          const tpl = snap.data() as EmailTemplate;
          setSelectedTemplateFromDb(tpl);
          return tpl;
        }
      }
      const res = await fetch(`/api/templates/${templateId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.template) {
          setSelectedTemplateFromDb(json.template);
          return json.template;
        }
      }
    } catch (err) {
      console.warn('Error fetching template document from DB:', err);
    } finally {
      setIsLoadingTemplateFromDb(false);
    }
    return null;
  };

  const handleSelectTemplate = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    selectedTemplateIdRef.current = templateId;
    await loadTemplateDirectlyFromDb(templateId);
  };

  const openCreateCampaignModal = async (preferredTemplateId?: string) => {
    setCampaignMode('PREDEFINED');
    setIsCreateModalOpen(true);
    const dbTpls = await fetchTemplatesDirectlyFromDb();
    const allAvailable = dbTpls.length > 0 ? dbTpls : templates;
    const targetId =
      preferredTemplateId ||
      (selectedTemplateId && allAvailable.some((t) => t.templateId === selectedTemplateId)
        ? selectedTemplateId
        : (allAvailable.length > 0 ? allAvailable[0].templateId : ''));
    if (targetId) {
      setSelectedTemplateId(targetId);
      selectedTemplateIdRef.current = targetId;
      await loadTemplateDirectlyFromDb(targetId);
    }
  };

  const [startImmediately, setStartImmediately] = useState(true);
  const [aiPreviewSamples, setAiPreviewSamples] = useState<any[]>([]);
  const [isAiPreviewModalOpen, setIsAiPreviewModalOpen] = useState(false);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [inspectingLead, setInspectingLead] = useState<CampaignLead | null>(null);

  // Delete Campaign State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);

  // File Upload & Column Mapping State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [leadInputMethod, setLeadInputMethod] = useState<'UPLOAD' | 'PASTE' | 'SAMPLE' | 'CRM'>('UPLOAD');
  const [deliveryMode, setDeliveryMode] = useState<'LIVE_SMTP' | 'SIMULATION'>('LIVE_SMTP');
  const [pastedLeadsText, setPastedLeadsText] = useState('');
  const [createCampaignError, setCreateCampaignError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [columnMapping, setColumnMapping] = useState<{
    email: string;
    name: string;
    company: string;
    phone: string;
    designation: string;
  }>({
    email: '',
    name: '',
    company: '',
    phone: '',
    designation: '',
  });
  const [parsedPreviewLeads, setParsedPreviewLeads] = useState<any[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const SAMPLE_PILGRIMAGE_LEADS = [
    {
      rowNumber: 1,
      name: 'Tariq Al-Mansoor',
      email: 'tariq@mansoorhajj.com',
      companyName: 'Al-Mansoor Hajj & Umrah Services',
      designation: 'Managing Director',
      phone: '+91 98201 11222',
      isValid: true,
    },
    {
      rowNumber: 2,
      name: 'Rashid Farooqui',
      email: 'rashid@haramainjourneys.in',
      companyName: 'Haramain Journeys Mumbai',
      designation: 'Owner / Partner',
      phone: '+91 98202 33445',
      isValid: true,
    },
    {
      rowNumber: 3,
      name: 'Zeeshan Malik',
      email: 'zeeshan@malikpilgrimages.co.uk',
      companyName: 'Malik Pilgrimages UK',
      designation: 'Operations Director',
      phone: '+44 7700 900123',
      isValid: true,
    },
    {
      rowNumber: 4,
      name: 'Bilal Qureshi',
      email: 'bilal@alnoortravels.ae',
      companyName: 'Al-Noor Tours Dubai',
      designation: 'General Manager',
      phone: '+971 50 123 4567',
      isValid: true,
    },
    {
      rowNumber: 5,
      name: 'Irfan Siddiqui',
      email: 'irfan@delhiumrah.in',
      companyName: 'Delhi Pilgrimage Consolidators',
      designation: 'CEO / Founder',
      phone: '+91 98111 55667',
      isValid: true,
    },
  ];

  const handleLoadSampleLeads = () => {
    setParsedPreviewLeads([...SAMPLE_PILGRIMAGE_LEADS]);
    setUploadedFileName('5_Sample_Pilgrimage_Tour_Operators.csv');
    setUploadError(null);
    setCreateCampaignError(null);
    if (!newCampaignName.trim()) {
      setNewCampaignName('Umrah Operators Outreach - Season 1448');
    }
  };

  const handleParsePastedLeads = (text: string) => {
    setPastedLeadsText(text);
    if (!text.trim()) {
      setParsedPreviewLeads([]);
      return;
    }
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((line, idx) => {
      const parts = line.includes('\t') ? line.split('\t') : line.includes(',') ? line.split(',') : [line];
      const emailPart = parts.find((p) => p.includes('@')) || parts[0] || '';
      const email = emailPart.replace(/[<>"']/g, '').trim();
      const remainingParts = parts.filter((p) => p !== emailPart).map((p) => p.trim());
      const name = remainingParts[0] || (email ? email.split('@')[0] : `Lead ${idx + 1}`);
      const companyName = remainingParts[1] || `${name}'s Agency`;
      const phone = remainingParts[2] || '';
      return {
        rowNumber: idx + 1,
        email,
        name,
        companyName,
        phone,
        designation: 'Director / Owner',
        isValid: Boolean(email && email.includes('@') && email.includes('.')),
      };
    }).filter((l) => l.email);

    setParsedPreviewLeads(parsed);
    setUploadedFileName(`Pasted_Leads_${parsed.length}_recipients`);
    setUploadError(null);
    setCreateCampaignError(null);
  };

  // Template Form State
  const [templateFormName, setTemplateFormName] = useState('');
  const [templateFormSubject, setTemplateFormSubject] = useState('');
  const [templateFormBody, setTemplateFormBody] = useState('');

  // Campaign Selection Handler - Instant, stable selection that is never overwritten by background polls
  const handleSelectCampaign = (camp: Campaign) => {
    setSelectedCampaignId(camp.campaignId);
    selectedCampaignIdRef.current = camp.campaignId;
    setSelectedCampaign(camp);
    setSearchQuery('');
    setLeadStatusFilter('ALL');
    setCampaignLeads([]);
    setCampaignRuns([]);
    // details are loaded by the selectedCampaignId effect
  };

  // fetch with a hard timeout so a slow/hung server call can never freeze the page or the poller
  const fetchJsonWithTimeout = async (url: string, init?: RequestInit, timeoutMs = 12000): Promise<any> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const templatesLoadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  const detailsSeqRef = useRef(0);

  // Fetch all campaigns (and templates only once - they rarely change)
  const loadData = async () => {
    const seq = ++loadSeqRef.current;
    try {
      setRefreshing(true);
      const needTemplates = !templatesLoadedRef.current;
      const [campData, tplData] = await Promise.all([
        fetchJsonWithTimeout('/api/campaigns'),
        needTemplates ? fetchJsonWithTimeout('/api/templates') : Promise.resolve(null),
      ]);

      // A newer request has already been issued: drop this (possibly stale) response
      if (seq !== loadSeqRef.current) return;

      if (campData && campData.campaigns && Array.isArray(campData.campaigns)) {
        setCampaigns(campData.campaigns);
        campaignsRef.current = campData.campaigns;

        // If a campaign is currently selected, refresh its details without altering user selection
        const activeId = selectedCampaignIdRef.current;
        if (activeId) {
          const updated = campData.campaigns.find((c: Campaign) => c.campaignId === activeId);
          if (updated) {
            setSelectedCampaign((prev) => (prev ? { ...prev, ...updated } : updated));
          }
        } else if (campData.campaigns.length > 0) {
          const firstCamp = campData.campaigns[0];
          setSelectedCampaignId(firstCamp.campaignId);
          selectedCampaignIdRef.current = firstCamp.campaignId;
          setSelectedCampaign(firstCamp);
        }
      }

      if (tplData && tplData.templates && Array.isArray(tplData.templates)) {
        templatesLoadedRef.current = true;
        setTemplates(tplData.templates);
        setSelectedTemplateId((curr) => {
          if (curr && tplData.templates.some((t: EmailTemplate) => t.templateId === curr)) {
            selectedTemplateIdRef.current = curr;
            return curr;
          }
          if (selectedTemplateIdRef.current && tplData.templates.some((t: EmailTemplate) => t.templateId === selectedTemplateIdRef.current)) {
            return selectedTemplateIdRef.current;
          }
          const firstId = tplData.templates[0]?.templateId || '';
          selectedTemplateIdRef.current = firstId;
          return firstId;
        });
      }
    } catch (e) {
      console.warn('Error loading campaigns/templates:', e);
    } finally {
      if (seq === loadSeqRef.current) setRefreshing(false);
    }
  };

  // Load selected campaign details (leads and runs). The campaign object itself comes from the list call.
  const loadSelectedCampaignDetails = async (campaignId: string) => {
    if (!campaignId) return;
    const seq = ++detailsSeqRef.current;
    try {
      const [leadsData, runsData] = await Promise.all([
        fetchJsonWithTimeout(`/api/campaigns/${campaignId}/leads`),
        fetchJsonWithTimeout(`/api/campaigns/${campaignId}/runs`),
      ]);

      // Ignore out-of-order responses and responses for a campaign that is no longer selected
      if (seq !== detailsSeqRef.current || selectedCampaignIdRef.current !== campaignId) return;

      // Accept empty arrays too, otherwise the previous campaign's leads (or stale statuses) stay on screen
      if (leadsData && Array.isArray(leadsData.leads)) {
        setCampaignLeads(leadsData.leads);
      }
      if (runsData && Array.isArray(runsData.runs)) {
        setCampaignRuns(runsData.runs);
      }
    } catch (e) {
      console.warn('Error loading campaign leads/runs from API:', e);
    }
  };

  // Single sequential poller: never overlaps itself, slows down when idle.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    const tick = async () => {
      if (cancelled) return;
      if (busy || document.visibilityState !== 'visible') {
        timer = setTimeout(tick, 5000);
        return;
      }
      busy = true;
      let running = false;
      try {
        const runningCamp = campaignsRef.current.find((c) => c.status === 'RUNNING');
        running = !!runningCamp;
        if (runningCamp) {
          await fetchJsonWithTimeout(`/api/campaigns/${runningCamp.campaignId}/process`, { method: 'POST' }, 20000);
        }
        await loadData();
        const activeId = selectedCampaignIdRef.current;
        if (activeId) await loadSelectedCampaignDetails(activeId);
      } finally {
        busy = false;
        if (!cancelled) timer = setTimeout(tick, running ? 5000 : 15000);
      }
    };

    tick();

    const handleVisible = () => {
      if (document.visibilityState === 'visible' && !busy) {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, []);

  useEffect(() => {
    if (selectedCampaignId) {
      loadSelectedCampaignDetails(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // Campaign Actions
  const handleStartCampaign = async (campaignId: string) => {
    const nowIso = new Date().toISOString();
    setCampaigns((prev) =>
      prev.map((c) => (c.campaignId === campaignId ? { ...c, status: 'RUNNING', updatedAt: nowIso } : c))
    );
    campaignsRef.current = campaignsRef.current.map((c) =>
      c.campaignId === campaignId ? { ...c, status: 'RUNNING', updatedAt: nowIso } : c
    );
    if (selectedCampaign?.campaignId === campaignId) {
      setSelectedCampaign((prev) => (prev ? { ...prev, status: 'RUNNING', updatedAt: nowIso } : null));
    }

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'campaigns', campaignId), { status: 'RUNNING', updatedAt: nowIso }, { merge: true });
      } catch (err) {
        console.warn('Browser Firestore start update note:', err);
      }
    }

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.campaign) {
        setSelectedCampaign(data.campaign);
        loadData();
        loadSelectedCampaignDetails(campaignId);
      }
    } catch (e) {
      console.error('Error starting campaign:', e);
    }
  };

  const handlePauseCampaign = async (campaignId: string) => {
    const nowIso = new Date().toISOString();
    setCampaigns((prev) =>
      prev.map((c) => (c.campaignId === campaignId ? { ...c, status: 'PAUSED', updatedAt: nowIso } : c))
    );
    campaignsRef.current = campaignsRef.current.map((c) =>
      c.campaignId === campaignId ? { ...c, status: 'PAUSED', updatedAt: nowIso } : c
    );
    if (selectedCampaign?.campaignId === campaignId) {
      setSelectedCampaign((prev) => (prev ? { ...prev, status: 'PAUSED', updatedAt: nowIso } : null));
    }

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'campaigns', campaignId), { status: 'PAUSED', updatedAt: nowIso }, { merge: true });
      } catch (err) {
        console.warn('Browser Firestore pause update note:', err);
      }
    }

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.campaign) {
        setSelectedCampaign(data.campaign);
        loadData();
        loadSelectedCampaignDetails(campaignId);
      }
    } catch (e) {
      console.error('Error pausing campaign:', e);
    }
  };

  const handleRestartCampaign = async (campaignId: string) => {
    try {
      setIsRestarting(true);
      const nowIso = new Date().toISOString();

      if (isFirebaseConfigured && db) {
        try {
          await setDoc(doc(db, 'campaigns', campaignId), { status: 'RUNNING', updatedAt: nowIso }, { merge: true });
        } catch (e) {}
      }

      const res = await fetch(`/api/campaigns/${campaignId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setIsRestartConfirmOpen(false);

      if (data.success || data.campaign) {
        if (data.allQualified) {
          setCampaignNotification({
            type: 'warning',
            title: 'All Leads Qualified! 🎉',
            message: data.message || 'All leads in this campaign have replied and qualified. 0 emails were dispatched as no unreplied leads remain.',
            subtext: `Run #${data.run?.runNumber || (selectedCampaign?.lastRunNumber || 1) + 1} recorded with 0 new sends.`,
          });
        } else {
          setCampaignNotification({
            type: 'success',
            title: `Run #${data.run?.runNumber || (selectedCampaign?.lastRunNumber || 0) + 1} Dispatched!`,
            message: data.message || `Started follow-up run for unreplied leads.`,
            subtext: `${data.alreadyRepliedCount || 0} lead(s) who already replied were safely excluded from sending.`,
          });
        }

        if (data.campaign) setSelectedCampaign(data.campaign);
        await loadData();
        await loadSelectedCampaignDetails(campaignId);
      } else {
        setCampaignNotification({
          type: 'success',
          title: 'Campaign Restarted!',
          message: 'Campaign follow-up run has been re-triggered.',
        });
        setCampaigns((prev) =>
          prev.map((c) => (c.campaignId === campaignId ? { ...c, status: 'RUNNING', updatedAt: nowIso } : c))
        );
      }
    } catch (e: any) {
      console.error('Error restarting campaign:', e);
      setCampaignNotification({
        type: 'warning',
        title: 'Restart Triggered',
        message: 'Campaign restarted in local state.',
      });
    } finally {
      setIsRestarting(false);
    }
  };

  // Update lead reply status (e.g. when manually qualifying or syncing lead state)
  const handleToggleReplyStatus = async (lead: CampaignLead) => {
    const nextStatus = lead.replyStatus === 'REPLIED' ? 'NOT_REPLIED' : 'REPLIED';
    const nowIso = new Date().toISOString();

    // 1. Optimistic local state update
    setCampaignLeads((prev) =>
      prev.map((l) =>
        l.campaignLeadId === lead.campaignLeadId
          ? { ...l, replyStatus: nextStatus, repliedAt: nextStatus === 'REPLIED' ? nowIso : undefined, updatedAt: nowIso }
          : l
      )
    );

    // 2. Direct Firestore write
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(
          doc(db, 'campaign_leads', lead.campaignLeadId),
          {
            replyStatus: nextStatus,
            repliedAt: nextStatus === 'REPLIED' ? nowIso : null,
            updatedAt: nowIso,
          },
          { merge: true }
        );
        if (lead.leadId) {
          await setDoc(
            doc(db, 'leads', lead.leadId),
            {
              replyStatus: nextStatus,
              repliedAt: nextStatus === 'REPLIED' ? nowIso : null,
              updatedAt: nowIso,
            },
            { merge: true }
          ).catch(() => {});
        }
      } catch (err) {
        console.warn('Direct Firestore reply update notice:', err);
      }
    }

    try {
      const res = await fetch(`/api/campaigns/lead/${lead.campaignLeadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replyStatus: nextStatus,
        }),
      });
      const data = await res.json();
      if (data.lead && selectedCampaignId) {
        loadSelectedCampaignDetails(selectedCampaignId);
        loadData();
      }
    } catch (e) {
      console.error('Error toggling reply status:', e);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    try {
      setIsDeletingCampaign(true);

      // 2. Call backend DELETE endpoint to clear memory caches & background execution
      let deleteOk = false;
      try {
        const delRes = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
        deleteOk = delRes.ok;
      } catch (e) {}
      if (!deleteOk) {
        alert('Could not delete the campaign. Please try again.');
        return;
      }

      setIsDeleteModalOpen(false);
      setCampaignToDelete(null);

      // 3. Immediately clear from local frontend state
      setCampaigns((prev) => {
        const next = prev.filter((c) => c.campaignId !== campaignId);
        if (selectedCampaignId === campaignId) {
          if (next.length > 0) {
            setSelectedCampaignId(next[0].campaignId);
            selectedCampaignIdRef.current = next[0].campaignId;
            setSelectedCampaign(next[0]);
            loadSelectedCampaignDetails(next[0].campaignId);
          } else {
            setSelectedCampaignId(null);
            selectedCampaignIdRef.current = null;
            setSelectedCampaign(null);
            setCampaignLeads([]);
            setCampaignRuns([]);
          }
        }
        return next;
      });
    } catch (e) {
      console.error('Error deleting campaign:', e);
    } finally {
      setIsDeletingCampaign(false);
    }
  };

  // Toggle Demo Status (Automatic or Manual single source of truth)
  const handleToggleDemoStatus = async (lead: CampaignLead) => {
    const nextStatus: DemoStatus = lead.demoStatus === 'BOOKED' ? 'NOT_BOOKED' : 'BOOKED';
    const nowIso = new Date().toISOString();

    // 1. Optimistic local state update
    setCampaignLeads((prev) =>
      prev.map((l) =>
        l.campaignLeadId === lead.campaignLeadId
          ? {
              ...l,
              demoStatus: nextStatus,
              demoSource: 'MANUAL',
              demoBookedAt: nextStatus === 'BOOKED' ? nowIso : undefined,
              updatedAt: nowIso,
            }
          : l
      )
    );

    // 2. Direct Firestore write
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(
          doc(db, 'campaign_leads', lead.campaignLeadId),
          {
            demoStatus: nextStatus,
            demoSource: 'MANUAL',
            demoBookedAt: nextStatus === 'BOOKED' ? nowIso : null,
            updatedAt: nowIso,
          },
          { merge: true }
        );
        if (lead.leadId) {
          await setDoc(
            doc(db, 'leads', lead.leadId),
            {
              demoStatus: nextStatus,
              demoSource: 'MANUAL',
              demoBookedAt: nextStatus === 'BOOKED' ? nowIso : null,
              status: nextStatus === 'BOOKED' ? 'DEMO_BOOKED' : 'ENGAGED',
              updatedAt: nowIso,
            },
            { merge: true }
          ).catch(() => {});
        }
      } catch (err) {
        console.warn('Direct Firestore demo update notice:', err);
      }
    }

    try {
      const res = await fetch(`/api/campaigns/lead/${lead.campaignLeadId}/demo-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demoStatus: nextStatus,
          demoSource: 'MANUAL',
        }),
      });
      const data = await res.json();
      if (data.lead && selectedCampaignId) {
        loadSelectedCampaignDetails(selectedCampaignId);
        loadData();
      }
    } catch (e) {
      console.error('Error updating demo status:', e);
    }
  };

  // File Upload & Parsing Handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!rows || rows.length === 0) {
          setUploadError('The uploaded file is empty.');
          return;
        }

        // Check if row 0 has an email address (indicates no header row)
        let headers: string[] = [];
        let dataRows: any[][] = [];

        const firstRowStr = (rows[0] || []).join(' ');
        const hasHeader = !firstRowStr.includes('@');

        if (hasHeader && rows.length >= 2) {
          headers = rows[0].map((h: any, i: number) => String(h || `Column_${i + 1}`).trim());
          dataRows = rows.slice(1).filter((r) => r && r.length > 0 && r.some((c) => Boolean(c)));
        } else {
          // No header row: synthesize headers
          const maxCols = Math.max(...rows.map((r) => (r ? r.length : 0)), 1);
          headers = Array.from({ length: maxCols }, (_, i) => i === 0 ? 'Email' : i === 1 ? 'Name' : i === 2 ? 'Company' : `Column_${i + 1}`);
          dataRows = rows.filter((r) => r && r.length > 0 && r.some((c) => Boolean(c)));
        }

        if (dataRows.length === 0) {
          setUploadError('The uploaded file contains no data rows.');
          return;
        }

        setRawHeaders(headers);
        setRawRows(dataRows);

        // Auto-detect columns
        const findCol = (candidates: string[]) =>
          headers.find((h) => candidates.some((c) => h.toLowerCase().includes(c))) || '';

        const detectedEmail = findCol(['email', 'e-mail', 'mail']) || headers[0] || '';
        const detectedName = findCol(['name', 'contact', 'person', 'lead']);
        const detectedCompany = findCol(['company', 'agency', 'firm', 'organization', 'operator']);
        const detectedPhone = findCol(['phone', 'mobile', 'whatsapp', 'tel']);
        const detectedDesignation = findCol(['designation', 'job', 'title', 'role']);

        const mapping = {
          email: detectedEmail,
          name: detectedName || '',
          company: detectedCompany || '',
          phone: detectedPhone || '',
          designation: detectedDesignation || '',
        };
        setColumnMapping(mapping);

        // Build preview
        updateLeadsPreview(dataRows, headers, mapping);
      } catch (err: any) {
        setUploadError(`Failed to parse file: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const updateLeadsPreview = (rows: any[][], headers: string[], mapping: typeof columnMapping) => {
    const emailIdx = headers.indexOf(mapping.email);
    const nameIdx = headers.indexOf(mapping.name);
    const companyIdx = headers.indexOf(mapping.company);
    const phoneIdx = headers.indexOf(mapping.phone);
    const desigIdx = headers.indexOf(mapping.designation);

    const parsed = rows
      .map((r, i) => {
        const email = emailIdx >= 0 ? String(r[emailIdx] || '').trim() : '';
        const name = nameIdx >= 0 ? String(r[nameIdx] || '').trim() : '';
        const company = companyIdx >= 0 ? String(r[companyIdx] || '').trim() : '';
        const phone = phoneIdx >= 0 ? String(r[phoneIdx] || '').trim() : '';
        const designation = desigIdx >= 0 ? String(r[desigIdx] || '').trim() : '';
        return {
          rowNumber: i + 1,
          email,
          name: name || (email ? email.split('@')[0] : 'Lead'),
          companyName: company || 'Agency',
          phone,
          designation,
          isValid: Boolean(email && email.includes('@')),
        };
      })
      .filter((l) => l.email);

    setParsedPreviewLeads(parsed);
  };

  const handleColumnMappingChange = (field: keyof typeof columnMapping, colName: string) => {
    const nextMapping = { ...columnMapping, [field]: colName };
    setColumnMapping(nextMapping);
    updateLeadsPreview(rawRows, rawHeaders, nextMapping);
  };

  // Preview AI Generated Emails
  const handlePreviewAiEmails = async () => {
    const validLeads = parsedPreviewLeads.filter((l) => l.isValid);
    if (validLeads.length === 0) {
      alert('Please upload a file with valid leads first.');
      return;
    }

    setAiPreviewLoading(true);
    try {
      const res = await fetch('/api/campaigns/ai-generate-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: validLeads }),
      });
      const data = await res.json();
      if (data.success && data.samples) {
        setAiPreviewSamples(data.samples);
        setIsAiPreviewModalOpen(true);
      } else {
        alert(data.error || 'Failed to generate AI email previews.');
      }
    } catch (e: any) {
      alert(`Error generating AI preview: ${e.message}`);
    } finally {
      setAiPreviewLoading(false);
    }
  };

  // Submit Create Campaign
  const handleCreateCampaignSubmit = async () => {
    setCreateCampaignError(null);

    const trimmedName = newCampaignName.trim();
    if (!trimmedName) {
      setCreateCampaignError('Please enter a campaign name.');
      return;
    }
    const validLeads = parsedPreviewLeads.filter((l) => l.isValid);
    if (validLeads.length === 0) {
      setCreateCampaignError('Please add at least one lead (Upload a spreadsheet, paste emails, or click "⚡ Sample Leads").');
      return;
    }

    const effectiveTemplateId =
      campaignMode === 'PREDEFINED'
        ? selectedTemplateId || selectedTemplateIdRef.current || (templates.length > 0 ? templates[0].templateId : undefined)
        : undefined;

    const matchedTemplate =
      (selectedTemplateFromDb && selectedTemplateFromDb.templateId === effectiveTemplateId)
        ? selectedTemplateFromDb
        : templates.find((t) => t.templateId === effectiveTemplateId);

    setLoading(true);
    let createdCampaignResult: Campaign | null = null;
    let createdLeadsResult: CampaignLead[] = [];

    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          type: newCampaignType,
          campaignMode,
          templateId: effectiveTemplateId,
          templateName: matchedTemplate?.name,
          templateSubject: matchedTemplate?.subject,
          templateBody: matchedTemplate?.body,
          sourceFileName: uploadedFileName || 'Leads List',
          leads: validLeads,
          startImmediately,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.campaign) {
          createdCampaignResult = data.campaign;
          if (data.leads) createdLeadsResult = data.leads;
        }
      }
    } catch (e: any) {
      console.warn('[Create Campaign API Note]:', e?.message || e);
    }

    // Client-side fallback if server API call timed out or failed on Vercel
    if (!createdCampaignResult) {
      const now = new Date().toISOString();
      const campaignId = `camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const mode = campaignMode || 'PREDEFINED';

      createdCampaignResult = {
        campaignId,
        name: trimmedName,
        type: newCampaignType || 'EMAIL',
        campaignMode: mode,
        deliveryMode: deliveryMode || 'LIVE_SMTP',
        status: startImmediately ? 'RUNNING' : 'DRAFT',
        templateId: mode === 'AI_GENERATED' ? undefined : effectiveTemplateId,
        templateName: mode === 'AI_GENERATED' ? 'AI Intelligent Personalization' : (matchedTemplate?.name || 'Predefined Template'),
        sourceFileName: uploadedFileName || 'Leads List',
        totalLeads: validLeads.length,
        sentCount: 0,
        pendingCount: validLeads.length,
        failedCount: 0,
        repliedCount: 0,
        demoBookedCount: 0,
        createdAt: now,
        updatedAt: now,
        lastRunNumber: startImmediately ? 1 : 0,
      };

      createdLeadsResult = validLeads.map((l, idx) => {
        const cleanEmail = (l.email || '').trim().toLowerCase();
        const leadName = l.name || cleanEmail.split('@')[0];
        return {
          campaignLeadId: `clead-${campaignId}-${idx + 1}`,
          campaignId,
          leadId: `lead-${cleanEmail.replace(/[^a-z0-9]/gi, '_')}`,
          name: leadName,
          companyName: l.companyName || `${leadName}'s Agency`,
          email: cleanEmail,
          phone: l.phone,
          designation: l.designation || 'Director / Owner',
          sourceFile: uploadedFileName || 'Leads List',
          rowNumber: l.rowNumber || idx + 1,
          sendStatus: 'PENDING',
          replyStatus: 'NOT_REPLIED',
          demoStatus: 'NOT_BOOKED',
          demoIntent: false,
          sendCount: 0,
          createdAt: now,
          updatedAt: now,
        };
      });
    }

    // Ensure persistence directly in Firestore from client browser if configured
    if (createdCampaignResult && isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'campaigns', createdCampaignResult.campaignId), createdCampaignResult, { merge: true });
        const leadSaves = createdLeadsResult.map((cl) =>
          setDoc(doc(db, 'campaign_leads', cl.campaignLeadId), cl, { merge: true })
        );
        await Promise.allSettled(leadSaves);
      } catch (fsErr) {
        console.warn('Browser Firestore save note:', fsErr);
      }
    }

    if (createdCampaignResult) {
      setIsCreateModalOpen(false);
      setNewCampaignName('');
      setUploadedFileName('');
      setPastedLeadsText('');
      setRawHeaders([]);
      setRawRows([]);
      setParsedPreviewLeads([]);
      setCreateCampaignError(null);

      const targetCamp = createdCampaignResult;
      setCampaigns((prev) => [targetCamp, ...prev.filter((c) => c.campaignId !== targetCamp.campaignId)]);
      setSelectedCampaignId(targetCamp.campaignId);
      setSelectedCampaign(targetCamp);
      setCampaignLeads(createdLeadsResult);

      loadData();
      if (targetCamp.campaignId) {
        loadSelectedCampaignDetails(targetCamp.campaignId);
      }
    } else {
      setCreateCampaignError('Unable to create campaign. Please check inputs and try again.');
    }
    setLoading(false);
  };

  // Save / Update Template with direct Firestore & API synchronization
  const handleSaveTemplate = async (payload: EmailTemplate) => {
    setIsSavingTemplate(true);
    setTemplateFormError(null);

    const templateId = payload.templateId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fullPayload: EmailTemplate = {
      ...payload,
      templateId,
    };

    try {
      // 1. PRIMARY: Store directly into Firestore Database
      if (isFirebaseConfigured && db && tenantId) {
        try {
          await setDoc(tplDoc(templateId), fullPayload, { merge: true });
          console.log('[DB Storage] Successfully saved template with attachments directly to Firestore DB:', templateId);
        } catch (fsErr) {
          console.error('[DB Storage] Direct Firestore write note:', fsErr);
        }
      }

      // 2. Server API call (updates in-memory store and verifies persistence)
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload),
      });
      const data = await res.json();
      const savedTpl: EmailTemplate = (data && data.success && data.template) ? data.template : fullPayload;

      // 3. Update local templates state with the new/updated template
      setTemplates((prev) => {
        const filtered = prev.filter((t) => t.templateId !== savedTpl.templateId);
        return [savedTpl, ...filtered];
      });

      // 4. CRITICAL: Automatically pre-select this newly saved template immediately for the next campaign!
      setSelectedTemplateId(savedTpl.templateId);
      selectedTemplateIdRef.current = savedTpl.templateId;
      setSelectedTemplateFromDb(savedTpl);

      setIsTemplateModalOpen(false);
      setEditingTemplate(null);
      setTemplateFormName('');
      setTemplateFormSubject('');
      setTemplateFormBody('');
      setTemplateSaveFeedback(
        editingTemplate
          ? `Template "${savedTpl.name}" updated successfully in database!`
          : `New template "${savedTpl.name}" saved to database and selected for your next campaign!`
      );
      setTimeout(() => setTemplateSaveFeedback(null), 5000);
    } catch (e: any) {
      console.error('Error saving template:', e);
      setTemplateFormError(`Failed to save template: ${e?.message || 'Unknown error'}`);
      throw e;
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const promptDeleteTemplate = (tpl: EmailTemplate) => {
    setTemplateToDelete(tpl);
    setIsDeleteTemplateModalOpen(true);
  };

  const handleConfirmDeleteTemplate = async () => {
    if (!templateToDelete) return;
    const targetId = templateToDelete.templateId;
    setIsDeletingTemplate(true);

    try {
      // 1. Direct Firestore deletion
      if (isFirebaseConfigured && db && tenantId) {
        try {
          await deleteDoc(tplDoc(targetId));
        } catch (fsErr) {
          console.warn('Firestore delete template note:', fsErr);
        }
      }

      // 2. Delete via API
      await fetch(`/api/templates/${targetId}`, { method: 'DELETE' });

      // 3. Local state update
      setTemplates((prev) => prev.filter((t) => t.templateId !== targetId));
      if (selectedTemplateId === targetId || selectedTemplateIdRef.current === targetId) {
        setSelectedTemplateId('');
        selectedTemplateIdRef.current = '';
        setSelectedTemplateFromDb(null);
      }
      if (editingTemplate?.templateId === targetId) {
        setIsTemplateModalOpen(false);
        setEditingTemplate(null);
      }

      setIsDeleteTemplateModalOpen(false);
      setTemplateToDelete(null);
      setTemplateSaveFeedback('Email template deleted from database.');
      setTimeout(() => setTemplateSaveFeedback(null), 3500);
    } catch (e: any) {
      console.error('Error deleting template:', e);
      alert(`Failed to delete template: ${e?.message || e}`);
    } finally {
      setIsDeletingTemplate(false);
    }
  };

  const handleDeleteTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.templateId === templateId);
    if (tpl) {
      promptDeleteTemplate(tpl);
    } else {
      promptDeleteTemplate({
        templateId,
        name: 'Email Template',
        subject: '',
        body: '',
        createdAt: '',
        updatedAt: '',
      });
    }
  };

  const openEditTemplate = (tpl: EmailTemplate) => {
    setEditingTemplate(tpl);
    setTemplateFormName(tpl.name);
    setTemplateFormSubject(tpl.subject);
    setTemplateFormBody(tpl.body);
    setTemplateFormError(null);
    setIsTemplateModalOpen(true);
  };

  function stripHtml(html: string): string {
    if (!html) return '';
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || '';
    } catch {
      return html.replace(/<[^>]*>?/gm, '');
    }
  }

  // Helper to preview variable replacement with mock agency data
  const renderTemplatePreview = (text: string) => {
    return text
      .replace(/\{\{name\}\}/gi, 'Mr. Tariq Farooq')
      .replace(/\{\{firstName\}\}/gi, 'Tariq')
      .replace(/\{\{lastName\}\}/gi, 'Farooq')
      .replace(/\{\{company\}\}/gi, 'Al-Bait Pilgrimage Tours')
      .replace(/\{\{designation\}\}/gi, 'Managing Director')
      .replace(/\{\{email\}\}/gi, 'tariq@albait-tours.com');
  };

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return campaignLeads.filter((lead) => {
      // Filter by status
      if (leadStatusFilter === 'PENDING' && lead.sendStatus !== 'PENDING') return false;
      if (leadStatusFilter === 'SENT' && lead.sendStatus !== 'SENT') return false;
      if (leadStatusFilter === 'FAILED' && lead.sendStatus !== 'FAILED') return false;
      if (leadStatusFilter === 'REPLIED' && lead.replyStatus !== 'REPLIED') return false;
      if (leadStatusFilter === 'DEMO_BOOKED' && lead.demoStatus !== 'BOOKED') return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = lead.name.toLowerCase().includes(q);
        const matchesEmail = lead.email.toLowerCase().includes(q);
        const matchesCompany = lead.companyName.toLowerCase().includes(q);
        return matchesName || matchesEmail || matchesCompany;
      }

      return true;
    });
  }, [campaignLeads, leadStatusFilter, searchQuery]);

  // Selected Campaign Template
  const activeTemplate = useMemo(() => {
    return templates.find((t) => t.templateId === selectedCampaign?.templateId) || templates[0];
  }, [templates, selectedCampaign?.templateId]);

  return (
    <div id="campaign-management-root" className="flex flex-col h-full bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Top Header */}
      <header className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-orange-50 border border-orange-200 rounded-xl text-orange-600">
            <Send className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900">Outbound Campaigns</h1>
              <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                Persistent Engine
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              High-converting cold email sequences, run tracking, automatic demo detection & idempotency
            </p>
          </div>
        </div>

        {/* Tab Switcher & Primary Action */}
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              id="tab-campaigns"
              onClick={() => setActiveTab('CAMPAIGNS')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'CAMPAIGNS'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>Campaigns ({campaigns.length})</span>
              </div>
            </button>
            <button
              id="tab-templates"
              onClick={() => setActiveTab('TEMPLATES')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'TEMPLATES'
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>Email Templates ({templates.length})</span>
              </div>
            </button>
          </div>

          <button
            id="refresh-campaigns-btn"
            onClick={loadData}
            title="Refresh campaign stats"
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 transition"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-orange-500' : ''}`} />
          </button>

          {activeTab === 'CAMPAIGNS' && (
            <button
              id="create-campaign-btn"
              onClick={() => openCreateCampaignModal()}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Create Campaign</span>
            </button>
          )}
          {activeTab === 'TEMPLATES' && (
            <button
              id="create-template-btn"
              onClick={() => {
                setEditingTemplate(null);
                setTemplateFormName('');
                setTemplateFormSubject('');
                setTemplateFormBody('');
                setIsTemplateModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>New Template</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      {activeTab === 'CAMPAIGNS' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Campaigns List */}
          <aside className="w-80 border-r border-slate-200 bg-white flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                All Campaigns
              </span>
              <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                {campaigns.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {campaigns.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  <Layers className="w-8 h-8 mx-auto mb-2 text-slate-400 opacity-60" />
                  <p className="text-sm font-medium text-slate-600">No campaigns yet</p>
                  <p className="text-xs text-slate-400 mt-1">Create your first campaign to begin cold outreach</p>
                  <button
                    onClick={() => openCreateCampaignModal()}
                    className="mt-3 px-3 py-1.5 text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-100 transition inline-block font-semibold"
                  >
                    Create Campaign
                  </button>
                </div>
              ) : (
                campaigns.map((camp) => {
                  const isSelected = camp.campaignId === selectedCampaignId;
                  const liveCampTotal = isSelected && campaignLeads.length > 0 ? campaignLeads.length : camp.totalLeads;
                  const liveCampSent = isSelected && campaignLeads.length > 0 ? campaignLeads.filter((l) => l.sendStatus === 'SENT').length : camp.sentCount;
                  const liveCampReplied = isSelected && campaignLeads.length > 0 ? campaignLeads.filter((l) => l.replyStatus === 'REPLIED').length : camp.repliedCount;
                  const liveCampDemo = isSelected && campaignLeads.length > 0 ? campaignLeads.filter((l) => l.demoStatus === 'BOOKED').length : (camp.demoBookedCount || 0);
                  const percentSent = liveCampTotal > 0 ? Math.round((liveCampSent / liveCampTotal) * 100) : 0;
                  return (
                    <div
                      key={camp.campaignId}
                      id={`campaign-card-${camp.campaignId}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectCampaign(camp)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectCampaign(camp);
                        }
                      }}
                      className={`p-3 rounded-xl cursor-pointer border transition-all select-none group active:scale-[0.99] ${
                        isSelected
                          ? 'bg-orange-50/70 border-orange-500 shadow-xs ring-1 ring-orange-500/30'
                          : 'bg-white border-slate-200/90 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <h3 className={`text-sm font-semibold truncate transition-colors ${
                            isSelected ? 'text-orange-600 font-bold' : 'text-slate-800 group-hover:text-orange-600'
                          }`}>
                            {camp.name}
                          </h3>
                          {isSelected && (
                            <span className="text-[9px] px-1.5 py-0.2 bg-orange-100 text-orange-700 border border-orange-200 font-bold rounded-sm uppercase tracking-wider shrink-0">
                              Selected
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-[10px] px-2 py-0.5 font-medium rounded-full ${
                              camp.status === 'RUNNING'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : camp.status === 'PAUSED'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : camp.status === 'COMPLETED'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {camp.status}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCampaignToDelete(camp);
                              setIsDeleteModalOpen(true);
                            }}
                            title="Delete Campaign"
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                        <span>{liveCampTotal} Leads</span>
                        <span>{percentSent}% Sent</span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-1.5 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-orange-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentSent}%` }}
                        />
                      </div>

                      {/* Quick metrics */}
                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span>{liveCampSent}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-sky-500" />
                          <span>{liveCampReplied}</span>
                        </span>
                        <span className="flex items-center gap-1 text-orange-600 font-semibold">
                          <Sparkles className="w-3 h-3" />
                          <span>{liveCampDemo} Demos</span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right Main Content: Selected Campaign Execution Dashboard */}
          <main className="flex-1 flex flex-col overflow-y-auto bg-slate-50">
            {selectedCampaign ? (
              <div className="p-6 space-y-6">
                {/* Notification Banner */}
                {campaignNotification && (
                  <div
                    className={`p-4 rounded-2xl border flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200 ${
                      campaignNotification.type === 'success'
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                        : campaignNotification.type === 'warning'
                        ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                        : 'bg-sky-950/40 border-sky-500/40 text-sky-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-black/20 shrink-0 mt-0.5">
                        {campaignNotification.type === 'success' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        ) : campaignNotification.type === 'warning' ? (
                          <AlertTriangle className="w-5 h-5 text-amber-400" />
                        ) : (
                          <Sparkles className="w-5 h-5 text-sky-400" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-100">{campaignNotification.title}</h4>
                        <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{campaignNotification.message}</p>
                        {campaignNotification.subtext && (
                          <p className="text-[11px] opacity-80 mt-1 font-mono">{campaignNotification.subtext}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setCampaignNotification(null)}
                      className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-white/5 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Campaign Header Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-white border border-slate-200 rounded-2xl shadow-2xs">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-slate-900">{selectedCampaign.name}</h2>
                      <span
                        className={`text-xs px-2.5 py-0.5 font-semibold rounded-full ${
                          selectedCampaign.status === 'RUNNING'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : selectedCampaign.status === 'PAUSED'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : selectedCampaign.status === 'COMPLETED'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {selectedCampaign.status}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                        Run #{selectedCampaign.lastRunNumber || 1}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
                      <span className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>Template: {selectedCampaign.templateName || 'Default B2B Portal'}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5 text-slate-400" />
                        <span>Source: {selectedCampaign.sourceFileName || 'Uploaded Leads'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions: Start / Pause / Restart */}
                  <div className="flex items-center gap-2">
                    {selectedCampaign.status === 'RUNNING' ? (
                      <button
                        id="pause-campaign-btn"
                        onClick={() => handlePauseCampaign(selectedCampaign.campaignId)}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition shadow-xs"
                      >
                        <Pause className="w-4 h-4" />
                        <span>Pause Sending</span>
                      </button>
                    ) : selectedCampaign.status === 'COMPLETED' ? (
                      <>
                        <div className="flex items-center gap-2 px-3.5 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Campaign Completed</span>
                        </div>
                        {(() => {
                          const failedCount = campaignLeads.filter((l) => l.sendStatus === 'FAILED').length;
                          return failedCount > 0 ? (
                            <button
                              id="retry-failed-campaign-btn"
                              onClick={() => handleStartCampaign(selectedCampaign.campaignId)}
                              className="flex items-center gap-2 px-3.5 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-sm font-semibold transition shadow-xs"
                              title="Re-send only the leads whose delivery failed"
                            >
                              <RotateCcw className="w-4 h-4" />
                              <span>Retry failed ({failedCount})</span>
                            </button>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <button
                        id="start-campaign-btn"
                        onClick={() => handleStartCampaign(selectedCampaign.campaignId)}
                        className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition shadow-xs"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>{selectedCampaign.status === 'PAUSED' ? 'Resume Campaign' : 'Start Campaign'}</span>
                      </button>
                    )}

                    <button
                      id="restart-campaign-btn"
                      onClick={() => setIsRestartConfirmOpen(true)}
                      className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-sm font-medium transition group"
                      title="Intelligent restart: only sends to unreplied leads"
                    >
                      <RotateCcw className="w-4 h-4 text-sky-600 group-hover:rotate-180 transition-transform duration-300" />
                      <span>Restart (New Run)</span>
                    </button>

                    <button
                      id="delete-campaign-btn"
                      onClick={() => {
                        setCampaignToDelete(selectedCampaign);
                        setIsDeleteModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-xl text-sm font-medium transition"
                      title="Delete this campaign and all its leads"
                    >
                      <Trash2 className="w-4 h-4 text-rose-500" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* Real-time Metric Cards Grid */}
                {(() => {
                  const currentRunNum = selectedCampaign.lastRunNumber || 1;
                  const isRestartRun = currentRunNum > 1;

                  const liveTotalLeads = campaignLeads.length > 0 ? campaignLeads.length : selectedCampaign.totalLeads;
                  
                  // For restart follow-up runs, target pool is unreplied leads receiving follow-ups
                  const unrepliedLeads = campaignLeads.filter((l) => l.replyStatus !== 'REPLIED');
                  const targetLeadsForRun = isRestartRun ? unrepliedLeads : campaignLeads;
                  const runTargetCount = isRestartRun ? targetLeadsForRun.length : liveTotalLeads;

                  const liveSentCount = isRestartRun
                    ? targetLeadsForRun.filter((l) => l.sendStatus === 'SENT').length
                    : (campaignLeads.length > 0 ? campaignLeads.filter((l) => l.sendStatus === 'SENT').length : selectedCampaign.sentCount);

                  const livePendingCount = isRestartRun
                    ? targetLeadsForRun.filter((l) => l.sendStatus === 'PENDING').length
                    : (campaignLeads.length > 0 ? campaignLeads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED').length : selectedCampaign.pendingCount);

                  const liveFailedCount = isRestartRun
                    ? targetLeadsForRun.filter((l) => l.sendStatus === 'FAILED').length
                    : (campaignLeads.length > 0 ? campaignLeads.filter((l) => l.sendStatus === 'FAILED').length : (selectedCampaign.failedCount || 0));

                  const liveRepliedCount = campaignLeads.length > 0 ? campaignLeads.filter((l) => l.replyStatus === 'REPLIED').length : selectedCampaign.repliedCount;
                  const liveDemoCount = campaignLeads.length > 0 ? campaignLeads.filter((l) => l.demoStatus === 'BOOKED').length : (selectedCampaign.demoBookedCount || 0);

                  const percentSent = runTargetCount > 0 ? Math.round((liveSentCount / runTargetCount) * 100) : 0;

                  return (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
                        <p className="text-xs text-slate-500 font-medium">Total Leads</p>
                        <p className="text-2xl font-bold text-slate-900 mt-1">{liveTotalLeads}</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {isRestartRun ? `Run #${currentRunNum} Target: ${runTargetCount} unreplied` : 'Uploaded prospect pool'}
                        </p>
                      </div>

                      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500 font-medium">Emails Sent</p>
                          {isRestartRun && (
                            <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                              Run #{currentRunNum}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1 mt-1">
                          <p className="text-2xl font-bold text-orange-600">{liveSentCount}</p>
                          <span className="text-xs text-slate-400">
                            / {runTargetCount}
                          </span>
                        </div>
                        <div className="mt-2 w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                          <div
                            className="bg-orange-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentSent}%` }}
                          />
                        </div>
                      </div>

                      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
                        <p className="text-xs text-slate-500 font-medium">Pending</p>
                        <p className="text-2xl font-bold text-amber-600 mt-1">{livePendingCount}</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {isRestartRun ? `Run #${currentRunNum} queued sends` : 'Awaiting dispatch'}
                        </p>
                      </div>

                      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
                        <p className="text-xs text-slate-500 font-medium">Failed / Errors</p>
                        <p className="text-2xl font-bold text-rose-600 mt-1">{liveFailedCount}</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {isRestartRun ? `Run #${currentRunNum} delivery errors` : 'SMTP errors / bounced'}
                        </p>
                      </div>

                      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
                        <p className="text-xs text-slate-500 font-medium">Replies</p>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <p className="text-2xl font-bold text-sky-600">{liveRepliedCount}</p>
                          <span className="text-xs text-sky-600 font-medium">
                            {liveSentCount > 0
                              ? `(${Math.round((liveRepliedCount / liveSentCount) * 100)}%)`
                              : '(0%)'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">Inbound replies received</p>
                      </div>

                      <div className="p-4 bg-orange-50/60 border border-orange-200 rounded-xl relative overflow-hidden shadow-2xs">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-orange-700">Demo Booked</p>
                          <Sparkles className="w-4 h-4 text-orange-500" />
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <p className="text-2xl font-bold text-orange-600">{liveDemoCount}</p>
                          <span className="text-xs text-orange-700 font-medium">
                            {liveSentCount > 0
                              ? `(${Math.round((liveDemoCount / liveSentCount) * 100)}%)`
                              : '(0%)'}
                          </span>
                        </div>
                        <p className="text-[11px] text-orange-700 mt-1 font-medium">Automatic + Manual</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Runs History Accordion / Bar if multiple runs exist */}
                {campaignRuns.length > 0 && (
                  <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Execution Runs History ({campaignRuns.length})</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {campaignRuns.map((run) => (
                        <div
                          key={run.runId}
                          className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center gap-2"
                        >
                          <span className="font-semibold text-slate-700">Run #{run.runNumber}</span>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                              run.status === 'COMPLETED'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : run.status === 'RUNNING'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {run.status}
                          </span>
                          <span className="text-slate-500 text-[11px]">
                            {run.sentCount} sent
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Leads Table Card */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  {/* Table Controls Header */}
                  <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          id="search-leads-input"
                          type="text"
                          placeholder="Search lead, email, company..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-64 pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 transition"
                        />
                      </div>

                      {/* Filter Pills */}
                      <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                        {(['ALL', 'PENDING', 'SENT', 'REPLIED', 'DEMO_BOOKED', 'FAILED'] as const).map(
                          (filter) => (
                            <button
                              key={filter}
                              id={`filter-leads-${filter.toLowerCase()}`}
                              onClick={() => setLeadStatusFilter(filter)}
                              className={`px-2.5 py-1 rounded-md transition ${
                                leadStatusFilter === filter
                                  ? 'bg-orange-500 text-white font-semibold shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {filter.replace('_', ' ')}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-500">
                      Showing <span className="font-semibold text-slate-900">{filteredLeads.length}</span> of{' '}
                      {campaignLeads.length} leads
                    </div>
                  </div>

                  {/* Leads Data Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
                        <tr>
                          <th className="py-3 px-4">#</th>
                          <th className="py-3 px-4">Lead Name / Title</th>
                          <th className="py-3 px-4">Email</th>
                          <th className="py-3 px-4">Company</th>
                          <th className="py-3 px-4">Send Status</th>
                          <th className="py-3 px-4">Reply Status</th>
                          <th className="py-3 px-4">Demo Status</th>
                          <th className="py-3 px-4">Last Sent</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredLeads.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-10 text-center text-slate-400">
                              No leads matching the current filter
                            </td>
                          </tr>
                        ) : (
                          filteredLeads.map((lead, idx) => {
                            const isDemoBooked = lead.demoStatus === 'BOOKED';
                            return (
                              <tr
                                key={lead.campaignLeadId}
                                className="hover:bg-slate-50 transition group"
                              >
                                <td className="py-3 px-4 text-slate-400">{lead.rowNumber || idx + 1}</td>
                                <td className="py-3 px-4">
                                  <div className="font-semibold text-slate-900">{lead.name}</div>
                                  {lead.designation && (
                                    <div className="text-[11px] text-slate-500">{lead.designation}</div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                                  {lead.email}
                                </td>
                                <td className="py-3 px-4 text-slate-700 font-medium">
                                  <div className="flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                    <span>{lead.companyName}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1 ${
                                      lead.sendStatus === 'SENT'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : lead.sendStatus === 'SENDING'
                                        ? 'bg-sky-50 text-sky-700 border border-sky-200 animate-pulse'
                                        : lead.sendStatus === 'FAILED'
                                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                                    }`}
                                  >
                                    {lead.sendStatus === 'SENT' && <CheckCircle2 className="w-2.5 h-2.5" />}
                                    {lead.sendStatus === 'FAILED' && <AlertCircle className="w-2.5 h-2.5" />}
                                    {lead.sendStatus}
                                  </span>
                                  {lead.lastError && lead.sendStatus !== 'SENT' && (
                                    <p className="text-[10px] text-rose-600 truncate max-w-[140px] mt-0.5" title={lead.lastError}>
                                      {lead.lastError}
                                    </p>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <button
                                    onClick={() => handleToggleReplyStatus(lead)}
                                    title="Click to toggle Lead Reply / Qualification status"
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1 transition border ${
                                      lead.replyStatus === 'REPLIED'
                                        ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                                        : 'bg-slate-100 text-slate-500 border-slate-200 hover:text-slate-800 hover:border-slate-300'
                                    }`}
                                  >
                                    {lead.replyStatus === 'REPLIED' ? (
                                      <>
                                        <MessageSquare className="w-2.5 h-2.5 text-sky-600" />
                                        <span>REPLIED</span>
                                      </>
                                    ) : (
                                      <span>NO REPLY</span>
                                    )}
                                  </button>
                                </td>
                                <td className="py-3 px-4">
                                  <button
                                    onClick={() => handleToggleDemoStatus(lead)}
                                    title="Click to toggle Demo Booked status"
                                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition inline-flex items-center gap-1.5 border ${
                                      isDemoBooked
                                        ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'
                                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-200'
                                    }`}
                                  >
                                    {isDemoBooked ? (
                                      <>
                                        <Sparkles className="w-3 h-3 text-orange-500" />
                                        <span>Booked ({lead.demoSource || 'Manual'})</span>
                                      </>
                                    ) : (
                                      <>
                                        <span>Not Booked</span>
                                        <span className="text-[10px] opacity-60">(Click)</span>
                                      </>
                                    )}
                                  </button>
                                </td>
                                <td className="py-3 px-4 text-slate-500 text-[11px]">
                                  {lead.lastSentAt
                                    ? new Date(lead.lastSentAt).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : '—'}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {lead.conversationId && onOpenConversation ? (
                                    <button
                                      onClick={() => onOpenConversation(lead.conversationId!)}
                                      className="p-1 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded transition"
                                      title="Open Thread in Unified Inbox"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </button>
                                  ) : (
                                    <span className="text-slate-400 text-[11px]">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400">
                <p>Select a campaign on the left or create a new campaign</p>
              </div>
            )}
          </main>
        </div>
      )}



      {/* Email Templates Sub-Tab */}
      {activeTab === 'TEMPLATES' && (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Feedback notification */}
            {templateSaveFeedback && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center justify-between shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-medium">{templateSaveFeedback}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setActiveTab('CAMPAIGNS');
                      openCreateCampaignModal(selectedTemplateIdRef.current);
                    }}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow transition"
                  >
                    <span>Use in Campaign</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTemplateSaveFeedback(null)}
                    className="text-emerald-400 hover:text-emerald-200 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Header & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-900">Outbound Email Templates</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                    {templates.length} {templates.length === 1 ? 'Template' : 'Templates'}
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Database className="w-3 h-3 text-emerald-500" />
                    <span>Database Synced</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Dynamic templates stored in Firestore database. Supports variable replacement like <code className="text-orange-600 bg-orange-50 px-1 py-0.5 rounded font-mono">{`{{name}}`}</code>, <code className="text-orange-600 bg-orange-50 px-1 py-0.5 rounded font-mono">{`{{company}}`}</code>, and <code className="text-orange-600 bg-orange-50 px-1 py-0.5 rounded font-mono">{`{{designation}}`}</code>.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingTemplate(null);
                    setTemplateFormName('');
                    setTemplateFormSubject('');
                    setTemplateFormBody('');
                    setTemplateFormError(null);
                    setIsTemplateModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-semibold transition shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Template</span>
                </button>
              </div>
            </div>

            {/* Search Filter Bar */}
            <div className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <Search className="w-4 h-4 text-slate-400 ml-1.5" />
              <input
                type="text"
                placeholder="Search templates by name or subject..."
                value={templateSearchQuery}
                onChange={(e) => setTemplateSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 placeholder-slate-400 focus:outline-none flex-1"
              />
              {templateSearchQuery && (
                <button
                  onClick={() => setTemplateSearchQuery('')}
                  className="text-slate-400 hover:text-slate-600 text-xs px-2 font-medium"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Templates List */}
            {templates.filter((tpl) => {
              if (!templateSearchQuery.trim()) return true;
              const q = templateSearchQuery.toLowerCase();
              return tpl.name.toLowerCase().includes(q) || tpl.subject.toLowerCase().includes(q);
            }).length === 0 ? (
              <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <Mail className="w-10 h-10 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-800">
                  {templateSearchQuery ? 'No templates match your search query.' : 'No email templates found in database.'}
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Create your first email template with dynamic placeholders to use in outbound campaigns.
                </p>
                <button
                  onClick={() => {
                    setEditingTemplate(null);
                    setTemplateFormName('');
                    setTemplateFormSubject('');
                    setTemplateFormBody('');
                    setTemplateFormError(null);
                    setIsTemplateModalOpen(true);
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create First Template</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {templates
                  .filter((tpl) => {
                    if (!templateSearchQuery.trim()) return true;
                    const q = templateSearchQuery.toLowerCase();
                    return tpl.name.toLowerCase().includes(q) || tpl.subject.toLowerCase().includes(q);
                  })
                  .map((tpl) => {
                    // Extract placeholder tags present in this template
                    const tags = Array.from(
                      new Set(
                        `${tpl.subject} ${tpl.body}`.match(/\{\{[a-zA-Z0-9_]+\}\}/g) || []
                      )
                    );

                    return (
                      <div
                        key={tpl.templateId}
                        className="p-5 bg-white border border-slate-200 hover:border-orange-300 rounded-2xl flex flex-col justify-between transition-all duration-150 shadow-2xs"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-slate-900 text-sm">{tpl.name}</h3>
                              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-medium">
                                Saved in DB
                              </span>
                              {tpl.isHtml || tpl.format === 'html' || tpl.htmlBody ? (
                                <span className="text-[10px] px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded font-medium flex items-center gap-1">
                                  <Code className="w-2.5 h-2.5" />
                                  <span>HTML Rich Text</span>
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded font-medium">
                                  Plain Text
                                </span>
                              )}
                              {tpl.attachments && tpl.attachments.length > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-medium flex items-center gap-1">
                                  <Paperclip className="w-2.5 h-2.5" />
                                  <span>{tpl.attachments.length} {tpl.attachments.length === 1 ? 'Attachment' : 'Attachments'}</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => openEditTemplate(tpl)}
                                className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                                title="Edit Email Template"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => promptDeleteTemplate(tpl)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                title="Delete Email Template from Database"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="text-xs font-mono text-orange-700 bg-orange-50/60 p-2.5 rounded-xl border border-orange-100 break-words">
                            <span className="text-slate-500 font-sans text-[11px] mr-1">Subject:</span>
                            {tpl.subject}
                          </div>

                          <div className="text-xs text-slate-600 line-clamp-4 whitespace-pre-wrap leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 font-sans">
                            {tpl.body || stripHtml(tpl.htmlBody || '')}
                          </div>

                          {/* Attachments chip bar */}
                          {tpl.attachments && tpl.attachments.length > 0 && (
                            <div className="p-2 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex items-center gap-1">
                                <Paperclip className="w-3 h-3 text-orange-500" />
                                <span>Attached Files ({tpl.attachments.length}):</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {tpl.attachments.map((att: any, attIdx: number) => (
                                  <div
                                    key={att.id || attIdx}
                                    className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[10px] text-slate-700 flex items-center gap-1 font-mono shadow-2xs"
                                    title={att.name || att.filename}
                                  >
                                    <File className="w-2.5 h-2.5 text-sky-500" />
                                    <span className="max-w-[130px] truncate">{att.name || att.filename}</span>
                                    {att.size && (
                                      <span className="text-slate-400 text-[9px]">
                                        ({att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(0)}KB` : `${(att.size / (1024 * 1024)).toFixed(1)}MB`})
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 pt-1">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mr-1">
                                Variables:
                              </span>
                              {tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="truncate max-w-[140px] font-mono" title={tpl.templateId}>
                            ID: {tpl.templateId}
                          </span>
                          <div className="flex items-center gap-3">
                            <span>{new Date(tpl.updatedAt || tpl.createdAt).toLocaleDateString()}</span>
                            <button
                              onClick={() => {
                                setActiveTab('CAMPAIGNS');
                                openCreateCampaignModal(tpl.templateId);
                              }}
                              className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-semibold"
                            >
                              <span>Use in Campaign</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE CAMPAIGN MODAL (WIZARD) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-slate-900">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Create New Campaign</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure campaign details, upload leads file, and select template
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Campaign Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Campaign Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q4 Outreach - Key Accounts"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Campaign Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Campaign Type *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <div
                    onClick={() => setNewCampaignType('EMAIL')}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center gap-2 ${
                      newCampaignType === 'EMAIL'
                        ? 'bg-orange-50 border-orange-500 text-orange-700 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Mail className="w-4 h-4 text-orange-500" />
                    <div>
                      <div className="text-xs font-semibold">EMAIL</div>
                      <div className="text-[10px] text-slate-500">SMTP Active</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed">
                    <div className="text-xs font-semibold">WHATSAPP</div>
                    <div className="text-[10px] text-slate-500">Coming Soon</div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed">
                    <div className="text-xs font-semibold">WHATSAPP + EMAIL</div>
                    <div className="text-[10px] text-slate-500">Coming Soon</div>
                  </div>
                </div>
              </div>

              {/* Lead Sources Selection Tabs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Add Campaign Leads *
                  </label>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    parsedPreviewLeads.length > 0 ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {parsedPreviewLeads.length} Lead{parsedPreviewLeads.length === 1 ? '' : 's'} Ready
                  </span>
                </div>

                <div className="flex items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-xl mb-3">
                  <button
                    type="button"
                    onClick={() => setLeadInputMethod('UPLOAD')}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                      leadInputMethod === 'UPLOAD'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLeadInputMethod('PASTE')}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                      leadInputMethod === 'PASTE'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Paste Leads</span>
                  </button>

                  {isUmrah && (
                  <button
                    type="button"
                    onClick={() => {
                      setLeadInputMethod('SAMPLE');
                      handleLoadSampleLeads();
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                      leadInputMethod === 'SAMPLE'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span>⚡ Sample Leads</span>
                  </button>
                  )}
                </div>

                {/* TAB 1: FILE UPLOAD */}
                {leadInputMethod === 'UPLOAD' && (
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                      className="hidden"
                    />

                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 hover:border-orange-500 rounded-xl p-5 text-center cursor-pointer bg-slate-50/50 transition group"
                    >
                      <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-400 group-hover:text-orange-500 transition" />
                      {uploadedFileName && leadInputMethod === 'UPLOAD' ? (
                        <div>
                          <p className="text-sm font-semibold text-orange-600">{uploadedFileName}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Found {parsedPreviewLeads.length} valid rows. Click to change file.
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            Click to select or drag and drop leads spreadsheet
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Supports CSV, XLS, XLSX. Any column structure supported.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: QUICK PASTE */}
                {leadInputMethod === 'PASTE' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Paste lines with Email, Name, Company (comma, tab or newline separated):</span>
                      {isUmrah && (
                      <button
                        type="button"
                        onClick={() => handleParsePastedLeads(`tariq@mansoorhajj.com, Tariq Al-Mansoor, Al-Mansoor Hajj Mumbai\nrashid@haramainjourneys.in, Rashid Farooqui, Haramain Journeys\nfarhan@malikpilgrimages.co.uk, Farhan Malik, Malik Pilgrimages UK`)}
                        className="text-orange-600 hover:underline text-[10px] font-semibold"
                      >
                        Paste Example Format
                      </button>
                      )}
                    </div>
                    <textarea
                      rows={4}
                      value={pastedLeadsText}
                      onChange={(e) => handleParsePastedLeads(e.target.value)}
                      placeholder={isUmrah ? `e.g.:\nahmed@safwatravels.in, Ahmed Khan, Al-Safwa Travels\ncontact@delhiumrah.in, Irfan Siddiqui, Delhi Consolidators\nbooking@alnoortours.ae, Bilal Qureshi, Al-Noor Tours` : `e.g.:\njane@example.com, Jane Doe, Example Co.\njohn@acme.com, John Smith, Acme Inc.`}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}

                {/* TAB 3: 1-CLICK SAMPLE LEADS */}
                {leadInputMethod === 'SAMPLE' && (
                  <div className="p-4 bg-orange-50/50 border border-orange-200 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-orange-500" />
                        <span className="text-xs font-bold text-slate-900">5 Verified Pilgrimage Tour Operator Leads</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleLoadSampleLeads}
                        className="px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition"
                      >
                        Reload 5 Leads
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Pre-configured licensed agency contacts across Mumbai, Delhi, London, and Dubai ready for instant campaign dispatch.
                    </p>
                  </div>
                )}

                {uploadError && (
                  <p className="text-xs text-rose-600 mt-2 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{uploadError}</span>
                  </p>
                )}
              </div>

              {/* Column Mapping Preview if headers detected */}
              {rawHeaders.length > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Auto-Detected Columns Mapping</span>
                  </span>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-600 mb-1">Email Column (Required) *</label>
                      <select
                        value={columnMapping.email}
                        onChange={(e) => handleColumnMappingChange('email', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded text-slate-800"
                      >
                        {rawHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1">Name / Contact Column</label>
                      <select
                        value={columnMapping.name}
                        onChange={(e) => handleColumnMappingChange('name', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded text-slate-800"
                      >
                        <option value="">None (Use email prefix)</option>
                        {rawHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1">Company Column</label>
                      <select
                        value={columnMapping.company}
                        onChange={(e) => handleColumnMappingChange('company', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded text-slate-800"
                      >
                        <option value="">None (Default)</option>
                        {rawHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1">Designation Column</label>
                      <select
                        value={columnMapping.designation}
                        onChange={(e) => handleColumnMappingChange('designation', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded text-slate-800"
                      >
                        <option value="">None</option>
                        {rawHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Quick Leads Preview (First 3) */}
                  {parsedPreviewLeads.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">Preview (Sample Leads):</span>
                      <div className="mt-1 space-y-1">
                        {parsedPreviewLeads.slice(0, 3).map((l, i) => (
                          <div key={i} className="flex items-center gap-2 text-slate-700">
                            <span className="text-orange-600 font-mono">{l.email}</span>
                            <span>•</span>
                            <span>{l.name}</span>
                            <span>•</span>
                            <span className="text-slate-500">{l.companyName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Campaign Mode Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Campaign Email Generation Mode *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setCampaignMode('PREDEFINED')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      campaignMode === 'PREDEFINED'
                        ? 'bg-orange-50 border-orange-500 text-slate-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-slate-900">
                      <FileText className="w-4 h-4 text-orange-500" />
                      <span>Predefined Template</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Uses standard template with variable replacement ({"{{name}}"}, {"{{company}}"}).
                    </p>
                  </div>

                  <div
                    onClick={() => setCampaignMode('AI_GENERATED')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      campaignMode === 'AI_GENERATED'
                        ? 'bg-orange-50 border-orange-500 text-slate-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-slate-900">
                      <Sparkles className="w-4 h-4 text-orange-500 animate-pulse" />
                      <span>AI Intelligent Personalization</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Full AI research, web signals, pain points, and Knowledge Base product pitching per lead.
                    </p>
                  </div>
                </div>
              </div>

              {/* Conditional: Predefined Template Selector or AI Preview Button */}
              {campaignMode === 'PREDEFINED' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Select Predefined Email Template *
                      </label>
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                        <Database className="w-3 h-3 text-emerald-600" />
                        <span>Database Synced</span>
                      </span>
                    </div>
                    <span className="text-[11px] text-orange-600 font-semibold">
                      {templates.length} templates in database
                    </span>
                  </div>

                  {/* Dropdown Selector */}
                  <select
                    value={selectedTemplateId || (templates.length > 0 ? templates[0].templateId : '')}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:border-orange-500 transition"
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.templateId} value={tpl.templateId}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>

                  {/* Visual Selectable Template Cards */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Or Select Directly from Database:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-1">
                      {templates.map((tpl) => {
                        const isSelected = (selectedTemplateId || (templates.length > 0 ? templates[0].templateId : '')) === tpl.templateId;
                        return (
                          <div
                            key={tpl.templateId}
                            onClick={() => handleSelectTemplate(tpl.templateId)}
                            className={`p-3 rounded-xl border cursor-pointer transition text-left relative flex flex-col justify-between ${
                              isSelected
                                ? 'bg-orange-50 border-orange-500 ring-1 ring-orange-500/30 shadow-2xs'
                                : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-600'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h4 className={`text-xs font-bold leading-tight ${isSelected ? 'text-orange-600' : 'text-slate-900'}`}>
                                    {tpl.name}
                                  </h4>
                                  {tpl.isHtml || tpl.format === 'html' || tpl.htmlBody ? (
                                    <span className="text-[9px] px-1 py-0.2 bg-sky-50 text-sky-700 rounded font-medium">
                                      HTML
                                    </span>
                                  ) : null}
                                  {tpl.attachments && tpl.attachments.length > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.2 bg-amber-50 text-amber-700 rounded font-medium flex items-center gap-0.5">
                                      <Paperclip className="w-2.5 h-2.5" />
                                      <span>{tpl.attachments.length}</span>
                                    </span>
                                  )}
                                </div>
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                  isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-300'
                                }`}>
                                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 font-mono">
                                {tpl.subject}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                                {stripHtml(tpl.htmlBody || tpl.body).slice(0, 100)}...
                              </p>
                            </div>
                            <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px]">
                              <span className={isSelected ? 'text-orange-600 font-semibold' : 'text-slate-400'}>
                                {isSelected ? '✓ ACTIVE SELECTION' : 'Click to select from DB'}
                              </span>
                              <span className="text-slate-400 font-mono text-[9px]">DB Doc: {tpl.templateId.slice(0, 14)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Active Selected Template Verification Box */}
                  {(() => {
                    const currentId = selectedTemplateId || (templates.length > 0 ? templates[0].templateId : '');
                    const activeTpl = (selectedTemplateFromDb && selectedTemplateFromDb.templateId === currentId)
                      ? selectedTemplateFromDb
                      : templates.find((t) => t.templateId === currentId);
                    if (!activeTpl) return null;
                    return (
                      <div className="p-3.5 bg-orange-50/40 border border-orange-200 rounded-xl text-xs space-y-2.5">
                        <div className="flex items-center justify-between border-b border-orange-100 pb-2">
                          <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-orange-500" />
                            <span className="text-[11px] font-bold text-orange-700 uppercase tracking-wider">
                              Retrieved from Database:
                            </span>
                            {isLoadingTemplateFromDb && (
                              <RefreshCw className="w-3 h-3 text-orange-500 animate-spin" />
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {activeTpl.attachments && activeTpl.attachments.length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-medium flex items-center gap-1">
                                <Paperclip className="w-3 h-3" />
                                <span>{activeTpl.attachments.length} File(s) Attached</span>
                              </span>
                            )}
                            <span className="text-[11px] text-orange-700 font-bold bg-orange-100 px-2.5 py-0.5 rounded border border-orange-200 font-mono">
                              {activeTpl.name}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                            Personalized Subject Line:
                          </span>
                          <p className="font-semibold text-slate-800 mt-0.5 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs">
                            {activeTpl.subject}
                          </p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                              Email Message Body (from DB):
                            </span>
                            <span className="text-[10px] text-slate-500">
                              (Placeholders like <code className="text-orange-600 font-mono">{"{{name}}"}</code> & <code className="text-orange-600 font-mono">{"{{company}}"}</code> will be auto-filled)
                            </span>
                          </div>
                          <div className="max-h-36 overflow-y-auto bg-white p-3 rounded-lg border border-slate-200 text-slate-800 text-xs leading-relaxed shadow-2xs">
                            {activeTpl.htmlBody ? (
                              <div
                                className="prose max-w-none text-xs"
                                dangerouslySetInnerHTML={{ __html: activeTpl.htmlBody }}
                              />
                            ) : (
                              <div className="font-mono whitespace-pre-wrap">
                                {activeTpl.body}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Attachments preview box */}
                        {activeTpl.attachments && activeTpl.attachments.length > 0 && (
                          <div className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-slate-700 flex items-center gap-1">
                                <Paperclip className="w-3.5 h-3.5 text-amber-500" />
                                <span>Attached to outgoing campaign emails:</span>
                              </span>
                              <span className="text-slate-400 font-mono text-[10px]">
                                Auto-dispatched via SMTP
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {activeTpl.attachments.map((att: any, attIdx: number) => (
                                <div
                                  key={att.id || attIdx}
                                  className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-[10px] text-slate-700 flex items-center gap-1.5"
                                >
                                  <File className="w-3 h-3 text-sky-500" />
                                  <span className="font-medium">{att.name || att.filename}</span>
                                  {att.size && (
                                    <span className="text-slate-400 font-mono">
                                      ({att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(1)} KB` : `${(att.size / (1024 * 1024)).toFixed(1)} MB`})
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="p-4 bg-orange-50/50 border border-orange-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-orange-500" />
                        <span>AI Personalization Engine Ready</span>
                      </h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Each lead will receive an individually researched, tailored email referencing their company profile and {brand.companyName} product capabilities.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePreviewAiEmails}
                      disabled={aiPreviewLoading || parsedPreviewLeads.length === 0}
                      className="px-3.5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shrink-0 shadow-xs"
                    >
                      {aiPreviewLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Generating AI Preview...</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Preview AI Emails</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Start Immediately Checkbox */}
              <div className="pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={startImmediately}
                    onChange={(e) => setStartImmediately(e.target.checked)}
                    className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500 bg-slate-50 border-slate-300"
                  />
                  <span className="text-sm text-slate-700 font-medium">
                    Start Campaign sending immediately upon creation
                  </span>
                </label>
              </div>
            </div>

            {/* Error feedback if any */}
            {createCampaignError && (
              <div className="px-6 py-2.5 bg-rose-50 border-t border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{createCampaignError}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {parsedPreviewLeads.length > 0 ? (
                  <span className="text-emerald-700 font-medium">
                    ✓ {parsedPreviewLeads.length} lead{parsedPreviewLeads.length === 1 ? '' : 's'} ready
                  </span>
                ) : (
                  <span className="text-slate-500">
                    Add leads via file, paste or sample button
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateCampaignSubmit}
                  disabled={loading}
                  className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <span>{startImmediately ? 'Create & Start Campaign' : 'Save as Draft'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESTART CAMPAIGN CONFIRMATION MODAL & ALL-QUALIFIED POPUP */}
      {isRestartConfirmOpen && selectedCampaign && (() => {
        const repliedLeads = campaignLeads.filter((l) => l.replyStatus === 'REPLIED');
        const unrepliedLeads = campaignLeads.filter((l) => l.replyStatus !== 'REPLIED');
        const allQualified = campaignLeads.length > 0 && repliedLeads.length === campaignLeads.length;
        const nextRun = (selectedCampaign.lastRunNumber || 0) + 1;

        return (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl text-slate-900 animate-in fade-in zoom-in-95 duration-150">
              {allQualified ? (
                // ALL LEADS QUALIFIED POPUP
                <>
                  <div className="flex items-start gap-3">
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-600 shrink-0">
                      <Sparkles className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold mb-1 border border-amber-200">
                        <Check className="w-3 h-3 text-amber-600" /> 100% Campaign Conversion
                      </div>
                      <h3 className="text-base font-bold text-slate-900">
                        All Leads Have Replied & Qualified! 🎉
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        No pending follow-ups required
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-xs space-y-2.5 text-slate-800">
                    <div className="flex items-center gap-2 text-amber-700 font-semibold">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Zero Follow-up Emails Will Be Dispatched</span>
                    </div>
                    <p className="text-slate-700 text-[12px] leading-relaxed">
                      Every single lead in this campaign (<strong>{campaignLeads.length} of {campaignLeads.length} leads</strong>) has already responded and engaged.
                    </p>
                    <p className="text-amber-800 text-[11px] bg-amber-100/60 p-2.5 rounded-lg border border-amber-200 font-medium">
                      ⚠️ <strong>Notice:</strong> If you restart the campaign now for Run #{nextRun}, <span className="underline decoration-amber-500">no one will receive an email</span> because all contacts have already converted and qualified.
                    </p>
                  </div>

                  {/* Qualified Leads List */}
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Qualified Responders ({repliedLeads.length})
                    </p>
                    {repliedLeads.map((l) => (
                      <div
                        key={l.campaignLeadId}
                        className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />
                          <span className="font-semibold text-slate-900">{l.name}</span>
                          <span className="text-slate-500 text-[11px]">({l.companyName})</span>
                        </div>
                        <span className="px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded text-[10px] font-semibold">
                          REPLIED
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => setIsRestartConfirmOpen(false)}
                      className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Close / Do Not Send
                    </button>
                    <button
                      id="confirm-restart-all-qualified-btn"
                      disabled={isRestarting}
                      onClick={() => handleRestartCampaign(selectedCampaign.campaignId)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold transition flex items-center gap-2"
                    >
                      {isRestarting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <span>Acknowledge & Record Run #{nextRun} (0 Mails)</span>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                // INTELLIGENT FOLLOW-UP RESTART MODAL
                <>
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-sky-600">
                      <RotateCcw className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Restart Campaign & Launch Follow-Up Run #{nextRun}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Automated smart filtering based on lead reply & delivery status
                      </p>
                    </div>
                  </div>

                  {/* Summary Breakdown */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl">
                      <div className="text-[11px] text-orange-700 font-semibold uppercase tracking-wider">
                        Follow-Up Queue (Run #{nextRun})
                      </div>
                      <div className="text-xl font-bold text-orange-600 mt-1">
                        {unrepliedLeads.length} <span className="text-xs font-normal text-slate-500">leads</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Failed sends or unreplied contacts
                      </p>
                    </div>

                    <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl">
                      <div className="text-[11px] text-sky-700 font-semibold uppercase tracking-wider">
                        Excluded (Already Replied)
                      </div>
                      <div className="text-xl font-bold text-sky-600 mt-1">
                        {repliedLeads.length} <span className="text-xs font-normal text-slate-500">leads</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        0 emails sent to replied contacts
                      </p>
                    </div>
                  </div>

                  {/* Follow-up Recipients List */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                      <span>Recipients for Run #{nextRun} ({unrepliedLeads.length})</span>
                      <span className="text-[10px] text-orange-600 font-medium">Will receive follow-up email</span>
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {unrepliedLeads.map((lead) => {
                        const isFailed = lead.sendStatus === 'FAILED';
                        return (
                          <div
                            key={lead.campaignLeadId}
                            className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                          >
                            <div>
                              <div className="font-semibold text-slate-900">{lead.name}</div>
                              <div className="text-[11px] text-slate-500 font-mono">{lead.email}</div>
                            </div>
                            <div className="text-right">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  isFailed
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {isFailed ? 'Retry Failed Send' : 'Follow-up (No Reply)'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {repliedLeads.map((lead) => (
                        <div
                          key={lead.campaignLeadId}
                          className="flex items-center justify-between p-2 bg-slate-100/60 border border-slate-200 rounded-lg text-xs opacity-60"
                        >
                          <div>
                            <div className="font-medium text-slate-600">{lead.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{lead.email}</div>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px]">
                            Skipped (Replied)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => setIsRestartConfirmOpen(false)}
                      className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      id="confirm-restart-campaign-btn"
                      disabled={isRestarting || unrepliedLeads.length === 0}
                      onClick={() => handleRestartCampaign(selectedCampaign.campaignId)}
                      className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition flex items-center gap-2 shadow-xs"
                    >
                      {isRestarting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Dispatching Run #{nextRun}...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-white" />
                          <span>Confirm & Start Run #{nextRun} ({unrepliedLeads.length} Leads)</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* DELETE CAMPAIGN CONFIRMATION MODAL */}
      {isDeleteModalOpen && campaignToDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl text-slate-900">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Campaign</h3>
                <p className="text-xs text-slate-500">This action cannot be undone</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 text-slate-700">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="text-rose-600 font-semibold">{campaignToDelete.name}</strong>?
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>Stops any active background sending immediately.</li>
                <li>Permanently removes all {campaignToDelete.totalLeads} associated leads and statistics.</li>
                <li>Deletes execution runs and tracking records for this campaign.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                disabled={isDeletingCampaign}
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setCampaignToDelete(null);
                }}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                id="confirm-delete-campaign-btn"
                disabled={isDeletingCampaign}
                onClick={() => handleDeleteCampaign(campaignToDelete.campaignId)}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-xs"
              >
                {isDeletingCampaign ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Campaign</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT TEMPLATE MODAL */}
      <EmailTemplateEditorModal
        isOpen={isTemplateModalOpen}
        onClose={() => {
          setIsTemplateModalOpen(false);
          setEditingTemplate(null);
        }}
        onSave={handleSaveTemplate}
        editingTemplate={editingTemplate}
        isSaving={isSavingTemplate}
        error={templateFormError}
      />

      {/* DELETE TEMPLATE CONFIRMATION MODAL */}
      {isDeleteTemplateModalOpen && templateToDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl text-slate-900">
            <div className="p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Email Template</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Are you sure you want to delete <strong className="text-slate-800">"{templateToDelete.name}"</strong>?
                  This will permanently remove the template from the Firestore database.
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 font-mono truncate">
                Subject: {templateToDelete.subject}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteTemplateModalOpen(false);
                  setTemplateToDelete(null);
                }}
                disabled={isDeletingTemplate}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 transition font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTemplate}
                disabled={isDeletingTemplate}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition"
              >
                {isDeletingTemplate ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI PREVIEW MODAL */}
      {isAiPreviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-slate-900">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-orange-500" />
                  <span>AI Personalization Preview (Sample Leads)</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Review how the AI personalizes subject lines, opening hooks, and product pitches for each company.
                </p>
              </div>
              <button
                onClick={() => setIsAiPreviewModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {aiPreviewSamples.map((sample, idx) => (
                <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <div>
                      <span className="text-xs font-bold text-orange-600">{sample.lead.name}</span>
                      <span className="text-xs text-slate-500 ml-2">({sample.lead.email})</span>
                    </div>
                    <span className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded font-semibold">
                      {sample.lead.companyName || (isUmrah ? 'Agency' : 'Company')}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-700">
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-slate-500">Detected Pain Point:</span>
                      <p className="text-slate-800 font-medium">{sample.selectedPainPoint}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-slate-500">Selected Capabilities:</span>
                      <p className="text-orange-600 font-medium">{sample.selectedCapabilities?.join(', ')}</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Generated Subject:</span>
                    <p className="text-xs font-mono text-orange-700 bg-orange-50/60 p-2 rounded border border-orange-200 font-semibold">
                      {sample.subject}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-500">Generated Email Body:</span>
                    <div className="text-xs text-slate-800 bg-white p-3 rounded border border-slate-200 whitespace-pre-wrap leading-relaxed shadow-2xs font-sans">
                      {sample.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsAiPreviewModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 font-medium"
              >
                Back to Config
              </button>
              <button
                onClick={() => {
                  setIsAiPreviewModalOpen(false);
                  handleCreateCampaignSubmit();
                }}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition flex items-center gap-2 shadow-xs"
              >
                <span>Confirm & Create AI Campaign</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LEAD AI INSPECTION MODAL */}
      {inspectingLead && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-slate-900">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <User className="w-4 h-4 text-orange-500" />
                  <span>Lead Personalization Audit: {inspectingLead.name}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {inspectingLead.companyName} ({inspectingLead.email})
                </p>
              </div>
              <button
                onClick={() => setInspectingLead(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Send Status:</span>
                  <p className="font-semibold text-emerald-700 mt-0.5">{inspectingLead.sendStatus}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Demo Status:</span>
                  <p className="font-semibold text-sky-700 mt-0.5">{inspectingLead.demoStatus || 'NOT_BOOKED'}</p>
                </div>
              </div>

              {inspectingLead.generatedSubject && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Actual Sent Subject:</span>
                  <p className="text-xs font-mono text-orange-700 bg-orange-50/60 p-3 rounded-xl border border-orange-200 font-semibold">
                    {inspectingLead.generatedSubject}
                  </p>
                </div>
              )}

              {inspectingLead.generatedBody && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Actual Sent Email Body:</span>
                  <div className="text-xs text-slate-800 bg-slate-50 p-4 rounded-xl border border-slate-200 whitespace-pre-wrap leading-relaxed font-mono">
                    {inspectingLead.generatedBody}
                  </div>
                </div>
              )}

              {inspectingLead.selectedPainPoint && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Targeted Pain Point:</span>
                  <p className="text-xs text-slate-800 font-medium">{inspectingLead.selectedPainPoint}</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setInspectingLead(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold border border-slate-200 transition"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};