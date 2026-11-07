import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database as DatabaseIcon,
  FileSpreadsheet,
  History,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';

type DatabaseSummary = {
  databaseId: string;
  name: string;
  description?: string;
  totalLeads: number;
  emailEligibleCount: number;
  createdAt: string;
  updatedAt: string;
};

type LeadRecord = {
  entryId: string;
  databaseId: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  designation?: string;
  city?: string;
  country?: string;
  sourceDatabaseName?: string;
  sourceFileName?: string;
  createdAt?: string;
};

type ImportRecord = {
  importId: string;
  sourceFileName?: string;
  received?: number;
  added?: number;
  duplicatesSkipped?: number;
  invalidCount?: number;
  status?: string;
  createdAt?: string;
};

type Props = { isAdmin?: boolean; tenantId?: string };

const PAGE_SIZE = 50;

async function apiRequest<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function parseLeadSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Please upload a file smaller than 10 MB.');
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The spreadsheet does not contain a worksheet.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];
  if (!rows.length) throw new Error('The uploaded file is empty.');

  const knownHeaders = new Set([
    'name', 'fullname', 'contactname', 'leadname', 'firstname', 'lastname',
    'email', 'emailaddress', 'emailid', 'mail',
    'phone', 'phonenumber', 'mobile', 'mobilenumber', 'whatsapp', 'contactno',
    'company', 'companyname', 'organization', 'organisation', 'business', 'businessname',
    'website', 'url', 'designation', 'jobtitle', 'title', 'city', 'country', 'location',
  ]);
  const firstRow = (rows[0] || []).map(normalizeHeader);
  const hasHeader = firstRow.some((header) => knownHeaders.has(header));
  const headers = hasHeader
    ? (rows[0] || []).map((value, index) => String(value || `Column ${index + 1}`).trim())
    : ['Email', 'Name', 'Company', 'Mobile', 'Website', 'Designation', 'City', 'Country'];
  const dataRows = (hasHeader ? rows.slice(1) : rows).filter((row) =>
    Array.isArray(row) && row.some((value) => String(value ?? '').trim() !== ''),
  );
  if (!dataRows.length) throw new Error('The spreadsheet contains no lead rows.');

  const aliases: Record<string, string[]> = {
    name: ['name', 'fullname', 'contactname', 'leadname'],
    firstName: ['firstname'],
    lastName: ['lastname'],
    email: ['email', 'emailaddress', 'emailid', 'mail'],
    phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'whatsapp', 'contactno'],
    companyName: ['company', 'companyname', 'organization', 'organisation', 'business', 'businessname'],
    website: ['website', 'url'],
    designation: ['designation', 'jobtitle', 'title'],
    city: ['city', 'location'],
    country: ['country'],
  };
  const headerIndexes = headers.map(normalizeHeader);
  const mappedIndex = (key: string) => headerIndexes.findIndex((header) => (aliases[key] || []).includes(header));
  const indexes = Object.fromEntries(Object.keys(aliases).map((key) => [key, mappedIndex(key)])) as Record<string, number>;
  const read = (row: unknown[], key: string) => indexes[key] >= 0 ? String(row[indexes[key]] ?? '').trim() : '';

  const known = new Set(Object.values(aliases).flat());
  return dataRows.map((row, index) => {
    const name = read(row, 'name') || [read(row, 'firstName'), read(row, 'lastName')].filter(Boolean).join(' ');
    const customFields: Record<string, string> = {};
    headers.forEach((header, colIndex) => {
      const key = normalizeHeader(header);
      const value = String(row[colIndex] ?? '').trim();
      if (value && !known.has(key)) customFields[header] = value;
    });
    return {
      rowNumber: index + (hasHeader ? 2 : 1),
      name,
      email: read(row, 'email'),
      phone: read(row, 'phone'),
      companyName: read(row, 'companyName'),
      website: read(row, 'website'),
      designation: read(row, 'designation'),
      city: read(row, 'city'),
      country: read(row, 'country'),
      customFields,
    };
  });
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export const LeadDatabase: React.FC<Props> = ({ isAdmin = false, tenantId = '' }) => {
  const [activeSection, setActiveSection] = useState<'databases' | 'all-leads'>('databases');
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<DatabaseSummary | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [importTarget, setImportTarget] = useState<DatabaseSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const addFileRef = useRef<HTMLInputElement>(null);

  const loadDatabases = useCallback(async () => {
    const data = await apiRequest<{ databases: DatabaseSummary[] }>('/api/lead-databases');
    setDatabases(data.databases || []);
  }, []);

  const loadEntries = useCallback(async (databaseId: string | null, cursor?: string, append = false) => {
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);
    try {
      const base = databaseId
        ? `/api/lead-databases/${encodeURIComponent(databaseId)}/leads`
        : '/api/lead-databases/leads';
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      const data = await apiRequest<{ leads: LeadRecord[]; nextCursor: string | null }>(`${base}?${params.toString()}`);
      setLeads((current) => append ? [...current, ...(data.leads || [])] : (data.leads || []));
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      setError(err?.message || 'Could not load leads.');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setSelectedDatabase(null);
    setDatabases([]);
    setLeads([]);
    setImports([]);
    setSearch('');
    loadDatabases().catch((err) => setError(err?.message || 'Could not load databases.'));
  }, [tenantId, loadDatabases]);

  useEffect(() => {
    if (activeSection === 'all-leads') {
      setSelectedDatabase(null);
      loadEntries(null);
    } else if (selectedDatabase) {
      loadEntries(selectedDatabase.databaseId);
      apiRequest<{ imports: ImportRecord[] }>(`/api/lead-databases/${encodeURIComponent(selectedDatabase.databaseId)}/imports`)
        .then((data) => setImports(data.imports || []))
        .catch(() => setImports([]));
    } else {
      setLeads([]);
      setImports([]);
    }
  }, [tenantId, activeSection, selectedDatabase?.databaseId, loadEntries]);

  const handleCreateDatabase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) {
      setError('Enter a database name.');
      return;
    }
    setIsCreating(true);
    setError(null);
    setFeedback(null);
    try {
      const rows = initialFile ? await parseLeadSpreadsheet(initialFile) : [];
      const data = await apiRequest<{ database: DatabaseSummary; importResult?: any }>('/api/lead-databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          sourceFileName: initialFile?.name || '',
          rows,
        }),
      });
      setIsCreateOpen(false);
      setNewName('');
      setNewDescription('');
      setInitialFile(null);
      await loadDatabases();
      setSelectedDatabase(data.database);
      setActiveSection('databases');
      if (data.importResult) {
        const result = data.importResult;
        setFeedback(`Added ${result.added} leads. Skipped ${result.duplicatesSkipped} duplicates and ${result.invalidCount} invalid rows.`);
      } else {
        setFeedback('Database created. You can now add leads.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not create the database.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !importTarget) return;
    setIsImporting(true);
    setError(null);
    setFeedback(null);
    try {
      const rows = await parseLeadSpreadsheet(file);
      const result = await apiRequest<any>(`/api/lead-databases/${encodeURIComponent(importTarget.databaseId)}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFileName: file.name, rows }),
      });
      setFeedback(`Added ${result.added} leads. Skipped ${result.duplicatesSkipped} duplicates and ${result.invalidCount} invalid rows.`);
      await loadDatabases();
      await loadEntries(importTarget.databaseId);
      const history = await apiRequest<{ imports: ImportRecord[] }>(`/api/lead-databases/${encodeURIComponent(importTarget.databaseId)}/imports`);
      setImports(history.imports || []);
    } catch (err: any) {
      setError(err?.message || 'Could not import leads.');
    } finally {
      setIsImporting(false);
      setImportTarget(null);
    }
  };

  const handleDeleteDatabase = async (database: DatabaseSummary) => {
    if (!window.confirm(`Delete "${database.name}" and all ${database.totalLeads} saved leads? This cannot be undone.`)) return;
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/lead-databases/${encodeURIComponent(database.databaseId)}`, { method: 'DELETE' });
      setDatabases((current) => current.filter((item) => item.databaseId !== database.databaseId));
      if (selectedDatabase?.databaseId === database.databaseId) setSelectedDatabase(null);
      setFeedback(`"${database.name}" was deleted.`);
    } catch (err: any) {
      setError(err?.message || 'Could not delete the database.');
    }
  };

  const filteredLeads = leads.filter((lead) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [lead.name, lead.email, lead.phone, lead.companyName, lead.sourceDatabaseName]
      .some((value) => String(value || '').toLowerCase().includes(term));
  });

  const tableTitle = activeSection === 'all-leads' ? 'All Leads' : selectedDatabase?.name || 'Database Leads';

  return (
    <div data-umrah360-module="database" className="max-w-7xl mx-auto space-y-5 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <DatabaseIcon className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-extrabold text-slate-900">Database</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">Store reusable lead lists and use them in campaigns without re-uploading files.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadDatabases().catch((err) => setError(err?.message || 'Refresh failed'))} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setIsCreateOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-sm">
            <Plus className="w-4 h-4" /> New Database
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => { setActiveSection('databases'); setSelectedDatabase(null); setSearch(''); }} className={`px-4 py-2.5 text-xs font-bold border-b-2 ${activeSection === 'databases' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          <DatabaseIcon className="w-4 h-4 inline mr-1.5" /> Databases
        </button>
        <button onClick={() => { setActiveSection('all-leads'); setSelectedDatabase(null); setSearch(''); }} className={`px-4 py-2.5 text-xs font-bold border-b-2 ${activeSection === 'all-leads' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          <Users className="w-4 h-4 inline mr-1.5" /> All Leads
        </button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}
      {feedback && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />{feedback}</div>}

      {activeSection === 'databases' && !selectedDatabase && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Saved databases</p>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">{databases.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Total saved leads</p>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">{databases.reduce((sum, item) => sum + (item.totalLeads || 0), 0).toLocaleString()}</p>
            </div>
          </div>
          {databases.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center">
              <DatabaseIcon className="w-10 h-10 mx-auto text-slate-300" />
              <h3 className="font-bold text-slate-800 mt-3">No databases yet</h3>
              <p className="text-xs text-slate-500 mt-1">Create a database and upload your first CSV or Excel lead list.</p>
              <button onClick={() => setIsCreateOpen(true)} className="mt-4 px-4 py-2 rounded-lg bg-orange-500 text-white text-xs font-bold"><Plus className="w-3.5 h-3.5 inline mr-1" /> Create Database</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {databases.map((database) => (
                <div key={database.databaseId} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-orange-50 text-orange-600"><DatabaseIcon className="w-5 h-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-900 truncate">{database.name}</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">{formatDate(database.createdAt)}</p>
                    </div>
                  </div>
                  {database.description && <p className="text-xs text-slate-600 mt-3 line-clamp-2">{database.description}</p>}
                  <div className="flex gap-4 mt-4 text-xs">
                    <span className="font-bold text-slate-900">{database.totalLeads.toLocaleString()} <span className="font-normal text-slate-500">leads</span></span>
                    <span className="font-bold text-slate-900">{database.emailEligibleCount.toLocaleString()} <span className="font-normal text-slate-500">email-ready</span></span>
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                    <button onClick={() => { setSelectedDatabase(database); setSearch(''); }} className="text-xs font-bold text-orange-600 hover:text-orange-700">View leads</button>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setImportTarget(database); addFileRef.current?.click(); }} disabled={isImporting} className="text-xs font-semibold text-slate-600 hover:text-orange-600"><Upload className="w-3.5 h-3.5 inline mr-1" />Add leads</button>
                      {isAdmin && <button onClick={() => handleDeleteDatabase(database)} className="p-1.5 text-slate-400 hover:text-rose-600" title="Delete database"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(activeSection === 'all-leads' || selectedDatabase) && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {selectedDatabase && <button onClick={() => { setSelectedDatabase(null); setSearch(''); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Back to databases"><ArrowLeft className="w-4 h-4" /></button>}
              <div>
                <h3 className="font-extrabold text-slate-900">{tableTitle}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">{selectedDatabase ? `${selectedDatabase.totalLeads.toLocaleString()} leads in this database` : 'Leads from every saved database in one table'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded rows..." className="pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs w-52 focus:outline-none focus:ring-2 focus:ring-orange-100" />
              </div>
              {selectedDatabase && <button onClick={() => { setImportTarget(selectedDatabase); addFileRef.current?.click(); }} disabled={isImporting} className="px-3 py-2 rounded-lg bg-orange-500 text-white text-xs font-bold"><Upload className="w-3.5 h-3.5 inline mr-1" />Add Leads</button>}
              <button onClick={() => loadEntries(selectedDatabase?.databaseId || null)} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="Refresh leads"><RefreshCw className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-xs text-slate-500">Loading leads…</div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">No leads found in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase tracking-wide text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Mobile</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Designation</th>
                    <th className="px-4 py-3">Source Database</th>
                    <th className="px-4 py-3">Date Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLeads.map((lead) => (
                    <tr key={lead.entryId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold text-slate-900">{lead.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{lead.email || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{lead.phone || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{lead.companyName || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{lead.designation || '—'}</td>
                      <td className="px-4 py-3"><span className="px-2 py-1 rounded-md bg-orange-50 text-orange-700 font-semibold">{lead.sourceDatabaseName || selectedDatabase?.name || '—'}</span></td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(lead.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Showing {filteredLeads.length} of {leads.length} loaded rows{nextCursor ? ' · More available' : ''}</span>
            {nextCursor && <button onClick={() => loadEntries(selectedDatabase?.databaseId || null, nextCursor, true)} disabled={isLoadingMore} className="px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{isLoadingMore ? 'Loading…' : 'Load More'}</button>}
          </div>
        </div>
      )}

      {selectedDatabase && activeSection === 'databases' && imports.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-2"><History className="w-4 h-4 text-orange-500" />Import history</h4>
          <div className="mt-3 divide-y divide-slate-100">
            {imports.slice(0, 5).map((item) => (
              <div key={item.importId} className="py-2 flex items-center justify-between gap-3 text-[11px]">
                <span className="text-slate-700 truncate">{item.sourceFileName || 'Uploaded leads'} · {formatDate(item.createdAt)}</span>
                <span className="text-slate-500 shrink-0">{item.added || 0} added · {item.duplicatesSkipped || 0} duplicates · {item.invalidCount || 0} invalid</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <input ref={addFileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleAddFile} />

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateDatabase} className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div><h3 className="font-extrabold text-slate-900">Create Database</h3><p className="text-xs text-slate-500 mt-1">Create a reusable lead list and optionally upload its first spreadsheet.</p></div>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-xs font-semibold text-slate-700 mb-1.5">Database Name *</label><input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={100} required placeholder="e.g. Umrah Travel Agencies" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100" /></div>
              <div><label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label><textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={500} rows={2} placeholder="Optional description for this lead database" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-100" /></div>
              <div><label className="block text-xs font-semibold text-slate-700 mb-1.5">Initial lead file (optional)</label><input type="file" accept=".csv,.xls,.xlsx" onChange={(event) => setInitialFile(event.target.files?.[0] || null)} className="w-full text-xs text-slate-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-700 file:font-semibold" /><p className="text-[11px] text-slate-500 mt-1">CSV, XLS or XLSX · up to 10 MB · up to 2,000 rows per import.</p></div>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={isCreating} className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold disabled:opacity-50">{isCreating ? 'Creating…' : 'Create Database'}</button>
            </div>
          </form>
        </div>
      )}
      {isImporting && <div className="text-xs text-slate-500">Importing leads and checking duplicates…</div>}
    </div>
  );
};

export default LeadDatabase;
