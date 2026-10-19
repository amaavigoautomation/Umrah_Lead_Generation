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

export type OrgStatus = 'active' | 'suspended';

/**
 * An organization (agency account) owns several client brands. Each client brand is a normal tenant with
 * `orgId` set. Organization admins are admins of every client brand under their organization.
 */
export interface Org {
  id: string;
  name: string;
  status: OrgStatus;
  planId?: string;
  /** Billing is manual for now (platform admin grants the plan). */
  billingStatus: 'manual' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'awaiting_plan';
  planSource: 'manual' | 'stripe';
  currentPeriodEnd?: string;
  pastDueSince?: string;
  contactEmail?: string;
  /** The customer's own workspace, when the org was created by an agency plan (its admins are org admins). */
  homeTenantId?: string;
  /** Per-organization overrides of plan features/limits, same shape as tenant overrides. */
  overrides?: { features?: Record<string, boolean>; limits?: Record<string, number> };
  createdAt: string;
  updatedAt?: string;
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
  /** Set when this workspace is a client brand of an organization (agency). Billing/plan then come from the org. */
  orgId?: string;
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
  /** Set for organization admins (they have no single tenant; they act in any client of their org). */
  orgId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthClaims {
  tenantId?: string;
  orgId?: string;
  role?: UserRole;
  platformAdmin?: boolean;
}

export interface TenantContext {
  /** '' for an organization admin who has not selected a client brand (org-level requests only). */
  tenantId: string;
  /** Set when the caller is an organization admin; the selected tenant is verified to belong to this org. */
  orgId?: string;
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
