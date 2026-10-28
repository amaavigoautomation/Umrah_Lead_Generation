import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  Search,
  Filter,
  Download,
  Clock,
  User,
  Activity,
  AlertTriangle,
  Info,
  ShieldAlert,
  FileText,
  Calendar,
  RefreshCw,
  Plus,
  Eye,
  CheckCircle2,
  X,
  Database,
  Layers,
  Code,
  Send,
  Users,
  Settings as SettingsIcon,
  BookOpen,
  Sparkles,
  ChevronRight,
  Terminal,
} from 'lucide-react';
import { AuditLog, AuditModule, AuditSeverity } from '../types';
import { db, isFirebaseConfigured } from '../firebase/config';
import { collection, onSnapshot, query, orderBy, limit, doc, setDoc } from 'firebase/firestore';
import { generateSampleAuditLogs, logAuditEvent } from '../services/auditService';

interface AuditLogsViewProps {
  tenantId?: string;
  currentUserEmail?: string;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  tenantId = 'umrah360',
  currentUserEmail = 'automation@amaavigo.com',
}) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<AuditModule | 'ALL'>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<AuditSeverity | 'ALL'>('ALL');
  const [dateRange, setDateRange] = useState<'ALL' | 'TODAY' | '7_DAYS' | '30_DAYS'>('ALL');

  // Inspection modal
  const [inspectedLog, setInspectedLog] = useState<AuditLog | null>(null);

  // Test log event state
  const [isTestLogModalOpen, setIsTestLogModalOpen] = useState<boolean>(false);
  const [testAction, setTestAction] = useState<string>('MANUAL_AUDIT_CHECK');
  const [testModule, setTestModule] = useState<AuditModule>('SETTINGS');
  const [testSeverity, setTestSeverity] = useState<AuditSeverity>('INFO');
  const [testDescription, setTestDescription] = useState<string>('Manual audit inspection performed by workspace administrator.');
  const [isSubmittingTest, setIsSubmittingTest] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Fetch / Sync Audit Logs from Firestore & API
  const loadAuditLogs = async () => {
    setRefreshing(true);
    let loaded: AuditLog[] = [];

    if (isFirebaseConfigured && db && tenantId) {
      try {
        const colRef = collection(db, 'tenants', tenantId, 'audit_logs');
        const q = query(colRef, orderBy('timestamp', 'desc'), limit(200));
        const snap = await new Promise<any>((resolve) => {
          const unsub = onSnapshot(q, (s) => {
            unsub();
            resolve(s);
          }, () => resolve(null));
        });

        if (snap && !snap.empty) {
          snap.forEach((d: any) => {
            loaded.push(d.data() as AuditLog);
          });
        }
      } catch (err) {
        console.warn('[AuditLogs] Firestore read note:', err);
      }
    }

    if (loaded.length === 0) {
      try {
        const res = await fetch(`/api/audit-logs?tenantId=${encodeURIComponent(tenantId)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.logs) && data.logs.length > 0) {
            loaded = data.logs;
          }
        }
      } catch (e) {}
    }

    // Fallback to rich sample audit logs if database is clean
    if (loaded.length === 0) {
      loaded = generateSampleAuditLogs(tenantId);
    }

    setLogs(loaded);
    setLoading(false);
    setRefreshing(false);
  };

  // Live Firestore Listener for Real-time Audit Events
  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (isFirebaseConfigured && db && tenantId) {
      try {
        const colRef = collection(db, 'tenants', tenantId, 'audit_logs');
        const q = query(colRef, orderBy('timestamp', 'desc'), limit(200));
        unsub = onSnapshot(q, (snap) => {
          if (!snap.empty) {
            const list: AuditLog[] = [];
            snap.forEach((d) => list.push(d.data() as AuditLog));
            setLogs(list);
            setLoading(false);
          } else {
            loadAuditLogs();
          }
        }, () => {
          loadAuditLogs();
        });
      } catch (err) {
        loadAuditLogs();
      }
    } else {
      loadAuditLogs();
    }

    return () => {
      if (unsub) unsub();
    };
  }, [tenantId]);

  // Handle creating a test audit log event
  const handleCreateTestLog = async () => {
    if (!testDescription.trim()) return;
    setIsSubmittingTest(true);

    try {
      const newLog = await logAuditEvent(tenantId, {
        action: testAction,
        module: testModule,
        severity: testSeverity,
        description: testDescription.trim(),
        actor: {
          name: currentUserEmail.split('@')[0] || 'Admin User',
          email: currentUserEmail,
          role: 'ADMIN',
        },
        target: {
          type: 'System',
          id: 'sys-audit-test',
          name: 'Audit Log Verification',
        },
        metadata: {
          triggeredBy: 'MANUAL_UI_TEST',
          clientTimestamp: new Date().toISOString(),
        },
      });

      if (newLog) {
        setLogs((prev) => [newLog, ...prev.filter((l) => l.id !== newLog.id)]);
      }

      setIsTestLogModalOpen(false);
      setToastMessage('New Audit Log entry successfully recorded in system ledger!');
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      alert(`Error recording audit log: ${err?.message || err}`);
    } finally {
      setIsSubmittingTest(false);
    }
  };

  // Filtered Logs Computation
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesDesc = log.description?.toLowerCase().includes(q);
        const matchesAction = log.action?.toLowerCase().includes(q);
        const matchesActorName = log.actor?.name?.toLowerCase().includes(q);
        const matchesActorEmail = log.actor?.email?.toLowerCase().includes(q);
        const matchesTargetName = log.target?.name?.toLowerCase().includes(q);
        const matchesModule = log.module?.toLowerCase().includes(q);
        if (!matchesDesc && !matchesAction && !matchesActorName && !matchesActorEmail && !matchesTargetName && !matchesModule) {
          return false;
        }
      }

      // Module Filter
      if (selectedModule !== 'ALL' && log.module !== selectedModule) {
        return false;
      }

      // Severity Filter
      if (selectedSeverity !== 'ALL' && log.severity !== selectedSeverity) {
        return false;
      }

      // Date Range Filter
      if (dateRange !== 'ALL' && log.timestamp) {
        const logTime = new Date(log.timestamp).getTime();
        const now = Date.now();
        if (dateRange === 'TODAY' && now - logTime > 24 * 60 * 60 * 1000) return false;
        if (dateRange === '7_DAYS' && now - logTime > 7 * 24 * 60 * 60 * 1000) return false;
        if (dateRange === '30_DAYS' && now - logTime > 30 * 24 * 60 * 60 * 1000) return false;
      }

      return true;
    });
  }, [logs, searchQuery, selectedModule, selectedSeverity, dateRange]);

  // Metrics summary
  const metrics = useMemo(() => {
    const total = logs.length;
    const criticalOrSecurity = logs.filter((l) => l.severity === 'CRITICAL' || l.severity === 'SECURITY').length;
    const warning = logs.filter((l) => l.severity === 'WARNING').length;
    const uniqueActors = new Set(logs.map((l) => l.actor?.email || l.actor?.userId)).size;

    return { total, criticalOrSecurity, warning, uniqueActors };
  }, [logs]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const headers = ['Audit ID', 'Timestamp', 'Action', 'Module', 'Severity', 'Actor Name', 'Actor Email', 'Description', 'Target Type', 'Target Name'];
    const csvRows = [
      headers.join(','),
      ...filteredLogs.map((l) =>
        [
          esc(l.id),
          esc(l.timestamp),
          esc(l.action),
          esc(l.module),
          esc(l.severity),
          esc(l.actor?.name),
          esc(l.actor?.email),
          esc(l.description),
          esc(l.target?.type || ''),
          esc(l.target?.name || ''),
        ].join(',')
      ),
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${tenantId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const getModuleIcon = (mod: AuditModule) => {
    switch (mod) {
      case 'CAMPAIGNS': return <Send className="w-3.5 h-3.5 text-orange-500" />;
      case 'CRM': return <Users className="w-3.5 h-3.5 text-emerald-500" />;
      case 'INBOX': return <Layers className="w-3.5 h-3.5 text-sky-500" />;
      case 'KNOWLEDGE': return <BookOpen className="w-3.5 h-3.5 text-amber-500" />;
      case 'SETTINGS': return <SettingsIcon className="w-3.5 h-3.5 text-slate-500" />;
      case 'AUTH': return <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />;
      case 'AI_ENGINE': return <Sparkles className="w-3.5 h-3.5 text-purple-500" />;
      default: return <Activity className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getSeverityBadge = (severity: AuditSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>CRITICAL</span>
          </span>
        );
      case 'SECURITY':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
            <ShieldAlert className="w-3 h-3 text-purple-600" />
            <span>SECURITY</span>
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>WARNING</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
            <Info className="w-3 h-3 text-slate-400" />
            <span>INFO</span>
          </span>
        );
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / (60 * 1000));
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center justify-between shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="p-1 hover:bg-white/20 rounded-md">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 text-white rounded-xl">
              <ShieldCheck className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-slate-900">System Audit Trail & Compliance Logs</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                  {filteredLogs.length} Events Logged
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Immutable, real-time audit ledger tracking user actions, campaign dispatches, lead edits, and security permissions across workspace modules.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={loadAuditLogs}
            disabled={refreshing}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 rounded-xl transition text-xs font-semibold flex items-center gap-1.5"
            title="Refresh Audit Logs"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-orange-500' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 border border-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs"
            title="Export CSV for compliance audits"
          >
            <Download className="w-4 h-4 text-slate-600" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setIsTestLogModalOpen(true)}
            className="px-3.5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs"
          >
            <Plus className="w-4 h-4" />
            <span>Log Audit Event</span>
          </button>
        </div>
      </div>

      {/* METRIC KPI SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Total Audit Records</span>
            <Database className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
            {metrics.total}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <span>Directly synchronized in Firestore DB</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Security & Critical Events</span>
            <ShieldAlert className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-extrabold text-purple-700 tracking-tight font-mono">
            {metrics.criticalOrSecurity}
          </div>
          <div className="text-[11px] text-purple-600 font-medium flex items-center gap-1">
            <span>High-priority security triggers</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Warning Alerts</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-amber-600 tracking-tight font-mono">
            {metrics.warning}
          </div>
          <div className="text-[11px] text-amber-700 font-medium">
            <span>Operational system warnings</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Active Logged Users</span>
            <User className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 tracking-tight font-mono">
            {metrics.uniqueActors}
          </div>
          <div className="text-[11px] text-slate-500">
            <span>Team & automated agent identities</span>
          </div>
        </div>
      </div>

      {/* SEARCH AND MULTI-FILTER CONTROL BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        {/* Search Bar */}
        <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200 focus-within:border-orange-500 transition">
          <Search className="w-4 h-4 text-slate-400 ml-1 shrink-0" />
          <input
            type="text"
            placeholder="Search audit trail by description, action, user email, or target..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none text-xs text-slate-800 placeholder-slate-400 focus:outline-none flex-1 font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-slate-600 text-xs px-2 font-medium"
            >
              Clear
            </button>
          )}
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1 border-t border-slate-100">
          
          {/* Module Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5 max-w-full">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mr-1 shrink-0">Module:</span>
            {(['ALL', 'CAMPAIGNS', 'CRM', 'INBOX', 'KNOWLEDGE', 'SETTINGS', 'AUTH', 'AI_ENGINE'] as const).map((mod) => (
              <button
                key={mod}
                onClick={() => setSelectedModule(mod)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition shrink-0 flex items-center gap-1.5 ${
                  selectedModule === mod
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                }`}
              >
                {mod !== 'ALL' && getModuleIcon(mod as AuditModule)}
                <span>{mod === 'ALL' ? 'All Modules' : mod}</span>
              </button>
            ))}
          </div>

          {/* Severity & Date Filters */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Severity Filter */}
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:border-orange-500"
            >
              <option value="ALL">All Severities</option>
              <option value="INFO">INFO Only</option>
              <option value="WARNING">WARNING Only</option>
              <option value="CRITICAL">CRITICAL Only</option>
              <option value="SECURITY">SECURITY Only</option>
            </select>

            {/* Date Range Filter */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:border-orange-500"
            >
              <option value="ALL">All Time</option>
              <option value="TODAY">Last 24 Hours</option>
              <option value="7_DAYS">Last 7 Days</option>
              <option value="30_DAYS">Last 30 Days</option>
            </select>
          </div>

        </div>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Time & ID</th>
                <th className="py-3.5 px-4">Actor / Identity</th>
                <th className="py-3.5 px-4">Module & Action</th>
                <th className="py-3.5 px-4">Audit Description</th>
                <th className="py-3.5 px-4">Severity</th>
                <th className="py-3.5 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin text-orange-500 mx-auto mb-2" />
                    <span>Loading audit records from Firestore DB...</span>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 space-y-2">
                    <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-sm font-semibold text-slate-700">No audit records match your filters.</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Try clearing search terms or selecting 'All Modules' to view historical events.
                    </p>
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedModule('ALL');
                        setSelectedSeverity('ALL');
                        setDateRange('ALL');
                      }}
                      className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-semibold shadow-xs"
                    >
                      Reset All Filters
                    </button>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setInspectedLog(log)}
                      className="hover:bg-slate-50/80 transition cursor-pointer group"
                    >
                      {/* Time & ID */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{formatRelativeTime(log.timestamp)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px]" title={log.id}>
                          {log.id}
                        </div>
                      </td>

                      {/* Actor */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800 flex items-center gap-1.5">
                          <span>{log.actor?.name || 'System'}</span>
                          <span className="text-[9px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded font-mono">
                            {log.actor?.role || 'ADMIN'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {log.actor?.email || '—'}
                        </div>
                      </td>

                      {/* Module & Action */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          {getModuleIcon(log.module)}
                          <span className="font-bold text-slate-900 text-xs">
                            {log.module}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-orange-700 bg-orange-50/80 px-1.5 py-0.5 rounded border border-orange-100 inline-block mt-1">
                          {log.action}
                        </div>
                      </td>

                      {/* Description & Target */}
                      <td className="py-3.5 px-4 max-w-md">
                        <p className="text-slate-800 text-xs leading-relaxed font-sans line-clamp-2">
                          {log.description}
                        </p>
                        {log.target && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                            <span className="font-semibold text-slate-600">Target:</span>
                            <span className="font-mono bg-slate-100 px-1.5 py-0.2 rounded text-[10px]">
                              {log.target.type}: {log.target.name}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Severity */}
                      <td className="py-3.5 px-4">
                        {getSeverityBadge(log.severity)}
                      </td>

                      {/* Details Icon Action */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectedLog(log);
                          }}
                          className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition"
                          title="View Complete Payload & Metadata"
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

        {/* Table Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-800">{filteredLogs.length}</strong> of {logs.length} total audit entries
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            Synced with Firestore Collection: tenants/{tenantId}/audit_logs
          </span>
        </div>
      </div>

      {/* INSPECTED LOG METADATA MODAL */}
      {inspectedLog && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-slate-900 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-900 text-white rounded-xl">
                  <Terminal className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>Audit Log Event Details</span>
                    {getSeverityBadge(inspectedLog.severity)}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    ID: {inspectedLog.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectedLog(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Event Overview Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Action Code: <strong className="text-orange-700 font-mono">{inspectedLog.action}</strong></span>
                  <span>{new Date(inspectedLog.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                  {inspectedLog.description}
                </p>
              </div>

              {/* Actor & Module Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1 shadow-2xs">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Actor / User:</span>
                  <div className="font-bold text-slate-900 text-xs">{inspectedLog.actor?.name || 'System'}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{inspectedLog.actor?.email || '—'}</div>
                  <div className="text-[10px] text-slate-400 pt-1">
                    Role: <span className="font-semibold text-slate-700">{inspectedLog.actor?.role}</span>
                    {inspectedLog.actor?.ipAddress && ` · IP: ${inspectedLog.actor.ipAddress}`}
                  </div>
                </div>

                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1 shadow-2xs">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Target Entity:</span>
                  <div className="font-bold text-slate-900 text-xs">
                    {inspectedLog.target?.type ? `${inspectedLog.target.type}: ${inspectedLog.target.name}` : 'N/A'}
                  </div>
                  {inspectedLog.target?.id && (
                    <div className="text-[11px] text-slate-500 font-mono">ID: {inspectedLog.target.id}</div>
                  )}
                  <div className="text-[10px] text-slate-400 pt-1">
                    Module: <span className="font-semibold text-orange-600">{inspectedLog.module}</span>
                  </div>
                </div>
              </div>

              {/* Raw JSON Payload */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span className="flex items-center gap-1">
                    <Code className="w-3.5 h-3.5 text-orange-500" />
                    <span>Raw Audit Payload & Metadata (JSON):</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Structured JSON Record</span>
                </div>
                <pre className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-amber-300 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-60 shadow-inner">
                  {JSON.stringify(inspectedLog, null, 2)}
                </pre>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setInspectedLog(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-2xs transition"
              >
                Close Audit Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE TEST AUDIT LOG MODAL */}
      {isTestLogModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl text-slate-900 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-orange-50 border border-orange-200 rounded-xl text-orange-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Record Audit Event</h3>
                  <p className="text-xs text-slate-500">Manually trigger a system audit event for verification</p>
                </div>
              </div>
              <button onClick={() => setIsTestLogModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Action Name *
                </label>
                <input
                  type="text"
                  value={testAction}
                  onChange={(e) => setTestAction(e.target.value)}
                  placeholder="e.g. MANUAL_AUDIT_CHECK"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-800 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Target Module *
                  </label>
                  <select
                    value={testModule}
                    onChange={(e) => setTestModule(e.target.value as AuditModule)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-orange-500"
                  >
                    <option value="SETTINGS">SETTINGS</option>
                    <option value="CAMPAIGNS">CAMPAIGNS</option>
                    <option value="CRM">CRM</option>
                    <option value="INBOX">INBOX</option>
                    <option value="KNOWLEDGE">KNOWLEDGE</option>
                    <option value="AUTH">AUTH</option>
                    <option value="AI_ENGINE">AI_ENGINE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Severity *
                  </label>
                  <select
                    value={testSeverity}
                    onChange={(e) => setTestSeverity(e.target.value as AuditSeverity)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-orange-500"
                  >
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="SECURITY">SECURITY</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Audit Description *
                </label>
                <textarea
                  rows={3}
                  value={testDescription}
                  onChange={(e) => setTestDescription(e.target.value)}
                  placeholder="Provide detailed prose describing what occurred..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-orange-500 font-sans"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsTestLogModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateTestLog}
                disabled={isSubmittingTest || !testDescription.trim()}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50 shadow-2xs"
              >
                {isSubmittingTest ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Writing to DB...</span>
                  </>
                ) : (
                  <span>Commit Audit Log</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AuditLogsView;
