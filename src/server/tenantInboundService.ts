import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { db, doc, collection, getDoc, getDocs, setDoc, createDoc, deleteDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo } from './tenantRepo.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import { describeImapError } from './imapService.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Per-workspace inbound mailbox (IMAP).
 *
 * Settings (no secrets):   tenants/{id}/settings/inbound
 * Password (encrypted):    tenants/{id}/secrets/imap_password   (AES-256-GCM, server only)
 * Mailbox registry:        imap_mailboxes/{hash(host|user)}     (one mailbox can belong to ONE workspace;
 *                                                               also the list the poller walks)
 *
 * The platform-wide env mailbox (IMAP_*) that belongs to IMAP_OWNER_TENANT_ID is a separate, older path and
 * is not touched by anything in this file.
 */

export type InboundStatus = 'not_configured' | 'connected' | 'error' | 'auth_failed' | 'paused';

export interface TenantInboundSettings {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  /** Also process brand-new emails from people we have no conversation with. Off by default. */
  processNewInquiries?: boolean;
  status?: InboundStatus;
  lastError?: string;
  lastErrorAt?: string;
  lastPolledAt?: string;
  lastSuccessAt?: string;
  /** Highest IMAP UID already handled. Messages with a higher UID are new. */
  lastUid?: number;
  /** UIDVALIDITY of the mailbox when lastUid was recorded. If it changes, UIDs were reset. */
  uidValidity?: string;
  connectedAt?: string;
  updatedAt?: string;
  consecutiveFailures?: number;
  /** Poller will not touch this mailbox before this time (backoff / minimum interval). */
  nextPollAt?: string;
}

export class InboundError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const INBOUND_SETTINGS_DOC = 'inbound';
export const INBOUND_SECRET_NAME = 'imap_password';
const MAILBOX_REGISTRY = 'imap_mailboxes';
/** Only real IMAP ports: 993 (TLS) and 143 (STARTTLS, required). Stops the server being used to probe other ports. */
const ALLOWED_PORTS = [993, 143];

const sysCtx = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: '', role: 'admin' });

// ---------------------------------------------------------------------------
// Host safety (SSRF): customers type the server name, our server connects to it.
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    if (/^f[cd]/.test(s)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(s)) return true; // fe80::/10 link local
    if (/^ff/.test(s)) return true; // multicast
    const mapped = s.match(/^::ffff:(.+)$/); // IPv4-mapped
    if (mapped) {
      const rest = mapped[1];
      if (net.isIP(rest) === 4) return isPrivateIPv4(rest);
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    return false;
  }
  return true; // not an IP at all
}

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * Resolves the host ONCE and returns a public IP to connect to (the caller then pins the connection to it,
 * so DNS cannot change between the check and the connect).
 */
export async function resolveSafeHost(host: string): Promise<string> {
  if (!HOST_RE.test(host) || host.includes('..') || !host.includes('.')) {
    throw new InboundError(400, 'Enter a valid mail server name, for example imap.gmail.com');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new InboundError(400, 'That mail server address is not allowed');
    return host;
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new InboundError(400, `Could not find the mail server "${host}". Check the spelling.`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new InboundError(400, 'That mail server address is not allowed');
  }
  return (addrs.find((a) => a.family === 4) || addrs[0]).address;
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

export interface InboundCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/** TLS certificates ARE verified here (unlike the legacy owner client): these are customers' mailboxes. */
export function createTenantImapClient(c: InboundCredentials, ip: string): ImapFlow {
  const client = new ImapFlow({
    host: ip,
    port: c.port,
    secure: c.secure,
    servername: c.host,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    // Port 143: upgrade with STARTTLS or fail. Never send the password in clear text.
    doSTARTTLS: c.secure ? undefined : true,
    tls: { rejectUnauthorized: true, servername: c.host },
    clientInfo: { name: 'Umrah360-Inbound', version: '1.0.0' },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 40_000,
  });
  client.on('error', (err: any) => {
    console.warn('[Tenant IMAP client notice]:', friendlyImapError(err, c));
  });
  return client;
}

export async function safeClose(client: ImapFlow) {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {}
  }
}

/** Customer-readable explanation of an IMAP failure. Never contains the password. */
export function friendlyImapError(err: any, c?: Pick<InboundCredentials, 'host' | 'port' | 'pass'>): string {
  let msg: string;
  const code = String(err?.code || '');
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|Authentication failed/i.test(String(err?.responseText || err?.message || ''))) {
    msg = 'Sign-in failed. Check the email address and password. Gmail and Microsoft accounts usually need an app password, not the normal one.';
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    msg = `Could not find the mail server${c ? ` "${c.host}"` : ''}.`;
  } else if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'NoConnection'].includes(code) || /timed? ?out/i.test(String(err?.message))) {
    msg = `Could not connect to the mail server${c ? ` at ${c.host}:${c.port}` : ''}. Check the server name and port.`;
  } else if (/CERT|SELF_SIGNED|ALTNAME|certificate/i.test(code + ' ' + String(err?.message))) {
    msg = "The mail server's security certificate could not be verified.";
  } else {
    msg = describeImapError(err);
  }
  if (c?.pass) msg = msg.split(c.pass).join('***');
  return msg.slice(0, 400);
}

/** Opens the INBOX read-only, reads its UID state and logs out. Throws InboundError with a readable message. */
export async function testImapCredentials(c: InboundCredentials, ip: string): Promise<{ uidValidity: string; uidNext: number }> {
  const client = createTenantImapClient(c, ip);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const mb: any = client.mailbox;
      return { uidValidity: String(mb?.uidValidity ?? ''), uidNext: Number(mb?.uidNext) || 1 };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    if (err instanceof InboundError) throw err;
    throw new InboundError(400, friendlyImapError(err, c));
  } finally {
    await safeClose(client);
  }
}

// ---------------------------------------------------------------------------
// Settings storage
// ---------------------------------------------------------------------------

const settingsCache = new Map<string, { at: number; value: TenantInboundSettings }>();
const CACHE_MS = 30_000;

export async function getInboundSettings(tenantId: string, opts: { fresh?: boolean } = {}): Promise<TenantInboundSettings> {
  const cached = settingsCache.get(tenantId);
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!isFirebaseConfigured || !db) return {};
  const snap = await getDoc(tenantRepo(sysCtx(tenantId)).settingsDoc(INBOUND_SETTINGS_DOC));
  const value = (snap.exists() ? (snap.data() as TenantInboundSettings) : {}) || {};
  settingsCache.set(tenantId, { at: Date.now(), value });
  return value;
}

async function writeSettings(tenantId: string, next: TenantInboundSettings, replace = false): Promise<TenantInboundSettings> {
  const repo = tenantRepo(sysCtx(tenantId));
  // A field passed as `undefined` means "clear it" (lastError, lastErrorAt, nextPollAt after a success).
  // JSON drops undefined, and on a MERGE write a dropped field keeps its old value in the database, so a
  // pause (nextPollAt) or an old error survived a successful check and the mailbox stayed silently paused.
  // On merge writes those fields are therefore cleared explicitly with null. A replace write needs nothing.
  const clean: TenantInboundSettings = JSON.parse(
    JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, replace ? undefined : (_key, value) => (value === undefined ? null : value))
  );
  await setDoc(repo.settingsDoc(INBOUND_SETTINGS_DOC), clean, replace ? { merge: false } : { merge: true });
  const merged = replace ? clean : { ...(await getInboundSettings(tenantId, { fresh: true })) };
  settingsCache.set(tenantId, { at: Date.now(), value: merged });
  return merged;
}

/** Used by the poller to record progress / errors. */
export async function updateInboundState(tenantId: string, patch: Partial<TenantInboundSettings>) {
  const current = await getInboundSettings(tenantId, { fresh: true });
  return writeSettings(tenantId, { ...current, ...patch });
}

export function invalidateInboundSettings(tenantId?: string) {
  if (tenantId) settingsCache.delete(tenantId);
  else settingsCache.clear();
}

async function readPassword(tenantId: string): Promise<string | null> {
  if (!isFirebaseConfigured || !db) return null;
  const snap = await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(INBOUND_SECRET_NAME));
  if (!snap.exists()) return null;
  try {
    return decryptSecret(snap.data() as any);
  } catch {
    return null;
  }
}

/** Decrypted credentials for the poller. Null when nothing (or an unreadable secret) is stored. */
export async function getInboundCredentials(tenantId: string): Promise<InboundCredentials | null> {
  const s = await getInboundSettings(tenantId, { fresh: true });
  if (!s.host || !s.user || !s.port) return null;
  const pass = await readPassword(tenantId);
  if (!pass) return null;
  return { host: s.host, port: s.port, secure: s.secure ?? s.port === 993, user: s.user, pass };
}

/** What the UI may see. Never includes the password. */
export async function getInboundView(tenantId: string) {
  const s = await getInboundSettings(tenantId, { fresh: true });
  let hasPassword = false;
  if (isFirebaseConfigured && db) {
    hasPassword = (await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(INBOUND_SECRET_NAME))).exists();
  }
  return {
    enabled: Boolean(s.enabled),
    host: s.host,
    port: s.port,
    user: s.user,
    processNewInquiries: Boolean(s.processNewInquiries),
    status: (s.status || 'not_configured') as InboundStatus,
    lastError: s.lastError,
    lastErrorAt: s.lastErrorAt,
    lastPolledAt: s.lastPolledAt,
    lastSuccessAt: s.lastSuccessAt,
    connectedAt: s.connectedAt,
    hasPassword,
  };
}

/** The connected mailbox address, used as the default Reply-To for outgoing email. */
export async function getConnectedMailboxAddress(tenantId: string): Promise<string | undefined> {
  try {
    const s = await getInboundSettings(tenantId);
    if (s.enabled && s.user && s.user.includes('@') && s.status !== 'not_configured') return s.user.toLowerCase();
  } catch {}
  return undefined;
}

// ---------------------------------------------------------------------------
// Mailbox registry (ownership claim + the list the poller walks)
// ---------------------------------------------------------------------------

export function mailboxKey(host: string, user: string): string {
  return crypto.createHash('sha256').update(`${host.toLowerCase()}|${user.toLowerCase()}`).digest('hex').slice(0, 32);
}

export async function listInboundTenantIds(): Promise<string[]> {
  if (!isFirebaseConfigured || !db) return [];
  const snap = await getDocs(collection(db, MAILBOX_REGISTRY));
  const ids = new Set<string>();
  snap.forEach((d) => {
    const t = (d.data() as any)?.tenantId;
    if (typeof t === 'string' && t) ids.add(t);
  });
  return [...ids];
}

async function claimMailbox(tenantId: string, host: string, user: string) {
  const ref = doc(db, MAILBOX_REGISTRY, mailboxKey(host, user));
  const record = { tenantId, host: host.toLowerCase(), user: user.toLowerCase(), createdAt: new Date().toISOString() };
  const snap = await getDoc(ref);
  if (snap.exists()) {
    if ((snap.data() as any)?.tenantId !== tenantId) {
      throw new InboundError(409, 'This mailbox is already connected to another workspace');
    }
    return;
  }
  try {
    await createDoc(ref, record);
  } catch (err: any) {
    // Lost a race: somebody created it between our read and write.
    const again = await getDoc(ref);
    if (!again.exists() || (again.data() as any)?.tenantId !== tenantId) {
      throw new InboundError(409, 'This mailbox is already connected to another workspace');
    }
  }
}

async function releaseMailbox(tenantId: string, host?: string, user?: string) {
  if (!host || !user) return;
  const ref = doc(db, MAILBOX_REGISTRY, mailboxKey(host, user));
  const snap = await getDoc(ref);
  if (snap.exists() && (snap.data() as any)?.tenantId === tenantId) await deleteDoc(ref);
}

// ---------------------------------------------------------------------------
// Public operations (called by the API)
// ---------------------------------------------------------------------------

export interface ConnectInput {
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  processNewInquiries?: boolean;
}

function requireDb() {
  if (!isFirebaseConfigured || !db) throw new InboundError(503, 'Database is not configured');
}

/**
 * Tests the mailbox and, only if the sign-in works, stores it (password encrypted) and starts the baseline:
 * mail that already exists in the inbox is never processed, only what arrives afterwards.
 */
export async function connectInbound(tenantId: string, input: ConnectInput) {
  requireDb();
  const host = String(input.host || '').trim().toLowerCase();
  const port = Number(input.port) || 993;
  const user = String(input.user || '').trim();
  if (!ALLOWED_PORTS.includes(port)) throw new InboundError(400, 'Use port 993 (SSL/TLS) or 143 (STARTTLS)');
  if (!user || user.length > 254 || /[\r\n\0]/.test(user)) throw new InboundError(400, 'Enter the mailbox email address or username');

  const existing = await getInboundSettings(tenantId, { fresh: true });
  const sameMailbox = existing.host === host && (existing.user || '').toLowerCase() === user.toLowerCase();

  let pass = String(input.password || '');
  if (!pass) {
    if (!sameMailbox) throw new InboundError(400, 'Enter the mailbox password');
    pass = (await readPassword(tenantId)) || '';
    if (!pass) throw new InboundError(400, 'Enter the mailbox password');
  }
  if (pass.length > 512) throw new InboundError(400, 'Password is too long');

  const creds: InboundCredentials = { host, port, secure: port === 993, user, pass };
  const ip = await resolveSafeHost(host);
  await claimMailbox(tenantId, host, user);

  let uidState: { uidValidity: string; uidNext: number };
  try {
    uidState = await testImapCredentials(creds, ip);
  } catch (err) {
    // A claim for a mailbox that never worked must not block anyone else.
    if (!sameMailbox) await releaseMailbox(tenantId, host, user).catch(() => {});
    throw err;
  }

  // A different mailbox than before: free the old claim.
  if (existing.host && !sameMailbox) await releaseMailbox(tenantId, existing.host, existing.user).catch(() => {});

  const repo = tenantRepo(sysCtx(tenantId));
  const enc = encryptSecret(pass);
  const now = new Date().toISOString();
  await setDoc(repo.secretDoc(INBOUND_SECRET_NAME), { name: INBOUND_SECRET_NAME, ...enc, createdAt: now, updatedAt: now }, { merge: false });

  // Keep the high-water mark when reconnecting the same, unchanged mailbox; otherwise start from "now".
  const keepBaseline = sameMailbox && existing.lastUid !== undefined && existing.uidValidity === uidState.uidValidity;
  await writeSettings(tenantId, {
    ...existing,
    enabled: true,
    host,
    port,
    secure: creds.secure,
    user,
    processNewInquiries: input.processNewInquiries ?? existing.processNewInquiries ?? false,
    status: 'connected',
    lastError: undefined,
    lastErrorAt: undefined,
    consecutiveFailures: 0,
    nextPollAt: undefined,
    uidValidity: uidState.uidValidity,
    lastUid: keepBaseline ? existing.lastUid : Math.max(0, uidState.uidNext - 1),
    connectedAt: keepBaseline ? existing.connectedAt : now,
  }, true);
  return getInboundView(tenantId);
}

/** Re-tests the stored mailbox (button in the UI). Clears an error / auth_failed state when it works. */
export async function testStoredInbound(tenantId: string) {
  requireDb();
  const creds = await getInboundCredentials(tenantId);
  if (!creds) throw new InboundError(400, 'No mailbox is connected');
  const ip = await resolveSafeHost(creds.host);
  const s = await getInboundSettings(tenantId, { fresh: true });
  try {
    const st = await testImapCredentials(creds, ip);
    const reset = st.uidValidity !== s.uidValidity;
    await updateInboundState(tenantId, {
      status: s.enabled === false ? 'paused' : 'connected',
      lastError: undefined,
      lastErrorAt: undefined,
      consecutiveFailures: 0,
      nextPollAt: undefined,
      ...(reset ? { uidValidity: st.uidValidity, lastUid: Math.max(0, st.uidNext - 1) } : {}),
    });
  } catch (err: any) {
    await updateInboundState(tenantId, { status: 'error', lastError: err?.message, lastErrorAt: new Date().toISOString() });
    throw err;
  }
  return getInboundView(tenantId);
}

export async function setInboundOptions(tenantId: string, opts: { enabled?: boolean; processNewInquiries?: boolean }) {
  requireDb();
  const s = await getInboundSettings(tenantId, { fresh: true });
  if (!s.host || !s.user) throw new InboundError(400, 'Connect a mailbox first');
  const patch: Partial<TenantInboundSettings> = {};
  if (typeof opts.processNewInquiries === 'boolean') patch.processNewInquiries = opts.processNewInquiries;
  if (typeof opts.enabled === 'boolean') {
    patch.enabled = opts.enabled;
    if (!opts.enabled) patch.status = 'paused';
    else if (s.status === 'paused') {
      patch.status = 'connected';
      patch.nextPollAt = undefined;
    }
  }
  await updateInboundState(tenantId, patch);
  return getInboundView(tenantId);
}

/** Removes the stored password and releases the mailbox. Nothing about the mailbox is kept. */
export async function disconnectInbound(tenantId: string) {
  requireDb();
  const s = await getInboundSettings(tenantId, { fresh: true });
  await deleteDoc(tenantRepo(sysCtx(tenantId)).secretDoc(INBOUND_SECRET_NAME)).catch(() => {});
  await releaseMailbox(tenantId, s.host, s.user).catch(() => {});
  await writeSettings(tenantId, { enabled: false, status: 'not_configured' }, true);
  return getInboundView(tenantId);
}
