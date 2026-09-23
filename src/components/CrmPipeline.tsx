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

interface CrmPipelineProps {
  leads: Lead[];
  contacts: Contact[];
  activities: LeadActivity[];
  onOpenConversation: (conversationId?: string, leadId?: string) => void;
  selectedLeadId?: string | null;
  onUpdateLeadStatus?: (leadId: string, newStatus: LeadStatus) => void;
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
      const contact = contacts.find((c) => c.contactId === l.contactId);
      if (typeFilter !== 'ALL' && l.leadType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = `${contact?.firstName} ${contact?.lastName}`.toLowerCase().includes(q);
        const matchCompany = contact?.companyName?.toLowerCase().includes(q);
        const matchEmail = contact?.email?.toLowerCase().includes(q);
        const matchSource = l.source?.toLowerCase().includes(q);
        if (!matchName && !matchCompany && !matchEmail && !matchSource) return false;
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
      {/* Top CRM Dashboard Metrics (Section 56) */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-xs text-slate-400 block font-medium">Total CRM Leads</span>
          <span className="text-2xl font-bold text-white mt-1 block">{totalLeads}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-xs text-slate-400 block font-medium">Inbound Leads</span>
          <span className="text-2xl font-bold text-teal-400 mt-1 block">{inboundCount}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-xs text-slate-400 block font-medium">Outbound Leads</span>
          <span className="text-2xl font-bold text-purple-400 mt-1 block">{outboundCount}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-xs text-slate-400 block font-medium">AI Qualified</span>
          <span className="text-2xl font-bold text-emerald-400 mt-1 block">{qualifiedCount}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-xs text-slate-400 block font-medium">High Intent</span>
          <span className="text-2xl font-bold text-amber-400 mt-1 block">{highIntentCount}</span>
        </div>
        <div className="bg-emerald-950/20 border border-emerald-500/30 p-3.5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400 block font-semibold">Demo Booked</span>
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <span className="text-2xl font-bold text-emerald-300 mt-1 block">{demoBookedCount}</span>
        </div>
      </div>

      {/* Control Toolbar: View Mode Toggle, Filters, Search */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-md">
        {/* Left: View Switcher (Pipeline vs Table vs Grid) */}
        <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 self-start">
          <button
            onClick={() => setViewMode('PIPELINE')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === 'PIPELINE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Split Pipeline View"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Pipeline View</span>
          </button>
          <button
            onClick={() => setViewMode('TABLE')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === 'TABLE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Full Data Grid / Table View"
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Table View</span>
          </button>
          <button
            onClick={() => setViewMode('GRID')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === 'GRID'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
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
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Lead Type Pill */}
          <div className="flex items-center space-x-1 text-xs bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['ALL', 'INBOUND', 'OUTBOUND'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  typeFilter === t
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
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
            className="bg-slate-950 border border-slate-700/80 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="NEW">NEW</option>
            <option value="CONTACTED">CONTACTED</option>
            <option value="ENGAGED">ENGAGED</option>
            <option value="QUALIFIED">QUALIFIED</option>
            <option value="DEMO_SCHEDULED">DEMO SCHEDULED</option>
            <option value="DEMO_BOOKED">DEMO BOOKED</option>
            <option value="HUMAN_HANDOFF">HUMAN_HANDOFF</option>
            <option value="CLOSED_WON">CLOSED_WON</option>
          </select>

          {/* Website Form Webhook Integration Button */}
          <button
            onClick={() => setIsWebsiteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold transition shadow-sm hover:border-emerald-500/60 shrink-0"
            title="Connect your website demo form (umrah360.in/request-demo) to CRM"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span>Website Form Webhook</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>
        </div>
      </div>

      {/* VIEW 1: PIPELINE (2-Column Split View) */}
      {viewMode === 'PIPELINE' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Leads List */}
          <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[calc(100vh-18rem)]">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-medium">
              <span>Showing {processedLeads.length} leads</span>
              <span className="text-[11px] text-slate-500">Sorted by score</span>
            </div>

            {/* Lead List Cards */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
              {processedLeads.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">No matching leads found.</div>
              ) : (
                processedLeads.map((lead) => {
                  const contact = contacts.find((c) => c.contactId === lead.contactId);
                  const isSelected = lead.leadId === activeLead?.leadId;

                  return (
                    <div
                      key={lead.leadId}
                      onClick={() => setSelectedLeadId(lead.leadId)}
                      className={`p-3.5 cursor-pointer transition ${
                        isSelected
                          ? 'bg-slate-800/90 border-l-4 border-emerald-500'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold text-xs text-white">
                            {contact?.firstName} {contact?.lastName}
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-0.5">{contact?.companyName}</p>
                        </div>

                        <div className="text-right">
                          <div className="flex items-center space-x-1">
                            <Flame className="w-3.5 h-3.5 text-amber-400" />
                            <span className="font-bold text-xs text-emerald-400">{lead.leadScore}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 uppercase">{lead.intent}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/40 text-[10px]">
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            lead.leadType === 'OUTBOUND'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-teal-500/20 text-teal-300'
                          }`}
                        >
                          {lead.source}
                        </span>

                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
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
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg overflow-y-auto h-[calc(100vh-18rem)] space-y-6">
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
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th
                    className="p-3.5 cursor-pointer hover:text-slate-200 transition"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Lead & Contact</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-slate-200 transition"
                    onClick={() => toggleSort('company')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Agency / Company</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th className="p-3.5">Type & Source</th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-slate-200 transition"
                    onClick={() => toggleSort('score')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Score</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-slate-200 transition"
                    onClick={() => toggleSort('intent')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Intent</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-slate-200 transition"
                    onClick={() => toggleSort('status')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Status</span>
                      <ArrowUpDown className="w-3 h-3 text-slate-500" />
                    </div>
                  </th>
                  <th className="p-3.5">Key Requirements</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300">
                {processedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500 text-xs">
                      No leads match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  processedLeads.map((lead) => {
                    const contact = contacts.find((c) => c.contactId === lead.contactId);

                    return (
                      <tr
                        key={lead.leadId}
                        className="hover:bg-slate-800/50 transition cursor-pointer"
                        onClick={() => setInspectModalLeadId(lead.leadId)}
                      >
                        {/* Lead / Contact */}
                        <td className="p-3.5">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-300 text-xs">
                              {contact?.firstName?.[0]}
                              {contact?.lastName?.[0]}
                            </div>
                            <div>
                              <span className="font-semibold text-white block">
                                {contact?.firstName} {contact?.lastName}
                              </span>
                              <span className="text-[11px] text-slate-500">{contact?.email}</span>
                            </div>
                          </div>
                        </td>

                        {/* Agency / Company */}
                        <td className="p-3.5">
                          <span className="font-medium text-slate-200 block">
                            {contact?.companyName}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {contact?.jobTitle || 'Executive'}
                          </span>
                        </td>

                        {/* Type & Source */}
                        <td className="p-3.5">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                lead.leadType === 'OUTBOUND'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                              }`}
                            >
                              {lead.leadType}
                            </span>
                            {lead.source === 'WEBSITE' ? (
                              <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                <Globe className="w-3 h-3" />
                                <span>Website Demo</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">{lead.source}</span>
                            )}
                          </div>
                        </td>

                        {/* Score */}
                        <td className="p-3.5">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`font-bold text-xs ${
                                lead.leadScore >= 80
                                  ? 'text-emerald-400'
                                  : lead.leadScore >= 50
                                  ? 'text-amber-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {lead.leadScore}
                            </span>
                            <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${
                                  lead.leadScore >= 80
                                    ? 'bg-emerald-500'
                                    : lead.leadScore >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-slate-600'
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
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : lead.intent === 'MEDIUM'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-slate-700/50 text-slate-400'
                            }`}
                          >
                            {lead.intent}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="p-3.5">
                          <div className="flex flex-col gap-1 items-start">
                            <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-medium">
                              {lead.status}
                            </span>
                            {(lead.demoStatus === 'BOOKED' || lead.status === 'DEMO_BOOKED') && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                                <span>Demo Booked</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Identified Requirements */}
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {lead.requirements.slice(0, 2).map((req, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] truncate"
                              >
                                {req}
                              </span>
                            ))}
                            {lead.requirements.length > 2 && (
                              <span className="text-[10px] text-slate-500 font-medium">
                                +{lead.requirements.length - 2} more
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="p-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={() => setInspectModalLeadId(lead.leadId)}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-750 text-slate-300 text-[11px] font-medium border border-slate-700 flex items-center space-x-1 transition"
                              title="Inspect 360 Profile"
                            >
                              <Eye className="w-3 h-3 text-slate-400" />
                              <span>360 Profile</span>
                            </button>
                            <button
                              onClick={() => onOpenConversation(undefined, lead.leadId)}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center space-x-1 transition shadow-sm"
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
            <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-slate-900 border border-slate-800 rounded-xl">
              No leads match the selected filter criteria.
            </div>
          ) : (
            processedLeads.map((lead) => {
              const contact = contacts.find((c) => c.contactId === lead.contactId);

              return (
                <div
                  key={lead.leadId}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg hover:border-slate-700 transition flex flex-col justify-between space-y-3"
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-sm">
                          {contact?.firstName?.[0]}
                          {contact?.lastName?.[0]}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-white">
                            {contact?.firstName} {contact?.lastName}
                          </h4>
                          <p className="text-xs text-slate-400">
                            {contact?.jobTitle || 'Executive'} •{' '}
                            <span className="text-slate-300 font-medium">{contact?.companyName}</span>
                          </p>
                        </div>
                      </div>

                      {/* Lead Score Flame Badge */}
                      <div className="flex items-center space-x-1 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700">
                        <Flame className="w-3 h-3 text-amber-400" />
                        <span className="font-bold text-xs text-emerald-400">{lead.leadScore}</span>
                      </div>
                    </div>

                    {/* Meta badges */}
                    <div className="flex items-center space-x-1.5 mt-3 text-[10px]">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          lead.leadType === 'OUTBOUND'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                        }`}
                      >
                        {lead.leadType} ({lead.source})
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded font-semibold ${
                          lead.intent === 'HIGH'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {lead.intent} Intent
                      </span>

                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                        {lead.status}
                      </span>
                    </div>

                    {/* Requirements Tags */}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {lead.requirements.slice(0, 3).map((req, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px]"
                        >
                          {req}
                        </span>
                      ))}
                    </div>

                    {/* AI Insight Summary */}
                    {lead.aiSummary && (
                      <p className="text-[11px] text-slate-400 mt-2 line-clamp-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 leading-relaxed">
                        <Sparkles className="w-3 h-3 text-blue-400 inline mr-1" />
                        {lead.aiSummary}
                      </p>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setInspectModalLeadId(lead.leadId)}
                      className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center space-x-1.5 transition border border-slate-700"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect 360</span>
                    </button>
                    <button
                      onClick={() => onOpenConversation(undefined, lead.leadId)}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition shadow-sm"
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => setInspectModalLeadId(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg bg-slate-800"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
        <div>
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-bold text-white">
              {selectedContact.firstName} {selectedContact.lastName}
            </h3>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                selectedLead.status === 'QUALIFIED'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : selectedLead.status === 'DEMO_BOOKED'
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}
            >
              {selectedLead.status}
            </span>
          </div>

          <p className="text-xs text-slate-300 mt-1 flex items-center space-x-2">
            <span>{selectedContact.jobTitle || 'Executive'}</span>
            <span>•</span>
            <span className="font-semibold text-white">{selectedContact.companyName}</span>
          </p>
        </div>

        <button
          onClick={() => onOpenConversation(undefined, selectedLead.leadId)}
          className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-md self-start sm:self-auto"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Open Omnichannel Inbox</span>
        </button>
      </div>

      {/* CRM Status & Single Source of Truth Demo Booking Action Bar */}
      <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">Pipeline Status:</span>
          <select
            value={selectedLead.status}
            onChange={(e) => onUpdateStatus?.(e.target.value as LeadStatus)}
            className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500"
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
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 border ${
            isDemoBooked
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            {isDemoBooked
              ? `Demo Booked (${selectedLead.demoSource || 'Manual'}) - Click to Toggle`
              : 'Mark as Demo Booked'}
          </span>
        </button>
      </div>

      {/* Contact Information & Channels (Section 55 Unified View) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-800/40 p-4 rounded-lg border border-slate-800">
        <div>
          <span className="text-slate-500 block">Email Address</span>
          <span className="text-slate-200 font-medium">{selectedContact.email}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Phone / WhatsApp</span>
          <span className="text-slate-200 font-medium">
            {selectedContact.phone || '+91 98100 23456'}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block">Lead Source & Type</span>
          <span className="text-emerald-400 font-semibold">
            {selectedLead.source} ({selectedLead.leadType})
          </span>
        </div>
      </div>

      {/* Website Demo Request Details Card */}
      {(selectedLead.source === 'WEBSITE' || selectedLead.queryMessage || selectedContact.website || selectedContact.city) && (
        <div className="bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/40 rounded-xl p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Website Demo Form (umrah360.in/request-demo)
              </span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/40 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Inbound Webhook</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Designation</span>
              <span className="text-slate-100 font-semibold">{selectedContact.jobTitle || 'Agency Executive'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Location</span>
              <span className="text-slate-100 font-semibold">
                {selectedContact.city ? `${selectedContact.city}, ` : ''}{selectedContact.country || 'India'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Branches</span>
              <span className="text-slate-100 font-semibold">{selectedContact.branches || selectedLead.branches || 'Single Office'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-medium">Team Size</span>
              <span className="text-slate-100 font-semibold">{selectedContact.teamSize || selectedLead.teamSize || '5-10 Users'}</span>
            </div>
          </div>

          {selectedContact.website && (
            <div className="text-xs flex items-center gap-2 pt-1 border-t border-slate-800/80">
              <span className="text-[10px] text-slate-400 font-medium">Agency Website:</span>
              <a
                href={selectedContact.website.startsWith('http') ? selectedContact.website : `https://${selectedContact.website}`}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300 underline font-mono text-[11px] inline-flex items-center gap-1"
              >
                <span>{selectedContact.website}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {(selectedLead.queryMessage || selectedLead.notes) && (
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Customer Message / Query:
              </span>
              <div className="bg-slate-950/90 p-3 rounded-lg border border-slate-800 text-slate-200 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {selectedLead.queryMessage || selectedLead.notes}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Intelligence Summary & Recommendations */}
      <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-3">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span>AI Qualification & Conversation Analysis</span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {selectedLead.aiSummary ||
            'Lead showed immediate interest in B2B sub-agent features and automated package generation.'}
        </p>

        {selectedLead.aiRecommendation && (
          <div className="p-3 bg-emerald-950/40 rounded-lg border border-emerald-800/40 text-xs text-emerald-200 flex items-start space-x-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold block text-emerald-300">
                AI Recommended Next Step:
              </span>
              {selectedLead.aiRecommendation}
            </div>
          </div>
        )}
      </div>

      {/* Requirements & Buying Profile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
          <span className="text-slate-400 font-medium block">Identified Requirements:</span>
          <div className="flex flex-wrap gap-1.5">
            {selectedLead.requirements.map((req, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs"
              >
                {req}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
          <span className="text-slate-400 font-medium block">Commercial Profile:</span>
          <div className="space-y-1 text-slate-300">
            <div>
              <span className="text-slate-500">Service Interest: </span>
              <span className="font-medium text-white">
                {selectedLead.serviceInterest || 'B2B Sub-Agent Portal'}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Budget Range: </span>
              <span className="font-medium text-white">{selectedLead.budget || 'Custom / Enterprise'}</span>
            </div>
            <div>
              <span className="text-slate-500">Timeline: </span>
              <span className="font-medium text-white">
                {selectedLead.timeline || 'Upcoming Season (Immediate)'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 54: Contact Timeline */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
          <Clock className="w-4 h-4 text-slate-400" />
          <span>Interaction Timeline (Section 54)</span>
        </div>

        <div className="border-l-2 border-slate-800 ml-3 space-y-4 pl-4 text-xs">
          {selectedActivities.length === 0 ? (
            <div className="text-slate-500">No logged activities for this lead yet.</div>
          ) : (
            selectedActivities.map((act) => (
              <div key={act.activityId} className="relative">
                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-slate-900" />
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{act.title}</span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(act.timestamp).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
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
