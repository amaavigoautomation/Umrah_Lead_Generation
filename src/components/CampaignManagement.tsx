import React, { useState, useEffect, useMemo, useRef } from 'react';
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
} from 'lucide-react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import {
  Campaign,
  CampaignLead,
  CampaignRun,
  EmailTemplate,
  DemoStatus,
  DemoSource,
  Conversation,
} from '../types/index.js';

interface CampaignManagementProps {
  onOpenConversation?: (conversationId: string) => void;
  conversations?: Conversation[];
}

export const CampaignManagement: React.FC<CampaignManagementProps> = ({
  onOpenConversation,
  conversations = [],
}) => {
  // Navigation sub-tabs
  const [activeTab, setActiveTab] = useState<'CAMPAIGNS' | 'TEMPLATES'>('CAMPAIGNS');

  // Campaigns state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
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

  // Fetch all templates directly from Firestore DB
  const fetchTemplatesDirectlyFromDb = async (): Promise<EmailTemplate[]> => {
    try {
      if (isFirebaseConfigured && db) {
        const snap = await getDocs(collection(db, 'email_templates'));
        if (!snap.empty) {
          const dbTpls: EmailTemplate[] = [];
          snap.forEach((d) => {
            const data = d.data() as EmailTemplate;
            if (data && data.templateId) dbTpls.push(data);
          });
          dbTpls.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
          setTemplates(dbTpls);
          return dbTpls;
        }
      }
    } catch (e) {
      console.warn('[DB Template] Note fetching templates from Firestore DB:', e);
    }
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.templates && data.templates.length > 0) {
        setTemplates(data.templates);
        return data.templates;
      }
    } catch (e) {}
    return [];
  };

  // Fetch a specific template document directly from Firestore DB
  const loadTemplateDirectlyFromDb = async (templateId: string): Promise<EmailTemplate | null> => {
    if (!templateId) return null;
    setIsLoadingTemplateFromDb(true);
    try {
      if (isFirebaseConfigured && db) {
        const snap = await getDoc(doc(db, 'email_templates', templateId));
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
    const targetId =
      preferredTemplateId ||
      (selectedTemplateId && dbTpls.some((t) => t.templateId === selectedTemplateId)
        ? selectedTemplateId
        : (dbTpls.length > 0 ? dbTpls[0].templateId : ''));
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

  // Template Form State
  const [templateFormName, setTemplateFormName] = useState('');
  const [templateFormSubject, setTemplateFormSubject] = useState('');
  const [templateFormBody, setTemplateFormBody] = useState('');

  // Fetch all campaigns and templates
  const loadData = async () => {
    try {
      setRefreshing(true);
      const [campRes, tplRes] = await Promise.all([
        fetch('/api/campaigns'),
        fetch('/api/templates'),
      ]);
      const campData = await campRes.json();
      const tplData = await tplRes.json();

      if (campData.campaigns) {
        setCampaigns(campData.campaigns);
        // If a campaign is currently selected, refresh its details
        if (selectedCampaignId) {
          const updated = campData.campaigns.find((c: Campaign) => c.campaignId === selectedCampaignId);
          if (updated) setSelectedCampaign(updated);
        } else if (campData.campaigns.length > 0 && !selectedCampaignId) {
          setSelectedCampaignId(campData.campaigns[0].campaignId);
          setSelectedCampaign(campData.campaigns[0]);
        }
      }

      if (tplData.templates && tplData.templates.length > 0) {
        setTemplates(tplData.templates);
        setSelectedTemplateId((curr) => {
          if (curr && tplData.templates.some((t: EmailTemplate) => t.templateId === curr)) {
            selectedTemplateIdRef.current = curr;
            return curr;
          }
          if (selectedTemplateIdRef.current && tplData.templates.some((t: EmailTemplate) => t.templateId === selectedTemplateIdRef.current)) {
            return selectedTemplateIdRef.current;
          }
          const firstId = tplData.templates[0].templateId;
          selectedTemplateIdRef.current = firstId;
          return firstId;
        });
      }
    } catch (e) {
      console.warn('Error loading campaigns/templates:', e);
    } finally {
      setRefreshing(false);
    }
  };

  // Load selected campaign details (leads and runs)
  const loadSelectedCampaignDetails = async (campaignId: string) => {
    try {
      const [campRes, leadsRes, runsRes] = await Promise.all([
        fetch(`/api/campaigns/${campaignId}`),
        fetch(`/api/campaigns/${campaignId}/leads`),
        fetch(`/api/campaigns/${campaignId}/runs`),
      ]);
      const campData = await campRes.json();
      const leadsData = await leadsRes.json();
      const runsData = await runsRes.json();

      if (campData.campaign) setSelectedCampaign(campData.campaign);
      if (leadsData.leads) setCampaignLeads(leadsData.leads);
      if (runsData.runs) setCampaignRuns(runsData.runs);
    } catch (e) {
      console.warn('Error loading campaign leads/runs:', e);
    }
  };

  // Real-time Firestore sync for email templates
  useEffect(() => {
    if (isFirebaseConfigured && db) {
      try {
        const unsubscribe = onSnapshot(
          collection(db, 'email_templates'),
          (snapshot) => {
            if (!snapshot.empty) {
              const loadedTpls: EmailTemplate[] = [];
              snapshot.forEach((docSnap) => {
                const data = docSnap.data() as EmailTemplate;
                if (data && data.templateId) {
                  loadedTpls.push(data);
                }
              });
              loadedTpls.sort(
                (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
              );
              setTemplates(loadedTpls);
              setSelectedTemplateId((curr) => {
                if (curr && loadedTpls.some((t) => t.templateId === curr)) {
                  selectedTemplateIdRef.current = curr;
                  return curr;
                }
                if (selectedTemplateIdRef.current && loadedTpls.some((t) => t.templateId === selectedTemplateIdRef.current)) {
                  return selectedTemplateIdRef.current;
                }
                const firstId = loadedTpls[0]?.templateId || '';
                selectedTemplateIdRef.current = firstId;
                return firstId;
              });
            }
          },
          (err) => {
            console.warn('Notice from Firestore email_templates listener:', err);
          }
        );
        return () => unsubscribe();
      } catch (e) {
        console.warn('Firestore subscription setup note:', e);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      // Poll every 3 seconds if active campaign is running
      if (selectedCampaign?.status === 'RUNNING' || campaigns.some((c) => c.status === 'RUNNING')) {
        loadData();
        if (selectedCampaignId) {
          loadSelectedCampaignDetails(selectedCampaignId);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedCampaignId, selectedCampaign?.status]);

  useEffect(() => {
    if (selectedCampaignId) {
      loadSelectedCampaignDetails(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // Campaign Actions
  const handleStartCampaign = async (campaignId: string) => {
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
      const res = await fetch(`/api/campaigns/${campaignId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setIsRestartConfirmOpen(false);

      if (data.success) {
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
            message: data.message || `Started follow-up run for ${data.targetLeadsCount} unreplied lead(s).`,
            subtext: `${data.alreadyRepliedCount} lead(s) who already replied were safely excluded from sending.`,
          });
        }

        if (data.campaign) setSelectedCampaign(data.campaign);
        await loadData();
        await loadSelectedCampaignDetails(campaignId);
      } else {
        setCampaignNotification({
          type: 'warning',
          title: 'Restart Failed',
          message: data.error || 'Unable to restart campaign',
        });
      }
    } catch (e: any) {
      console.error('Error restarting campaign:', e);
      setCampaignNotification({
        type: 'warning',
        title: 'Restart Error',
        message: e?.message || 'Network error occurred while restarting campaign',
      });
    } finally {
      setIsRestarting(false);
    }
  };

  // Update lead reply status (e.g. when manually qualifying or syncing lead state)
  const handleToggleReplyStatus = async (lead: CampaignLead) => {
    const nextStatus = lead.replyStatus === 'REPLIED' ? 'NOT_REPLIED' : 'REPLIED';
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
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setIsDeleteModalOpen(false);
        setCampaignToDelete(null);

        // Fetch fresh list
        const campRes = await fetch('/api/campaigns');
        const campData = await campRes.json();
        const updatedList: Campaign[] = campData.campaigns || [];
        setCampaigns(updatedList);

        if (selectedCampaignId === campaignId) {
          if (updatedList.length > 0) {
            setSelectedCampaignId(updatedList[0].campaignId);
            setSelectedCampaign(updatedList[0]);
            loadSelectedCampaignDetails(updatedList[0].campaignId);
          } else {
            setSelectedCampaignId(null);
            setSelectedCampaign(null);
            setCampaignLeads([]);
            setCampaignRuns([]);
          }
        }
      } else {
        alert(data.error || 'Failed to delete campaign');
      }
    } catch (e) {
      console.error('Error deleting campaign:', e);
    } finally {
      setIsDeletingCampaign(false);
    }
  };

  // Toggle Demo Status (Automatic or Manual single source of truth)
  const handleToggleDemoStatus = async (lead: CampaignLead) => {
    const nextStatus: DemoStatus = lead.demoStatus === 'BOOKED' ? 'NOT_BOOKED' : 'BOOKED';
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

        if (!rows || rows.length < 2) {
          setUploadError('The uploaded file contains no data rows.');
          return;
        }

        const headers = rows[0].map((h: any) => String(h || '').trim());
        const dataRows = rows.slice(1).filter((r) => r && r.length > 0 && r.some((c) => Boolean(c)));

        setRawHeaders(headers);
        setRawRows(dataRows);

        // Auto-detect columns
        const findCol = (candidates: string[]) =>
          headers.find((h) => candidates.some((c) => h.toLowerCase().includes(c))) || '';

        const detectedEmail = findCol(['email', 'e-mail', 'mail']);
        const detectedName = findCol(['name', 'contact', 'person', 'lead']);
        const detectedCompany = findCol(['company', 'agency', 'firm', 'organization', 'operator']);
        const detectedPhone = findCol(['phone', 'mobile', 'whatsapp', 'tel']);
        const detectedDesignation = findCol(['designation', 'job', 'title', 'role']);

        const mapping = {
          email: detectedEmail || headers[0] || '',
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
    if (!newCampaignName.trim()) {
      alert('Please enter a campaign name');
      return;
    }
    const validLeads = parsedPreviewLeads.filter((l) => l.isValid);
    if (validLeads.length === 0) {
      alert('Please upload a file with at least one valid email address.');
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

    console.log('[Create Campaign] Dispatching creation payload:', {
      name: newCampaignName,
      campaignMode,
      effectiveTemplateId,
      templateName: matchedTemplate?.name,
      leadsCount: validLeads.length,
      startImmediately,
    });

    setLoading(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCampaignName,
          type: newCampaignType,
          campaignMode,
          templateId: effectiveTemplateId,
          templateName: matchedTemplate?.name,
          templateSubject: matchedTemplate?.subject,
          templateBody: matchedTemplate?.body,
          sourceFileName: uploadedFileName,
          leads: validLeads,
          startImmediately,
        }),
      });

      const data = await res.json();
      if (data.campaign) {
        setIsCreateModalOpen(false);
        // Reset modal fields
        setNewCampaignName('');
        setUploadedFileName('');
        setRawHeaders([]);
        setRawRows([]);
        setParsedPreviewLeads([]);
        setSelectedCampaignId(data.campaign.campaignId);
        loadData();
      } else {
        alert(data.error || 'Failed to create campaign');
      }
    } catch (e: any) {
      alert(`Error creating campaign: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Save / Update Template with direct Firestore & API synchronization
  const handleSaveTemplate = async () => {
    if (!templateFormName.trim() || !templateFormSubject.trim() || !templateFormBody.trim()) {
      setTemplateFormError('Please fill in Template Name, Subject Line, and Email Body.');
      return;
    }

    setIsSavingTemplate(true);
    setTemplateFormError(null);

    const now = new Date().toISOString();
    const templateId = editingTemplate?.templateId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const payload: EmailTemplate = {
      templateId,
      name: templateFormName.trim(),
      subject: templateFormSubject.trim(),
      body: templateFormBody.trim(),
      createdAt: editingTemplate?.createdAt || now,
      updatedAt: now,
    };

    try {
      // 1. PRIMARY: Store directly into Firestore Database
      if (isFirebaseConfigured && db) {
        try {
          await setDoc(doc(db, 'email_templates', templateId), payload, { merge: true });
          console.log('[DB Storage] Successfully saved template directly to Firestore DB:', templateId);
        } catch (fsErr) {
          console.error('[DB Storage] Direct Firestore write note:', fsErr);
        }
      }

      // 2. Server API call (updates in-memory store and verifies persistence)
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const savedTpl: EmailTemplate = (data && data.success && data.template) ? data.template : payload;

      // 3. Update local templates state with the new template at the very top
      setTemplates((prev) => {
        const remaining = prev.filter((t) => t.templateId !== savedTpl.templateId);
        return [savedTpl, ...remaining];
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
      loadData();
    } catch (e: any) {
      console.error('Error saving template:', e);
      setTemplateFormError(`Failed to save template: ${e?.message || 'Unknown error'}`);
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
      if (isFirebaseConfigured && db) {
        try {
          await deleteDoc(doc(db, 'email_templates', targetId));
        } catch (fsErr) {
          console.warn('Firestore delete template note:', fsErr);
        }
      }

      // 2. Delete via API
      await fetch(`/api/templates/${targetId}`, { method: 'DELETE' });

      // 3. Optimistic local state update
      setTemplates((prev) => prev.filter((t) => t.templateId !== targetId));
      if (selectedTemplateId === targetId) {
        setSelectedTemplateId('');
      }
      if (editingTemplate?.templateId === targetId) {
        setIsTemplateModalOpen(false);
        setEditingTemplate(null);
      }

      setIsDeleteTemplateModalOpen(false);
      setTemplateToDelete(null);
      setTemplateSaveFeedback('Email template deleted from database.');
      setTimeout(() => setTemplateSaveFeedback(null), 3500);
      loadData();
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
    <div id="campaign-management-root" className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Header */}
      <header className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
            <Send className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100">Outbound Campaigns</h1>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Persistent Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              High-converting cold email sequences, run tracking, automatic demo detection & idempotency
            </p>
          </div>
        </div>

        {/* Tab Switcher & Primary Action */}
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700/60">
            <button
              id="tab-campaigns"
              onClick={() => setActiveTab('CAMPAIGNS')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === 'CAMPAIGNS'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
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
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === 'TEMPLATES'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
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
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg border border-slate-800 transition"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {activeTab === 'CAMPAIGNS' ? (
            <button
              id="create-campaign-btn"
              onClick={() => openCreateCampaignModal()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition shadow-md shadow-emerald-950/40"
            >
              <Plus className="w-4 h-4" />
              <span>Create Campaign</span>
            </button>
          ) : (
            <button
              id="create-template-btn"
              onClick={() => {
                setEditingTemplate(null);
                setTemplateFormName('');
                setTemplateFormSubject('');
                setTemplateFormBody('');
                setIsTemplateModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition shadow-md shadow-emerald-950/40"
            >
              <Plus className="w-4 h-4" />
              <span>New Template</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      {activeTab === 'CAMPAIGNS' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Campaigns List */}
          <aside className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                All Campaigns
              </span>
              <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                {campaigns.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {campaigns.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  <Layers className="w-8 h-8 mx-auto mb-2 text-slate-400 opacity-60" />
                  <p className="text-sm font-medium text-slate-400">No campaigns yet</p>
                  <p className="text-xs text-slate-400 mt-1">Create your first campaign to begin cold outreach</p>
                  <button
                    onClick={() => openCreateCampaignModal()}
                    className="mt-3 px-3 py-1.5 text-xs bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-600/50 transition inline-block"
                  >
                    Create Campaign
                  </button>
                </div>
              ) : (
                campaigns.map((camp) => {
                  const isSelected = camp.campaignId === selectedCampaignId;
                  const percentSent = camp.totalLeads > 0 ? Math.round((camp.sentCount / camp.totalLeads) * 100) : 0;
                  return (
                    <div
                      key={camp.campaignId}
                      id={`campaign-card-${camp.campaignId}`}
                      onClick={() => {
                        setSelectedCampaignId(camp.campaignId);
                        setSelectedCampaign(camp);
                      }}
                      className={`p-3 rounded-xl cursor-pointer border transition-all ${
                        isSelected
                          ? 'bg-slate-800/90 border-emerald-500/50 shadow-md shadow-emerald-950/20'
                          : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-100 truncate flex-1">{camp.name}</h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-[10px] px-2 py-0.5 font-medium rounded-full ${
                              camp.status === 'RUNNING'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse'
                                : camp.status === 'PAUSED'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : camp.status === 'COMPLETED'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : 'bg-slate-700 text-slate-300'
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
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-slate-400 flex items-center justify-between">
                        <span>{camp.totalLeads} Leads</span>
                        <span>{percentSent}% Sent</span>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-1.5 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentSent}%` }}
                        />
                      </div>

                      {/* Quick metrics */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>{camp.sentCount}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-sky-400" />
                          <span>{camp.repliedCount}</span>
                        </span>
                        <span className="flex items-center gap-1 text-emerald-400 font-medium">
                          <Sparkles className="w-3 h-3" />
                          <span>{camp.demoBookedCount} Demos</span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right Main Content: Selected Campaign Execution Dashboard */}
          <main className="flex-1 flex flex-col overflow-y-auto bg-slate-950">
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
                <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-slate-900 border border-slate-800 rounded-2xl">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-slate-100">{selectedCampaign.name}</h2>
                      <span
                        className={`text-xs px-2.5 py-0.5 font-semibold rounded-full ${
                          selectedCampaign.status === 'RUNNING'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : selectedCampaign.status === 'PAUSED'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : selectedCampaign.status === 'COMPLETED'
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {selectedCampaign.status}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        Run #{selectedCampaign.lastRunNumber || 1}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-400 mt-2">
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
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600/90 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition shadow"
                      >
                        <Pause className="w-4 h-4" />
                        <span>Pause Sending</span>
                      </button>
                    ) : (
                      <button
                        id="start-campaign-btn"
                        onClick={() => handleStartCampaign(selectedCampaign.campaignId)}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition shadow shadow-emerald-950/40"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>{selectedCampaign.status === 'PAUSED' ? 'Resume Campaign' : 'Start Campaign'}</span>
                      </button>
                    )}

                    <button
                      id="restart-campaign-btn"
                      onClick={() => setIsRestartConfirmOpen(true)}
                      className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-sm font-medium transition group"
                      title="Intelligent restart: only sends to unreplied leads"
                    >
                      <RotateCcw className="w-4 h-4 text-sky-400 group-hover:rotate-180 transition-transform duration-300" />
                      <span>Restart (New Run)</span>
                    </button>

                    <button
                      id="delete-campaign-btn"
                      onClick={() => {
                        setCampaignToDelete(selectedCampaign);
                        setIsDeleteModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-400 border border-slate-700 hover:border-rose-800/60 rounded-xl text-sm font-medium transition"
                      title="Delete this campaign and all its leads"
                    >
                      <Trash2 className="w-4 h-4 text-rose-400" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* Real-time Metric Cards Grid */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-400">Total Leads</p>
                    <p className="text-2xl font-bold text-slate-100 mt-1">{selectedCampaign.totalLeads}</p>
                    <p className="text-[11px] text-slate-400 mt-1">Uploaded prospect pool</p>
                  </div>

                  <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-400">Emails Sent</p>
                    <div className="flex items-baseline gap-1 mt-1">
                      <p className="text-2xl font-bold text-emerald-400">{selectedCampaign.sentCount}</p>
                      <span className="text-xs text-slate-400">
                        / {selectedCampaign.totalLeads}
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full"
                        style={{
                          width: `${
                            selectedCampaign.totalLeads > 0
                              ? Math.round((selectedCampaign.sentCount / selectedCampaign.totalLeads) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-400">Pending</p>
                    <p className="text-2xl font-bold text-amber-400 mt-1">{selectedCampaign.pendingCount}</p>
                    <p className="text-[11px] text-slate-400 mt-1">Awaiting dispatch</p>
                  </div>

                  <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-400">Failed / Errors</p>
                    <p className="text-2xl font-bold text-rose-400 mt-1">{selectedCampaign.failedCount || 0}</p>
                    <p className="text-[11px] text-slate-400 mt-1">SMTP errors / bounced</p>
                  </div>

                  <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-400">Replies</p>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <p className="text-2xl font-bold text-sky-400">{selectedCampaign.repliedCount}</p>
                      <span className="text-xs text-sky-300">
                        {selectedCampaign.sentCount > 0
                          ? `(${Math.round((selectedCampaign.repliedCount / selectedCampaign.sentCount) * 100)}%)`
                          : '(0%)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Inbound replies received</p>
                  </div>

                  <div className="p-4 bg-emerald-950/20 border border-emerald-500/30 rounded-xl relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-emerald-400">Demo Booked</p>
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <p className="text-2xl font-bold text-emerald-300">{selectedCampaign.demoBookedCount}</p>
                      <span className="text-xs text-emerald-400">
                        {selectedCampaign.sentCount > 0
                          ? `(${Math.round((selectedCampaign.demoBookedCount / selectedCampaign.sentCount) * 100)}%)`
                          : '(0%)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-400 mt-1">Automatic + Manual</p>
                  </div>
                </div>

                {/* Runs History Accordion / Bar if multiple runs exist */}
                {campaignRuns.length > 0 && (
                  <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Execution Runs History ({campaignRuns.length})</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {campaignRuns.map((run) => (
                        <div
                          key={run.runId}
                          className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg text-xs flex items-center gap-2"
                        >
                          <span className="font-semibold text-slate-200">Run #{run.runNumber}</span>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] rounded ${
                              run.status === 'COMPLETED'
                                ? 'bg-blue-500/20 text-blue-300'
                                : run.status === 'RUNNING'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-slate-700 text-slate-400'
                            }`}
                          >
                            {run.status}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            {run.sentCount} sent
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Leads Table Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  {/* Table Controls Header */}
                  <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          id="search-leads-input"
                          type="text"
                          placeholder="Search lead, email, company..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-64 pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      {/* Filter Pills */}
                      <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                        {(['ALL', 'PENDING', 'SENT', 'REPLIED', 'DEMO_BOOKED', 'FAILED'] as const).map(
                          (filter) => (
                            <button
                              key={filter}
                              id={`filter-leads-${filter.toLowerCase()}`}
                              onClick={() => setLeadStatusFilter(filter)}
                              className={`px-2.5 py-1 rounded-md transition ${
                                leadStatusFilter === filter
                                  ? 'bg-slate-800 text-emerald-400 font-semibold'
                                  : 'text-slate-400 hover:text-slate-300'
                              }`}
                            >
                              {filter.replace('_', ' ')}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-400">
                      Showing <span className="font-semibold text-slate-200">{filteredLeads.length}</span> of{' '}
                      {campaignLeads.length} leads
                    </div>
                  </div>

                  {/* Leads Data Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
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
                      <tbody className="divide-y divide-slate-800/60">
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
                                className="hover:bg-slate-800/40 transition group"
                              >
                                <td className="py-3 px-4 text-slate-400">{lead.rowNumber || idx + 1}</td>
                                <td className="py-3 px-4">
                                  <div className="font-medium text-slate-200">{lead.name}</div>
                                  {lead.designation && (
                                    <div className="text-[11px] text-slate-400">{lead.designation}</div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                                  {lead.email}
                                </td>
                                <td className="py-3 px-4 text-slate-300">
                                  <div className="flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                    <span>{lead.companyName}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1 ${
                                      lead.sendStatus === 'SENT'
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        : lead.sendStatus === 'SENDING'
                                        ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
                                        : lead.sendStatus === 'FAILED'
                                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                                    }`}
                                  >
                                    {lead.sendStatus === 'SENT' && <CheckCircle2 className="w-2.5 h-2.5" />}
                                    {lead.sendStatus === 'FAILED' && <AlertCircle className="w-2.5 h-2.5" />}
                                    {lead.sendStatus}
                                  </span>
                                  {lead.lastError && (
                                    <p className="text-[10px] text-rose-400 truncate max-w-[140px] mt-0.5" title={lead.lastError}>
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
                                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30'
                                        : 'bg-slate-800/90 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
                                    }`}
                                  >
                                    {lead.replyStatus === 'REPLIED' ? (
                                      <>
                                        <MessageSquare className="w-2.5 h-2.5 text-sky-400" />
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
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                                        : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700'
                                    }`}
                                  >
                                    {isDemoBooked ? (
                                      <>
                                        <Sparkles className="w-3 h-3 text-emerald-400" />
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
                                <td className="py-3 px-4 text-slate-400 text-[11px]">
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
                                      className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition"
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
      ) : (
        /* Email Templates Sub-Tab */
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-100">Outbound Email Templates</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {templates.length} {templates.length === 1 ? 'Template' : 'Templates'}
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Database className="w-3 h-3 text-emerald-400" />
                    <span>Database Synced</span>
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Dynamic templates stored in Firestore database. Supports variable replacement like <code className="text-emerald-400 bg-slate-950 px-1 py-0.5 rounded">{`{{name}}`}</code>, <code className="text-emerald-400 bg-slate-950 px-1 py-0.5 rounded">{`{{company}}`}</code>, and <code className="text-emerald-400 bg-slate-950 px-1 py-0.5 rounded">{`{{designation}}`}</code>.
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
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-emerald-900/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Template</span>
                </button>
              </div>
            </div>

            {/* Search Filter Bar */}
            <div className="flex items-center gap-3 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
              <Search className="w-4 h-4 text-slate-400 ml-1.5" />
              <input
                type="text"
                placeholder="Search templates by name or subject..."
                value={templateSearchQuery}
                onChange={(e) => setTemplateSearchQuery(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-200 placeholder-slate-500 focus:outline-none flex-1"
              />
              {templateSearchQuery && (
                <button
                  onClick={() => setTemplateSearchQuery('')}
                  className="text-slate-500 hover:text-slate-300 text-xs px-2"
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
              <div className="p-12 text-center bg-slate-900/40 rounded-2xl border border-slate-800/60 space-y-3">
                <Mail className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm font-medium text-slate-300">
                  {templateSearchQuery ? 'No templates match your search query.' : 'No email templates found in database.'}
                </p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
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
                  className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
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
                        className="p-5 bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl flex flex-col justify-between transition-all duration-150 shadow-sm"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-slate-100 text-sm">{tpl.name}</h3>
                              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                                Saved in DB
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => openEditTemplate(tpl)}
                                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition"
                                title="Edit Email Template"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => promptDeleteTemplate(tpl)}
                                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                                title="Delete Email Template from Database"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="text-xs font-mono text-emerald-400 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 break-words">
                            <span className="text-slate-400 font-sans text-[11px] mr-1">Subject:</span>
                            {tpl.subject}
                          </div>

                          <div className="text-xs text-slate-400 line-clamp-4 whitespace-pre-wrap leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-800/40 font-mono">
                            {tpl.body}
                          </div>

                          {tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 pt-1">
                              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mr-1">
                                Variables:
                              </span>
                              {tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700/60"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                          <span className="truncate max-w-[140px]" title={tpl.templateId}>
                            ID: {tpl.templateId}
                          </span>
                          <div className="flex items-center gap-3">
                            <span>{new Date(tpl.updatedAt || tpl.createdAt).toLocaleDateString()}</span>
                            <button
                              onClick={() => {
                                setActiveTab('CAMPAIGNS');
                                openCreateCampaignModal(tpl.templateId);
                              }}
                              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-100">Create New Campaign</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure campaign details, upload leads file, and select template
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Campaign Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Campaign Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Mumbai Umrah Operators - Q4 Outreach"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Campaign Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Campaign Type *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <div
                    onClick={() => setNewCampaignType('EMAIL')}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center gap-2 ${
                      newCampaignType === 'EMAIL'
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Mail className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div className="text-xs font-semibold">EMAIL</div>
                      <div className="text-[10px] text-slate-400">SMTP Active</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 text-slate-400 opacity-60 cursor-not-allowed">
                    <div className="text-xs font-semibold">WHATSAPP</div>
                    <div className="text-[10px] text-slate-400">Coming Soon</div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 text-slate-400 opacity-60 cursor-not-allowed">
                    <div className="text-xs font-semibold">WHATSAPP + EMAIL</div>
                    <div className="text-[10px] text-slate-400">Coming Soon</div>
                  </div>
                </div>
              </div>

              {/* Upload Leads File */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Upload Leads File (CSV / XLS / XLSX) *
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  className="hidden"
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700/80 hover:border-emerald-500/60 rounded-xl p-5 text-center cursor-pointer bg-slate-950/60 transition group"
                >
                  <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-400 group-hover:text-emerald-400 transition" />
                  {uploadedFileName ? (
                    <div>
                      <p className="text-sm font-semibold text-emerald-400">{uploadedFileName}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Found {parsedPreviewLeads.length} valid rows. Click to change file.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-slate-300">
                        Click to select or drag and drop leads spreadsheet
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Supports CSV, XLS, XLSX. Any column structure supported.
                      </p>
                    </div>
                  )}
                </div>

                {uploadError && (
                  <p className="text-xs text-rose-400 mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{uploadError}</span>
                  </p>
                )}
              </div>

              {/* Column Mapping Preview if headers detected */}
              {rawHeaders.length > 0 && (
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Auto-Detected Columns Mapping</span>
                  </span>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">Email Column (Required) *</label>
                      <select
                        value={columnMapping.email}
                        onChange={(e) => handleColumnMappingChange('email', e.target.value)}
                        className="w-full p-2 bg-slate-900 border border-slate-700 rounded text-slate-200"
                      >
                        {rawHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1">Name / Contact Column</label>
                      <select
                        value={columnMapping.name}
                        onChange={(e) => handleColumnMappingChange('name', e.target.value)}
                        className="w-full p-2 bg-slate-900 border border-slate-700 rounded text-slate-200"
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
                      <label className="block text-slate-400 mb-1">Company Column</label>
                      <select
                        value={columnMapping.company}
                        onChange={(e) => handleColumnMappingChange('company', e.target.value)}
                        className="w-full p-2 bg-slate-900 border border-slate-700 rounded text-slate-200"
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
                      <label className="block text-slate-400 mb-1">Designation Column</label>
                      <select
                        value={columnMapping.designation}
                        onChange={(e) => handleColumnMappingChange('designation', e.target.value)}
                        className="w-full p-2 bg-slate-900 border border-slate-700 rounded text-slate-200"
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
                    <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">
                      <span className="font-semibold text-slate-300">Preview (Sample Leads):</span>
                      <div className="mt-1 space-y-1">
                        {parsedPreviewLeads.slice(0, 3).map((l, i) => (
                          <div key={i} className="flex items-center gap-2 text-slate-300">
                            <span className="text-emerald-400 font-mono">{l.email}</span>
                            <span>•</span>
                            <span>{l.name}</span>
                            <span>•</span>
                            <span className="text-slate-400">{l.companyName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Campaign Mode Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Campaign Email Generation Mode *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setCampaignMode('PREDEFINED')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      campaignMode === 'PREDEFINED'
                        ? 'bg-emerald-600/20 border-emerald-500 text-slate-100'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-slate-200">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <span>Predefined Template</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Uses standard template with variable replacement ({"{{name}}"}, {"{{company}}"}).
                    </p>
                  </div>

                  <div
                    onClick={() => setCampaignMode('AI_GENERATED')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition ${
                      campaignMode === 'AI_GENERATED'
                        ? 'bg-emerald-600/20 border-emerald-500 text-slate-100'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-slate-200">
                      <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span>AI Intelligent Personalization</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
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
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Select Predefined Email Template *
                      </label>
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-medium">
                        <Database className="w-3 h-3" />
                        <span>Database Synced</span>
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-400 font-medium">
                      {templates.length} templates in database
                    </span>
                  </div>

                  {/* Dropdown Selector */}
                  <select
                    value={selectedTemplateId || (templates.length > 0 ? templates[0].templateId : '')}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm font-medium text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.templateId} value={tpl.templateId}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>

                  {/* Visual Selectable Template Cards */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
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
                                ? 'bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/50 shadow-sm'
                                : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-400'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <h4 className={`text-xs font-bold leading-tight ${isSelected ? 'text-emerald-300' : 'text-slate-200'}`}>
                                  {tpl.name}
                                </h4>
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                  isSelected ? 'border-emerald-400 bg-emerald-500 text-slate-950' : 'border-slate-700'
                                }`}>
                                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1 line-clamp-1 font-mono">
                                {tpl.subject}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                {tpl.body.slice(0, 100)}...
                              </p>
                            </div>
                            <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px]">
                              <span className={isSelected ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
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
                      <div className="p-3.5 bg-slate-950 border border-emerald-500/30 rounded-xl text-xs space-y-2.5 shadow-inner">
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                          <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-emerald-400" />
                            <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                              Retrieved from Database:
                            </span>
                            {isLoadingTemplateFromDb && (
                              <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
                            )}
                          </div>
                          <span className="text-[11px] text-emerald-300 font-semibold bg-emerald-950/60 px-2.5 py-0.5 rounded border border-emerald-800/40 font-mono">
                            {activeTpl.name}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                            Personalized Subject Line:
                          </span>
                          <p className="font-semibold text-emerald-300 mt-0.5 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
                            {activeTpl.subject}
                          </p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                              Email Message Body (from DB):
                            </span>
                            <span className="text-[10px] text-slate-400">
                              (Placeholders like <code className="text-emerald-400 font-mono">{"{{name}}"}</code> & <code className="text-emerald-400 font-mono">{"{{company}}"}</code> will be auto-filled)
                            </span>
                          </div>
                          <div className="max-h-36 overflow-y-auto bg-slate-900/90 p-3 rounded-lg border border-slate-800 text-slate-200 font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-inner">
                            {activeTpl.body}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="p-4 bg-slate-950 border border-emerald-500/30 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        <span>AI Personalization Engine Ready</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Each lead will receive an individually researched, tailored email referencing their company profile and Umrah360 product capabilities.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePreviewAiEmails}
                      disabled={aiPreviewLoading || parsedPreviewLeads.length === 0}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shrink-0"
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
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-sm text-slate-200">
                    Start Campaign sending immediately upon creation
                  </span>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCampaignSubmit}
                disabled={loading || parsedPreviewLeads.length === 0}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2"
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
      )}

      {/* RESTART CAMPAIGN CONFIRMATION MODAL & ALL-QUALIFIED POPUP */}
      {isRestartConfirmOpen && selectedCampaign && (() => {
        const repliedLeads = campaignLeads.filter((l) => l.replyStatus === 'REPLIED');
        const unrepliedLeads = campaignLeads.filter((l) => l.replyStatus !== 'REPLIED');
        const allQualified = campaignLeads.length > 0 && repliedLeads.length === campaignLeads.length;
        const nextRun = (selectedCampaign.lastRunNumber || 0) + 1;

        return (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              {allQualified ? (
                // ALL LEADS QUALIFIED POPUP
                <>
                  <div className="flex items-start gap-3">
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
                      <Sparkles className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold mb-1">
                        <Check className="w-3 h-3" /> 100% Campaign Conversion
                      </div>
                      <h3 className="text-base font-bold text-slate-100">
                        All Leads Have Replied & Qualified! 🎉
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        No pending follow-ups required
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-amber-950/20 border border-amber-500/30 rounded-xl text-xs space-y-2.5 text-slate-200">
                    <div className="flex items-center gap-2 text-amber-300 font-semibold">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Zero Follow-up Emails Will Be Dispatched</span>
                    </div>
                    <p className="text-slate-300 text-[12px] leading-relaxed">
                      Every single lead in this campaign (<strong>{campaignLeads.length} of {campaignLeads.length} leads</strong>) has already responded and engaged.
                    </p>
                    <p className="text-amber-200/90 text-[11px] bg-amber-900/30 p-2.5 rounded-lg border border-amber-600/30 font-medium">
                      ⚠️ <strong>Notice:</strong> If you restart the campaign now for Run #{nextRun}, <span className="underline decoration-amber-400">no one will receive an email</span> because all contacts have already converted and qualified.
                    </p>
                  </div>

                  {/* Qualified Leads List */}
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Qualified Responders ({repliedLeads.length})
                    </p>
                    {repliedLeads.map((l) => (
                      <div
                        key={l.campaignLeadId}
                        className="flex items-center justify-between p-2 bg-slate-950/80 border border-slate-800 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                          <span className="font-medium text-slate-200">{l.name}</span>
                          <span className="text-slate-400 text-[11px]">({l.companyName})</span>
                        </div>
                        <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 rounded text-[10px] font-semibold">
                          REPLIED
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => setIsRestartConfirmOpen(false)}
                      className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 font-medium"
                    >
                      Close / Do Not Send
                    </button>
                    <button
                      id="confirm-restart-all-qualified-btn"
                      disabled={isRestarting}
                      onClick={() => handleRestartCampaign(selectedCampaign.campaignId)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-2"
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
                    <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400">
                      <RotateCcw className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-100">
                        Restart Campaign & Launch Follow-Up Run #{nextRun}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Automated smart filtering based on lead reply & delivery status
                      </p>
                    </div>
                  </div>

                  {/* Summary Breakdown */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-xl">
                      <div className="text-[11px] text-emerald-400 font-semibold uppercase tracking-wider">
                        Follow-Up Queue (Run #{nextRun})
                      </div>
                      <div className="text-xl font-bold text-emerald-300 mt-1">
                        {unrepliedLeads.length} <span className="text-xs font-normal text-slate-400">leads</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Failed sends or unreplied contacts
                      </p>
                    </div>

                    <div className="p-3 bg-sky-950/20 border border-sky-500/30 rounded-xl">
                      <div className="text-[11px] text-sky-400 font-semibold uppercase tracking-wider">
                        Excluded (Already Replied)
                      </div>
                      <div className="text-xl font-bold text-sky-300 mt-1">
                        {repliedLeads.length} <span className="text-xs font-normal text-slate-400">leads</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        0 emails sent to replied contacts
                      </p>
                    </div>
                  </div>

                  {/* Follow-up Recipients List */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Recipients for Run #{nextRun} ({unrepliedLeads.length})</span>
                      <span className="text-[10px] text-emerald-400 font-normal">Will receive follow-up email</span>
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {unrepliedLeads.map((lead) => {
                        const isFailed = lead.sendStatus === 'FAILED';
                        return (
                          <div
                            key={lead.campaignLeadId}
                            className="flex items-center justify-between p-2 bg-slate-950 border border-slate-800 rounded-lg text-xs"
                          >
                            <div>
                              <div className="font-medium text-slate-200">{lead.name}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{lead.email}</div>
                            </div>
                            <div className="text-right">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  isFailed
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
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
                          className="flex items-center justify-between p-2 bg-slate-950/40 border border-slate-800/60 rounded-lg text-xs opacity-60"
                        >
                          <div>
                            <div className="font-medium text-slate-400">{lead.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{lead.email}</div>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[10px]">
                            Skipped (Replied)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => setIsRestartConfirmOpen(false)}
                      className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      id="confirm-restart-campaign-btn"
                      disabled={isRestarting || unrepliedLeads.length === 0}
                      onClick={() => handleRestartCampaign(selectedCampaign.campaignId)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-2 shadow shadow-emerald-950/40"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-900/40 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Delete Campaign</h3>
                <p className="text-xs text-slate-400">This action cannot be undone</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2 text-slate-300">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="text-rose-400 font-semibold">{campaignToDelete.name}</strong>?
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
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
                className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                id="confirm-delete-campaign-btn"
                disabled={isDeletingCampaign}
                onClick={() => handleDeleteCampaign(campaignToDelete.campaignId)}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
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
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-slate-100">
                  {editingTemplate ? 'Edit Email Template' : 'Create New Email Template'}
                </h3>
              </div>
              <button
                onClick={() => setIsTemplateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {templateFormError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{templateFormError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Template Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ramadan B2B Operator Outreach"
                  value={templateFormName}
                  onChange={(e) => {
                    setTemplateFormName(e.target.value);
                    if (templateFormError) setTemplateFormError(null);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Subject Line *
                  </label>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {['{{name}}', '{{company}}', '{{designation}}'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTemplateFormSubject((prev) => `${prev} ${v}`)}
                        className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded font-mono border border-slate-700/60 transition"
                      >
                        +{v}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Streamlining Pilgrimage Operations for {{company}}"
                  value={templateFormSubject}
                  onChange={(e) => {
                    setTemplateFormSubject(e.target.value);
                    if (templateFormError) setTemplateFormError(null);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Email Body *
                  </label>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {['{{name}}', '{{firstName}}', '{{company}}', '{{designation}}', '{{email}}'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTemplateFormBody((prev) => `${prev} ${v}`)}
                        className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded font-mono border border-slate-700/60 transition"
                      >
                        +{v}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={8}
                  placeholder={`Hi {{name}},\n\nI noticed you manage pilgrimage operations at {{company}}.\n\nUmrah360 helps tour operators like yours automate dynamic package pricing, manage B2B sub-agents, and streamline Makkah/Madinah hotel allotments.\n\nWould you be open to a quick 10-minute walkthrough this week?\n\nBest regards,\nUmrah360 Team`}
                  value={templateFormBody}
                  onChange={(e) => {
                    setTemplateFormBody(e.target.value);
                    if (templateFormError) setTemplateFormError(null);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 leading-relaxed font-mono"
                />
              </div>

              {/* Dynamic Sample Live Preview */}
              {(templateFormSubject || templateFormBody) && (
                <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                      <Eye className="w-3 h-3 text-emerald-400" />
                      <span>Live Rendered Preview (Sample Lead Data)</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Lead: Tariq Farooq @ Al-Bait Pilgrimage Tours
                    </span>
                  </div>
                  {templateFormSubject && (
                    <div className="text-xs font-mono text-emerald-300 bg-slate-900 p-2 rounded-lg border border-slate-800/80">
                      <span className="text-slate-400 mr-1.5">Subject:</span>
                      {renderTemplatePreview(templateFormSubject)}
                    </div>
                  )}
                  {templateFormBody && (
                    <div className="text-xs text-slate-300 bg-slate-900 p-3 rounded-lg border border-slate-800/80 whitespace-pre-wrap leading-relaxed font-mono">
                      {renderTemplatePreview(templateFormBody)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                {editingTemplate && (
                  <button
                    type="button"
                    onClick={() => {
                      promptDeleteTemplate(editingTemplate);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl text-xs font-semibold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Template</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={isSavingTemplate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-900/20 transition"
                >
                  {isSavingTemplate ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to DB...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{editingTemplate ? 'Update Template' : 'Save Template'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE TEMPLATE CONFIRMATION MODAL */}
      {isDeleteTemplateModalOpen && templateToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl">
            <div className="p-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Delete Email Template</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Are you sure you want to delete <strong className="text-slate-200">"{templateToDelete.name}"</strong>?
                  This will permanently remove the template from the Firestore database.
                </p>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 font-mono truncate">
                Subject: {templateToDelete.subject}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteTemplateModalOpen(false);
                  setTemplateToDelete(null);
                }}
                disabled={isDeletingTemplate}
                className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTemplate}
                disabled={isDeletingTemplate}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-900/20 transition"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>AI Personalization Preview (Sample Leads)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Review how the AI personalizes subject lines, opening hooks, and product pitches for each company.
                </p>
              </div>
              <button
                onClick={() => setIsAiPreviewModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {aiPreviewSamples.map((sample, idx) => (
                <div key={idx} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div>
                      <span className="text-xs font-semibold text-emerald-400">{sample.lead.name}</span>
                      <span className="text-xs text-slate-400 ml-2">({sample.lead.email})</span>
                    </div>
                    <span className="text-[11px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded">
                      {sample.lead.companyName || 'Agency'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Detected Pain Point:</span>
                      <p className="text-slate-200 font-medium">{sample.selectedPainPoint}</p>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Selected Capabilities:</span>
                      <p className="text-emerald-400 font-medium">{sample.selectedCapabilities?.join(', ')}</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Generated Subject:</span>
                    <p className="text-xs font-mono text-emerald-300 bg-slate-900 p-2 rounded border border-slate-800">
                      {sample.subject}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Generated Email Body:</span>
                    <div className="text-xs text-slate-200 bg-slate-900 p-3 rounded border border-slate-800 whitespace-pre-wrap leading-relaxed">
                      {sample.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsAiPreviewModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 font-medium"
              >
                Back to Config
              </button>
              <button
                onClick={() => {
                  setIsAiPreviewModalOpen(false);
                  handleCreateCampaignSubmit();
                }}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-2"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <User className="w-4 h-4 text-emerald-400" />
                  <span>Lead Personalization Audit: {inspectingLead.name}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {inspectingLead.companyName} ({inspectingLead.email})
                </p>
              </div>
              <button
                onClick={() => setInspectingLead(null)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Send Status:</span>
                  <p className="font-semibold text-emerald-400 mt-0.5">{inspectingLead.sendStatus}</p>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Demo Status:</span>
                  <p className="font-semibold text-sky-400 mt-0.5">{inspectingLead.demoStatus || 'NOT_BOOKED'}</p>
                </div>
              </div>

              {inspectingLead.generatedSubject && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Actual Sent Subject:</span>
                  <p className="text-xs font-mono text-emerald-300 bg-slate-950 p-3 rounded-xl border border-slate-800">
                    {inspectingLead.generatedSubject}
                  </p>
                </div>
              )}

              {inspectingLead.generatedBody && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Actual Sent Email Body:</span>
                  <div className="text-xs text-slate-200 bg-slate-950 p-4 rounded-xl border border-slate-800 whitespace-pre-wrap leading-relaxed font-mono">
                    {inspectingLead.generatedBody}
                  </div>
                </div>
              )}

              {inspectingLead.selectedPainPoint && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Targeted Pain Point:</span>
                  <p className="text-xs text-slate-200 font-medium">{inspectingLead.selectedPainPoint}</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end">
              <button
                onClick={() => setInspectingLead(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
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
