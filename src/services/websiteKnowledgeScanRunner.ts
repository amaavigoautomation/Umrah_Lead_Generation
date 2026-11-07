type ScanEventDetail = { tenantId: string; job?: any; report?: any; message?: string };
function emitScanEvent(name: string, detail: ScanEventDetail): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('website-knowledge-scan:' + name, { detail }));
}
let activeTenantId = '';
let activeRun: Promise<void> | null = null;
let runVersion = 0;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
async function readScanState(): Promise<any> {
  const response = await fetch('/api/knowledge/website-scan', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not read website scan status.');
  return data;
}
export function startWebsiteKnowledgeScanRunner(tenantId: string): Promise<void> {
  if (!tenantId) return Promise.resolve();
  if (activeRun && activeTenantId === tenantId) return activeRun;
  activeTenantId = tenantId;
  const version = ++runVersion;
  activeRun = (async () => {
    let consecutiveErrors = 0;
    try {
      let state = await readScanState();
      let job = state.job || null;
      if (!job) return;
      emitScanEvent('progress', { tenantId, job });
      while (version === runVersion && activeTenantId === tenantId) {
        try {
          const response = await fetch('/api/knowledge/website-scan/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (String(data.error || '').toLowerCase().includes('no website scan')) {
              state = await readScanState();
              if (!state.job && state.lastReport) {
                emitScanEvent('completed', { tenantId, report: state.lastReport });
                return;
              }
              if (!state.job) throw new Error('The scan job is no longer available. Start a new scan; previously saved Knowledge Base articles are preserved.');
            } else throw new Error(data.error || 'Website scan step failed.');
          } else if (data.done) {
            emitScanEvent('completed', { tenantId, report: data.report || {} });
            return;
          } else if (data.job) {
            job = data.job;
            consecutiveErrors = 0;
            emitScanEvent('progress', { tenantId, job });
          } else {
            state = await readScanState();
            if (!state.job && state.lastReport) {
              emitScanEvent('completed', { tenantId, report: state.lastReport });
              return;
            }
            if (state.job) {
              job = state.job;
              emitScanEvent('progress', { tenantId, job });
            } else throw new Error('The scanner returned no active job or completion report.');
          }
          await wait(300);
        } catch (error: any) {
          if (version !== runVersion || activeTenantId !== tenantId) return;
          consecutiveErrors += 1;
          if (consecutiveErrors >= 8) throw error;
          emitScanEvent('retry', { tenantId, job, message: error?.message || 'Temporary connection issue. Retrying.' });
          await wait(Math.min(10_000, 700 * (2 ** (consecutiveErrors - 1))));
        }
      }
    } catch (error: any) {
      if (version === runVersion && activeTenantId === tenantId) emitScanEvent('failed', { tenantId, message: error?.message || 'Website scan stopped unexpectedly.' });
    } finally {
      if (version === runVersion) { activeRun = null; activeTenantId = ''; }
    }
  })();
  return activeRun;
}