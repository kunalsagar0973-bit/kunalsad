export type PlatformRole =
  | 'super_admin'
  | 'org_admin'
  | 'developer'
  | 'customer'
  | 'enterprise_member';

export type PortalSection =
  | 'overview'
  | 'marketplace'
  | 'builder'
  | 'hosting'
  | 'datacloud'
  | 'billing'
  | 'support'
  | 'docs'
  | 'account'
  | 'admin';

export type PlanTierId = 'free' | 'starter' | 'pro' | 'business' | 'enterprise';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  orgId: string;
  orgName: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  status: 'active' | 'suspended';
  avatarUrl?: string | null;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  planId: PlanTierId;
  billingCycle: 'monthly' | 'annual';
  storageQuotaGb: number;
  dbQuotaCount: number;
  createdAt: string;
}

export interface ApiProduct {
  id: string;
  slug: string;
  name: string;
  provider: string;
  category: string;
  version: string;
  description: string;
  basePath: string;
  uptimePercent: number;
  avgLatencyMs: number;
  pricingModel: string;
  starterPriceCents: number;
  proPriceCents: number;
  rateLimitPerMin: number;
  monthlyQuota: number;
  sampleRequest: string;
  sampleResponse: string;
  endpoints: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    summary: string;
    scope: string;
  }>;
  status: 'operational' | 'degraded' | 'maintenance';
}

export interface ApiSubscription {
  id: string;
  orgId: string;
  apiId: string;
  apiName: string;
  apiSlug: string;
  planName: string;
  monthlyQuota: number;
  requestsUsed: number;
  tokensUsed: number;
  status: 'active' | 'cancelled';
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  orgId: string;
  userId: string;
  apiId: string;
  apiName: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitPerMin: number;
  requestsCount: number;
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface ApiLogRecord {
  id: string;
  orgId: string;
  apiId: string;
  apiName: string;
  keyPrefix: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  tokensUsed: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface WebhookRecord {
  id: string;
  orgId: string;
  apiId: string;
  url: string;
  events: string[];
  secretPrefix: string;
  status: 'active' | 'disabled';
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface BuilderFile {
  path: string;
  language: string;
  content: string;
}

export interface AiProject {
  id: string;
  orgId: string;
  name: string;
  description: string;
  framework: string;
  model: string;
  files: BuilderFile[];
  envVars: Array<{ key: string; value: string }>;
  customDomain: string | null;
  status: 'ready' | 'building' | 'error';
  updatedAt: string;
  createdAt: string;
}

export interface AiProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  summary: string;
  files: BuilderFile[];
  createdAt: string;
}

export interface HostingDeployment {
  id: string;
  orgId: string;
  projectId: string | null;
  projectName: string;
  environment: 'production' | 'staging' | 'preview';
  region: string;
  branch: string;
  commitSha: string;
  url: string;
  status: 'live' | 'building' | 'failed' | 'rolled_back';
  buildDurationMs: number;
  cpuPercent: number;
  memoryMb: number;
  bandwidthGb: number;
  buildLogs: string[];
  createdAt: string;
}

export interface HostingDomain {
  id: string;
  orgId: string;
  projectName: string;
  domain: string;
  sslStatus: 'active' | 'pending';
  dnsVerified: boolean;
  createdAt: string;
}

export interface ManagedDatabase {
  id: string;
  orgId: string;
  name: string;
  engine: 'postgresql' | 'mysql' | 'mongodb' | 'redis';
  version: string;
  region: string;
  tier: string;
  storageUsedGb: number;
  storageLimitGb: number;
  connectionLimit: number;
  activeConnections: number;
  cpuPercent: number;
  iops: number;
  host: string;
  port: number;
  dbName: string;
  username: string;
  status: 'available' | 'backing_up' | 'restoring';
  createdAt: string;
}

export interface DatabaseBackup {
  id: string;
  orgId: string;
  databaseId: string;
  databaseName: string;
  type: 'scheduled' | 'manual';
  sizeMb: number;
  retentionDays: number;
  encrypted: boolean;
  status: 'completed' | 'restoring';
  createdAt: string;
}

export interface StorageObject {
  id: string;
  orgId: string;
  bucket: string;
  folder: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  visibility: 'private' | 'org_shared';
  checksum: string;
  uploadedBy: string;
  createdAt: string;
}

export interface PlanDefinition {
  id: PlanTierId;
  name: string;
  audience: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedApiRequests: number;
  includedAiTokens: number;
  includedStorageGb: number;
  includedDatabases: number;
  includedDeployments: number;
  includedBandwidthGb: number;
  features: string[];
}

export interface InvoiceRecord {
  id: string;
  orgId: string;
  invoiceNumber: string;
  planId: PlanTierId;
  billingCycle: 'monthly' | 'annual';
  subtotalCents: number;
  usageOverageCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  couponCode: string | null;
  status: 'paid' | 'pending' | 'failed' | 'refunded';
  paymentProvider: string;
  webhookVerified: boolean;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  orgId: string;
  userId: string;
  userName: string;
  subject: string;
  category: 'billing' | 'api' | 'hosting' | 'datacloud' | 'security';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  orgId: string;
  userId: string | null;
  type: 'deployment' | 'billing' | 'security' | 'usage' | 'announcement';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorId: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string;
  details: string;
  createdAt: string;
}
