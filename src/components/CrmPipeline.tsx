import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
  CheckCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Sparkles,
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
  LayoutGrid,
  Table as TableIcon,
  Columns,
  ArrowUpDown,
  Eye,
  X,
  Layers,
  ArrowUpRight,
  Globe,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Lead,
  Contact,
  LeadActivity,
  LeadStatus,
  LeadType,
  LeadSource,
} from '../types';
import { WebsiteLeadIntegrationModal } from './WebsiteLeadIntegrationModal';
import { CrmOutboundWebhookBanner } from './CrmOutboundWebhookBanner';

interface CrmPipelineProps {
  leads: Lead[];
  contacts: Contact[];
  activities: LeadActivity[];
  onOpenConversation: (conversationId?: string, leadId?: string) => void;
  selectedLeadId?: string | null;
  onUpdateLeadStatus?: (leadId: string, newStatus: LeadStatus) => void;
  tenantId?: string;
}

type ViewMode = 'PIPELINE' | 'TABLE' | 'GRID';
type SortField = 'score' | 'name' | 'company' | 'status' | 'intent';

export const CrmPipeline: React.FC<CrmPipelineProps> = ({
  leads,
  contacts,
  activities,
  onOpenConversation,
  selectedLeadId: initialSelectedLeadId,
  onUpdateLeadStatus,
  tenantId = 'umrah360',
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('PIPELINE');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    initialSelectedLeadId || leads[0]?.leadId || null
  );
  const [inspectModalLeadId, setInspectModalLeadId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | LeadType>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [isWebsiteModalOpen, setIsWebsiteModalOpen] = useState<boolean>(false);

  const handleLeadStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    if (onUpdateLeadStatus) {
      onUpdateLeadStatus(leadId, newStatus);
    }
    if (newStatus === 'DEMO_BOOKED') {
      try {
        await fetch(`/api/campaigns/lead/${leadId}/demo-status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ demoStatus: 'BOOKED', demoSource: 'MANUAL' }),
        });
      } catch {}
    }
  };

  const handleToggleLeadDemoStatus = async (lead: Lead) => {
    const isBooked = lead.demoStatus === 'BOOKED' || lead.status === 'DEMO_BOOKED';
    const nextStatus: LeadStatus = isBooked ? 'QUALIFIED' : 'DEMO_BOOKED';
    handleLeadStatusChange(lead.leadId, nextStatus);
  };

  // Active lead for Split Pipeline view or Inspect Modal
  const activeDetailLeadId = inspectModalLeadId || selectedLeadId || leads[0]?.leadId;
  const activeLead = leads.find((l) => l.leadId === activeDetailLeadId) || leads[0];
  const activeContact = contacts.find((c) => c.contactId === activeLead?.contactId);
  const activeActivities = activities.filter((a) => a.leadId === activeLead?.leadId);

  // Filtered and Sorted Leads
  const processedLeads = useMemo(() => {
    let result = leads.filter((l) => {
      // Outbound campaign leads MUST ONLY be shown in CRM if they have replied
      const isCampaignLead = Boolean(l.campaignId || l.campaignLeadId || (l.leadType === 'OUTBOUND' && l.source === 'EMAIL'));
      if (isCampaignLead && l.replyStatus !== 'REPLIED') {
        return false;
      }

      const contact = contacts.find((c) => c.contactId === l.contactId);
      if (typeFilter !== 'ALL' && l.leadType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = `${contact?.firstName} ${contact?.lastName}`.toLowerCase().includes(q);
        const matchCompany = contact?.companyName?.toLowerCase().includes(q);
        const matchEmail = contact?.email?.toLowerCase().includes(q);
        const matchSource = l.source?.toLowerCase().includes(q);
        const matchCampaign = l.campaignName?.toLowerCase().includes(q);
        if (!matchName && !matchCompany && !matchEmail && !matchSource && !matchCampaign) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      const contactA = contacts.find((c) => c.contactId === a.contactId);
      const contactB = contacts.find((c) => c.contactId === b.contactId);

      let comparison = 0;
      if (sortField === 'score') {
        comparison = a.leadScore - b.leadScore;
      } else if (sortField === 'name') {
        const nameA = `${contactA?.firstName} ${contactA?.lastName}`.toLowerCase();
        const nameB = `${contactB?.firstName} ${contactB?.lastName}`.toLowerCase();
        comparison = nameA.localeCompare(nameB);
      } else if (sortField === 'company') {
        const compA = (contactA?.companyName || '').toLowerCase();
        const compB = (contactB?.companyName || '').toLowerCase();
        comparison = compA.localeCompare(compB);
      } else if (sortField === 'status') {
        comparison = a.status.localeCompare(b.status);
      } else if (sortField === 'intent') {
        const weight = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        comparison = (weight[a.intent] || 0) - (weight[b.intent] || 0);
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [leads, contacts, typeFilter, statusFilter, searchQuery, sortField, sortAsc]);

  // Metrics (Section 56 Lead Dashboard)
  const totalLeads = leads.length;
  const inboundCount = leads.filter((l) => l.leadType === 'INBOUND').length;
  const outboundCount = leads.filter((l) => l.leadType === 'OUTBOUND').length;
  const qualifiedCount = leads.filter((l) => l.status === 'QUALIFIED' || l.leadScore >= 80).length;
  const highIntentCount = leads.filter((l) => l.intent === 'HIGH').length;
  const demoBookedCount = leads.filter((l) => l.demoStatus === 'BOOKED' || l.status === 'DEMO_BOOKED').length;

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Client-Unique Outbound CRM Lead Webhook Forwarder */}
      <CrmOutboundWebhookBanner tenantId={tenantId} />

      {/* Top CRM Dashboard Metrics (Section 56) */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3.5">
        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs hover:shadow-md hover:border-slate-300 transition-all duration-200 group">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total CRM Leads</span>
            <Users className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          </div>
          <span className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono tabular-nums">{totalLeads}</span>
          <span className="text-[10px] text-slate-400 mt-1 block font-medium">All active database leads</span>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs hover:shadow-md hover:border-orange-200 transition-all duration-200 group">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Inbound Leads</span>
            <Globe className="w-4 h-4 text-orange-500 group-hover:scale-110 transition-transform" />
          </div>
          <span className="text-3xl font-extrabold text-orange-600 tracking-tight font-mono tabular-nums">{inboundCount}</span>
          <span className="text-[10px] text-orange-600/80 mt-1 block font-medium">Web & Chat conversations</span>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs hover:shadow-md hover:border-purple-200 transition-all duration-200 group">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Outbound Leads</span>
            <Send className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" />
          </div>
          <span className="text-3xl font-extrabold text-purple-700 tracking-tight font-mono tabular-nums">{outboundCount}</span>
          <span className="text-[10px] text-purple-600/80 mt-1 block font-medium">Campaign cold outreach</span>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs hover:shadow-md hover:border-emerald-200 transition-all duration-200 group">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">AI Qualified</span>
            <CheckCircle className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <span className="text-3xl font-extrabold text-emerald-600 tracking-tight font-mono tabular-nums">{qualifiedCount}</span>
          <span className="text-[10px] text-emerald-600/80 mt-1 block font-medium">Score ≥ 80 or qualified</span>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs hover:shadow-md hover:border-amber-200 transition-all duration-200 group">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">High Intent</span>
            <Flame className="w-4 h-4 text-orange-500 group-hover:scale-110 transition-transform" />
          </div>
          <span className="text-3xl font-extrabold text-orange-500 tracking-tight font-mono tabular-nums">{highIntentCount}</span>
          <span className="text-[10px] text-amber-600/80 mt-1 block font-medium">Immediate buy signal</span>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border border-orange-600/80 p-4 rounded-2xl shadow-md shadow-orange-500/20 hover:shadow-lg hover:shadow-orange-500/30 transition-all duration-200 group">
          <div className="flex items-center justify-between text-orange-100 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-orange-100">Demo Booked</span>
            <Sparkles className="w-4 h-4 text-white group-hover:rotate-12 transition-transform" />
          </div>
          <span className="text-3xl font-extrabold text-white tracking-tight font-mono tabular-nums">{demoBookedCount}</span>
          <span className="text-[10px] text-orange-100/90 mt-1 block font-medium">Calendar meetings set</span>
        </div>
      </div>

      {/* Control Toolbar: View Mode Toggle, Filters, Search */}
      <div className="bg-white border border-slate-200/90 p-3.5 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-2xs">
        {/* Left: View Switcher (Pipeline vs Table vs Grid) */}
        <div className="flex items-center space-x-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 self-start">
          <button
            onClick={() => setViewMode('PIPELINE')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'PIPELINE'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
            title="Split Pipeline View"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Pipeline View</span>
          </button>
          <button
            onClick={() => setViewMode('TABLE')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'TABLE'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
            title="Full Data Grid / Table View"
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Table View</span>
          </button>
          <button
            onClick={() => setViewMode('GRID')}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'GRID'
                ? 'bg-orange-500 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
            title="Card Grid View"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Grid View</span>
          </button>
        </div>

        {/* Right: Search, Filter by Type & Status */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search leads, companies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-8 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:bg-white focus:ring-1 focus:ring-orange-500 font-medium transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Lead Type Segment */}
          <div className="flex items-center space-x-1 text-xs bg-slate-100/90 p-1 rounded-xl border border-slate-200/80">
            {(['ALL', 'INBOUND', 'OUTBOUND'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded-lg font-bold transition-all ${
                  typeFilter === t
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs text-slate-800 font-bold rounded-xl px-3 py-1.5 focus:outline-none focus:border-orange-500 focus:bg-white shadow-2xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="NEW">NEW</option>
            <option value="CONTACTED">CONTACTED</option>
            <option value="ENGAGED">ENGAGED</option>
            <option value="QUALIFIED">QUALIFIED</option>
            <option value="DEMO_SCHEDULED">DEMO SCHEDULED</option>
            <option value="DEMO_BOOKED">DEMO BOOKED</option>
            <option value="HUMAN_HANDOFF">HUMAN HANDOFF</option>
            <option value="CLOSED_WON">CLOSED WON</option>
          </select>

          {/* Website Form Webhook Integration Button */}
          <button
            onClick={() => setIsWebsiteModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-bold transition shadow-2xs shadow-orange-500/20 shrink-0"
            title="Connect your website demo form (umrah360.in/request-demo) to CRM"
          >
            <Globe className="w-3.5 h-3.5 text-white" />
            <span>Website Form Webhook</span>
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
          </button>
        </div>
      </div>

      {/* VIEW 1: PIPELINE (2-Column Split View) */}
      {viewMode === 'PIPELINE' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Leads List */}
          <div className="lg:col-span-1 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs flex flex-col h-[calc(100vh-18rem)]">
            <div className="p-3 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold bg-slate-50/80">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>Showing {processedLeads.length} leads</span>
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Sorted by score</span>
            </div>

            {/* Lead List Cards */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100/80">
              {processedLeads.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs font-medium">No matching leads found.</div>
              ) : (
                processedLeads.map((lead) => {
                  const contact = contacts.find((c) => c.contactId === lead.contactId);
                  const isSelected = lead.leadId === activeLead?.leadId;

                  return (
                    <div
                      key={lead.leadId}
                      onClick={() => setSelectedLeadId(lead.leadId)}
                      className={`p-3.5 cursor-pointer transition-all duration-150 group ${
                        isSelected
                          ? 'bg-orange-50/90 border-l-4 border-orange-500 shadow-2xs'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 transition-colors ${
                            isSelected ? 'bg-orange-500 text-white border-orange-600 shadow-2xs' : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {contact?.firstName?.[0]}{contact?.lastName?.[0]}
                          </div>
                          <div className="min-w-0">
                            <h4 className={`font-bold text-xs transition-colors truncate ${
                              isSelected ? 'text-slate-900' : 'text-slate-800 group-hover:text-orange-600'
                            }`}>
                              {contact?.firstName} {contact?.lastName}
                            </h4>
                            <p className="text-[11px] text-slate-500 mt-0.5 font-medium truncate">{contact?.companyName}</p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="flex items-center space-x-1 justify-end">
                            <Flame className={`w-3.5 h-3.5 ${lead.leadScore >= 80 ? 'text-orange-500' : 'text-slate-400'}`} />
                            <span className="font-extrabold text-xs text-slate-900 font-mono tabular-nums">{lead.leadScore}</span>
                          </div>
                          <span className={`text-[10px] font-extrabold uppercase ${
                            lead.intent === 'HIGH' ? 'text-emerald-600' : lead.intent === 'MEDIUM' ? 'text-amber-600' : 'text-slate-400'
                          }`}>{lead.intent}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[10px] gap-1 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                            lead.leadType === 'OUTBOUND'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-orange-50 text-orange-700 border border-orange-200'
                          }`}
                        >
                          {lead.leadType} ({lead.source})
                        </span>

                        {lead.campaignName && (
                          <span className="px-2 py-0.5 rounded-md bg-purple-100/70 text-purple-800 font-bold border border-purple-200 truncate max-w-[120px]">
                            {lead.campaignName}
                          </span>
                        )}

                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold border border-slate-200/80 ml-auto">
                          {lead.status}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Lead 360 Profile & Timeline */}
          <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs overflow-y-auto h-[calc(100vh-18rem)] space-y-6">
            {renderLeadDetail(
              activeLead,
              activeContact,
              activeActivities,
              onOpenConversation,
              (newStatus) => handleLeadStatusChange(activeLead.leadId, newStatus),
              () => handleToggleLeadDemoStatus(activeLead)
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: TABLE / DATA GRID VIEW */}
      {viewMode === 'TABLE' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-extrabold uppercase tracking-wider text-[11px]">
                  <th
                    className="p-3.5 cursor-pointer hover:text-orange-600 transition"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Lead & Contact</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-orange-600 transition"
                    onClick={() => toggleSort('company')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Agency / Company</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th className="p-3.5">Type & Source</th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-orange-600 transition"
                    onClick={() => toggleSort('score')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Score</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-orange-600 transition"
                    onClick={() => toggleSort('intent')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Intent</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-orange-600 transition"
                    onClick={() => toggleSort('status')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Status</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                    </div>
                  </th>
                  <th className="p-3.5">Key Requirements</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {processedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400 text-xs font-medium">
                      No leads match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  processedLeads.map((lead) => {
                    const contact = contacts.find((c) => c.contactId === lead.contactId);

                    return (
                      <tr
                        key={lead.leadId}
                        className="hover:bg-slate-50 transition cursor-pointer"
                        onClick={() => setInspectModalLeadId(lead.leadId)}
                      >
                        {/* Lead / Contact */}
                        <td className="p-3.5">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-800 text-xs shadow-2xs">
                              {contact?.firstName?.[0]}
                              {contact?.lastName?.[0]}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block">
                                {contact?.firstName} {contact?.lastName}
                              </span>
                              <span className="text-[11px] text-slate-500 font-medium">{contact?.email}</span>
                            </div>
                          </div>
                        </td>

                        {/* Agency / Company */}
                        <td className="p-3.5">
                          <span className="font-bold text-slate-900 block">
                            {contact?.companyName}
                          </span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            {contact?.jobTitle || 'Executive'}
                          </span>
                        </td>

                        {/* Type & Source */}
                        <td className="p-3.5">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center space-x-1.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  lead.leadType === 'OUTBOUND'
                                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                    : 'bg-teal-50 text-teal-700 border border-teal-200'
                                }`}
                              >
                                {lead.leadType}
                              </span>
                              {lead.source === 'WEBSITE' ? (
                                <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  <Globe className="w-3 h-3 text-emerald-600" />
                                  <span>Website Demo</span>
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-600 font-medium">{lead.source}</span>
                              )}
                            </div>
                            {lead.campaignName && (
                              <span className="text-[10px] text-purple-800 font-bold bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded w-fit">
                                {lead.campaignName}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Score */}
                        <td className="p-3.5">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`font-bold text-xs ${
                                lead.leadScore >= 80
                                  ? 'text-emerald-700'
                                  : lead.leadScore >= 50
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {lead.leadScore}
                            </span>
                            <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden border border-slate-200">
                              <div
                                className={`h-1.5 rounded-full ${
                                  lead.leadScore >= 80
                                    ? 'bg-emerald-500'
                                    : lead.leadScore >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-slate-400'
                                }`}
                                style={{ width: `${lead.leadScore}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Intent */}
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              lead.intent === 'HIGH'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : lead.intent === 'MEDIUM'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {lead.intent}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="p-3.5">
                          <div className="flex flex-col gap-1 items-start">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-bold">
                              {lead.status}
                            </span>
                            {(lead.demoStatus === 'BOOKED' || lead.status === 'DEMO_BOOKED') && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                                <span>Demo Booked</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Identified Requirements */}
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {(Array.isArray(lead.requirements)
                              ? lead.requirements
                              : typeof lead.requirements === 'string'
                              ? (lead.requirements as string).split('|').map((s) => s.trim())
                              : []
                            ).slice(0, 2).map((req, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded bg-orange-50 text-orange-900 border border-orange-200 text-[10px] font-semibold truncate"
                              >
                                {req}
                              </span>
                            ))}
                            {(Array.isArray(lead.requirements) ? lead.requirements.length : 0) > 2 && (
                              <span className="text-[10px] text-slate-500 font-semibold">
                                +{(lead.requirements?.length || 0) - 2} more
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="p-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={() => setInspectModalLeadId(lead.leadId)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center space-x-1 transition border border-slate-200 shadow-2xs"
                              title="Inspect 360 Profile"
                            >
                              <Eye className="w-3 h-3 text-slate-700" />
                              <span>360 Profile</span>
                            </button>
                            <button
                              onClick={() => onOpenConversation(undefined, lead.leadId)}
                              className="px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold flex items-center space-x-1 transition shadow-2xs"
                              title="Open Omnichannel Inbox"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>Chat</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: CARD GRID VIEW */}
      {viewMode === 'GRID' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {processedLeads.length === 0 ? (
            <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-white border border-slate-200 rounded-2xl">
              No leads match the selected filter criteria.
            </div>
          ) : (
            processedLeads.map((lead) => {
              const contact = contacts.find((c) => c.contactId === lead.contactId);

              return (
                <div
                  key={lead.leadId}
                  className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs hover:border-slate-300 transition flex flex-col justify-between space-y-3"
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-800 text-sm shadow-2xs">
                          {contact?.firstName?.[0]}
                          {contact?.lastName?.[0]}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-slate-900">
                            {contact?.firstName} {contact?.lastName}
                          </h4>
                          <p className="text-xs text-slate-500 font-medium">
                            {contact?.jobTitle || 'Executive'} •{' '}
                            <span className="text-slate-800 font-bold">{contact?.companyName}</span>
                          </p>
                        </div>
                      </div>

                      {/* Lead Score Flame Badge */}
                      <div className="flex items-center space-x-1 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
                        <Flame className="w-3.5 h-3.5 text-orange-500" />
                        <span className="font-extrabold text-xs text-orange-950">{lead.leadScore}</span>
                      </div>
                    </div>

                    {/* Meta badges */}
                    <div className="flex items-center space-x-1.5 mt-3 text-[10px] flex-wrap gap-y-1">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          lead.leadType === 'OUTBOUND'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : 'bg-teal-50 text-teal-700 border border-teal-200'
                        }`}
                      >
                        {lead.leadType} ({lead.source})
                      </span>

                      {lead.campaignName && (
                        <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200 font-bold">
                          {lead.campaignName}
                        </span>
                      )}

                      <span
                        className={`px-2 py-0.5 rounded font-semibold ${
                          lead.intent === 'HIGH'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {lead.intent} Intent
                      </span>

                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold border border-slate-200">
                        {lead.status}
                      </span>
                    </div>

                    {/* Requirements Tags */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(Array.isArray(lead.requirements)
                        ? lead.requirements
                        : typeof lead.requirements === 'string'
                        ? (lead.requirements as string).split('|').map((s) => s.trim())
                        : []
                      ).slice(0, 3).map((req, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-0.5 rounded-lg bg-orange-50 text-orange-950 border border-orange-200 text-[10px] font-semibold"
                        >
                          {req}
                        </span>
                      ))}
                    </div>

                    {/* AI Insight Summary */}
                    {lead.aiSummary && (
                      <p className="text-[11px] text-slate-700 font-medium mt-2 line-clamp-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 leading-relaxed">
                        <Sparkles className="w-3 h-3 text-orange-500 inline mr-1" />
                        {lead.aiSummary}
                      </p>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setInspectModalLeadId(lead.leadId)}
                      className="flex-1 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center space-x-1.5 transition border border-slate-200 shadow-2xs"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-700" />
                      <span>Inspect 360</span>
                    </button>
                    <button
                      onClick={() => onOpenConversation(undefined, lead.leadId)}
                      className="flex-1 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold flex items-center justify-center space-x-1.5 transition shadow-2xs"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Omnichannel</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MODAL: Lead 360 Inspector (When viewing from Table or Grid view) */}
      {inspectModalLeadId && activeLead && activeContact && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl space-y-6 max-h-[92vh] overflow-y-auto relative text-slate-900">
            <button
              onClick={() => setInspectModalLeadId(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 transition"
            >
              <X className="w-5 h-5" />
            </button>

            {renderLeadDetail(
              activeLead,
              activeContact,
              activeActivities,
              (convId, leadId) => {
                setInspectModalLeadId(null);
                onOpenConversation(convId, leadId);
              },
              (newStatus) => handleLeadStatusChange(activeLead.leadId, newStatus),
              () => handleToggleLeadDemoStatus(activeLead)
            )}
          </div>
        </div>
      )}

      {/* Website Lead Ingestion Modal (umrah360.in) */}
      <WebsiteLeadIntegrationModal
        isOpen={isWebsiteModalOpen}
        onClose={() => setIsWebsiteModalOpen(false)}
        onLeadCreated={(newLeadId) => {
          setSelectedLeadId(newLeadId);
          setInspectModalLeadId(newLeadId);
        }}
      />
    </div>
  );
};

// Helper: Render Complete Lead 360 Profile & Timeline
function renderLeadDetail(
  selectedLead: Lead,
  selectedContact: Contact | undefined,
  selectedActivities: LeadActivity[],
  onOpenConversation: (conversationId?: string, leadId?: string) => void,
  onUpdateStatus?: (newStatus: LeadStatus) => void,
  onToggleDemo?: () => void
) {
  if (!selectedLead || !selectedContact) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        Select a lead to view profile & history
      </div>
    );
  }

  const isDemoBooked = selectedLead.demoStatus === 'BOOKED' || selectedLead.status === 'DEMO_BOOKED';

  return (
    <div className="space-y-6">
      {/* Header Profile */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div>
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-extrabold text-slate-900">
              {selectedContact.firstName} {selectedContact.lastName}
            </h3>
            <span
              className={`px-3 py-0.5 rounded-full text-xs font-bold ${
                selectedLead.status === 'QUALIFIED'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : selectedLead.status === 'DEMO_BOOKED'
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 font-extrabold'
                  : 'bg-blue-50 text-blue-800 border border-blue-200'
              }`}
            >
              {selectedLead.status}
            </span>
          </div>

          <p className="text-xs text-slate-600 mt-1 flex items-center space-x-2 font-medium">
            <span>{selectedContact.jobTitle || 'Executive'}</span>
            <span>•</span>
            <span className="font-bold text-slate-900">{selectedContact.companyName}</span>
          </p>
        </div>

        <button
          onClick={() => onOpenConversation(undefined, selectedLead.leadId)}
          className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition shadow-2xs self-start sm:self-auto"
        >
          <MessageCircle className="w-4 h-4 text-white" />
          <span>Open Omnichannel Inbox</span>
        </button>
      </div>

      {/* CRM Status & Single Source of Truth Demo Booking Action Bar */}
      <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">Pipeline Status:</span>
          <select
            value={selectedLead.status}
            onChange={(e) => onUpdateStatus?.(e.target.value as LeadStatus)}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-orange-500 shadow-2xs"
          >
            <option value="NEW">NEW</option>
            <option value="ENGAGED">ENGAGED</option>
            <option value="QUALIFIED">QUALIFIED</option>
            <option value="DEMO_SCHEDULED">DEMO SCHEDULED</option>
            <option value="DEMO_BOOKED">DEMO BOOKED</option>
            <option value="PROPOSAL_SENT">PROPOSAL SENT</option>
            <option value="CLOSED_WON">CLOSED WON</option>
            <option value="CLOSED_LOST">CLOSED LOST</option>
            <option value="NOT_INTERESTED">NOT INTERESTED</option>
            <option value="UNSUBSCRIBED">UNSUBSCRIBED</option>
            <option value="HUMAN_HANDOFF">HUMAN HANDOFF</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onToggleDemo}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border shadow-2xs ${
            isDemoBooked
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
              : 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
          }`}
        >
          <Sparkles className={`w-3.5 h-3.5 ${isDemoBooked ? 'text-emerald-600' : 'text-white'}`} />
          <span>
            {isDemoBooked
              ? `Demo Booked (${selectedLead.demoSource || 'Manual'}) - Click to Toggle`
              : 'Mark as Demo Booked'}
          </span>
        </button>
      </div>

      {/* Contact Information & Channels (Section 55 Unified View) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div>
          <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px] block">Email Address</span>
          <span className="text-slate-900 font-bold">{selectedContact.email}</span>
        </div>
        <div>
          <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px] block">Phone / WhatsApp</span>
          <span className="text-slate-900 font-bold">
            {selectedContact.phone || '+91 98100 23456'}
          </span>
        </div>
        <div>
          <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px] block">Lead Source & Type</span>
          <span className="text-orange-600 font-extrabold">
            {selectedLead.source} ({selectedLead.leadType})
          </span>
        </div>
      </div>

      {/* Outbound Campaign Details Card */}
      {(selectedLead.leadType === 'OUTBOUND' || selectedLead.campaignName || selectedLead.campaignId) && (
        <div className="bg-purple-50/80 border border-purple-200 rounded-2xl p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between border-b border-purple-200 pb-2.5">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-purple-600" />
              <span className="text-xs font-bold text-purple-950 uppercase tracking-wider">
                Outbound Campaign Outreach
              </span>
            </div>
            <span className="text-[10px] font-bold text-purple-800 bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-300 flex items-center gap-1.5 font-mono">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
              <span>OUTBOUND</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[10px] text-purple-700 block font-semibold">Campaign Name</span>
              <span className="text-purple-900 font-extrabold text-sm block">
                {selectedLead.campaignName || 'Outbound Campaign'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-purple-700 block font-semibold">Campaign ID</span>
              <span className="text-purple-900 font-mono text-xs font-bold">
                {selectedLead.campaignId || 'N/A'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Website Demo Request Details Card */}
      {(selectedLead.source === 'WEBSITE' || selectedLead.queryMessage || selectedContact.website || selectedContact.city) && (
        <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between border-b border-emerald-200 pb-2.5">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                Website Demo Form (umrah360.in/request-demo)
              </span>
            </div>
            <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded border border-emerald-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>Inbound Webhook</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-[10px] text-emerald-700 block font-semibold">Designation</span>
              <span className="text-slate-900 font-bold">{selectedContact.jobTitle || 'Agency Executive'}</span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-700 block font-semibold">Location</span>
              <span className="text-slate-900 font-bold">
                {selectedContact.city ? `${selectedContact.city}, ` : ''}{selectedContact.country || 'India'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-700 block font-semibold">Branches</span>
              <span className="text-slate-900 font-bold">{selectedContact.branches || selectedLead.branches || 'Single Office'}</span>
            </div>
            <div>
              <span className="text-[10px] text-emerald-700 block font-semibold">Team Size</span>
              <span className="text-slate-900 font-bold">{selectedContact.teamSize || selectedLead.teamSize || '5-10 Users'}</span>
            </div>
          </div>

          {selectedContact.website && (
            <div className="text-xs flex items-center gap-2 pt-2 border-t border-emerald-200">
              <span className="text-[10px] text-emerald-800 font-bold">Agency Website:</span>
              <a
                href={selectedContact.website.startsWith('http') ? selectedContact.website : `https://${selectedContact.website}`}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-800 hover:text-emerald-900 underline font-mono text-xs font-bold inline-flex items-center gap-1"
              >
                <span>{selectedContact.website}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {(selectedLead.queryMessage || selectedLead.notes) && (
            <div className="pt-2 border-t border-emerald-200">
              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">
                Customer Message / Query:
              </span>
              <div className="bg-white p-3 rounded-xl border border-emerald-200 text-slate-900 font-sans text-xs leading-relaxed whitespace-pre-wrap shadow-2xs font-medium">
                {selectedLead.queryMessage || selectedLead.notes}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Intelligence Summary & Recommendations */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-900">
          <Sparkles className="w-4 h-4 text-orange-500" />
          <span>AI Qualification & Conversation Analysis</span>
        </div>

        <p className="text-xs text-slate-800 leading-relaxed font-medium">
          {selectedLead.aiSummary ||
            'Lead showed immediate interest in B2B sub-agent features and automated package generation.'}
        </p>

        {selectedLead.aiRecommendation && (
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-950 flex items-start space-x-2 shadow-2xs">
            <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold block text-emerald-900">
                AI Recommended Next Step:
              </span>
              {selectedLead.aiRecommendation}
            </div>
          </div>
        )}
      </div>

      {/* Requirements & Buying Profile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs text-xs space-y-2">
          <span className="text-slate-500 font-bold block">Identified Requirements:</span>
          <div className="flex flex-wrap gap-1.5">
            {(Array.isArray(selectedLead.requirements)
              ? selectedLead.requirements
              : typeof selectedLead.requirements === 'string'
              ? (selectedLead.requirements as string).split('|').map((s) => s.trim())
              : ['Umrah Packages', 'Costing Engine']
            ).map((req, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-950 border border-orange-200 text-xs font-bold"
              >
                {req}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs text-xs space-y-2">
          <span className="text-slate-500 font-bold block">Commercial Profile:</span>
          <div className="space-y-1.5 text-slate-800 font-medium">
            <div>
              <span className="text-slate-500">Service Interest: </span>
              <span className="font-bold text-slate-900">
                {selectedLead.serviceInterest || 'B2B Sub-Agent Portal'}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Budget Range: </span>
              <span className="font-bold text-slate-900">{selectedLead.budget || 'Custom / Enterprise'}</span>
            </div>
            <div>
              <span className="text-slate-500">Timeline: </span>
              <span className="font-bold text-slate-900">
                {selectedLead.timeline || 'Upcoming Season (Immediate)'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 54: Contact Timeline */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
          <Clock className="w-4 h-4 text-orange-500" />
          <span>Interaction Timeline</span>
        </div>

        <div className="border-l-2 border-slate-200 ml-3 space-y-4 pl-4 text-xs">
          {selectedActivities.length === 0 ? (
            <div className="text-slate-500 font-medium">No logged activities for this lead yet.</div>
          ) : (
            selectedActivities.map((act) => (
              <div key={act.activityId} className="relative">
                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-orange-500 ring-4 ring-white" />
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{act.title}</span>
                  <span className="text-[10px] text-slate-500 font-mono font-medium">
                    {new Date(act.timestamp).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed font-medium">
                  {act.description}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
