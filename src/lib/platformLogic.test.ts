import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreviewHtml,
  calculateInvoiceBreakdown,
  canAccessTenantResource,
  evaluateRateLimit,
  formatBytes,
  formatCurrencyCents,
  hasPermission,
  slugifySubdomain,
  validateCouponCode,
} from './platformLogic';

test('billing calculation computes base, overages, promo discount, and GST tax accurately', () => {
  const breakdown = calculateInvoiceBreakdown({
    planId: 'starter',
    billingCycle: 'monthly',
    usage: {
      apiRequests: 270_000, // 20,000 overage => 2 * 150 = 300 cents
      aiTokens: 600_000, // 100,000 overage => 1 * 200 = 200 cents
      storageGb: 52, // 2 GB overage => 2 * 25 = 50 cents
      databasesCount: 4, // 1 overage => 1500 cents
      bandwidthGb: 205, // 5 GB overage => 5 * 10 = 50 cents
    },
    couponCode: 'KODEX20',
    taxRatePercent: 18,
  });

  assert.equal(breakdown.baseCents, 2900);
  assert.equal(breakdown.apiOverageCents, 300);
  assert.equal(breakdown.aiOverageCents, 200);
  assert.equal(breakdown.storageOverageCents, 50);
  assert.equal(breakdown.databaseOverageCents, 1500);
  assert.equal(breakdown.bandwidthOverageCents, 50);
  assert.equal(breakdown.usageOverageCents, 2100);
  // Gross = 5000, 20% off = 1000, taxable = 4000, 18% GST = 720, total = 4720
  assert.equal(breakdown.discountCents, 1000);
  assert.equal(breakdown.taxCents, 720);
  assert.equal(breakdown.totalCents, 4720);
});

test('coupon validation rejects invalid codes and normalizes valid codes', () => {
  assert.equal(validateCouponCode('invalid99').valid, false);
  const valid = validateCouponCode(' startup50 ');
  assert.equal(valid.valid, true);
  assert.equal(valid.code, 'STARTUP50');
  assert.equal(valid.percentOff, 50);
});

test('RBAC and tenant isolation prevent cross-tenant data access', () => {
  assert.equal(hasPermission('developer', 'admin:platform'), false);
  assert.equal(hasPermission('super_admin', 'admin:platform'), true);

  // Same org developer can read datacloud
  assert.equal(
    canAccessTenantResource({
      userRole: 'developer',
      userOrgId: 'org-1',
      resourceOrgId: 'org-1',
      action: 'datacloud:read',
    }),
    true,
  );

  // Enterprise member from org-2 MUST NOT access org-1 private data
  assert.equal(
    canAccessTenantResource({
      userRole: 'enterprise_member',
      userOrgId: 'org-2',
      resourceOrgId: 'org-1',
      action: 'datacloud:read',
    }),
    false,
  );

  // Even org_admin cannot cross into another org's tenant data
  assert.equal(
    canAccessTenantResource({
      userRole: 'org_admin',
      userOrgId: 'org-1',
      resourceOrgId: 'org-2',
      action: 'datacloud:write',
    }),
    false,
  );
});

test('rate limiter and formatting helpers behave deterministically', () => {
  assert.deepEqual(evaluateRateLimit({ requestsInWindow: 59, limitPerMinute: 60 }), {
    allowed: true,
    remaining: 1,
  });
  assert.deepEqual(evaluateRateLimit({ requestsInWindow: 60, limitPerMinute: 60 }), {
    allowed: false,
    remaining: 0,
  });
  assert.equal(slugifySubdomain('My SaaS Portal!!'), 'my-saas-portal');
  assert.equal(formatCurrencyCents(4720), '$47.20');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('buildPreviewHtml injects CSS and JS cleanly into index.html', () => {
  const html = buildPreviewHtml([
    {
      path: 'index.html',
      language: 'html',
      content: '<html><head><title>App</title></head><body><h1>Hello</h1></body></html>',
    },
    { path: 'styles.css', language: 'css', content: 'body { color: red; }' },
    { path: 'app.js', language: 'javascript', content: 'console.log("ok");' },
  ]);
  assert.ok(html.includes('body { color: red; }'));
  assert.ok(html.includes('console.log("ok");'));
});
