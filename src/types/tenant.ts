/**
 * Multi-Tenant Core Type Definitions for Umrah360 SaaS Platform
 */

export type UserRole = 'platformAdmin' | 'admin' | 'member';

export type TenantStatus = 'active' | 'suspended';

export interface TenantLimits {
  monthlyAiTokens: number;
  dailyOutboundSends: number;
  hourlyOutboundSends: number;
  seats: number;
}

export interface TenantPlan {
  id: 'starter' | 'growth' | 'enterprise';
  name: string;
  maxSeats: number;
  maxDailySends: number;
  monthlyAiTokenCap: number;
}

export interface Tenant {
  id: string; // Tenant ID e.g. "umrah360" or uuid
  name: string;
  slug: string;
  status: TenantStatus;
  plan: 'starter' | 'growth' | 'enterprise';
  limits: TenantLimits;
  createdAt: string;
  updatedAt?: string;
  contactEmail?: string;
  contactPhone?: string;
  timezone?: string; // Default: 'Asia/Kolkata'
  defaultCurrency?: string; // Default: 'USD' or 'INR'
}

export interface GlobalUser {
  uid: string;
  email: string;
  tenantId: string;
  role: UserRole;
  active: boolean;
  name?: string;
  displayName?: string;
  photoURL?: string;
  allowedModules?: string[]; // Module RBAC for UI
  createdAt: string;
  updatedAt?: string;
}

export interface AuthClaims {
  tenantId?: string;
  role?: UserRole;
  platformAdmin?: boolean;
}

export interface TenantContext {
  tenantId: string;
  uid: string;
  email: string;
  role: UserRole;
  isPlatformAdmin?: boolean;
}

export interface WebhookRoute {
  webhookId: string;
  tenantId: string;
  type: 'website' | 'whatsapp';
  secretHash: string;
  createdAt: string;
  rotatedAt?: string;
  allowedOrigins?: string[];
}

export interface ChannelRoute {
  phoneNumberId: string;
  tenantId: string;
  businessAccountId?: string;
  createdAt: string;
}

export interface DomainRoute {
  domain: string;
  tenantId: string;
  resendDomainId?: string;
  verified?: boolean;
  createdAt: string;
}

export interface EmailRoute {
  resendEmailId: string;
  tenantId: string;
  messageId: string;
  expiresAt: number; // TTL timestamp in seconds
}

export interface TenantMonthlyUsage {
  month: string; // "YYYY-MM"
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiRequestCount: number;
  solicitedEmailCount: number;
  coldEmailCount: number;
  whatsappMessageCount: number;
  updatedAt: string;
}

export interface TenantJobLease {
  jobName: string;
  workerId: string;
  leasedAt: string;
  expiresAt: string;
  lastCompletedAt?: string;
  lastStatus?: 'success' | 'failed';
  lastError?: string;
}

export interface TenantSecretRecord {
  name: string;
  encryptedData: string; // Base64 ciphertext
  iv: string; // Base64 initialization vector
  authTag: string; // Base64 GCM auth tag
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedSecretPayload {
  encryptedData: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}
