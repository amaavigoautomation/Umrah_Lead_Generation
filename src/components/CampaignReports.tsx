import React, { useEffect, useState } from 'react';
import { BarChart3, FileDown, FileText, History, RefreshCw, Sparkles, Trash2, Users, MousePointerClick, Eye, MailCheck, Clock3 } from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import { authFetch } from '../services/authService';
import type { Campaign } from '../types';

type ReportCampaign = {
  campaignId: string;
  name: string;
  status: string;
  metrics: {
    totalLeads: number; sent: number; delivered: number; pending: number; failed: number;
    uniqueOpened: number; totalOpens: number; scannerOpens: number;
    uniqueClicked: number; totalClicks: number; replied: number; ignored: number; waiting: number;
    bounced: number; complaints: number; delayed: number; deliveryUnknown: number;
  };
  rates: { deliveryRate: number; uniqueOpenRate: number; uniqueClickRate: number; replyRate: number };
  activity: { repeatOpens: number; repeatClicks: number; averageOpensPerUniqueLead: number; averageClicksPerUniqueLead: number };
  tracking: { trackedLeads: number; ignoredAfterDays: number; hasTrackingData: boolean };
};
type CampaignReport = {
  reportId: string;
  reportType: 'INDIVIDUAL' | 'COMPARISON';
  title: string;
  campaignNames: string[];
  campaigns: ReportCampaign[];
  analysis: { executiveSummary: string; highlights: string[]; risks: string[]; recommendations: string[]; aiGenerated: boolean; model: string };
  brand: { companyName: string; teamName: string; logoUrl: string; websiteUrl: string; salesEmail: string };
  generatedAt: string;
  generatedBy: string;
};

const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '0');
const pct = (value: number) => Number(value || 0).toFixed(1) + '%';
const dateLabel = (value?: string) => value ? new Date(value).toLocaleString() : '—';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char));
}

function buildPdfDocument(report: CampaignReport): string {
  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const LEFT = 42;
  const RIGHT = 553;
  const CONTENT_WIDTH = RIGHT - LEFT;
  const brand = report.brand || { companyName: 'Workspace', teamName: '', logoUrl: '', websiteUrl: '', salesEmail: '' };
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = 0;

  const safe = (value: unknown) => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const escapePdf = (value: unknown) => safe(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

  function text(value: unknown, x: number, top: number, size = 10, color = '0.12 0.17 0.24', bold = false) {
    const baseline = PAGE_HEIGHT - top - size;
    commands.push(color + ' rg BT /' + (bold ? 'F2' : 'F1') + ' ' + size +
      ' Tf 1 0 0 1 ' + x + ' ' + baseline + ' Tm (' + escapePdf(value) + ') Tj ET');
  }

  function rect(x: number, top: number, width: number, height: number, fill: string, stroke?: string) {
    const bottom = PAGE_HEIGHT - top - height;
    if (stroke) {
      commands.push(fill + ' rg ' + stroke + ' RG 0.7 w ' + x + ' ' + bottom + ' ' + width + ' ' + height + ' re B');
    } else {
      commands.push(fill + ' rg ' + x + ' ' + bottom + ' ' + width + ' ' + height + ' re f');
    }
  }

  function rule(top: number, color = '0.88 0.90 0.93') {
    const py = PAGE_HEIGHT - top;
    commands.push(color + ' RG 0.7 w ' + LEFT + ' ' + py + ' m ' + RIGHT + ' ' + py + ' l S');
  }

  function newPage() {
    commands = [];
    pages.push(commands);
    rect(0, 0, PAGE_WIDTH, 7, '0.93 0.39 0.09');
    text(brand.companyName || 'Workspace', LEFT, 22, 15, '0.10 0.16 0.23', true);
    text('CAMPAIGN INTELLIGENCE', 390, 25, 8, '0.93 0.39 0.09', true);
    rule(52, '0.88 0.90 0.93');
    y = 72;
  }

  function ensureRoom(height: number) {
    if (y + height > 785) newPage();
  }

  function wrap(value: unknown, maxChars: number): string[] {
    const input = String(value ?? '').replace(/\r/g, '');
    const result: string[] = [];
    for (const rawLine of input.split('\n')) {
      const words = safe(rawLine).split(' ').filter(Boolean);
      if (!words.length) {
        result.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        if (line && (line.length + word.length + 1) > maxChars) {
          result.push(line);
          line = word;
        } else {
          line = line ? line + ' ' + word : word;
        }
      }
      if (line) result.push(line);
    }
    return result;
  }

  function paragraph(value: unknown, options: { size?: number; color?: string; maxChars?: number; lineHeight?: number } = {}) {
    const size = options.size || 9;
    const lineHeight = options.lineHeight || size * 1.55;
    const lines = wrap(value, options.maxChars || 98);
    ensureRoom(lines.length * lineHeight + 4);
    for (const line of lines) {
      text(line, LEFT, y, size, options.color || '0.28 0.34 0.42');
      y += lineHeight;
    }
    y += 4;
  }

  function section(title: string) {
    ensureRoom(34);
    y += 7;
    text(title.toUpperCase(), LEFT, y, 9, '0.93 0.39 0.09', true);
    y += 17;
    rule(y, '0.91 0.92 0.94');
    y += 9;
  }

  function card(label: string, value: number, note: string, x: number, top: number, width: number) {
    rect(x, top, width, 46, '0.97 0.98 0.99', '0.88 0.90 0.93');
    text(label, x + 10, top + 7, 7, '0.39 0.45 0.53', true);
    text(number(value), x + 10, top + 17, 15, '0.10 0.16 0.23', true);
    text(note, x + 10, top + 34, 6.5, '0.43 0.49 0.57');
  }

  function listSection(title: string, items: string[]) {
    section(title);
    if (!items || !items.length) {
      paragraph('No items recorded.', { color: '0.48 0.53 0.60' });
      return;
    }
    for (const item of items) {
      const lines = wrap(item, 94);
      ensureRoom(lines.length * 13 + 6);
      text('-', LEFT + 2, y, 9, '0.93 0.39 0.09', true);
      for (const line of lines) {
        text(line, LEFT + 13, y, 8.5, '0.25 0.31 0.39');
        y += 12;
      }
      y += 3;
    }
  }

  newPage();
  text(report.reportType === 'COMPARISON' ? 'Campaign comparison report' : 'Individual campaign report', LEFT, y, 8, '0.93 0.39 0.09', true);
  y += 15;
  for (const line of wrap(report.title, 70)) {
    ensureRoom(28);
    text(line, LEFT, y, 21, '0.10 0.16 0.23', true);
    y += 25;
  }
  paragraph('Prepared for ' + (brand.companyName || 'Workspace') + ' by ' + (report.generatedBy || 'Workspace user') +
    ' | Generated ' + dateLabel(report.generatedAt), { size: 8, color: '0.43 0.49 0.57', maxChars: 100 });
  if (report.analysis && report.analysis.executiveSummary) {
    section('Executive summary');
    paragraph(report.analysis.executiveSummary, { size: 9, maxChars: 100 });
  }

  for (const campaign of report.campaigns || []) {
    ensureRoom(55);
    section('Campaign: ' + campaign.name);
    const m = campaign.metrics;
    paragraph('Status: ' + campaign.status + ' | ' + number(m.totalLeads) + ' total leads | ' +
      number(m.sent) + ' sent | ' + number(m.delivered) + ' delivered', { size: 8, color: '0.43 0.49 0.57' });
    const gap = 10;
    const width = (CONTENT_WIDTH - gap) / 2;
    const rows = [
      [['Total leads', m.totalLeads, 'Audience size'], ['Emails sent', m.sent, 'Dispatch attempts']],
      [['Delivered', m.delivered, pct(campaign.rates.deliveryRate) + ' of sent'], ['Unique leads opened', m.uniqueOpened, pct(campaign.rates.uniqueOpenRate) + ' estimated']],
      [['Total open events', m.totalOpens, number(campaign.activity.repeatOpens) + ' repeat opens'], ['Unique leads clicked', m.uniqueClicked, pct(campaign.rates.uniqueClickRate) + ' of sent']],
      [['Total click events', m.totalClicks, number(campaign.activity.repeatClicks) + ' repeat clicks'], ['Replies', m.replied, pct(campaign.rates.replyRate) + ' of sent']],
      [['Ignored', m.ignored, 'Five-day qualification rule'], ['Waiting', m.waiting, 'Still inside waiting window']],
      [['Bounced', m.bounced, 'Undeliverable emails'], ['Spam complaints', m.complaints, 'Recipient complaints']],
      [['Pending', m.pending, 'Not yet dispatched'], ['Failed', m.failed, 'Send errors']],
    ];
    for (const row of rows) {
      ensureRoom(54);
      card(row[0][0], row[0][1], row[0][2], LEFT, y, width);
      card(row[1][0], row[1][1], row[1][2], LEFT + width + gap, y, width);
      y += 54;
    }
    section('Activity interpretation');
    paragraph('Unique opens: ' + number(m.uniqueOpened) + ' leads | Total opens: ' + number(m.totalOpens) +
      ' events | Repeat opens beyond first: ' + number(campaign.activity.repeatOpens) + '.', { maxChars: 100 });
    paragraph('Unique clicks: ' + number(m.uniqueClicked) + ' leads | Total clicks: ' + number(m.totalClicks) +
      ' events | Repeat clicks beyond first: ' + number(campaign.activity.repeatClicks) + '.', { maxChars: 100 });
    paragraph('Average opens per unique opener: ' + number(campaign.activity.averageOpensPerUniqueLead) +
      ' | Average clicks per unique clicker: ' + number(campaign.activity.averageClicksPerUniqueLead) + '.', { maxChars: 100 });
    paragraph('Scanner opens excluded: ' + number(m.scannerOpens) + ' | Tracking-eligible leads: ' +
      number(campaign.tracking.trackedLeads) + ' | Ignored rule: ' + number(campaign.tracking.ignoredAfterDays) + ' days.',
      { size: 8, color: '0.43 0.49 0.57', maxChars: 100 });
  }

  listSection('Key findings', report.analysis && report.analysis.highlights ? report.analysis.highlights : []);
  listSection('Risks and limitations', report.analysis && report.analysis.risks ? report.analysis.risks : []);
  listSection('AI recommendations', report.analysis && report.analysis.recommendations ? report.analysis.recommendations : []);

  for (let index = 0; index < pages.length; index += 1) {
    const target = pages[index];
    commands = target;
    rule(810, '0.88 0.90 0.93');
    text((brand.companyName || 'Workspace') + ' | Unique leads and total events are separate metrics. Opens are estimates.',
      LEFT, 817, 6.2, '0.48 0.53 0.60');
    text('Page ' + (index + 1) + ' of ' + pages.length, 490, 817, 6.2, '0.48 0.53 0.60');
  }

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const fontRegularId = 3 + pages.length * 2;
  const fontBoldId = fontRegularId + 1;
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [' + pageObjectIds.map((id) => id + ' 0 R').join(' ') +
    '] /Count ' + pages.length + ' >>';

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const stream = page.join('\n') + '\n';
    objects[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT +
      '] /Resources << /Font << /F1 ' + fontRegularId + ' 0 R /F2 ' + fontBoldId +
      ' 0 R >> >> /Contents ' + contentId + ' 0 R >>';
    objects[contentId] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream';
  });
  objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += id + ' 0 obj\n' + objects[id] + '\nendobj\n';
  }
  const xrefOffset = pdf.length;
  pdf += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id += 1) {
    pdf += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';
  return pdf;
}

export const CampaignReports: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { brand } = useBrand();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [campaignResponse, historyResponse] = await Promise.all([
        authFetch('/api/campaigns'),
        authFetch('/api/campaign-reports'),
      ]);
      const campaignData = await campaignResponse.json();
      const historyData = await historyResponse.json();
      if (!campaignResponse.ok) throw new Error(campaignData?.error || 'Could not load campaigns.');
      if (!historyResponse.ok) throw new Error(historyData?.error || 'Could not load report history.');
      setCampaigns(Array.isArray(campaignData.campaigns) ? campaignData.campaigns : []);
      setHistory(Array.isArray(historyData.reports) ? historyData.reports : []);
    } catch (err: any) {
      setError(err?.message || 'Could not load campaign reporting data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [tenantId]);

  const toggleCampaign = (campaignId: string) => {
    setSelectedIds((current) => current.includes(campaignId)
      ? current.filter((id) => id !== campaignId)
      : current.length < 10 ? [...current, campaignId] : current);
  };

  const handleGenerate = async () => {
    if (!selectedIds.length) {
      setError('Select at least one campaign first.');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const response = await authFetch('/api/campaign-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignIds: selectedIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Could not generate report.');
      setReport(data.report);
      setNotice(data.report?.analysis?.aiGenerated
        ? 'AI report generated and saved to report history.'
        : 'Report saved. AI was unavailable, so a rule-based analysis was added.');
      await loadHistoryOnly();
    } catch (err: any) {
      setError(err?.message || 'Could not generate report.');
    } finally {
      setGenerating(false);
    }
  };

  const loadHistoryOnly = async () => {
    try {
      const response = await authFetch('/api/campaign-reports');
      const data = await response.json();
      if (response.ok) setHistory(Array.isArray(data.reports) ? data.reports : []);
    } catch {}
  };

  const openSavedReport = async (reportId: string) => {
    setError('');
    setNotice('');
    try {
      const response = await authFetch('/api/campaign-reports/' + encodeURIComponent(reportId));
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Could not open saved report.');
      setReport(data.report);
    } catch (err: any) {
      setError(err?.message || 'Could not open saved report.');
    }
  };

  const deleteSavedReport = async (reportId: string) => {
    try {
      const response = await authFetch('/api/campaign-reports/' + encodeURIComponent(reportId), { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Could not delete report.');
      setHistory((current) => current.filter((item) => item.reportId !== reportId));
      if (report?.reportId === reportId) setReport(null);
    } catch (err: any) {
      setError(err?.message || 'Could not delete report.');
    }
  };

  const exportPdf = () => {
    if (!report) return;
    try {
      const pdf = buildPdfDocument(report);
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeName = (report.title || 'campaign-report')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'campaign-report';
      anchor.href = downloadUrl;
      anchor.download = safeName + '.pdf';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
      setError('');
      setNotice('Your branded PDF download has started.');
    } catch (err: any) {
      setError(err?.message || 'Could not create the PDF. Please try again.');
    }
  };

  const displayBrand = brand.companyName || 'Your workspace';

  return (
    <div className="space-y-5 font-sans">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-orange-500" />
            <h1 className="text-xl font-extrabold text-slate-900">AI Campaign Reporting</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">Individual campaign performance, cross-campaign comparisons and AI recommendations for {displayBrand}.</p>
        </div>
        <button onClick={() => void loadData()} disabled={loading} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh data
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <section className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Choose campaigns</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Select one for an individual report or multiple for a comparison. Up to 10 per report.</p>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">{selectedIds.length} selected</span>
          </div>
          <div className="max-h-[330px] overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading campaigns…</div>
            ) : campaigns.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No campaigns found in this workspace.</div>
            ) : campaigns.map((campaign) => (
              <label key={campaign.campaignId} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selectedIds.includes(campaign.campaignId)} onChange={() => toggleCampaign(campaign.campaignId)} className="rounded border-slate-300 text-orange-500 focus:ring-orange-500" />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-slate-800 truncate">{campaign.name}</span>
                  <span className="block text-[10px] text-slate-400">{campaign.status} · {number(campaign.totalLeads)} leads · {number(campaign.sentCount)} sent</span>
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{campaign.type}</span>
              </label>
            ))}
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-[10px] text-slate-500">Reports are saved as historical snapshots and will not change when campaign activity changes later.</span>
            <button onClick={() => void handleGenerate()} disabled={generating || loading || !selectedIds.length} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-sm disabled:opacity-50">
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Generating report…' : 'Generate AI report'}
            </button>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl shadow-2xs p-4 space-y-3">
          <div className="flex items-center gap-2"><History className="w-4 h-4 text-orange-500"/><h2 className="text-sm font-bold text-slate-900">Report history</h2></div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400 py-5 text-center">Generated reports will appear here.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {history.map((item) => (
                <div key={item.reportId} className="rounded-lg border border-slate-200 p-3 hover:border-orange-200">
                  <button onClick={() => void openSavedReport(item.reportId)} className="block text-left w-full">
                    <span className="block text-xs font-semibold text-slate-800">{item.title}</span>
                    <span className="block text-[10px] text-slate-500 mt-1">{(item.campaignNames || []).join(' · ')}</span>
                    <span className="block text-[10px] text-slate-400 mt-1">{dateLabel(item.generatedAt)} · {item.reportType === 'COMPARISON' ? 'Comparison' : 'Individual'}</span>
                  </button>
                  <div className="flex justify-end mt-2">
                    <button onClick={() => void deleteSavedReport(item.reportId)} title="Delete saved report" className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5"/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {!report ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
          <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3"/>
          <h2 className="text-sm font-bold text-slate-700">Your campaign report will appear here</h2>
          <p className="text-xs text-slate-400 mt-1">Select one or more campaigns and generate a report to view performance, activity totals and AI recommendations.</p>
        </div>
      ) : (
        <ReportView report={report} onExport={exportPdf} />
      )}
    </div>
  );
};

const ReportView: React.FC<{ report: CampaignReport; onExport: () => void }> = ({ report, onExport }) => {
  const campaign = report.campaigns[0];
  const metrics = campaign?.metrics;
  const card = (label: string, value: number, sub: string, color: string, icon: React.ReactNode) => (
    <div className="p-3 rounded-xl border border-slate-200 bg-white min-w-0">
      <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-slate-500">{label}</span><span className={color}>{icon}</span></div>
      <div className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">{number(value)}</div>
      <div className="text-[10px] text-slate-400 mt-1">{sub}</div>
    </div>
  );

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-900">{report.title}</h2>
            <span className="px-2 py-0.5 text-[9px] uppercase tracking-wide font-bold rounded-full bg-orange-50 text-orange-700 border border-orange-100">{report.reportType === 'COMPARISON' ? 'Comparison' : 'Individual'}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Snapshot generated {dateLabel(report.generatedAt)} · {report.generatedBy}</p>
        </div>
        <button onClick={onExport} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"><FileDown className="w-4 h-4"/> Download branded PDF</button>
      </div>

      {report.reportType === 'INDIVIDUAL' && metrics && (
        <div className="p-4 sm:p-5 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {card('Total leads', metrics.totalLeads, 'Uploaded campaign audience', 'text-slate-400', <Users className="w-4 h-4"/>)}
            {card('Emails sent', metrics.sent, number(metrics.delivered) + ' delivered', 'text-blue-500', <MailCheck className="w-4 h-4"/>)}
            {card('Unique leads opened', metrics.uniqueOpened, pct(campaign.rates.uniqueOpenRate) + ' · estimated', 'text-amber-500', <Eye className="w-4 h-4"/>)}
            {card('Unique leads clicked', metrics.uniqueClicked, pct(campaign.rates.uniqueClickRate), 'text-emerald-500', <MousePointerClick className="w-4 h-4"/>)}
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Campaign engagement</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {card('Total open events', metrics.totalOpens, number(campaign.activity.repeatOpens) + ' repeat opens beyond first', 'text-amber-500', <Eye className="w-4 h-4"/>)}
              {card('Total click events', metrics.totalClicks, number(campaign.activity.repeatClicks) + ' repeat clicks beyond first', 'text-emerald-500', <MousePointerClick className="w-4 h-4"/>)}
              {card('Replies', metrics.replied, pct(campaign.rates.replyRate) + ' of sent', 'text-sky-500', <MailCheck className="w-4 h-4"/>)}
              {card('Ignored', metrics.ignored, number(metrics.waiting) + ' still waiting · ' + campaign.tracking.ignoredAfterDays + 'd rule', 'text-slate-400', <Clock3 className="w-4 h-4"/>)}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Delivery outcomes</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[['Delivered',metrics.delivered],['Pending',metrics.pending],['Failed',metrics.failed],['Bounced',metrics.bounced],['Spam complaints',metrics.complaints]].map(([label,value]) => (
                <div key={String(label)} className="rounded-lg bg-slate-50 border border-slate-100 p-3"><div className="text-[10px] text-slate-500">{label}</div><div className="text-lg font-bold text-slate-800 mt-1">{number(value)}</div></div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-xs font-bold text-slate-700 mb-2">Activity totals vs unique leads</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div><div className="flex justify-between"><span className="text-slate-600">Opens</span><b>{number(metrics.uniqueOpened)} unique leads · {number(metrics.totalOpens)} total opens</b></div><div className="mt-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-400" style={{width: Math.min(100, campaign.rates.uniqueOpenRate) + '%'}}/></div></div>
              <div><div className="flex justify-between"><span className="text-slate-600">Clicks</span><b>{number(metrics.uniqueClicked)} unique leads · {number(metrics.totalClicks)} total clicks</b></div><div className="mt-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{width: Math.min(100, campaign.rates.uniqueClickRate) + '%'}}/></div></div>
            </div>
            <p className="text-[10px] text-slate-400 mt-3">Scanner opens excluded: {number(metrics.scannerOpens)}. Opens are estimates. Historical reports use the metrics captured when the report was generated.</p>
          </div>
        </div>
      )}

      {report.reportType === 'COMPARISON' && (
        <div className="p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Campaign comparison</h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>
                <th className="p-3">Campaign</th><th className="p-3 text-right">Leads</th><th className="p-3 text-right">Sent</th>
                <th className="p-3 text-right">Unique opens</th><th className="p-3 text-right">Total opens</th>
                <th className="p-3 text-right">Unique clicks</th><th className="p-3 text-right">Total clicks</th>
                <th className="p-3 text-right">Replies</th><th className="p-3 text-right">Ignored</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.campaigns.map((item) => (<tr key={item.campaignId}>
                  <td className="p-3 font-semibold text-slate-800">{item.name}</td>
                  <td className="p-3 text-right">{number(item.metrics.totalLeads)}</td>
                  <td className="p-3 text-right">{number(item.metrics.sent)}</td>
                  <td className="p-3 text-right font-semibold text-amber-700">{number(item.metrics.uniqueOpened)}</td>
                  <td className="p-3 text-right">{number(item.metrics.totalOpens)}</td>
                  <td className="p-3 text-right font-semibold text-emerald-700">{number(item.metrics.uniqueClicked)}</td>
                  <td className="p-3 text-right">{number(item.metrics.totalClicks)}</td>
                  <td className="p-3 text-right">{number(item.metrics.replied)}</td>
                  <td className="p-3 text-right">{number(item.metrics.ignored)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.campaigns.map((item) => (
              <div key={item.campaignId} className="rounded-lg border border-slate-200 p-3">
                <div className="font-semibold text-xs text-slate-800 mb-2">{item.name}</div>
                <div className="flex justify-between text-[10px] text-slate-500"><span>Unique open rate</span><b>{pct(item.rates.uniqueOpenRate)}</b></div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1 mb-2"><div className="h-full bg-amber-400" style={{width: Math.min(100,item.rates.uniqueOpenRate)+'%'}}/></div>
                <div className="flex justify-between text-[10px] text-slate-500"><span>Unique click rate</span><b>{pct(item.rates.uniqueClickRate)}</b></div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1"><div className="h-full bg-emerald-500" style={{width: Math.min(100,item.rates.uniqueClickRate)+'%'}}/></div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400">Compare campaigns with their audience sizes and delivery outcomes in mind. Unique leads and total open/click events are separate measures.</p>
        </div>
      )}

      <div className="border-t border-slate-100 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-orange-500"/> AI analysis and recommendations</h3>
          <span className={'text-[9px] font-bold px-2 py-1 rounded-full ' + (report.analysis?.aiGenerated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            {report.analysis?.aiGenerated ? 'AI GENERATED' : 'RULE-BASED FALLBACK'}
          </span>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs text-slate-700 leading-relaxed">{report.analysis?.executiveSummary}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <InsightList title="Key findings" items={report.analysis?.highlights || []} tone="blue"/>
          <InsightList title="Risks and limitations" items={report.analysis?.risks || []} tone="amber"/>
          <InsightList title="Recommended actions" items={report.analysis?.recommendations || []} tone="green"/>
        </div>
      </div>
    </section>
  );
};

const InsightList: React.FC<{ title: string; items: string[]; tone: 'blue' | 'amber' | 'green' }> = ({ title, items, tone }) => {
  const colors = tone === 'blue' ? 'bg-blue-50 border-blue-100 text-blue-800' : tone === 'amber' ? 'bg-amber-50 border-amber-100 text-amber-800' : 'bg-emerald-50 border-emerald-100 text-emerald-800';
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold text-slate-700">{title}</h4>
      {items.length ? items.map((item, index) => <div key={index} className={'text-[11px] leading-relaxed rounded-lg border p-3 ' + colors}>{item}</div>) : <p className="text-[11px] text-slate-400">No items recorded.</p>}
    </div>
  );
};

export default CampaignReports;
