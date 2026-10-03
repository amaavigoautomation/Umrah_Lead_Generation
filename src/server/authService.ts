import crypto from 'crypto';
import { promisify } from 'util';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import type { AppUser, UserRole } from '../types/index.js';

/**
 * Server-side authentication.
 *
 * - Passwords are verified on the server (scrypt hashes in Firestore `user_credentials`, never in `app_users`).
 * - Legacy accounts whose plaintext password still sits in `app_users.password` are accepted once and upgraded
 *   automatically on their first successful login (hash written, plaintext field cleared).
 * - Sessions are stateless HMAC-signed tokens sent in the `x-auth-token` header
 *   (the `Authorization` header is already used for the Google Calendar token).
 *
 * Env:
 *   AUTH_SECRET                      required in production (>= 16 chars) — signs session tokens
 *   INITIAL_ADMIN_EMAIL / _PASSWORD  optional — creates the first platform admin when no users exist yet
 *   CRON_SECRET                      optional — lets a scheduler call /api/campaigns/process-active
 */

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;
const PLATFORM_MODULE_IDS = ['inbox', 'campaigns', 'crm', 'knowledge', 'playground', 'scenarios', 'settings', 'live-mailbox'];
/** Client (tenant) users only ever get these modules — everything else shows platform-wide data. */
export const CLIENT_MODULE_IDS = ['campaigns', 'settings'];

const scryptAsync = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

export type PublicUser = Omit<AppUser, 'password'>;

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  /** Undefined for platform staff. */
  clientId?: string;
  /** Platform staff with the ADMIN role. */
  isPlatformAdmin: boolean;
}

interface TokenPayload {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  cid?: string;
  exp: number;
}

// ---------------------------------------------------------------------------
// Secrets / tokens
// ---------------------------------------------------------------------------

let ephemeralSecret = '';

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[Auth] AUTH_SECRET is missing or shorter than 16 characters. Using a temporary secret: sessions reset on every restart and will not work across multiple instances. Set AUTH_SECRET in your environment.'
    );
  }
  return ephemeralSecret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(data: string): string {
  return b64url(crypto.createHmac('sha256', getSecret()).update(data).digest());
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function signToken(payload: TokenPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

function verifyToken(token: string): TokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf-8')) as TokenPayload;
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function authenticateRequest(req: any): AuthContext | null {
  const raw = req?.headers?.['x-auth-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || typeof token !== 'string') return null;
  const p = verifyToken(token);
  if (!p) return null;
  return {
    userId: p.uid,
    email: p.email,
    name: p.name,
    role: p.role,
    clientId: p.cid || undefined,
    isPlatformAdmin: p.role === 'ADMIN' && !p.cid,
  };
}

/** True when the request carries the scheduler secret (e.g. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
export function isCronAuthorized(req: any): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req?.headers?.authorization;
  return typeof h === 'string' && safeEqual(h, `Bearer ${secret}`);
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = (stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scryptAsync(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function loadUsers(): Promise<AppUser[]> {
  if (!isFirebaseConfigured || !db) return [];
  const snap = await getDocs(collection(db, 'app_users'));
  return snap.docs.map((d) => d.data() as AppUser).filter((u) => u && u.userId && u.email);
}

function toPublicUser(u: AppUser): PublicUser {
  const { password: _pw, ...rest } = u;
  const clientId = u.clientId || undefined;
  if (clientId) {
    return {
      ...rest,
      clientId,
      role: u.role === 'ADMIN' ? 'OPERATOR' : u.role,
      accessLevel: 'CUSTOM',
      allowedModules: CLIENT_MODULE_IDS,
    };
  }
  return { ...rest, clientId: undefined };
}

async function bootstrapAdminIfEmpty(): Promise<void> {
  const email = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  if (!email || password.length < 8 || !isFirebaseConfigured || !db) return;

  const now = new Date().toISOString();
  const admin: AppUser = {
    userId: 'user-admin-01',
    email,
    username: email.split('@')[0],
    name: 'Platform Administrator',
    role: 'ADMIN',
    accessLevel: 'ALL',
    allowedModules: PLATFORM_MODULE_IDS,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'app_users', admin.userId), sanitizeForFirestore({ ...admin, password: '' }));
  await setDoc(doc(db, 'user_credentials', admin.userId), {
    passwordHash: await hashPassword(password),
    updatedAt: now,
  });
  console.log(`[Auth] Created initial platform admin ${email}.`);
}

const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

export type LoginResult =
  | { ok: true; token: string; user: PublicUser }
  | { ok: false; status: number; error: string };

export async function loginWithPassword(identifier: string, password: string): Promise<LoginResult> {
  const id = (identifier || '').trim().toLowerCase();
  const pw = (password || '').trim();
  if (!id || !pw) return { ok: false, status: 400, error: 'Please enter both email/username and password.' };

  if (!isFirebaseConfigured || !db) {
    return { ok: false, status: 503, error: 'The user database is not configured on the server.' };
  }

  const lock = failedAttempts.get(id);
  if (lock && lock.lockedUntil > Date.now()) {
    return { ok: false, status: 429, error: 'Too many failed attempts. Try again in a few minutes.' };
  }

  let users = await loadUsers();
  if (users.length === 0) {
    await bootstrapAdminIfEmpty();
    users = await loadUsers();
  }
  if (users.length === 0) {
    return {
      ok: false,
      status: 503,
      error: 'No users exist yet. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD on the server and try again.',
    };
  }

  const user = users.find((u) => u.email.toLowerCase() === id || (u.username && u.username.toLowerCase() === id));

  const fail = (): LoginResult => {
    const cur = failedAttempts.get(id) || { count: 0, lockedUntil: 0 };
    cur.count += 1;
    if (cur.count >= MAX_FAILED_ATTEMPTS) {
      cur.lockedUntil = Date.now() + LOCKOUT_MS;
      cur.count = 0;
    }
    failedAttempts.set(id, cur);
    return { ok: false, status: 401, error: 'Invalid credentials. Please check your email/username and password.' };
  };

  if (!user) return fail();

  let valid = false;
  const credSnap = await getDoc(doc(db, 'user_credentials', user.userId)).catch(() => null);
  const storedHash: string | undefined = credSnap && credSnap.exists() ? (credSnap.data() as any).passwordHash : undefined;

  if (storedHash) {
    valid = await verifyPassword(pw, storedHash);
  } else if (user.password && user.password.trim()) {
    // Legacy plaintext account: accept once, then upgrade to a hash and clear the plaintext.
    valid = safeEqual(user.password.trim(), pw);
    if (valid) {
      const now = new Date().toISOString();
      await setDoc(doc(db, 'user_credentials', user.userId), { passwordHash: await hashPassword(pw), updatedAt: now });
      await setDoc(doc(db, 'app_users', user.userId), { password: '', updatedAt: now }, { merge: true });
    }
  }

  if (!valid) return fail();

  if (user.isActive === false) {
    return { ok: false, status: 403, error: 'This account has been deactivated.' };
  }

  failedAttempts.delete(id);

  const pub = toPublicUser(user);
  const token = signToken({
    uid: pub.userId,
    email: pub.email,
    name: pub.name,
    role: pub.role,
    cid: pub.clientId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
  return { ok: true, token, user: pub };
}

export async function getUserById(userId: string): Promise<PublicUser | null> {
  if (!isFirebaseConfigured || !db) return null;
  const snap = await getDoc(doc(db, 'app_users', userId)).catch(() => null);
  if (!snap || !snap.exists()) return null;
  return toPublicUser(snap.data() as AppUser);
}

function requirePlatformAdmin(actor: AuthContext) {
  if (!actor.isPlatformAdmin) throw new Error('Only platform administrators can manage users.');
}

/** Creates or updates a user. The password (if any) is hashed here and never stored in `app_users`. */
export async function saveUserServer(
  input: Partial<AppUser> & { password?: string },
  actor: AuthContext
): Promise<PublicUser> {
  requirePlatformAdmin(actor);
  if (!isFirebaseConfigured || !db) throw new Error('The user database is not configured on the server.');

  const name = (input.name || '').trim();
  const email = (input.email || '').trim().toLowerCase();
  if (!name || !email) throw new Error('Name and email are required.');

  const users = await loadUsers();
  const userId = input.userId || `user-${Date.now()}`;
  const existing = users.find((u) => u.userId === userId);

  if (users.some((u) => u.userId !== userId && u.email.toLowerCase() === email)) {
    throw new Error('Another user already uses this email.');
  }

  const newPassword = (input.password || '').trim();
  if (!existing && newPassword.length < 8) throw new Error('A password of at least 8 characters is required.');
  if (newPassword && newPassword.length < 8) throw new Error('Passwords must be at least 8 characters.');

  const now = new Date().toISOString();
  const role: UserRole = (input.role as UserRole) || existing?.role || 'SPECIALIST';
  const clientId = (input.clientId ?? existing?.clientId ?? '').toString().trim();

  const record: AppUser = {
    userId,
    email,
    username: (input.username || existing?.username || email.split('@')[0]).trim().toLowerCase(),
    password: '',
    name,
    role,
    accessLevel: role === 'ADMIN' && !clientId ? 'ALL' : input.accessLevel || existing?.accessLevel || 'CUSTOM',
    allowedModules:
      role === 'ADMIN' && !clientId
        ? PLATFORM_MODULE_IDS
        : input.allowedModules && input.allowedModules.length > 0
        ? input.allowedModules
        : existing?.allowedModules || ['knowledge', 'playground'],
    clientId,
    isActive: input.isActive !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'app_users', userId), sanitizeForFirestore(record), { merge: true });

  if (newPassword) {
    await setDoc(doc(db, 'user_credentials', userId), { passwordHash: await hashPassword(newPassword), updatedAt: now });
  }

  return toPublicUser(record);
}

export async function deleteUserServer(userId: string, actor: AuthContext): Promise<void> {
  requirePlatformAdmin(actor);
  if (!isFirebaseConfigured || !db) throw new Error('The user database is not configured on the server.');
  if (userId === actor.userId) throw new Error('You cannot delete your own account.');
  await deleteDoc(doc(db, 'app_users', userId));
  await deleteDoc(doc(db, 'user_credentials', userId)).catch(() => {});
}
