import os from 'os';
import { getDoc, setDoc, updateDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext, TenantJobLease } from '../types/tenant.js';

const WORKER_ID = `${os.hostname()}-${process.pid}-${Math.random().toString(36).substring(2, 8)}`;

/**
 * Attempts to acquire an exclusive distributed lease for a job within a tenant
 * Returns true if lease was successfully acquired or renewed, false if held by another worker
 */
export async function acquireJobLease(
  tenantId: string,
  jobName: string,
  ttlMs: number = 30_000
): Promise<boolean> {
  if (!isFirebaseConfigured || !db || !tenantId) return true; // Single-instance fallback

  const ctx: TenantContext = {
    tenantId,
    uid: 'system',
    email: 'system@umrah360.in',
    role: 'admin',
  };

  const jobDocRef = tenantRepo(ctx).jobDoc(jobName);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const leasedAt = new Date(now).toISOString();

  try {
    const snap = await getDoc(jobDocRef);

    if (!snap.exists()) {
      const leaseRecord: TenantJobLease = {
        jobName,
        workerId: WORKER_ID,
        leasedAt,
        expiresAt,
      };
      await setDoc(jobDocRef, leaseRecord);
      return true;
    }

    const currentLease = snap.data() as TenantJobLease;
    const currentExpiry = new Date(currentLease.expiresAt).getTime();

    // If current lease has expired OR was already leased by this worker, renew it
    if (now > currentExpiry || currentLease.workerId === WORKER_ID) {
      await updateDoc(jobDocRef, {
        workerId: WORKER_ID,
        leasedAt,
        expiresAt,
      });
      return true;
    }

    // Held by another active worker
    return false;
  } catch (err) {
    console.warn(`[JobLease] Lease check error for ${tenantId}/${jobName}:`, err);
    return true; // Fallback to avoid complete background stalling
  }
}

/**
 * Releases a job lease upon completion
 */
export async function releaseJobLease(
  tenantId: string,
  jobName: string,
  status: 'success' | 'failed' = 'success',
  error?: string
): Promise<void> {
  if (!isFirebaseConfigured || !db || !tenantId) return;

  const ctx: TenantContext = {
    tenantId,
    uid: 'system',
    email: 'system@umrah360.in',
    role: 'admin',
  };

  const jobDocRef = tenantRepo(ctx).jobDoc(jobName);

  try {
    const snap = await getDoc(jobDocRef);
    if (snap.exists()) {
      const currentLease = snap.data() as TenantJobLease;
      if (currentLease.workerId === WORKER_ID) {
        await updateDoc(jobDocRef, {
          expiresAt: new Date(0).toISOString(), // Expire immediately
          lastCompletedAt: new Date().toISOString(),
          lastStatus: status,
          ...(error ? { lastError: error } : {}),
        });
      }
    }
  } catch (err) {
    console.warn(`[JobLease] Lease release error for ${tenantId}/${jobName}:`, err);
  }
}

/**
 * Higher-order runner that executes a task under an exclusive distributed job lease
 */
export async function runWithJobLease<T>(
  tenantId: string,
  jobName: string,
  ttlMs: number,
  task: () => Promise<T>
): Promise<T | null> {
  const acquired = await acquireJobLease(tenantId, jobName, ttlMs);
  if (!acquired) {
    return null;
  }

  try {
    const result = await task();
    await releaseJobLease(tenantId, jobName, 'success');
    return result;
  } catch (err: any) {
    await releaseJobLease(tenantId, jobName, 'failed', err?.message || String(err));
    throw err;
  }
}
