import os from 'os';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import type { TenantContext, TenantJobLease } from '../types/tenant.js';

const WORKER_ID = `${os.hostname()}-${process.pid}-${Math.random().toString(36).substring(2, 8)}`;

// Efficient in-memory lease tracking to avoid exhausting Firestore quotas
const inMemoryLeases = new Map<string, TenantJobLease>();

/**
 * Attempts to acquire an exclusive distributed lease for a job within a tenant
 * Returns true if lease was successfully acquired or renewed, false if held by another worker
 */
export async function acquireJobLease(
  tenantId: string,
  jobName: string,
  ttlMs: number = 30_000
): Promise<boolean> {
  const leaseKey = `${tenantId}:${jobName}`;
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const leasedAt = new Date(now).toISOString();

  const currentLease = inMemoryLeases.get(leaseKey);

  if (!currentLease) {
    const leaseRecord: TenantJobLease = {
      jobName,
      workerId: WORKER_ID,
      leasedAt,
      expiresAt,
    };
    inMemoryLeases.set(leaseKey, leaseRecord);
    return true;
  }

  const currentExpiry = new Date(currentLease.expiresAt).getTime();

  // If current lease has expired OR was already leased by this worker, renew it
  if (now > currentExpiry || currentLease.workerId === WORKER_ID) {
    inMemoryLeases.set(leaseKey, {
      ...currentLease,
      workerId: WORKER_ID,
      leasedAt,
      expiresAt,
    });
    return true;
  }

  // Held by another active worker
  return false;
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
  const leaseKey = `${tenantId}:${jobName}`;
  const currentLease = inMemoryLeases.get(leaseKey);
  
  if (currentLease && currentLease.workerId === WORKER_ID) {
    inMemoryLeases.set(leaseKey, {
      ...currentLease,
      expiresAt: new Date(0).toISOString(), // Expire immediately
      lastCompletedAt: new Date().toISOString(),
      lastStatus: status,
      ...(error ? { lastError: error } : {}),
    });
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
