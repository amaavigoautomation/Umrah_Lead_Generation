import crypto from 'crypto';
import {
  createDoc,
  deleteDoc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderByDocumentId,
  query,
  setDoc,
  startAfterId,
  updateDoc,
  where,
} from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

const MAX_IMPORT_ROWS = 2000;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const ACTIVE_CAMPAIGN_STATUSES = new Set(['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LeadDatabaseSummary {
  databaseId: string;
  name: string;
  description: string;
  totalLeads: number;
  emailEligibleCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

type NormalizedEntry = {
  entryId: string;
  databaseId: string;
  identityKey: string;
  name: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  companyName: string;
  website: string;
  designation: string;
  city: string;
  country: string;
  customFields: Record<string, string>;
  sourceFileName: string;
  sourceRowNumber: number;
  createdAt: string;
  updatedAt: string;
};

function cleanString(value: unknown, max = 500): string {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeEmail(value: unknown): string {
  return cleanString(value, 320).toLowerCase();
}

function normalizePhone(value: unknown): string {
  return cleanString(value, 80).replace(/[^0-9]/g, '');
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function normalizeRows(
  databaseId: string,
  rows: Array<Record<string, unknown>>,
  sourceFileName: string,
): { valid: NormalizedEntry[]; invalid: Array<{ rowNumber: number; reason: string }> } {
  const now = new Date().toISOString();
  const valid: NormalizedEntry[] = [];
  const invalid: Array<{ rowNumber: number; reason: string }> = [];

  rows.forEach((raw, index) => {
    const rowNumber = Math.max(1, Number(raw?.rowNumber) || index + 2);
    const name = cleanString(raw?.name || [raw?.firstName, raw?.lastName].filter(Boolean).join(' '), 200);
    const email = normalizeEmail(raw?.email);
    const phone = cleanString(raw?.phone || raw?.mobile, 80);
    const normalizedPhone = normalizePhone(phone);
    const companyName = cleanString(raw?.companyName || raw?.company || raw?.organization, 200);
    const website = cleanString(raw?.website, 300);
    const designation = cleanString(raw?.designation || raw?.jobTitle, 160);
    const city = cleanString(raw?.city, 120);
    const country = cleanString(raw?.country, 120);

    if (!name && !email && !normalizedPhone && !companyName) {
      invalid.push({ rowNumber, reason: 'The row does not contain a name, email, mobile number, or company.' });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      invalid.push({ rowNumber, reason: 'Email address is not valid.' });
      return;
    }

    const identity = email
      ? `email:${email}`
      : normalizedPhone
        ? `phone:${normalizedPhone}`
        : `record:${name.toLowerCase()}|${companyName.toLowerCase()}|${website.toLowerCase()}`;
    const customSource = raw?.customFields && typeof raw.customFields === 'object'
      ? raw.customFields as Record<string, unknown>
      : {};
    const customFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(customSource).slice(0, 40)) {
      const safeKey = cleanString(key, 80).replace(/[.$\[\]#\/]/g, '_');
      const safeValue = cleanString(value, 1000);
      if (safeKey && safeValue) customFields[safeKey] = safeValue;
    }

    const entryId = `lde_${shortHash(`${databaseId}:${identity}`).slice(0, 32)}`;
    valid.push({
      entryId,
      databaseId,
      identityKey: shortHash(identity),
      name,
      email,
      normalizedEmail: email,
      phone,
      normalizedPhone,
      companyName,
      website,
      designation,
      city,
      country,
      customFields,
      sourceFileName: cleanString(sourceFileName, 240),
      sourceRowNumber: rowNumber,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { valid, invalid };
}

export async function listLeadDatabases(ctx: TenantContext): Promise<LeadDatabaseSummary[]> {
  const snap = await getDocs(query(tenantRepo(ctx).leadDatabases(), orderByDocumentId()));
  return snap.docs
    .map((doc) => doc.data() as LeadDatabaseSummary)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getLeadDatabase(ctx: TenantContext, databaseId: string): Promise<LeadDatabaseSummary | null> {
  const snap = await getDoc(tenantRepo(ctx).leadDatabaseDoc(databaseId));
  return snap.exists() ? ({ ...(snap.data() as LeadDatabaseSummary), databaseId } as LeadDatabaseSummary) : null;
}

export async function listLeadDatabaseEntries(
  ctx: TenantContext,
  opts: { databaseId?: string; cursor?: string; pageSize?: number; search?: string } = {},
): Promise<{ leads: Array<Record<string, unknown>>; nextCursor: string | null }> {
  const repo = tenantRepo(ctx);
  const size = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(opts.pageSize) || PAGE_SIZE_DEFAULT));
  const term = cleanString(opts.search, 120).toLowerCase();
  const scanSize = term ? 200 : size + 1;
  const matches: Array<Record<string, unknown>> = [];
  let scanCursor = opts.cursor || '';
  let reachedEnd = false;

  // Search across the full collection server-side, rather than only the browser's current page.
  while (!reachedEnd && matches.length <= size) {
    const constraints: any[] = [];
    if (opts.databaseId) constraints.push(where('databaseId', '==', opts.databaseId));
    constraints.push(orderByDocumentId());
    if (scanCursor) constraints.push(startAfterId(scanCursor));
    constraints.push(limit(scanSize));
    const snap = await getDocs(query(repo.leadDatabaseEntries(), ...constraints));
    if (!snap.docs.length) { reachedEnd = true; break; }
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (!term || [
        data.name, data.email, data.phone, data.companyName, data.designation,
        data.city, data.country, data.website, data.sourceFileName,
      ].some((value) => String(value || '').toLowerCase().includes(term))) {
        matches.push({ ...data, entryId: doc.id });
        if (matches.length > size) break;
      }
    }
    scanCursor = snap.docs[snap.docs.length - 1].id;
    if (matches.length > size) break;
    if (snap.docs.length < scanSize) reachedEnd = true;
  }
  const pageDocs = matches.slice(0, size);
  const databases = await listLeadDatabases(ctx);
  const names = new Map(databases.map((database) => [database.databaseId, database.name]));
  const leads = pageDocs.map((lead) => ({
    ...lead,
    sourceDatabaseName: names.get(String(lead.databaseId || '')) || 'Unknown database',
  }));
  return {
    leads,
    nextCursor: matches.length > size ? String(pageDocs[pageDocs.length - 1]?.entryId || '') || null : null,
  };
}

export async function listLeadDatabaseImports(
  ctx: TenantContext,
  databaseId: string,
): Promise<Array<Record<string, unknown>>> {
  const snap = await getDocs(query(
    tenantRepo(ctx).leadDatabaseImports(),
    where('databaseId', '==', databaseId),
    orderByDocumentId(),
    limit(100),
  ));
  return snap.docs
    .map((doc) => ({ ...(doc.data() as Record<string, unknown>), importId: doc.id } as Record<string, unknown>))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function previewLeadDatabaseRows(
  ctx: TenantContext,
  databaseId: string,
  input: { rows: Array<Record<string, unknown>> },
): Promise<{
  received: number; readyCount: number; duplicateCount: number; invalidCount: number;
  duplicates: Array<Record<string, unknown>>; invalidRows: Array<Record<string, unknown>>;
}> {
  if (!Array.isArray(input.rows) || !input.rows.length) throw new Error('Upload a spreadsheet containing at least one data row.');
  if (input.rows.length > MAX_IMPORT_ROWS) throw new Error('A single import can contain up to ' + MAX_IMPORT_ROWS.toLocaleString() + ' rows. Split larger files into smaller uploads.');
  if (!(await getLeadDatabase(ctx, databaseId))) throw new Error('Database not found.');

  const repo = tenantRepo(ctx);
  const normalized = normalizeRows(databaseId, input.rows, 'Preview');
  const duplicates: Array<Record<string, unknown>> = [];
  const unique: NormalizedEntry[] = [];
  const seenEmails = new Map<string, number>();
  const seenPhones = new Map<string, number>();
  const seenFallback = new Map<string, number>();
  for (const entry of normalized.valid) {
    const previous = entry.normalizedEmail ? seenEmails.get(entry.normalizedEmail)
      : entry.normalizedPhone ? seenPhones.get(entry.normalizedPhone) : seenFallback.get(entry.identityKey);
    if (previous !== undefined) {
      duplicates.push({ rowNumber: entry.sourceRowNumber, duplicateOfRow: previous, identity: entry.email || entry.phone || entry.name, reason: 'Duplicate within this upload' });
      continue;
    }
    if (entry.normalizedEmail) seenEmails.set(entry.normalizedEmail, entry.sourceRowNumber);
    if (entry.normalizedPhone && !seenPhones.has(entry.normalizedPhone)) seenPhones.set(entry.normalizedPhone, entry.sourceRowNumber);
    if (!entry.normalizedEmail && !entry.normalizedPhone) seenFallback.set(entry.identityKey, entry.sourceRowNumber);
    unique.push(entry);
  }

  const existingEmails = new Set<string>();
  const existingPhones = new Set<string>();
  const existingFallbackKeys = new Set<string>();
  const emails = Array.from(new Set(unique.map((entry) => entry.normalizedEmail).filter(Boolean)));
  const phones = Array.from(new Set(unique.filter((entry) => !entry.normalizedEmail).map((entry) => entry.normalizedPhone).filter(Boolean)));
  const fallbackKeys = Array.from(new Set(unique.filter((entry) => !entry.normalizedEmail && !entry.normalizedPhone).map((entry) => entry.identityKey)));
  for (const batch of chunks(emails, 30)) {
    const existing = await getDocs(query(repo.leadDatabaseEntries(), where('databaseId', '==', databaseId), where('normalizedEmail', 'in', batch)));
    existing.forEach((doc) => existingEmails.add(String((doc.data() as any).normalizedEmail || '')));
  }
  for (const batch of chunks(phones, 30)) {
    const existing = await getDocs(query(repo.leadDatabaseEntries(), where('databaseId', '==', databaseId), where('normalizedPhone', 'in', batch)));
    existing.forEach((doc) => existingPhones.add(String((doc.data() as any).normalizedPhone || '')));
  }
  for (const batch of chunks(fallbackKeys, 30)) {
    const existing = await getDocs(query(repo.leadDatabaseEntries(), where('databaseId', '==', databaseId), where('identityKey', 'in', batch)));
    existing.forEach((doc) => existingFallbackKeys.add(String((doc.data() as any).identityKey || '')));
  }
  for (const entry of unique) {
    const exists = entry.normalizedEmail ? existingEmails.has(entry.normalizedEmail)
      : entry.normalizedPhone ? existingPhones.has(entry.normalizedPhone) : existingFallbackKeys.has(entry.identityKey);
    if (exists) duplicates.push({ rowNumber: entry.sourceRowNumber, identity: entry.email || entry.phone || entry.name, reason: 'Already exists in this database' });
  }
  return {
    received: input.rows.length,
    readyCount: Math.max(0, normalized.valid.length - duplicates.length),
    duplicateCount: duplicates.length,
    invalidCount: normalized.invalid.length,
    duplicates: duplicates.slice(0, 500),
    invalidRows: normalized.invalid.slice(0, 500),
  };
}

export async function importLeadDatabaseRows(
  ctx: TenantContext,
  databaseId: string,
  input: { sourceFileName?: string; rows: Array<Record<string, unknown>> },
): Promise<{
  added: number;
  duplicatesSkipped: number;
  invalidCount: number;
  duplicates: Array<Record<string, unknown>>;
  invalidRows: Array<Record<string, unknown>>;
  totalLeads: number;
  emailEligibleCount: number;
}> {
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error('Upload a spreadsheet containing at least one data row.');
  }
  if (input.rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`A single import can contain up to ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split larger files into smaller uploads.`);
  }

  const repo = tenantRepo(ctx);
  const database = await getLeadDatabase(ctx, databaseId);
  if (!database) throw new Error('Database not found.');

  const sourceFileName = cleanString(input.sourceFileName || 'Uploaded leads', 240);
  const normalized = normalizeRows(databaseId, input.rows, sourceFileName);
  // Email is the primary identity. Phone is the fallback only when the incoming row has no email.
  // Track both values so an email-less row also matches an older record that did have an email.
  const seenEmails = new Map<string, number>();
  const seenPhones = new Map<string, number>();
  const seenFallback = new Map<string, number>();
  const duplicates: Array<Record<string, unknown>> = [];
  const unique: NormalizedEntry[] = [];

  for (const entry of normalized.valid) {
    const previous = entry.normalizedEmail
      ? seenEmails.get(entry.normalizedEmail)
      : entry.normalizedPhone
        ? seenPhones.get(entry.normalizedPhone)
        : seenFallback.get(entry.identityKey);
    if (previous !== undefined) {
      duplicates.push({
        rowNumber: entry.sourceRowNumber,
        duplicateOfRow: previous,
        identity: entry.email || entry.phone || entry.name,
        reason: 'Duplicate within this upload',
      });
      continue;
    }
    if (entry.normalizedEmail) seenEmails.set(entry.normalizedEmail, entry.sourceRowNumber);
    if (entry.normalizedPhone && !seenPhones.has(entry.normalizedPhone)) {
      seenPhones.set(entry.normalizedPhone, entry.sourceRowNumber);
    }
    if (!entry.normalizedEmail && !entry.normalizedPhone) {
      seenFallback.set(entry.identityKey, entry.sourceRowNumber);
    }
    unique.push(entry);
  }

  const existingEmails = new Set<string>();
  const existingPhones = new Set<string>();
  const emails = Array.from(new Set(unique.map((entry) => entry.normalizedEmail).filter(Boolean)));
  const phones = Array.from(new Set(unique.filter((entry) => !entry.normalizedEmail).map((entry) => entry.normalizedPhone).filter(Boolean)));
  for (const batch of chunks(emails, 30)) {
    const existing = await getDocs(query(
      repo.leadDatabaseEntries(),
      where('databaseId', '==', databaseId),
      where('normalizedEmail', 'in', batch),
    ));
    existing.forEach((doc) => existingEmails.add(String((doc.data() as any).normalizedEmail || '')));
  }
  for (const batch of chunks(phones, 30)) {
    const existing = await getDocs(query(
      repo.leadDatabaseEntries(),
      where('databaseId', '==', databaseId),
      where('normalizedPhone', 'in', batch),
    ));
    existing.forEach((doc) => existingPhones.add(String((doc.data() as any).normalizedPhone || '')));
  }

  const existingFallbackKeys = new Set<string>();
  const fallbackKeys = Array.from(new Set(unique.filter((entry) => !entry.normalizedEmail && !entry.normalizedPhone).map((entry) => entry.identityKey)));
  for (const batch of chunks(fallbackKeys, 30)) {
    const existing = await getDocs(query(
      repo.leadDatabaseEntries(),
      where('databaseId', '==', databaseId),
      where('identityKey', 'in', batch),
    ));
    existing.forEach((doc) => existingFallbackKeys.add(String((doc.data() as any).identityKey || '')));
  }

  const toWrite: NormalizedEntry[] = [];
  for (const entry of unique) {
    const exists = entry.normalizedEmail
      ? existingEmails.has(entry.normalizedEmail)
      : entry.normalizedPhone
        ? existingPhones.has(entry.normalizedPhone)
        : existingFallbackKeys.has(entry.identityKey);
    if (exists) {
      duplicates.push({
        rowNumber: entry.sourceRowNumber,
        identity: entry.email || entry.phone || entry.name,
        reason: 'Already exists in this database',
      });
    } else {
      toWrite.push(entry);
    }
  }

  let added = 0;
  let emailEligibleAdded = 0;
  const writeErrors: string[] = [];
  for (const batch of chunks(toWrite, 200)) {
    const results = await Promise.allSettled(
      batch.map((entry) => createDoc(repo.leadDatabaseEntryDoc(entry.entryId), entry)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        added += 1;
        if (batch[index].normalizedEmail) emailEligibleAdded += 1;
      } else {
        const error: any = result.reason;
        const code = error?.code;
        const alreadyExists = code === 6 || code === 'already-exists' || /ALREADY_EXISTS/i.test(String(error?.message || ''));
        if (alreadyExists) {
          duplicates.push({
            rowNumber: batch[index].sourceRowNumber,
            identity: batch[index].email || batch[index].phone || batch[index].name,
            reason: 'Already exists in this database',
          });
        } else {
          writeErrors.push(String(error?.message || 'Could not save row'));
        }
      }
    });
  }

  const now = new Date().toISOString();
  if (added > 0) {
    await updateDoc(repo.leadDatabaseDoc(databaseId), {
      totalLeads: increment(added),
      emailEligibleCount: increment(emailEligibleAdded),
      updatedAt: now,
    });
  }

  const importId = `imp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const invalidRows = normalized.invalid;
  const importRecord = {
    importId,
    databaseId,
    sourceFileName,
    received: input.rows.length,
    added,
    duplicatesSkipped: duplicates.length,
    invalidCount: invalidRows.length,
    failedWrites: writeErrors.length,
    duplicateRows: duplicates.slice(0, 500),
    invalidRows: invalidRows.slice(0, 500),
    status: writeErrors.length ? 'PARTIAL' : 'COMPLETED',
    createdAt: now,
  };
  await setDoc(repo.leadDatabaseImportDoc(importId), importRecord);

  const updatedDatabase = await getLeadDatabase(ctx, databaseId);
  return {
    added,
    duplicatesSkipped: duplicates.length,
    invalidCount: invalidRows.length,
    duplicates: duplicates.slice(0, 200),
    invalidRows: invalidRows.slice(0, 200),
    totalLeads: updatedDatabase?.totalLeads || 0,
    emailEligibleCount: updatedDatabase?.emailEligibleCount || 0,
  };
}

export async function createLeadDatabase(
  ctx: TenantContext,
  input: { name: string; description?: string; sourceFileName?: string; rows?: Array<Record<string, unknown>> },
): Promise<{ database: LeadDatabaseSummary; importResult?: Awaited<ReturnType<typeof importLeadDatabaseRows>> }> {
  const name = cleanString(input.name, 100);
  if (!name) throw new Error('Database name is required.');
  const databaseId = `ldb_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
  const now = new Date().toISOString();
  const database: LeadDatabaseSummary = {
    databaseId,
    name,
    description: cleanString(input.description, 500),
    totalLeads: 0,
    emailEligibleCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.email || undefined,
  };
  await createDoc(tenantRepo(ctx).leadDatabaseDoc(databaseId), database);
  let importResult: Awaited<ReturnType<typeof importLeadDatabaseRows>> | undefined;
  if (Array.isArray(input.rows) && input.rows.length > 0) {
    importResult = await importLeadDatabaseRows(ctx, databaseId, {
      rows: input.rows,
      sourceFileName: input.sourceFileName || 'Initial upload',
    });
  }
  const latest = await getLeadDatabase(ctx, databaseId);
  return { database: latest || database, ...(importResult ? { importResult } : {}) };
}

export async function updateLeadDatabase(
  ctx: TenantContext,
  databaseId: string,
  input: { name?: string; description?: string },
): Promise<LeadDatabaseSummary> {
  const current = await getLeadDatabase(ctx, databaseId);
  if (!current) throw new Error('Database not found.');
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = cleanString(input.name, 100);
    if (!name) throw new Error('Database name cannot be empty.');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = cleanString(input.description, 500);
  await updateDoc(tenantRepo(ctx).leadDatabaseDoc(databaseId), patch);
  return (await getLeadDatabase(ctx, databaseId)) || current;
}

export async function getCampaignDatabaseSnapshot(
  ctx: TenantContext,
  databaseId: string,
): Promise<{
  database: LeadDatabaseSummary;
  leads: Array<Record<string, unknown>>;
  excludedWithoutEmail: number;
}> {
  const database = await getLeadDatabase(ctx, databaseId);
  if (!database) throw new Error('Selected lead database no longer exists.');
  const snap = await getDocs(query(
    tenantRepo(ctx).leadDatabaseEntries(),
    where('databaseId', '==', databaseId),
  ));
  const entries = snap.docs
    .map((doc) => ({ ...(doc.data() as Record<string, unknown>), databaseEntryId: doc.id }))
    .sort((a: any, b: any) => Number(a.sourceRowNumber || 0) - Number(b.sourceRowNumber || 0));
  const leads = entries
    .filter((entry: any) => EMAIL_RE.test(normalizeEmail(entry.email)))
    .map((entry: any, index) => ({
      name: String(entry.name || ''),
      firstName: String(entry.name || '').trim().split(/\s+/)[0] || '',
      lastName: String(entry.name || '').trim().split(/\s+/).slice(1).join(' '),
      companyName: String(entry.companyName || ''),
      email: normalizeEmail(entry.email),
      phone: String(entry.phone || ''),
      designation: String(entry.designation || ''),
      customFields: (entry.customFields || {}) as Record<string, string>,
      databaseEntryId: String(entry.databaseEntryId),
      rowNumber: index + 1,
    }));
  return { database, leads, excludedWithoutEmail: entries.length - leads.length };
}

export async function listLeadDatabaseCampaignCounts(ctx: TenantContext): Promise<Record<string, number>> {
  const snap = await getDocs(query(tenantRepo(ctx).campaigns()));
  const counts: Record<string, number> = {};
  snap.docs.forEach((doc) => {
    const databaseId = String((doc.data() as any).sourceDatabaseId || '');
    if (databaseId) counts[databaseId] = (counts[databaseId] || 0) + 1;
  });
  return counts;
}

export async function listLeadDatabaseCampaignUsage(ctx: TenantContext, databaseId: string): Promise<Array<Record<string, unknown>>> {
  if (!(await getLeadDatabase(ctx, databaseId))) throw new Error('Database not found.');
  const snap = await getDocs(query(tenantRepo(ctx).campaigns(), where('sourceDatabaseId', '==', databaseId)));
  return snap.docs.map((doc) => {
    const campaign = doc.data() as Record<string, any>;
    const recipientCount = Number(campaign.snapshotRecipientCount ?? campaign.recipientCount ?? campaign.totalRecipients ?? campaign.leadCount);
    return {
      campaignId: doc.id,
      name: String(campaign.name || campaign.campaignName || campaign.title || 'Untitled campaign'),
      status: String(campaign.status || 'UNKNOWN').toUpperCase(),
      ...(Number.isFinite(recipientCount) ? { recipientCount } : {}),
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function deleteLeadDatabase(ctx: TenantContext, databaseId: string): Promise<void> {
  if (ctx.role !== 'admin' && !ctx.isPlatformAdmin) {
    throw new Error('Only workspace administrators can delete a database.');
  }
  const database = await getLeadDatabase(ctx, databaseId);
  if (!database) throw new Error('Database not found.');

  const campaignSnap = await getDocs(query(
    tenantRepo(ctx).campaigns(),
    where('sourceDatabaseId', '==', databaseId),
  ));
  const dependent = campaignSnap.docs
    .map((doc) => doc.data() as any)
    .filter((campaign) => ACTIVE_CAMPAIGN_STATUSES.has(String(campaign.status || '').toUpperCase()));
  if (dependent.length) {
    throw new Error(`This database is used by ${dependent.length} active, scheduled, draft, or paused campaign(s). Complete or delete those campaigns before deleting the database.`);
  }

  const repo = tenantRepo(ctx);
  const [entries, imports] = await Promise.all([
    getDocs(query(repo.leadDatabaseEntries(), where('databaseId', '==', databaseId))),
    getDocs(query(repo.leadDatabaseImports(), where('databaseId', '==', databaseId))),
  ]);
  for (const batch of chunks(entries.docs, 200)) {
    await Promise.all(batch.map((doc) => deleteDoc(repo.leadDatabaseEntryDoc(doc.id))));
  }
  for (const batch of chunks(imports.docs, 200)) {
    await Promise.all(batch.map((doc) => deleteDoc(repo.leadDatabaseImportDoc(doc.id))));
  }
  await deleteDoc(repo.leadDatabaseDoc(databaseId));
}
