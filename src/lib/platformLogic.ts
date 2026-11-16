import type {
  BuilderFile,
  PlanDefinition,
  PlanTierId,
  PlatformRole,
} from '../types';

export const PLATFORM_PLANS: Record<PlanTierId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    audience: 'For individual exploration & prototypes',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    includedApiRequests: 10_000,
    includedAiTokens: 50_000,
    includedStorageGb: 5,
    includedDatabases: 1,
    includedDeployments: 3,
    includedBandwidthGb: 20,
    features: [
      '10,000 monthly API gateway requests',
      '50,000 AI App Builder tokens',
      '1 managed database · 5 GB object storage',
      'Community support & TLS hosting',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    audience: 'For early-stage teams shipping fast',
    monthlyPriceCents: 2900,
    annualPriceCents: 27840,
    includedApiRequests: 250_000,
    includedAiTokens: 500_000,
    includedStorageGb: 50,
    includedDatabases: 3,
    includedDeployments: 15,
    includedBandwidthGb: 200,
    features: [
      '250,000 monthly API gateway requests',
      '500,000 AI App Builder tokens',
      '3 managed databases · 50 GB object storage',
      'Custom domains & automatic SSL',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    audience: 'For growing SaaS & production workloads',
    monthlyPriceCents: 9900,
    annualPriceCents: 95040,
    includedApiRequests: 2_000_000,
    includedAiTokens: 3_000_000,
    includedStorageGb: 250,
    includedDatabases: 10,
    includedDeployments: 50,
    includedBandwidthGb: 1000,
    features: [
      '2,000,000 monthly API gateway requests',
      '3,000,000 AI App Builder tokens',
      '10 managed databases · 250 GB object storage',
      'Scheduled backups, 2FA & team RBAC',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    audience: 'For scaling operations & multi-region apps',
    monthlyPriceCents: 29900,
    annualPriceCents: 287040,
    includedApiRequests: 10_000_000,
    includedAiTokens: 12_000_000,
    includedStorageGb: 1000,
    includedDatabases: 30,
    includedDeployments: 200,
    includedBandwidthGb: 5000,
    features: [
      '10,000,000 monthly API gateway requests',
      '12,000,000 AI App Builder tokens',
      '30 managed databases · 1 TB object storage',
      'Priority SLA, webhooks & audit streaming',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'For regulated tenants & dedicated clouds',
    monthlyPriceCents: 89900,
    annualPriceCents: 863040,
    includedApiRequests: 50_000_000,
    includedAiTokens: 50_000_000,
    includedStorageGb: 5000,
    includedDatabases: 100,
    includedDeployments: 1000,
    includedBandwidthGb: 25000,
    features: [
      '50,000,000 monthly API gateway requests',
      '50,000,000 AI App Builder tokens',
      '100 isolated databases · 5 TB encrypted storage',
      'Dedicated tenant isolation, SSO & 24/7 response',
    ],
  },
};

export interface UsageMetrics {
  apiRequests: number;
  aiTokens: number;
  storageGb: number;
  databasesCount: number;
  bandwidthGb: number;
}

export interface InvoiceBreakdown {
  baseCents: number;
  apiOverageCents: number;
  aiOverageCents: number;
  storageOverageCents: number;
  databaseOverageCents: number;
  bandwidthOverageCents: number;
  usageOverageCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

const PROMO_COUPONS: Record<string, { percentOff: number; fixedOffCents?: number }> = {
  KODEX20: { percentOff: 20 },
  STARTUP50: { percentOff: 50 },
  CLOUD100: { percentOff: 0, fixedOffCents: 10000 },
};

export function validateCouponCode(code?: string | null): {
  valid: boolean;
  code: string | null;
  percentOff: number;
  fixedOffCents: number;
} {
  if (!code) {
    return { valid: false, code: null, percentOff: 0, fixedOffCents: 0 };
  }
  const normalized = code.trim().toUpperCase();
  const entry = PROMO_COUPONS[normalized];
  if (!entry) {
    return { valid: false, code: normalized, percentOff: 0, fixedOffCents: 0 };
  }
  return {
    valid: true,
    code: normalized,
    percentOff: entry.percentOff,
    fixedOffCents: entry.fixedOffCents ?? 0,
  };
}

export function calculateInvoiceBreakdown(params: {
  planId: PlanTierId;
  billingCycle: 'monthly' | 'annual';
  usage: UsageMetrics;
  couponCode?: string | null;
  taxRatePercent?: number;
}): InvoiceBreakdown {
  const plan = PLATFORM_PLANS[params.planId] ?? PLATFORM_PLANS.free;
  const baseCents =
    params.billingCycle === 'annual' ? plan.annualPriceCents : plan.monthlyPriceCents;

  const extraRequests = Math.max(0, params.usage.apiRequests - plan.includedApiRequests);
  const apiOverageCents = Math.ceil(extraRequests / 10_000) * 150;

  const extraTokens = Math.max(0, params.usage.aiTokens - plan.includedAiTokens);
  const aiOverageCents = Math.ceil(extraTokens / 100_000) * 200;

  const extraStorageGb = Math.max(0, params.usage.storageGb - plan.includedStorageGb);
  const storageOverageCents = Math.ceil(extraStorageGb) * 25;

  const extraDbs = Math.max(0, params.usage.databasesCount - plan.includedDatabases);
  const databaseOverageCents = extraDbs * 1500;

  const extraBandwidthGb = Math.max(
    0,
    params.usage.bandwidthGb - plan.includedBandwidthGb,
  );
  const bandwidthOverageCents = Math.ceil(extraBandwidthGb) * 10;

  const usageOverageCents =
    apiOverageCents +
    aiOverageCents +
    storageOverageCents +
    databaseOverageCents +
    bandwidthOverageCents;

  const grossCents = baseCents + usageOverageCents;

  const coupon = validateCouponCode(params.couponCode);
  let discountCents = 0;
  if (coupon.valid) {
    discountCents = Math.round((grossCents * coupon.percentOff) / 100) + coupon.fixedOffCents;
    discountCents = Math.min(grossCents, discountCents);
  }

  const taxableCents = Math.max(0, grossCents - discountCents);
  const taxRate = params.taxRatePercent ?? 18;
  const taxCents = Math.round((taxableCents * taxRate) / 100);
  const totalCents = taxableCents + taxCents;

  return {
    baseCents,
    apiOverageCents,
    aiOverageCents,
    storageOverageCents,
    databaseOverageCents,
    bandwidthOverageCents,
    usageOverageCents,
    discountCents,
    taxCents,
    totalCents,
  };
}

export type PermissionAction =
  | 'marketplace:read'
  | 'marketplace:manage_keys'
  | 'builder:use'
  | 'hosting:deploy'
  | 'datacloud:read'
  | 'datacloud:write'
  | 'billing:manage'
  | 'org:manage_team'
  | 'admin:platform';

const ROLE_PERMISSIONS: Record<PlatformRole, Set<PermissionAction>> = {
  super_admin: new Set([
    'marketplace:read',
    'marketplace:manage_keys',
    'builder:use',
    'hosting:deploy',
    'datacloud:read',
    'datacloud:write',
    'billing:manage',
    'org:manage_team',
    'admin:platform',
  ]),
  org_admin: new Set([
    'marketplace:read',
    'marketplace:manage_keys',
    'builder:use',
    'hosting:deploy',
    'datacloud:read',
    'datacloud:write',
    'billing:manage',
    'org:manage_team',
  ]),
  developer: new Set([
    'marketplace:read',
    'marketplace:manage_keys',
    'builder:use',
    'hosting:deploy',
    'datacloud:read',
    'datacloud:write',
  ]),
  enterprise_member: new Set([
    'marketplace:read',
    'marketplace:manage_keys',
    'builder:use',
    'hosting:deploy',
    'datacloud:read',
    'datacloud:write',
  ]),
  customer: new Set([
    'marketplace:read',
    'marketplace:manage_keys',
    'builder:use',
    'hosting:deploy',
    'datacloud:read',
    'billing:manage',
  ]),
};

export function hasPermission(role: PlatformRole, action: PermissionAction): boolean {
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}

export function canAccessTenantResource(params: {
  userRole: PlatformRole;
  userOrgId: string;
  resourceOrgId: string;
  action: PermissionAction;
}): boolean {
  if (!hasPermission(params.userRole, params.action)) {
    return false;
  }
  if (params.userRole === 'super_admin' && params.action === 'admin:platform') {
    return true;
  }
  return params.userOrgId === params.resourceOrgId;
}

export function evaluateRateLimit(params: {
  requestsInWindow: number;
  limitPerMinute: number;
}): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, params.limitPerMinute - params.requestsInWindow);
  return {
    allowed: params.requestsInWindow < params.limitPerMinute,
    remaining,
  };
}

export function slugifySubdomain(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || 'kodex-app';
}

export function formatCurrencyCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function buildPreviewHtml(files: BuilderFile[]): string {
  const htmlFile = files.find((f) => f.path.endsWith('index.html'));
  const cssFiles = files.filter((f) => f.path.endsWith('.css'));
  const jsFiles = files.filter(
    (f) => f.path.endsWith('.js') && !f.path.includes('server') && !f.path.includes('schema'),
  );

  const combinedCss = cssFiles.map((f) => f.content).join('\n');
  const combinedJs = jsFiles.map((f) => f.content).join('\n');

  if (htmlFile) {
    let html = htmlFile.content;
    if (combinedCss && !html.includes(combinedCss.slice(0, 24))) {
      const styleTag = `<style>\n${combinedCss}\n</style>`;
      html = html.includes('</head>')
        ? html.replace('</head>', `${styleTag}\n</head>`)
        : `${styleTag}\n${html}`;
    }
    if (combinedJs && !html.includes(combinedJs.slice(0, 24))) {
      const scriptTag = `<script>\n${combinedJs}\n</script>`;
      html = html.includes('</body>')
        ? html.replace('</body>', `${scriptTag}\n</body>`)
        : `${html}\n${scriptTag}`;
    }
    return html;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #0f172a; background: #ffffff; }
    ${combinedCss}
  </style>
</head>
<body>
  <main>
    <h1>Generated Application Preview</h1>
    <p>Files in workspace: ${files.map((f) => f.path).join(', ')}</p>
  </main>
  <script>${combinedJs}</script>
</body>
</html>`;
}
