import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronLeft,
  Clock3, Database as DatabaseIcon, Download, FileCheck2, FileSpreadsheet, Filter,
  History, Info, Loader2, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  Trash2, Upload, Users, X, Zap,
} from 'lucide-react';

type DatabaseSummary = {
  databaseId: string; name: string; description?: string; totalLeads: number;
  emailEligibleCount: number; createdAt: string; updatedAt: string;
};
type LeadRecord = {
  entryId: string; databaseId: string; name?: string; email?: string; phone?: string;
  companyName?: string; website?: string; designation?: string; city?: string; country?: string;
  customFields?: Record<string, string>; sourceDatabaseName?: string; sourceFileName?: string;
  sourceRowNumber?: number; createdAt?: string;
};
type ImportRecord = {
  importId: string; sourceFileName?: string; received?: number; added?: number;
  duplicatesSkipped?: number; invalidCount?: number; failedWrites?: number;
  duplicateRows?: Array<Record<string, unknown>>; invalidRows?: Array<Record<string, unknown>>;
  status?: string; createdAt?: string;
};
type CampaignUsage = {
  campaignId: string; name: string; status: string; recipientCount?: number;
  createdAt?: string; updatedAt?: string;
};
type LeadField = 'name' | 'email' | 'phone' | 'companyName' | 'website' | 'designation' | 'city' | 'country';
type WorkbookLike = { SheetNames: string[]; Sheets: Record<string, any> };
type PreviewResult = {
  received: number; readyCount: number; duplicateCount: number; invalidCount: number;
  duplicates: Array<Record<string, unknown>>; invalidRows: Array<Record<string, unknown>>;
};
type ImportResult = PreviewResult & {
  added: number; duplicatesSkipped: number; totalLeads: number; emailEligibleCount: number;
};
type Props = { isAdmin?: boolean; tenantId?: string };

const PAGE_SIZE = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FIELDS: Array<{ key: LeadField; label: string }> = [
  { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email address' },
  { key: 'phone', label: 'Mobile / phone' }, { key: 'companyName', label: 'Company' },
  { key: 'website', label: 'Website' }, { key: 'designation', label: 'Designation' },
  { key: 'city', label: 'City' }, { key: 'country', label: 'Country' },
];
const ALIASES: Record<LeadField, string[]> = {
  name: ['name', 'fullname', 'contactname', 'leadname', 'firstname'],
  email: ['email', 'emailaddress', 'emailid', 'mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'whatsapp', 'contactno', 'telephone'],
  companyName: ['company', 'companyname', 'organization', 'organisation', 'business', 'businessname'],
  website: ['website', 'url', 'domain'], designation: ['designation', 'jobtitle', 'title', 'role'],
  city: ['city', 'location'], country: ['country'],
};

async function apiRequest<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || ('Request failed (' + response.status + ')'));
  return data as T;
}
function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function formatNumber(value: number | undefined): string {
  return Number(value || 0).toLocaleString();
}
function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function csvCell(value: unknown): string {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}
function downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  if (!rows.length) return;
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [keys.map(csvCell).join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor);
  anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
function mapWorkbookSheet(workbook: WorkbookLike, sheetName: string, hasHeader: boolean) {
  const XLSX = (window as any).__leadDatabaseXlsx;
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false }) as unknown[][];
  const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((value) => String(value ?? '').trim() !== ''));
  if (!nonEmptyRows.length) throw new Error('This worksheet does not contain any rows.');
  const first = nonEmptyRows[0] || [];
  const headers = hasHeader ? first.map((value, index) => String(value || ('Column ' + (index + 1))).trim()) : first.map((_value, index) => 'Column ' + (index + 1));
  const dataRows = hasHeader ? nonEmptyRows.slice(1) : nonEmptyRows;
  if (!dataRows.length) throw new Error('The selected worksheet has no lead rows.');
  return { headers, rows: dataRows.map((row) => row.map((value) => String(value ?? '').trim())) };
}
function guessMapping(headers: string[]): Record<LeadField, string> {
  const result = {} as Record<LeadField, string>;
  FIELDS.forEach(({ key }) => {
    const index = headers.findIndex((header) => ALIASES[key].includes(normalizeHeader(header)));
    result[key] = index >= 0 ? String(index) : '';
  });
  return result;
}
function statusClass(status: string): string {
  const value = String(status || '').toUpperCase();
  if (['COMPLETED', 'SENT', 'ACTIVE', 'RUNNING'].includes(value)) return 'lead-db-status lead-db-status--success';
  if (['PARTIAL', 'PAUSED', 'SCHEDULED', 'DRAFT'].includes(value)) return 'lead-db-status lead-db-status--warning';
  if (['FAILED', 'CANCELLED', 'ERROR'].includes(value)) return 'lead-db-status lead-db-status--danger';
  return 'lead-db-status';
}
const StatCard: React.FC<{ label: string; value: string; helper: string; icon: React.ElementType; tone?: string }> =
  ({ label, value, helper, icon: Icon, tone = 'orange' }) => (
    <div className="lead-db-stat">
      <div className={'lead-db-stat-icon lead-db-stat-icon--' + tone}><Icon size={17} /></div>
      <div className="min-w-0"><div className="lead-db-stat-label">{label}</div><div className="lead-db-stat-value">{value}</div><div className="lead-db-stat-helper">{helper}</div></div>
    </div>
  );

export const LeadDatabase: React.FC<Props> = ({ isAdmin = false, tenantId = '' }) => {
  const [activeSection, setActiveSection] = useState<'databases' | 'all-leads'>('databases');
  const [selectedDatabase, setSelectedDatabase] = useState<DatabaseSummary | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<'leads' | 'imports' | 'settings' | 'usage'>('leads');
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [campaignCounts, setCampaignCounts] = useState<Record<string, number>>({});
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [campaignUsage, setCampaignUsage] = useState<CampaignUsage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const [search, setSearch] = useState('');
  const [databaseSearch, setDatabaseSearch] = useState('');
  const [databaseFilter, setDatabaseFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingDatabase, setEditingDatabase] = useState<DatabaseSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<DatabaseSummary | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<WorkbookLike | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<LeadField, string>>({ name: '', email: '', phone: '', companyName: '', website: '', designation: '', city: '', country: '' });
  const [wizardStep, setWizardStep] = useState(1);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDatabases = useCallback(async () => {
    const data = await apiRequest<{ databases: DatabaseSummary[]; campaignCounts?: Record<string, number> }>('/api/lead-databases');
    const nextDatabases = data.databases || [];
    setDatabases(nextDatabases);
    setCampaignCounts(data.campaignCounts || {});
    setSelectedDatabase((current) => current ? nextDatabases.find((database) => database.databaseId === current.databaseId) || current : current);
  }, []);

  const loadEntries = useCallback(async (append = false) => {
    const cursor = append ? cursorRef.current : null;
    if (append && !cursor) return;
    if (append) setIsLoadingMore(true); else setIsLoading(true);
    setError(null);
    try {
      const useWorkspace = !!selectedDatabase && activeSection === 'databases';
      const path = useWorkspace ? '/api/lead-databases/' + encodeURIComponent(selectedDatabase!.databaseId) + '/leads' : '/api/lead-databases/leads';
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (append && cursor) params.set('cursor', cursor);
      if (search.trim()) params.set('q', search.trim());
      if (!useWorkspace && activeSection === 'all-leads' && databaseFilter) params.set('databaseId', databaseFilter);
      const data = await apiRequest<{ leads: LeadRecord[]; nextCursor: string | null }>(path + '?' + params.toString());
      setLeads((current) => append ? current.concat(data.leads || []) : (data.leads || []));
      setNextCursor(data.nextCursor || null); cursorRef.current = data.nextCursor || null;
    } catch (err: any) {
      setError(err?.message || 'Could not load leads.');
    } finally {
      setIsLoading(false); setIsLoadingMore(false);
    }
  }, [selectedDatabase, activeSection, search, databaseFilter]);

  const loadImports = useCallback(async (databaseId: string) => {
    try {
      const data = await apiRequest<{ imports: ImportRecord[] }>('/api/lead-databases/' + encodeURIComponent(databaseId) + '/imports');
      setImports(data.imports || []);
    } catch (err: any) { setImports([]); setError(err?.message || 'Could not load import history.'); }
  }, []);
  const loadUsage = useCallback(async (databaseId: string) => {
    try {
      const data = await apiRequest<{ campaigns: CampaignUsage[] }>('/api/lead-databases/' + encodeURIComponent(databaseId) + '/campaign-usage');
      setCampaignUsage(data.campaigns || []);
    } catch (err: any) { setCampaignUsage([]); setError(err?.message || 'Could not load campaign usage.'); }
  }, []);

  useEffect(() => {
    setSelectedDatabase(null); setDatabases([]); setLeads([]); setImports([]); setCampaignUsage([]);
    setSearch(''); setDatabaseSearch(''); setDatabaseFilter('');
    loadDatabases().catch((err) => setError(err?.message || 'Could not load databases.'));
  }, [tenantId, loadDatabases]);

  useEffect(() => {
    if (activeSection === 'all-leads') {
      setSelectedDatabase(null);
      const timer = window.setTimeout(() => { loadEntries(false); }, search ? 280 : 0);
      return () => window.clearTimeout(timer);
    }
    if (!selectedDatabase) { setLeads([]); setNextCursor(null); cursorRef.current = null; return; }
    if (workspaceTab === 'leads') {
      const timer = window.setTimeout(() => { loadEntries(false); }, search ? 280 : 0);
      return () => window.clearTimeout(timer);
    }
    if (workspaceTab === 'imports') loadImports(selectedDatabase.databaseId);
    if (workspaceTab === 'usage') loadUsage(selectedDatabase.databaseId);
  }, [activeSection, selectedDatabase?.databaseId, workspaceTab, search, databaseFilter, tenantId, loadEntries, loadImports, loadUsage]);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await loadDatabases();
      if (activeSection === 'all-leads' || selectedDatabase) {
        if (workspaceTab === 'leads' || activeSection === 'all-leads') await loadEntries(false);
        if (selectedDatabase && workspaceTab === 'imports') await loadImports(selectedDatabase.databaseId);
        if (selectedDatabase && workspaceTab === 'usage') await loadUsage(selectedDatabase.databaseId);
      }
      setFeedback('Lead database is up to date.');
    } catch (err: any) { setError(err?.message || 'Refresh failed.'); }
    finally { setIsRefreshing(false); }
  };
  const openWorkspace = (database: DatabaseSummary) => {
    setSelectedDatabase(database); setActiveSection('databases'); setWorkspaceTab('leads');
    setSearch(''); setFeedback(null); setError(null);
  };

  const handleCreateDatabase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) { setError('Enter a database name.'); return; }
    setIsCreating(true); setError(null); setFeedback(null);
    try {
      const data = await apiRequest<{ database: DatabaseSummary }>('/api/lead-databases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() }),
      });
      setCreateOpen(false); setNewName(''); setNewDescription('');
      await loadDatabases(); openWorkspace(data.database);
      setFeedback('Database created. Import your first lead file when ready.');
    } catch (err: any) { setError(err?.message || 'Could not create the database.'); }
    finally { setIsCreating(false); }
  };

  const openEdit = (database: DatabaseSummary) => {
    setEditingDatabase(database); setEditName(database.name); setEditDescription(database.description || '');
  };
  const saveDatabaseDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingDatabase || !editName.trim()) return;
    setIsSavingDetails(true); setError(null);
    try {
      const data = await apiRequest<{ database: DatabaseSummary }>('/api/lead-databases/' + encodeURIComponent(editingDatabase.databaseId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() }),
      });
      setDatabases((current) => current.map((item) => item.databaseId === data.database.databaseId ? data.database : item));
      if (selectedDatabase?.databaseId === data.database.databaseId) setSelectedDatabase(data.database);
      setEditingDatabase(null); setFeedback('Database details saved.');
    } catch (err: any) { setError(err?.message || 'Could not save database details.'); }
    finally { setIsSavingDetails(false); }
  };

  const handleDeleteDatabase = async (database: DatabaseSummary) => {
    setError(null);
    try {
      const usage = await apiRequest<{ campaigns: CampaignUsage[] }>('/api/lead-databases/' + encodeURIComponent(database.databaseId) + '/campaign-usage');
      const blocking = (usage.campaigns || []).filter((campaign) => ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED'].includes(String(campaign.status).toUpperCase()));
      if (blocking.length) {
        window.alert('This database is still used by active campaign(s): ' + blocking.map((campaign) => campaign.name + ' (' + campaign.status + ')').join('; ') + '. Complete or delete these campaigns before deleting the database.');
        return;
      }
      const confirmed = window.confirm('Delete "' + database.name + '" and all ' + formatNumber(database.totalLeads) + ' saved leads? This action cannot be undone.');
      if (!confirmed) return;
      await apiRequest('/api/lead-databases/' + encodeURIComponent(database.databaseId), { method: 'DELETE' });
      setDatabases((current) => current.filter((item) => item.databaseId !== database.databaseId));
      if (selectedDatabase?.databaseId === database.databaseId) setSelectedDatabase(null);
      setFeedback('Database deleted.');
    } catch (err: any) { setError(err?.message || 'Could not delete database.'); }
  };

  const openImport = (database: DatabaseSummary) => {
    setImportTarget(database); setImportFile(null); setWorkbook(null); setSheetName('');
    setHeaders([]); setSheetRows([]); setHasHeader(true);
    setMapping({ name: '', email: '', phone: '', companyName: '', website: '', designation: '', city: '', country: '' });
    setWizardStep(1); setPreview(null); setImportResult(null); setImportOpen(true);
  };
  const closeImport = () => {
    if (isImporting) return;
    setImportOpen(false); setImportTarget(null); setImportFile(null); setWorkbook(null); setPreview(null); setImportResult(null);
  };
  const prepareSheet = (targetWorkbook: WorkbookLike, targetSheet: string, headerMode: boolean) => {
    try {
      const parsed = mapWorkbookSheet(targetWorkbook, targetSheet, headerMode);
      setHeaders(parsed.headers); setSheetRows(parsed.rows); setMapping(guessMapping(parsed.headers)); setPreview(null);
    } catch (err: any) { setError(err?.message || 'Could not read this worksheet.'); }
  };
  const handleFileSelected = async (file?: File) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) { setError('Please choose a file smaller than 10 MB.'); return; }
    setIsPreparingFile(true);
    try {
      const XLSX = await import('xlsx');
      (window as any).__leadDatabaseXlsx = XLSX;
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      if (!book.SheetNames?.length) throw new Error('The file does not contain a worksheet.');
      setImportFile(file); setWorkbook(book as unknown as WorkbookLike);
      setSheetName(book.SheetNames[0]); prepareSheet(book as unknown as WorkbookLike, book.SheetNames[0], hasHeader);
    } catch (err: any) { setError(err?.message || 'Could not read this spreadsheet.'); }
    finally { setIsPreparingFile(false); }
  };

  const mappedRows = useMemo(() => {
    if (!headers.length || !sheetRows.length) return [];
    const indexFor = (field: LeadField) => mapping[field] === '' ? -1 : Number(mapping[field]);
    return sheetRows.map((row, index) => {
      const values: Record<string, string> = {};
      FIELDS.forEach(({ key }) => { const idx = indexFor(key); values[key] = idx >= 0 ? String(row[idx] || '').trim() : ''; });
      const used = new Set(Object.values(mapping).filter((value) => value !== '').map(Number));
      const customFields: Record<string, string> = {};
      headers.forEach((header, colIndex) => {
        const value = String(row[colIndex] || '').trim();
        if (!used.has(colIndex) && value) customFields[header || ('Column ' + (colIndex + 1))] = value;
      });
      return {
        rowNumber: index + (hasHeader ? 2 : 1), name: values.name, email: values.email, phone: values.phone,
        companyName: values.companyName, website: values.website, designation: values.designation,
        city: values.city, country: values.country, customFields,
      };
    });
  }, [headers, sheetRows, mapping, hasHeader]);

  const handlePreview = async () => {
    if (!importTarget) return;
    if (!mappedRows.length) { setError('Choose a worksheet with lead rows.'); return; }
    if (!mapping.email && !mapping.name && !mapping.phone && !mapping.companyName) {
      setError('Map at least one identity field: name, email, mobile or company.'); return;
    }
    setIsValidating(true); setError(null);
    try {
      const data = await apiRequest<PreviewResult>('/api/lead-databases/' + encodeURIComponent(importTarget.databaseId) + '/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFileName: importFile?.name || 'Uploaded leads', rows: mappedRows }),
      });
      setPreview(data); setWizardStep(3);
    } catch (err: any) { setError(err?.message || 'Could not validate the upload.'); }
    finally { setIsValidating(false); }
  };
  const handleImport = async () => {
    if (!importTarget || !mappedRows.length) return;
    setIsImporting(true); setError(null);
    try {
      const data = await apiRequest<ImportResult>('/api/lead-databases/' + encodeURIComponent(importTarget.databaseId) + '/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFileName: importFile?.name || 'Uploaded leads', rows: mappedRows }),
      });
      setImportResult(data); setWizardStep(4);
      await loadDatabases();
      if (selectedDatabase?.databaseId === importTarget.databaseId) {
        await loadEntries(false); await loadImports(importTarget.databaseId);
      }
      setFeedback('Import completed. ' + formatNumber(data.added) + ' leads added.');
    } catch (err: any) { setError(err?.message || 'Could not import leads.'); }
    finally { setIsImporting(false); }
  };

  const downloadAllLeads = async (databaseId?: string, currentSearch = '') => {
    setError(null);
    try {
      const records: LeadRecord[] = []; let cursor = ''; let keepGoing = true;
      while (keepGoing) {
        const path = databaseId ? '/api/lead-databases/' + encodeURIComponent(databaseId) + '/leads' : '/api/lead-databases/leads';
        const params = new URLSearchParams({ limit: '100' });
        if (cursor) params.set('cursor', cursor);
        if (currentSearch.trim()) params.set('q', currentSearch.trim());
        if (!databaseId && activeSection === 'all-leads' && databaseFilter) params.set('databaseId', databaseFilter);
        const data = await apiRequest<{ leads: LeadRecord[]; nextCursor: string | null }>(path + '?' + params.toString());
        records.push(...(data.leads || [])); cursor = data.nextCursor || ''; keepGoing = !!cursor;
      }
      const rows = records.map((lead) => ({
        name: lead.name || '', email: lead.email || '', mobile: lead.phone || '', company: lead.companyName || '',
        designation: lead.designation || '', website: lead.website || '', city: lead.city || '', country: lead.country || '',
        sourceDatabase: lead.sourceDatabaseName || '', sourceFile: lead.sourceFileName || '',
        ...Object.fromEntries(Object.entries(lead.customFields || {})),
      }));
      downloadCsv((databaseId ? (selectedDatabase?.name || 'database') : 'all-leads').replace(/[^a-z0-9-_]+/gi, '-') + '.csv', rows);
      setFeedback('Exported ' + formatNumber(records.length) + ' leads.');
    } catch (err: any) { setError(err?.message || 'Could not export leads.'); }
  };

  const latestImportCount = databases.filter((database) => database.updatedAt && Date.now() - new Date(database.updatedAt).getTime() < 7 * 86400000).length;
  const totalLeads = databases.reduce((sum, database) => sum + Number(database.totalLeads || 0), 0);
  const emailReady = databases.reduce((sum, database) => sum + Number(database.emailEligibleCount || 0), 0);
  const pageTitle = selectedDatabase && activeSection === 'databases' ? selectedDatabase.name : activeSection === 'all-leads' ? 'All leads' : 'Lead Database';

  const searchBar = (
    <div className="lead-db-search">
      <Search size={16} />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, company, mobile..." aria-label="Search leads" />
      {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}
    </div>
  );

  return (
    <div data-umrah360-module="database" className="lead-database-shell max-w-[1440px] mx-auto space-y-5">
      <div className="lead-db-page-heading">
        <div className="min-w-0">
          <div className="lead-db-eyebrow">WORKSPACE / DATA MANAGEMENT</div>
          <div className="flex items-center gap-3">
            {selectedDatabase && activeSection === 'databases' && <button className="lead-db-icon-button" onClick={() => { setSelectedDatabase(null); setSearch(''); setWorkspaceTab('leads'); }} title="Back to databases"><ArrowLeft size={17} /></button>}
            <div>
              <h1>{pageTitle}</h1>
              <p>{selectedDatabase && activeSection === 'databases' ? (selectedDatabase.description || 'Reusable lead collection for your campaign workflows.') : activeSection === 'all-leads' ? 'A searchable view of every saved lead across your workspace databases.' : 'Organise reusable lead lists, validate imports and select clean audiences for campaigns.'}</p>
            </div>
          </div>
        </div>
        <div className="lead-db-heading-actions">
          <button className="lead-db-button lead-db-button--secondary" onClick={refresh} disabled={isRefreshing}>{isRefreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Refresh</button>
          {selectedDatabase && activeSection === 'databases' ? <>
            <button className="lead-db-button lead-db-button--secondary" onClick={() => downloadAllLeads(selectedDatabase.databaseId, search)}><Download size={16} /> Export</button>
            <button className="lead-db-button lead-db-button--primary" onClick={() => openImport(selectedDatabase)}><Upload size={16} /> Import leads</button>
          </> : activeSection === 'databases' ? <button className="lead-db-button lead-db-button--primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Create database</button> :
            <button className="lead-db-button lead-db-button--secondary" onClick={() => downloadAllLeads(undefined, search)}><Download size={16} /> Export leads</button>}
        </div>
      </div>

      {error && <div className="lead-db-alert lead-db-alert--error"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError(null)}><X size={15} /></button></div>}
      {feedback && <div className="lead-db-alert lead-db-alert--success"><CheckCircle2 size={17} /><span>{feedback}</span><button onClick={() => setFeedback(null)}><X size={15} /></button></div>}

      {!selectedDatabase && activeSection === 'databases' && <>
        <div className="lead-db-stats-grid">
          <StatCard label="Saved databases" value={formatNumber(databases.length)} helper="Reusable lead collections" icon={DatabaseIcon} tone="orange" />
          <StatCard label="Total leads" value={formatNumber(totalLeads)} helper="Across all saved databases" icon={Users} tone="blue" />
          <StatCard label="Email-ready leads" value={formatNumber(emailReady)} helper="Valid email addresses" icon={FileCheck2} tone="green" />
          <StatCard label="Recently updated" value={formatNumber(latestImportCount)} helper="Databases updated in 7 days" icon={Clock3} tone="purple" />
        </div>
        <div className="lead-db-toolbar">
          <div className="lead-db-view-tabs">
            <button className="is-active" onClick={() => { setActiveSection('databases'); setSelectedDatabase(null); }}><DatabaseIcon size={15} /> Databases</button>
            <button onClick={() => { setActiveSection('all-leads'); setSelectedDatabase(null); setSearch(''); setDatabaseFilter(''); }}><Users size={15} /> All leads</button>
          </div>
          <span className="lead-db-muted-label">{databases.length} collections</span>
        </div>
        <div className="lead-db-panel overflow-hidden">
          <div className="lead-db-panel-heading">
            <div><h2>Your databases</h2><p>Open a collection to search, import, export and review campaign usage.</p></div>
            <div className="lead-db-search lead-db-search--compact"><Search size={16} /><input placeholder="Search databases" onChange={(event) => setDatabaseSearch(event.target.value)} value={databaseSearch} /></div>
          </div>
          {databases.length === 0 ? <div className="lead-db-empty">
            <div className="lead-db-empty-icon"><DatabaseIcon size={25} /></div><h3>No lead databases yet</h3>
            <p>Create a collection to keep lead lists organised and reuse them when launching campaigns.</p>
            <button className="lead-db-button lead-db-button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create your first database</button>
          </div> : <div className="overflow-x-auto">
            <table className="lead-db-table lead-db-database-table">
              <thead><tr><th>DATABASE</th><th>LEADS</th><th>EMAIL-READY</th><th>CAMPAIGNS</th><th>CREATED</th><th>LAST UPDATED</th><th className="text-right">ACTIONS</th></tr></thead>
              <tbody>{databases.filter((database) => (database.name + ' ' + (database.description || '')).toLowerCase().includes(databaseSearch.toLowerCase())).map((database) => (
                <tr key={database.databaseId}>
                  <td><button className="lead-db-database-name" onClick={() => openWorkspace(database)}>
                    <span className="lead-db-database-icon"><DatabaseIcon size={17} /></span>
                    <span className="min-w-0"><strong>{database.name}</strong><small>{database.description || 'No description added'}</small></span>
                  </button></td>
                  <td><strong>{formatNumber(database.totalLeads)}</strong></td>
                  <td><span className="lead-db-email-count">{formatNumber(database.emailEligibleCount)}</span></td>
                  <td>{formatNumber(campaignCounts[database.databaseId] || 0)}</td>
                  <td>{formatDate(database.createdAt)}</td><td>{formatDate(database.updatedAt)}</td>
                  <td><div className="lead-db-row-actions">
                    <button onClick={() => openWorkspace(database)} title="Open database"><ArrowRight size={15} /></button>
                    <button onClick={() => openImport(database)} title="Import leads"><Upload size={15} /></button>
                    <button onClick={() => openEdit(database)} title="Edit database"><Pencil size={15} /></button>
                    {isAdmin && <button className="is-danger" onClick={() => handleDeleteDatabase(database)} title="Delete database"><Trash2 size={15} /></button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
        </div>
        <div className="lead-db-footnote"><ShieldCheck size={14} /> Lead databases are workspace-scoped and separate from your CRM contacts. Campaign recipients are snapshotted when a campaign is created.</div>
      </>}

      {activeSection === 'all-leads' && <>
        <div className="lead-db-toolbar">
          <div className="lead-db-view-tabs">
            <button onClick={() => { setActiveSection('databases'); setSelectedDatabase(null); setSearch(''); }}><DatabaseIcon size={15} /> Databases</button>
            <button className="is-active"><Users size={15} /> All leads</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="lead-db-search lead-db-search--compact">{searchBar.props.children}</div>
            <label className="lead-db-filter"><Filter size={14} /><select value={databaseFilter} onChange={(event) => setDatabaseFilter(event.target.value)}><option value="">All databases</option>{databases.map((database) => <option key={database.databaseId} value={database.databaseId}>{database.name}</option>)}</select><ChevronDown size={13} /></label>
          </div>
        </div>
        <div className="lead-db-panel overflow-hidden">
          <div className="lead-db-panel-heading"><div><h2>All saved leads</h2><p>Search across saved collections without merging them into CRM.</p></div><span className="lead-db-muted-label">{leads.length} shown</span></div>
          <LeadTable leads={leads} allLeads loading={isLoading} />
          <Pagination nextCursor={nextCursor} loading={isLoadingMore} onMore={() => loadEntries(true)} />
        </div>
      </>}

      {selectedDatabase && activeSection === 'databases' && <>
        <div className="lead-db-workspace-summary">
          <div className="lead-db-workspace-summary-item"><span>LEADS IN DATABASE</span><strong>{formatNumber(selectedDatabase.totalLeads)}</strong></div>
          <div className="lead-db-workspace-summary-item"><span>EMAIL-READY</span><strong>{formatNumber(selectedDatabase.emailEligibleCount)}</strong></div>
          <div className="lead-db-workspace-summary-item"><span>WITHOUT VALID EMAIL</span><strong>{formatNumber(Math.max(0, selectedDatabase.totalLeads - selectedDatabase.emailEligibleCount))}</strong></div>
          <div className="lead-db-workspace-summary-note"><ShieldCheck size={15} /> Campaign recipient lists are copied at creation and do not change when this database is edited.</div>
        </div>
        <div className="lead-db-workspace-tabs">
          <button className={workspaceTab === 'leads' ? 'is-active' : ''} onClick={() => setWorkspaceTab('leads')}><Users size={15} /> Leads</button>
          <button className={workspaceTab === 'imports' ? 'is-active' : ''} onClick={() => setWorkspaceTab('imports')}><History size={15} /> Import history</button>
          <button className={workspaceTab === 'usage' ? 'is-active' : ''} onClick={() => setWorkspaceTab('usage')}><Zap size={15} /> Campaign usage</button>
          <button className={workspaceTab === 'settings' ? 'is-active' : ''} onClick={() => setWorkspaceTab('settings')}><Settings2 size={15} /> Settings</button>
        </div>

        {workspaceTab === 'leads' && <div className="lead-db-panel overflow-hidden">
          <div className="lead-db-panel-heading">
            <div><h2>Saved leads</h2><p>Search every record in this database. Missing email and mobile values remain empty.</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="lead-db-search lead-db-search--compact"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this database" /></div>
              <button className="lead-db-button lead-db-button--secondary" onClick={() => downloadAllLeads(selectedDatabase.databaseId, search)}><Download size={15} /> Export</button>
            </div>
          </div>
          <LeadTable leads={leads} loading={isLoading} />
          <Pagination nextCursor={nextCursor} loading={isLoadingMore} onMore={() => loadEntries(true)} />
        </div>}

        {workspaceTab === 'imports' && <div className="lead-db-panel overflow-hidden">
          <div className="lead-db-panel-heading"><div><h2>Import history</h2><p>Every upload is recorded with row-level duplicate and validation reports.</p></div><button className="lead-db-button lead-db-button--primary" onClick={() => openImport(selectedDatabase)}><Upload size={15} /> Import file</button></div>
          {imports.length === 0 ? <div className="lead-db-empty lead-db-empty--compact"><div className="lead-db-empty-icon"><History size={22} /></div><h3>No imports yet</h3><p>Import a CSV or Excel file to add leads to this database.</p></div> :
            <div className="overflow-x-auto"><table className="lead-db-table"><thead><tr><th>FILE</th><th>DATE</th><th>RECEIVED</th><th>ADDED</th><th>DUPLICATES</th><th>INVALID</th><th>STATUS</th><th>REPORTS</th></tr></thead><tbody>
              {imports.map((item) => <tr key={item.importId}>
                <td><div className="lead-db-file-name"><FileSpreadsheet size={16} /><span>{item.sourceFileName || 'Uploaded leads'}</span></div></td>
                <td>{formatDateTime(item.createdAt)}</td><td>{formatNumber(item.received)}</td><td><span className="lead-db-positive">{formatNumber(item.added)}</span></td>
                <td>{formatNumber(item.duplicatesSkipped)}</td><td>{formatNumber(item.invalidCount)}</td>
                <td><span className={statusClass(item.status || '')}>{item.status || 'UNKNOWN'}</span></td>
                <td><div className="lead-db-report-actions">
                  {(item.duplicateRows || []).length > 0 && <button onClick={() => downloadCsv('duplicate-rows-' + item.importId + '.csv', item.duplicateRows || [])}>Duplicates</button>}
                  {(item.invalidRows || []).length > 0 && <button onClick={() => downloadCsv('invalid-rows-' + item.importId + '.csv', item.invalidRows || [])}>Invalid rows</button>}
                  {!(item.duplicateRows || []).length && !(item.invalidRows || []).length && <span>—</span>}
                </div></td>
              </tr>)}
            </tbody></table></div>}
        </div>}

        {workspaceTab === 'usage' && <div className="lead-db-panel overflow-hidden">
          <div className="lead-db-panel-heading"><div><h2>Campaign usage</h2><p>Campaigns retain their own recipient snapshot, even when this database changes later.</p></div><span className="lead-db-muted-label">{campaignUsage.length} linked campaigns</span></div>
          {campaignUsage.length === 0 ? <div className="lead-db-empty lead-db-empty--compact"><div className="lead-db-empty-icon"><Zap size={22} /></div><h3>No campaigns use this database</h3><p>When you select this database while creating a campaign, its recipients are copied into that campaign.</p></div> :
            <div className="overflow-x-auto"><table className="lead-db-table"><thead><tr><th>CAMPAIGN</th><th>STATUS</th><th>SNAPSHOT RECIPIENTS</th><th>CREATED</th><th>LAST UPDATED</th></tr></thead><tbody>
              {campaignUsage.map((campaign) => <tr key={campaign.campaignId}><td><strong className="text-slate-800">{campaign.name}</strong></td><td><span className={statusClass(campaign.status)}>{campaign.status}</span></td><td>{typeof campaign.recipientCount === 'number' ? formatNumber(campaign.recipientCount) : 'Snapshot retained'}</td><td>{formatDate(campaign.createdAt)}</td><td>{formatDate(campaign.updatedAt)}</td></tr>)}
            </tbody></table></div>}
          <div className="lead-db-info-strip"><Info size={16} /><span>Deletion is blocked while draft, scheduled, running or paused campaigns depend on this database. Completed campaigns keep their own snapshot.</span></div>
        </div>}

        {workspaceTab === 'settings' && <div className="lead-db-panel lead-db-settings-panel">
          <div><h2>Database settings</h2><p>Update the label and description your workspace sees when selecting audiences.</p></div>
          <form className="lead-db-settings-form" onSubmit={(event) => { event.preventDefault(); openEdit(selectedDatabase); }}>
            <label>Database name<input readOnly value={selectedDatabase.name} /></label>
            <label>Description<textarea readOnly value={selectedDatabase.description || ''} rows={3} /></label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="lead-db-button lead-db-button--primary" onClick={() => openEdit(selectedDatabase)}><Pencil size={15} /> Edit details</button>
              {isAdmin && <button type="button" className="lead-db-button lead-db-button--danger" onClick={() => handleDeleteDatabase(selectedDatabase)}><Trash2 size={15} /> Delete database</button>}
            </div>
          </form>
          <div className="lead-db-info-strip"><ShieldCheck size={16} /><span>Only workspace administrators can delete databases. A database with active campaign dependencies cannot be deleted.</span></div>
        </div>}
      </>}

      {createOpen && <Modal title="Create a lead database" eyebrow="NEW COLLECTION" onClose={() => setCreateOpen(false)}>
        <form className="lead-db-modal-form" onSubmit={handleCreateDatabase}>
          <label>Database name<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Mumbai travel agencies" maxLength={100} required /></label>
          <label>Description <span className="lead-db-optional">Optional</span><textarea rows={3} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="What type of leads does this collection contain?" maxLength={500} /></label>
          <div className="lead-db-modal-note"><Info size={15} /> Databases are separate from CRM contacts. You can import leads after creating the collection.</div>
          <div className="lead-db-modal-actions"><button type="button" className="lead-db-button lead-db-button--secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="lead-db-button lead-db-button--primary" disabled={isCreating || !newName.trim()}>{isCreating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create database</button></div>
        </form>
      </Modal>}

      {editingDatabase && <Modal title="Edit database details" eyebrow="COLLECTION SETTINGS" onClose={() => setEditingDatabase(null)}>
        <form className="lead-db-modal-form" onSubmit={saveDatabaseDetails}>
          <label>Database name<input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={100} required /></label>
          <label>Description <span className="lead-db-optional">Optional</span><textarea rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={500} /></label>
          <div className="lead-db-modal-actions"><button type="button" className="lead-db-button lead-db-button--secondary" onClick={() => setEditingDatabase(null)}>Cancel</button><button type="submit" className="lead-db-button lead-db-button--primary" disabled={isSavingDetails || !editName.trim()}>{isSavingDetails ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save changes</button></div>
        </form>
      </Modal>}

      {importOpen && importTarget && <Modal title="Import leads" eyebrow={importTarget.name.toUpperCase()} onClose={closeImport} wide>
        <div className="lead-db-wizard-steps">
          {['Upload file', 'Map columns', 'Review rows', 'Import report'].map((label, index) => <div className={'lead-db-wizard-step ' + (wizardStep === index + 1 ? 'is-active' : wizardStep > index + 1 ? 'is-done' : '')} key={label}><span>{wizardStep > index + 1 ? <Check size={13} /> : index + 1}</span><small>{label}</small></div>)}
        </div>

        {wizardStep === 1 && <div className="lead-db-wizard-body">
          <div className="lead-db-upload-drop" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFileSelected(event.dataTransfer.files?.[0]); }}>
            <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(event) => { void handleFileSelected(event.target.files?.[0]); event.target.value = ''; }} />
            <div className="lead-db-upload-icon"><Upload size={24} /></div>
            <strong>{importFile ? importFile.name : 'Choose a CSV or Excel file'}</strong>
            <span>{importFile ? (formatNumber(Math.ceil(importFile.size / 1024)) + ' KB · ' + (workbook?.SheetNames?.length || 1) + ' worksheet(s)') : 'Drag and drop here, or browse from your computer'}</span>
            <button type="button" className="lead-db-button lead-db-button--secondary" onClick={(event) => { event.stopPropagation(); fileRef.current?.click(); }}>{importFile ? 'Replace file' : 'Browse files'}</button>
          </div>
          <div className="lead-db-upload-foot"><span><FileSpreadsheet size={14} /> CSV, XLS or XLSX</span><span>Maximum 10 MB</span><span>Up to 2,000 rows per import</span></div>
          {workbook && <div className="lead-db-sheet-options">
            <label>Worksheet<select value={sheetName} onChange={(event) => { setSheetName(event.target.value); prepareSheet(workbook, event.target.value, hasHeader); }}>{workbook.SheetNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="lead-db-toggle"><input type="checkbox" checked={hasHeader} onChange={(event) => { setHasHeader(event.target.checked); prepareSheet(workbook, sheetName, event.target.checked); }} /> First row contains column headers</label>
          </div>}
          <div className="lead-db-modal-actions"><button type="button" className="lead-db-button lead-db-button--secondary" onClick={closeImport}>Cancel</button><button type="button" className="lead-db-button lead-db-button--primary" onClick={() => setWizardStep(2)} disabled={!importFile || !headers.length || isPreparingFile}>{isPreparingFile ? <Loader2 size={15} className="animate-spin" /> : <>Continue <ArrowRight size={15} /></>}</button></div>
        </div>}

        {wizardStep === 2 && <div className="lead-db-wizard-body">
          <div className="lead-db-wizard-intro"><div><h3>Match your spreadsheet columns</h3><p>We’ve matched common column names automatically. Review the fields below or choose a different source column.</p></div><span>{formatNumber(sheetRows.length)} rows detected</span></div>
          <div className="lead-db-mapping-grid">
            {FIELDS.map(({ key, label }) => <label key={key}><span>{label}{['name', 'email', 'phone', 'companyName'].includes(key) && <em>Identity</em>}</span><select value={mapping[key]} onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value }))}><option value="">Do not map</option>{headers.map((header, index) => <option key={index} value={String(index)}>{header || ('Column ' + (index + 1))}</option>)}</select></label>)}
          </div>
          <div className="lead-db-info-strip"><Info size={16} /><span>Unmapped columns are preserved as custom fields. Missing email or mobile values stay blank; no placeholder contact details are generated.</span></div>
          <div className="lead-db-modal-actions"><button type="button" className="lead-db-button lead-db-button--secondary" onClick={() => setWizardStep(1)}><ChevronLeft size={15} /> Back</button><button type="button" className="lead-db-button lead-db-button--primary" onClick={handlePreview} disabled={isValidating || !sheetRows.length}>{isValidating ? <><Loader2 size={15} className="animate-spin" /> Checking rows</> : <>Review rows <ArrowRight size={15} /></>}</button></div>
        </div>}

        {wizardStep === 3 && preview && <div className="lead-db-wizard-body">
          <div className="lead-db-wizard-intro"><div><h3>Review before importing</h3><p>Duplicate checks include existing records in this database and repeated identities in the uploaded file.</p></div><span>{importFile?.name}</span></div>
          <div className="lead-db-preview-stats">
            <div><small>Ready to add</small><strong className="is-green">{formatNumber(preview.readyCount)}</strong></div>
            <div><small>Duplicates to skip</small><strong className="is-amber">{formatNumber(preview.duplicateCount)}</strong></div>
            <div><small>Invalid rows</small><strong className="is-red">{formatNumber(preview.invalidCount)}</strong></div>
            <div><small>Total rows</small><strong>{formatNumber(preview.received)}</strong></div>
          </div>
          <div className="lead-db-preview-table"><table className="lead-db-table"><thead><tr><th>ROW</th><th>NAME</th><th>EMAIL</th><th>MOBILE</th><th>COMPANY</th></tr></thead><tbody>
            {mappedRows.slice(0, 8).map((row: any) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.name || '—'}</td><td>{row.email || '—'}</td><td>{row.phone || '—'}</td><td>{row.companyName || '—'}</td></tr>)}
          </tbody></table></div>
          <div className="lead-db-preview-notes"><span><CheckCircle2 size={14} /> {formatNumber(preview.readyCount)} rows ready</span><span><AlertCircle size={14} /> {formatNumber(preview.duplicateCount)} duplicates will be skipped</span><span><AlertCircle size={14} /> {formatNumber(preview.invalidCount)} invalid rows will be excluded</span></div>
          <div className="lead-db-modal-actions"><button type="button" className="lead-db-button lead-db-button--secondary" onClick={() => setWizardStep(2)}><ChevronLeft size={15} /> Back to mapping</button><button type="button" className="lead-db-button lead-db-button--primary" onClick={handleImport} disabled={isImporting || preview.readyCount === 0}>{isImporting ? <><Loader2 size={15} className="animate-spin" /> Importing</> : <>Import {formatNumber(preview.readyCount)} leads <ArrowRight size={15} /></>}</button></div>
        </div>}

        {wizardStep === 4 && importResult && <div className="lead-db-wizard-body">
          <div className="lead-db-import-success"><div><CheckCircle2 size={27} /></div><h3>Import finished</h3><p>{formatNumber(importResult.added)} new leads were added to {importTarget.name}.</p></div>
          <div className="lead-db-preview-stats">
            <div><small>Added</small><strong className="is-green">{formatNumber(importResult.added)}</strong></div>
            <div><small>Duplicates skipped</small><strong className="is-amber">{formatNumber(importResult.duplicatesSkipped)}</strong></div>
            <div><small>Invalid rows</small><strong className="is-red">{formatNumber(importResult.invalidCount)}</strong></div>
            <div><small>Total in database</small><strong>{formatNumber(importResult.totalLeads)}</strong></div>
          </div>
          <div className="lead-db-report-downloads">
            {importResult.duplicates?.length > 0 && <button onClick={() => downloadCsv('duplicate-rows.csv', importResult.duplicates)}><Download size={15} /> Download duplicates ({importResult.duplicates.length})</button>}
            {importResult.invalidRows?.length > 0 && <button onClick={() => downloadCsv('invalid-rows.csv', importResult.invalidRows)}><Download size={15} /> Download invalid rows ({importResult.invalidRows.length})</button>}
            {!(importResult.duplicates?.length) && !(importResult.invalidRows?.length) && <span><CheckCircle2 size={15} /> No duplicates or invalid rows detected.</span>}
          </div>
          <div className="lead-db-info-strip"><ShieldCheck size={16} /><span>The import report is saved in this database’s Import history. Campaign snapshots already created from this database are unchanged.</span></div>
          <div className="lead-db-modal-actions"><button type="button" className="lead-db-button lead-db-button--primary" onClick={closeImport}>Done</button></div>
        </div>}
      </Modal>}
    </div>
  );
};

const LeadTable: React.FC<{ leads: LeadRecord[]; allLeads?: boolean; loading?: boolean }> = ({ leads, allLeads = false, loading = false }) => {
  const customColumns = Array.from(new Set(leads.flatMap((lead) => Object.keys(lead.customFields || {})))).slice(0, 3);
  if (loading && !leads.length) return <div className="lead-db-table-loading"><Loader2 size={20} className="animate-spin" /> Loading leads…</div>;
  if (!leads.length) return <div className="lead-db-empty lead-db-empty--compact"><div className="lead-db-empty-icon"><Users size={22} /></div><h3>No leads found</h3><p>Try a different search or import a CSV / Excel file into this database.</p></div>;
  return (
    <div className="overflow-x-auto"><table className="lead-db-table">
      <thead><tr><th>LEAD</th><th>CONTACT</th><th>COMPANY</th>{customColumns.map((column) => <th key={column}>{column.toUpperCase()}</th>)}{allLeads && <th>SOURCE DATABASE</th>}<th>ADDED</th></tr></thead>
      <tbody>{leads.map((lead) => <tr key={lead.entryId}>
        <td><div className="lead-db-person"><div className="lead-db-avatar">{(lead.name || lead.email || 'L').trim().charAt(0).toUpperCase()}</div><div className="min-w-0"><div className="lead-db-person-name">{lead.name || 'Name not provided'}</div><div className="lead-db-person-meta">{lead.designation || 'Lead record'}</div></div></div></td>
        <td><div className="lead-db-cell-main">{lead.email || '—'}</div><div className="lead-db-cell-sub">{lead.phone || 'No mobile number'}</div></td>
        <td><div className="lead-db-cell-main">{lead.companyName || '—'}</div><div className="lead-db-cell-sub">{[lead.city, lead.country].filter(Boolean).join(', ') || '—'}</div></td>
        {customColumns.map((column) => <td key={column}><div className="lead-db-cell-main">{lead.customFields?.[column] || '—'}</div></td>)}
        {allLeads && <td><span className="lead-db-source"><DatabaseIcon size={13} />{lead.sourceDatabaseName || 'Unknown database'}</span></td>}
        <td><div className="lead-db-cell-main">{formatDate(lead.createdAt)}</div><div className="lead-db-cell-sub">{lead.sourceFileName || 'Manual import'}</div></td>
      </tr>)}</tbody>
    </table></div>
  );
};

const Pagination: React.FC<{ nextCursor: string | null; loading: boolean; onMore: () => void }> = ({ nextCursor, loading, onMore }) => (
  <div className="lead-db-pagination"><span>Records are loaded 50 at a time</span>{nextCursor ? <button onClick={onMore} disabled={loading}>{loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={15} />} Load more</button> : <span className="lead-db-end-of-list">End of list</span>}</div>
);
const Modal: React.FC<{ title: string; eyebrow: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, eyebrow, onClose, wide = false, children }) => (
  <div className="lead-db-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={'lead-db-modal ' + (wide ? 'lead-db-modal--wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><span>{eyebrow}</span><h2>{title}</h2></div><button onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>{children}
    </section>
  </div>
);

export default LeadDatabase;
