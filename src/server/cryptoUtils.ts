import crypto from 'crypto';
import type { EncryptedSecretPayload } from '../types/tenant.js';

// Derive or format a 32-byte (256-bit) encryption key from environment variable
function getMasterKey(): Buffer {
  const envKey = process.env.SECRETS_MASTER_KEY || process.env.TENANT_MASTER_KEY;
  if (!envKey) {
    // Development fallback key with strict notice
    const fallbackSeed = 'umrah360_platform_master_seed_key_v1_secure_dev';
    return crypto.createHash('sha256').update(fallbackSeed).digest();
  }

  // If hex string (64 characters)
  if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }

  // Hash any other passphrase into consistent 32-byte key
  return crypto.createHash('sha256').update(envKey).digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const KEY_VERSION = 1;

/**
 * Encrypts sensitive credentials using AES-256-GCM
 */
export function encryptSecret(plainText: string): EncryptedSecretPayload {
  if (!plainText) {
    throw new Error('Cannot encrypt empty or null secret');
  }

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');

  return {
    encryptedData: encrypted,
    iv: iv.toString('base64'),
    authTag,
    keyVersion: KEY_VERSION,
  };
}

/**
 * Decrypts sensitive credentials using AES-256-GCM
 */
export function decryptSecret(payload: EncryptedSecretPayload): string {
  if (!payload || !payload.encryptedData || !payload.iv || !payload.authTag) {
    throw new Error('Invalid encrypted secret payload structure');
  }

  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(payload.encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates an unguessable webhook identifier
 */
export function generateWebhookId(prefix = 'wh'): string {
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Generates an unguessable webhook secret token
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

/**
 * Computes a secure SHA-256 hash of a webhook secret for comparison
 */
export function hashWebhookSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret.trim()).digest('hex');
}

/**
 * Constant-time string equality check to prevent timing attacks
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
