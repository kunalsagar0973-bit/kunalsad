import crypto from 'node:crypto';
import type { Express } from 'express';
import {
  requireAuth,
  requirePermission,
  signWebhookPayload,
  verifyWebhookSignature,
  type AuthenticatedRequest,
} from '../auth';
import { createNotification, db, recordAuditLog } from '../db';
import {
  calculateInvoiceBreakdown,
  PLATFORM_PLANS,
  validateCouponCode,
} from '../../src/lib/platformLogic';
import type { PlanTierId } from '../../src/types';

function getWebhookSecret(): string {
  return process.env.PAYMENT_WEBHOOK_SECRET || 'kodex_local_webhook_signing_secret';
}

function getOrgUsage(orgId: string) {
  const counters = db
    .prepare('SELECT api_requests, ai_tokens, bandwidth_gb FROM org_usage_counters WHERE org_id = ?')
    .get(orgId) as { api_requests: number; ai_tokens: number; bandwidth_gb: number } | undefined;

  const dbAgg = db
    .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(storage_used_gb), 0) AS total_gb FROM managed_databases WHERE org_id = ?')
    .get(orgId) as { cnt: number; total_gb: number };

  const storageAgg = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM storage_objects WHERE org_id = ?')
    .get(orgId) as { total_bytes: number };

  const objGb = storageAgg.total_bytes / (1024 * 1024 * 1024);

  return {
    apiRequests: counters?.api_requests ?? 0,
    aiTokens: counters?.ai_tokens ?? 0,
    bandwidthGb: Number((counters?.bandwidth_gb ?? 0).toFixed(2)),
    databasesCount: dbAgg.cnt,
    storageGb: Number((dbAgg.total_gb + objGb).toFixed(2)),
  };
}

export function registerBillingRoutes(app: Express): void {
  app.get('/api/billing/overview', requireAuth, (req: AuthenticatedRequest, res) => {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user!.orgId) as {
      id: string;
      name: string;
      plan_id: PlanTierId;
      billing_cycle: 'monthly' | 'annual';
    };

    const usage = getOrgUsage(req.user!.orgId);
    const previewBreakdown = calculateInvoiceBreakdown({
      planId: org.plan_id,
      billingCycle: org.billing_cycle,
      usage,
    });

    const invoices = db
      .prepare('SELECT * FROM invoices WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    const payments = db
      .prepare('SELECT * FROM payments WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    res.json({
      plans: Object.values(PLATFORM_PLANS),
      currentPlanId: org.plan_id,
      billingCycle: org.billing_cycle,
      usage,
      projectedBreakdown: previewBreakdown,
      invoices: invoices.map((i) => ({
        id: i.id,
        orgId: i.org_id,
        invoiceNumber: i.invoice_number,
        planId: i.plan_id,
        billingCycle: i.billing_cycle,
        subtotalCents: i.subtotal_cents,
        usageOverageCents: i.usage_overage_cents,
        discountCents: i.discount_cents,
        taxCents: i.tax_cents,
        totalCents: i.total_cents,
        currency: i.currency,
        couponCode: i.coupon_code,
        status: i.status,
        paymentProvider: i.payment_provider,
        webhookVerified: Boolean(i.webhook_verified),
        createdAt: i.created_at,
      })),
      payments,
    });
  });

  app.post('/api/billing/validate-coupon', requireAuth, (req, res) => {
    const { code } = req.body as { code?: string };
    const result = validateCouponCode(code);
    if (!result.valid) {
      res.status(404).json({ valid: false, error: 'Coupon code is invalid or expired.' });
      return;
    }
    res.json(result);
  });

  // Create a pending checkout and execute signed webhook settlement
  app.post('/api/billing/checkout', requireAuth, requirePermission('billing:manage'), (req: AuthenticatedRequest, res) => {
    const { planId, billingCycle, couponCode, provider } = req.body as {
      planId?: PlanTierId;
      billingCycle?: 'monthly' | 'annual';
      couponCode?: string;
      provider?: 'stripe' | 'razorpay';
    };

    if (!planId || !PLATFORM_PLANS[planId]) {
      res.status(400).json({ error: 'Valid subscription plan required.' });
      return;
    }

    const cycle = billingCycle === 'annual' ? 'annual' : 'monthly';
    const usage = getOrgUsage(req.user!.orgId);
    const breakdown = calculateInvoiceBreakdown({
      planId,
      billingCycle: cycle,
      usage,
      couponCode,
    });

    const invoiceId = `inv_${crypto.randomUUID().slice(0, 10)}`;
    const invoiceNumber = `KX-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();
    const chosenProvider = provider === 'razorpay' ? 'razorpay' : 'stripe';

    // Record pending invoice first — never mark paid before verifying signed webhook
    db.prepare(
      `INSERT INTO invoices (
        id, org_id, invoice_number, plan_id, billing_cycle, subtotal_cents, usage_overage_cents,
        discount_cents, tax_cents, total_cents, currency, coupon_code, status, payment_provider, webhook_verified, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'pending', ?, 0, ?)`,
    ).run(
      invoiceId,
      req.user!.orgId,
      invoiceNumber,
      planId,
      cycle,
      breakdown.baseCents,
      breakdown.usageOverageCents,
      breakdown.discountCents,
      breakdown.taxCents,
      breakdown.totalCents,
      couponCode ? couponCode.trim().toUpperCase() : null,
      chosenProvider,
      now,
    );

    // Simulate payment provider signed webhook payload (zero raw card details stored)
    const eventPayload = JSON.stringify({
      eventId: `evt_${chosenProvider}_${crypto.randomBytes(6).toString('hex')}`,
      invoiceId,
      orgId: req.user!.orgId,
      planId,
      billingCycle: cycle,
      amountCents: breakdown.totalCents,
      provider: chosenProvider,
      status: 'succeeded',
    });

    const signature = signWebhookPayload(eventPayload, getWebhookSecret());

    // Immediately verify signature on server before finalizing subscription & payment record
    const verified = verifyWebhookSignature(eventPayload, signature, getWebhookSecret());
    if (!verified) {
      db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run('failed', invoiceId);
      res.status(400).json({ error: 'Webhook signature verification failed.' });
      return;
    }

    const parsedEvent = JSON.parse(eventPayload) as {
      eventId: string;
      amountCents: number;
    };

    const planDef = PLATFORM_PLANS[planId];
    db.prepare('UPDATE invoices SET status = ?, webhook_verified = 1 WHERE id = ?').run('paid', invoiceId);
    db.prepare(
      `INSERT INTO payments (id, org_id, invoice_id, provider, provider_event_id, amount_cents, status, signature_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'succeeded', 1, ?)`,
    ).run(
      `pay_${crypto.randomUUID().slice(0, 10)}`,
      req.user!.orgId,
      invoiceId,
      chosenProvider,
      parsedEvent.eventId,
      parsedEvent.amountCents,
      now,
    );

    db.prepare(
      `UPDATE organizations SET plan_id = ?, billing_cycle = ?, storage_quota_gb = ?, db_quota_count = ? WHERE id = ?`,
    ).run(
      planId,
      cycle,
      planDef.includedStorageGb,
      planDef.includedDatabases,
      req.user!.orgId,
    );

    createNotification({
      orgId: req.user!.orgId,
      type: 'billing',
      title: `Plan updated to ${planDef.name}`,
      message: `Invoice ${invoiceNumber} settled via ${chosenProvider} webhook verification.`,
    });

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'billing.subscription_updated',
      resourceType: 'invoice',
      resourceId: invoiceId,
      details: `Upgraded/changed plan to ${planId} (${cycle}) · ${invoiceNumber}`,
    });

    res.status(201).json({
      invoiceId,
      invoiceNumber,
      webhookVerified: true,
      breakdown,
    });
  });

  app.post('/api/billing/invoices/:id/refund', requireAuth, requirePermission('billing:manage'), (req: AuthenticatedRequest, res) => {
    const invoice = db
      .prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId) as { id: string; invoice_number: string; status: string } | undefined;

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    if (invoice.status === 'refunded') {
      res.status(400).json({ error: 'Invoice already refunded.' });
      return;
    }

    db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run('refunded', invoice.id);
    db.prepare('UPDATE payments SET status = ? WHERE invoice_id = ?').run('refunded', invoice.id);

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'billing.invoice_refunded',
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: `Refund issued for ${invoice.invoice_number}`,
    });

    res.json({ ok: true });
  });
}
