import React, { useState } from 'react';
import {
  Send,
  Search,
  Filter,
  CheckCircle2,
  Sparkles,
  Users,
  Play,
  Pause,
  Mail,
  Building,
  Plus,
  ArrowRight,
  TrendingUp,
  Target,
  ExternalLink,
} from 'lucide-react';
import {
  OutboundCampaign,
  OutboundProspect,
  Contact,
} from '../types';
import { qualifyApolloProspect } from '../services/aiService';
import { findDuplicateContact } from '../services/dataService';

interface OutboundCampaignsProps {
  campaigns: OutboundCampaign[];
  prospects: OutboundProspect[];
  contacts: Contact[];
  onAddProspect: (prospect: OutboundProspect) => void;
  onSendColdEmail: (prospectId: string, customSubject?: string, customBody?: string) => void;
  onToggleCampaignStatus: (campaignId: string) => void;
  onSelectProspectConversation: (emailThreadId: string) => void;
}

export const OutboundCampaigns: React.FC<OutboundCampaignsProps> = ({
  campaigns,
  prospects,
  contacts,
  onAddProspect,
  onSendColdEmail,
  onToggleCampaignStatus,
  onSelectProspectConversation,
}) => {
  const activeCampaign = campaigns[0];
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);
  const [isQualifying, setIsQualifying] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // New Prospect Form State (Apollo Search Simulation)
  const [newProspect, setNewProspect] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    companyName: '',
    jobTitle: 'Founder',
    industry: 'Pilgrimage & Leisure Tours',
    companySize: '11-50',
    location: 'Mumbai, India',
  });

  const selectedProspect = prospects.find((p) => p.prospectId === selectedProspectId);

  // Filter prospects
  const filteredProspects = prospects.filter((p) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.companyName.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q)
    );
  });

  // Calculate campaign metrics
  const stats = activeCampaign?.stats || {
    prospectsFound: prospects.length,
    prospectsQualified: prospects.filter((p) => p.qualificationStatus === 'QUALIFIED').length,
    emailsSent: prospects.filter((p) => p.status !== 'PROSPECTED').length,
    replies: prospects.filter((p) => p.status === 'REPLIED' || p.status === 'ENGAGED' || p.status === 'QUALIFIED').length,
    engaged: prospects.filter((p) => p.status === 'ENGAGED' || p.status === 'QUALIFIED').length,
    qualifiedLeads: prospects.filter((p) => p.status === 'QUALIFIED').length,
    meetingsRequested: 5,
    unsubscribes: 1,
    bounces: 0,
  };

  // Handle Apollo discovery import
  const handleImportApolloProspect = async () => {
    if (!newProspect.firstName || !newProspect.email || !newProspect.companyName) return;

    // Duplicate check (Section 9)
    const existing = findDuplicateContact(
      {
        email: newProspect.email,
        phone: newProspect.phone,
        companyName: newProspect.companyName,
      },
      contacts
    );

    setIsQualifying(true);
    const aiFit = await qualifyApolloProspect({
      jobTitle: newProspect.jobTitle,
      companyName: newProspect.companyName,
      industry: newProspect.industry,
      companySize: newProspect.companySize,
      location: newProspect.location,
    });
    setIsQualifying(false);

    const prospectId = `prospect-${Date.now()}`;
    const prospect: OutboundProspect = {
      prospectId,
      campaignId: activeCampaign.campaignId,
      apolloPersonId: `ap_${Math.floor(1000000 + Math.random() * 9000000)}`,
      firstName: newProspect.firstName,
      lastName: newProspect.lastName,
      email: newProspect.email,
      phone: newProspect.phone,
      jobTitle: newProspect.jobTitle,
      companyName: newProspect.companyName,
      industry: newProspect.industry,
      companySize: newProspect.companySize,
      location: newProspect.location,
      source: 'APOLLO',
      status: 'PROSPECTED',
      qualificationStatus: aiFit.qualified ? 'QUALIFIED' : 'DISQUALIFIED',
      qualificationScore: aiFit.score,
      qualificationReason: existing
        ? `Duplicate matched existing contact (${existing.firstName} ${existing.lastName}). Attached to record.`
        : aiFit.reason,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onAddProspect(prospect);
    setShowAddModal(false);
    setSelectedProspectId(prospectId);
    setNewProspect({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      companyName: '',
      jobTitle: 'Founder',
      industry: 'Pilgrimage & Leisure Tours',
      companySize: '11-50',
      location: 'Mumbai, India',
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Campaign Overview Banner */}
      {activeCampaign && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold text-white">{activeCampaign.name}</h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    activeCampaign.status === 'RUNNING'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {activeCampaign.status}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Apollo Engine Connected
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1 max-w-3xl">
                {activeCampaign.description}
              </p>
              <div className="flex flex-wrap gap-2 mt-3 text-xs text-slate-300">
                <span className="px-2 py-1 bg-slate-800 rounded-md border border-slate-700">
                  Target: {activeCampaign.targetJobTitles.join(', ')}
                </span>
                <span className="px-2 py-1 bg-slate-800 rounded-md border border-slate-700">
                  Region: {activeCampaign.targetLocation}
                </span>
                <span className="px-2 py-1 bg-slate-800 rounded-md border border-slate-700">
                  Sending: {activeCampaign.emailAccountId} (sales@umrah360.in)
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => onToggleCampaignStatus(activeCampaign.campaignId)}
                className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                  activeCampaign.status === 'RUNNING'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {activeCampaign.status === 'RUNNING' ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>Pause Campaign</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Resume Outreach</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Discover via Apollo</span>
              </button>
            </div>
          </div>

          {/* Section 56 Outbound Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-6 pt-6 border-t border-slate-800">
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Prospects</span>
              <span className="text-lg font-bold text-white mt-0.5 block">
                {stats.prospectsFound}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">AI Qualified</span>
              <span className="text-lg font-bold text-emerald-400 mt-0.5 block">
                {stats.prospectsQualified}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Emails Sent</span>
              <span className="text-lg font-bold text-blue-400 mt-0.5 block">
                {stats.emailsSent}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Replies</span>
              <span className="text-lg font-bold text-purple-400 mt-0.5 block">
                {stats.replies}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Engaged</span>
              <span className="text-lg font-bold text-indigo-400 mt-0.5 block">
                {stats.engaged}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Qualified Leads</span>
              <span className="text-lg font-bold text-emerald-300 mt-0.5 block">
                {stats.qualifiedLeads}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Meetings Req.</span>
              <span className="text-lg font-bold text-amber-300 mt-0.5 block">
                {stats.meetingsRequested}
              </span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[11px] text-slate-400 block">Unsubscribes</span>
              <span className="text-lg font-bold text-rose-400 mt-0.5 block">
                {stats.unsubscribes}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Prospects Table & Details Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Prospects List */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-emerald-500" />
              <h3 className="font-semibold text-sm text-white">
                Campaign Prospects ({filteredProspects.length})
              </h3>
            </div>
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search prospect or company..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-800/40 text-slate-400 uppercase tracking-wider text-[10px]">
                  <th className="p-3">Prospect</th>
                  <th className="p-3">Company</th>
                  <th className="p-3">AI Fit Score</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredProspects.map((p) => {
                  const isSelected = p.prospectId === selectedProspect?.prospectId;

                  return (
                    <tr
                      key={p.prospectId}
                      onClick={() => setSelectedProspectId(p.prospectId)}
                      className={`cursor-pointer transition ${
                        isSelected ? 'bg-slate-800/90' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="p-3">
                        <div className="font-semibold text-slate-100">
                          {p.firstName} {p.lastName}
                        </div>
                        <div className="text-[11px] text-slate-400">{p.jobTitle}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{p.email}</div>
                      </td>

                      <td className="p-3">
                        <div className="font-medium text-slate-200">{p.companyName}</div>
                        <div className="text-[11px] text-slate-400">{p.location}</div>
                        <div className="text-[10px] text-slate-500">{p.companySize} employees</div>
                      </td>

                      <td className="p-3">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`font-bold ${
                              (p.qualificationScore || 0) >= 80
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }`}
                          >
                            {p.qualificationScore || 85}
                          </span>
                          <span className="text-[10px] text-slate-500">/100</span>
                        </div>
                        <span className="text-[10px] text-emerald-400/90 block truncate max-w-[150px]">
                          {p.qualificationStatus}
                        </span>
                      </td>

                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            p.status === 'ENGAGED' || p.status === 'QUALIFIED'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : p.status === 'REPLIED'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : p.status === 'EMAIL_SENT'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>

                      <td className="p-3 text-right">
                        {p.status === 'PROSPECTED' ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSendColdEmail(p.prospectId);
                            }}
                            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] transition shadow-sm"
                          >
                            Send Cold Email
                          </button>
                        ) : p.emailThreadId ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectProspectConversation(p.emailThreadId!);
                            }}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 font-medium text-[11px] transition flex items-center space-x-1 ml-auto"
                          >
                            <span>Open Thread</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 1 Col: Prospect Details & Cold Email Preview */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col space-y-4">
          {selectedProspect ? (
            <>
              <div className="border-b border-slate-800 pb-3">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Prospect Details
                </span>
                <h4 className="text-base font-bold text-white mt-1">
                  {selectedProspect.firstName} {selectedProspect.lastName}
                </h4>
                <p className="text-xs text-slate-300">
                  {selectedProspect.jobTitle} at {selectedProspect.companyName}
                </p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedProspect.email}</p>
              </div>

              {/* AI Qualification Breakdown */}
              <div className="bg-slate-800/80 p-3.5 rounded-lg border border-slate-700/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    <span>AI Qualification Fit</span>
                  </span>
                  <span className="font-bold text-emerald-400 text-sm">
                    {selectedProspect.qualificationScore || 90} / 100
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedProspect.qualificationReason ||
                    'Verified decision maker in pilgrimage tours with high relevance for Umrah360 B2B.'}
                </p>
              </div>

              {/* Cold Email Preview with Personalization Variables */}
              <div className="space-y-2 flex-1 flex flex-col">
                <span className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                  <Mail className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Outbound Cold Email Preview</span>
                </span>

                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-300 space-y-2 font-mono flex-1">
                  <div className="text-slate-400 border-b border-slate-800 pb-1.5">
                    <span className="text-slate-500">Subject: </span>
                    Umrah360 for {selectedProspect.companyName} - Automate B2B Packages & Visa
                    Operations
                  </div>
                  <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">
                    Hi {selectedProspect.firstName},
                    {'\n\n'}
                    I noticed you are leading operations at {selectedProspect.companyName}. We work
                    with top Umrah operators across India to automate their dynamic package costing,
                    Makkah/Madinah room allotments, and sub-agent B2B voucher distribution.
                    {'\n\n'}
                    Umrah360 gives your agency an automated B2B portal with live supplier costs and
                    compliant invoicing.
                    {'\n\n'}
                    Would you be open to exploring how this could streamline your upcoming season?
                    {'\n\n'}
                    Regards,
                    {'\n'}
                    Umrah360 Growth Team
                  </div>
                </div>
              </div>

              {selectedProspect.status === 'PROSPECTED' && (
                <button
                  onClick={() => onSendColdEmail(selectedProspect.prospectId)}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center justify-center space-x-1.5 shadow-md"
                >
                  <Send className="w-4 h-4" />
                  <span>Dispatch Cold Email (Creates Thread)</span>
                </button>
              )}

              {selectedProspect.emailThreadId && (
                <button
                  onClick={() => onSelectProspectConversation(selectedProspect.emailThreadId!)}
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition flex items-center justify-center space-x-1.5 shadow-md"
                >
                  <span>View Active Email Conversation</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center p-8 text-slate-500 text-xs">
              Select a prospect from the table to preview AI qualification details and outbound cold
              email.
            </div>
          )}
        </div>
      </div>

      {/* Apollo Import Modal (Simulation) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Target className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-sm">
                  Apollo Prospect Discovery & ICP Qualification
                </h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Enter candidate details discovered from Apollo search. The system will perform duplicate
              detection against contacts, verify ICP fit with Gemini, and queue for outbound campaign.
            </p>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">First Name *</label>
                <input
                  type="text"
                  value={newProspect.firstName}
                  onChange={(e) => setNewProspect({ ...newProspect, firstName: e.target.value })}
                  placeholder="e.g. Tariq"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Last Name</label>
                <input
                  type="text"
                  value={newProspect.lastName}
                  onChange={(e) => setNewProspect({ ...newProspect, lastName: e.target.value })}
                  placeholder="e.g. Khan"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div className="col-span-2">
                <label className="text-slate-400 block mb-1">Email Address *</label>
                <input
                  type="email"
                  value={newProspect.email}
                  onChange={(e) => setNewProspect({ ...newProspect, email: e.target.value })}
                  placeholder="tariq@albarakatours.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Company Name *</label>
                <input
                  type="text"
                  value={newProspect.companyName}
                  onChange={(e) => setNewProspect({ ...newProspect, companyName: e.target.value })}
                  placeholder="Al Baraka Travels"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Job Title</label>
                <input
                  type="text"
                  value={newProspect.jobTitle}
                  onChange={(e) => setNewProspect({ ...newProspect, jobTitle: e.target.value })}
                  placeholder="Managing Director"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Location</label>
                <input
                  type="text"
                  value={newProspect.location}
                  onChange={(e) => setNewProspect({ ...newProspect, location: e.target.value })}
                  placeholder="Mumbai, India"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Company Size</label>
                <input
                  type="text"
                  value={newProspect.companySize}
                  onChange={(e) => setNewProspect({ ...newProspect, companySize: e.target.value })}
                  placeholder="11-50 employees"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleImportApolloProspect}
                disabled={isQualifying || !newProspect.firstName || !newProspect.email}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 flex items-center space-x-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isQualifying ? 'Checking ICP...' : 'Check & Add to Campaign'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
