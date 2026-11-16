import crypto from 'node:crypto';
import type { Express } from 'express';
import {
  requireAuth,
  requirePermission,
  type AuthenticatedRequest,
} from '../auth';
import { createNotification, db, hashSha256, recordAuditLog } from '../db';
import { evaluateRateLimit } from '../../src/lib/platformLogic';

const slidingRateBuckets = new Map<string, { windowStart: number; count: number }>();

export function registerMarketplaceRoutes(app: Express): void {
  app.get('/api/marketplace/catalog', requireAuth, (req: AuthenticatedRequest, res) => {
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const category = ((req.query.category as string) || 'all').trim();

    const rows = db.prepare('SELECT * FROM api_products ORDER BY name ASC').all() as Array<Record<string, unknown>>;

    const filtered = rows
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        provider: r.provider,
        category: r.category,
        version: r.version,
        description: r.description,
        basePath: r.base_path,
        uptimePercent: r.uptime_percent,
        avgLatencyMs: r.avg_latency_ms,
        pricingModel: r.pricing_model,
        starterPriceCents: r.starter_price_cents,
        proPriceCents: r.pro_price_cents,
        rateLimitPerMin: r.rate_limit_per_min,
        monthlyQuota: r.monthly_quota,
        sampleRequest: r.sample_request,
        sampleResponse: r.sample_response,
        endpoints: JSON.parse(String(r.endpoints_json || '[]')),
        status: r.status,
      }))
      .filter((item) => {
        const matchesCat = category === 'all' || item.category === category;
        const matchesSearch =
          !search ||
          String(item.name).toLowerCase().includes(search) ||
          String(item.description).toLowerCase().includes(search) ||
          String(item.category).toLowerCase().includes(search);
        return matchesCat && matchesSearch;
      });

    const subscriptions = db
      .prepare(
        `SELECT s.*, p.name AS api_name, p.slug AS api_slug
         FROM api_subscriptions s
         JOIN api_products p ON p.id = s.api_id
         WHERE s.org_id = ?
         ORDER BY s.created_at DESC`,
      )
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    const keys = db
      .prepare(
        `SELECT k.id, k.org_id, k.user_id, k.api_id, p.name AS api_name, k.name, k.key_prefix,
                k.scopes_json, k.rate_limit_per_min, k.requests_count, k.last_used_at, k.status, k.created_at
         FROM api_keys k
         JOIN api_products p ON p.id = k.api_id
         WHERE k.org_id = ?
         ORDER BY k.created_at DESC`,
      )
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    const logs = db
      .prepare(
        `SELECT l.*, p.name AS api_name
         FROM api_logs l
         JOIN api_products p ON p.id = l.api_id
         WHERE l.org_id = ?
         ORDER BY l.created_at DESC
         LIMIT 50`,
      )
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    const webhooks = db
      .prepare('SELECT * FROM webhooks WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    res.json({
      products: filtered,
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        orgId: s.org_id,
        apiId: s.api_id,
        apiName: s.api_name,
        apiSlug: s.api_slug,
        planName: s.plan_name,
        monthlyQuota: s.monthly_quota,
        requestsUsed: s.requests_used,
        tokensUsed: s.tokens_used,
        status: s.status,
        createdAt: s.created_at,
      })),
      keys: keys.map((k) => ({
        id: k.id,
        orgId: k.org_id,
        userId: k.user_id,
        apiId: k.api_id,
        apiName: k.api_name,
        name: k.name,
        keyPrefix: k.key_prefix,
        scopes: JSON.parse(String(k.scopes_json || '[]')),
        rateLimitPerMin: k.rate_limit_per_min,
        requestsCount: k.requests_count,
        lastUsedAt: k.last_used_at,
        status: k.status,
        createdAt: k.created_at,
      })),
      logs: logs.map((l) => ({
        id: l.id,
        orgId: l.org_id,
        apiId: l.api_id,
        apiName: l.api_name,
        keyPrefix: l.key_prefix,
        method: l.method,
        path: l.path,
        statusCode: l.status_code,
        latencyMs: l.latency_ms,
        tokensUsed: l.tokens_used,
        errorMessage: l.error_message,
        createdAt: l.created_at,
      })),
      webhooks: webhooks.map((w) => ({
        id: w.id,
        orgId: w.org_id,
        apiId: w.api_id,
        url: w.url,
        events: JSON.parse(String(w.events_json || '[]')),
        secretPrefix: w.secret_prefix,
        status: w.status,
        lastTriggeredAt: w.last_triggered_at,
        createdAt: w.created_at,
      })),
    });
  });

  app.post('/api/marketplace/subscribe', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    const { apiId, planName } = req.body as { apiId?: string; planName?: string };
    if (!apiId) {
      res.status(400).json({ error: 'apiId is required.' });
      return;
    }

    const product = db.prepare('SELECT * FROM api_products WHERE id = ?').get(apiId) as Record<string, unknown> | undefined;
    if (!product) {
      res.status(404).json({ error: 'API product not found.' });
      return;
    }

    const quotaMap: Record<string, number> = {
      Free: 10_000,
      Starter: 100_000,
      Pro: Number(product.monthly_quota) || 250_000,
      Business: 1_000_000,
      Enterprise: 10_000_000,
    };
    const chosenPlan = planName && quotaMap[planName] ? planName : 'Pro';
    const monthlyQuota = quotaMap[chosenPlan];
    const now = new Date().toISOString();

    const existing = db
      .prepare('SELECT id FROM api_subscriptions WHERE org_id = ? AND api_id = ?')
      .get(req.user!.orgId, apiId) as { id: string } | undefined;

    if (existing) {
      db.prepare('UPDATE api_subscriptions SET plan_name = ?, monthly_quota = ?, status = ? WHERE id = ?').run(
        chosenPlan,
        monthlyQuota,
        'active',
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO api_subscriptions (id, org_id, api_id, plan_name, monthly_quota, requests_used, tokens_used, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 'active', ?)`,
      ).run(`sub_${crypto.randomUUID().slice(0, 10)}`, req.user!.orgId, apiId, chosenPlan, monthlyQuota, now);
    }

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'marketplace.subscribed',
      resourceType: 'api_subscription',
      resourceId: apiId,
      details: `Subscribed to ${product.name} (${chosenPlan})`,
    });

    createNotification({
      orgId: req.user!.orgId,
      type: 'billing',
      title: `Subscribed to ${product.name}`,
      message: `${chosenPlan} plan activated with ${monthlyQuota.toLocaleString()} monthly requests.`,
    });

    res.json({ ok: true, planName: chosenPlan, monthlyQuota });
  });

  app.post('/api/marketplace/subscriptions/:id/cancel', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    const result = db
      .prepare('UPDATE api_subscriptions SET status = ? WHERE id = ? AND org_id = ?')
      .run('cancelled', req.params.id, req.user!.orgId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Subscription not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/marketplace/keys', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    const { apiId, name, scopes, rateLimitPerMin } = req.body as {
      apiId?: string;
      name?: string;
      scopes?: string[];
      rateLimitPerMin?: number;
    };

    if (!apiId || !name?.trim()) {
      res.status(400).json({ error: 'API selection and key label are required.' });
      return;
    }

    const product = db.prepare('SELECT id, name, slug, rate_limit_per_min FROM api_products WHERE id = ?').get(apiId) as
      | { id: string; name: string; slug: string; rate_limit_per_min: number }
      | undefined;

    if (!product) {
      res.status(404).json({ error: 'API product not found.' });
      return;
    }

    const rawKey = `kx_live_${product.slug.replace(/-/g, '')}_${crypto.randomBytes(16).toString('hex')}`;
    const keyPrefix = `${rawKey.slice(0, 18)}...`;
    const keyHash = hashSha256(rawKey);
    const keyId = `key_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO api_keys (id, org_id, user_id, api_id, name, key_prefix, key_hash, scopes_json, rate_limit_per_min, requests_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)`,
    ).run(
      keyId,
      req.user!.orgId,
      req.user!.id,
      apiId,
      name.trim(),
      keyPrefix,
      keyHash,
      JSON.stringify(scopes?.length ? scopes : [`${product.slug.split('-')[0]}:read`, `${product.slug.split('-')[0]}:write`]),
      rateLimitPerMin ?? product.rate_limit_per_min,
      now,
    );

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'apikey.created',
      resourceType: 'api_key',
      resourceId: keyId,
      details: `Generated API key "${name.trim()}" for ${product.name}`,
    });

    res.status(201).json({
      id: keyId,
      rawKey,
      keyPrefix,
      apiName: product.name,
    });
  });

  app.post('/api/marketplace/keys/:id/rotate', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    const existing = db
      .prepare('SELECT k.id, k.name, p.slug FROM api_keys k JOIN api_products p ON p.id = k.api_id WHERE k.id = ? AND k.org_id = ?')
      .get(req.params.id, req.user!.orgId) as { id: string; name: string; slug: string } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }

    const rawKey = `kx_live_${existing.slug.replace(/-/g, '')}_${crypto.randomBytes(16).toString('hex')}`;
    const keyPrefix = `${rawKey.slice(0, 18)}...`;

    db.prepare('UPDATE api_keys SET key_prefix = ?, key_hash = ?, status = ? WHERE id = ?').run(
      keyPrefix,
      hashSha256(rawKey),
      'active',
      existing.id,
    );

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'apikey.rotated',
      resourceType: 'api_key',
      resourceId: existing.id,
      details: `Rotated key "${existing.name}"`,
    });

    res.json({ rawKey, keyPrefix });
  });

  app.post('/api/marketplace/keys/:id/revoke', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    const result = db
      .prepare('UPDATE api_keys SET status = ? WHERE id = ? AND org_id = ?')
      .run('revoked', req.params.id, req.user!.orgId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'apikey.revoked',
      resourceType: 'api_key',
      resourceId: req.params.id,
      details: 'Revoked API key',
    });

    res.json({ ok: true });
  });

  app.post('/api/marketplace/webhooks', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    const { apiId, url, events } = req.body as { apiId?: string; url?: string; events?: string[] };
    if (!apiId || !url || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: 'Valid webhook URL (http/https) and API are required.' });
      return;
    }
    const id = `wh_${crypto.randomUUID().slice(0, 10)}`;
    const secret = `whsec_${crypto.randomBytes(12).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO webhooks (id, org_id, api_id, url, events_json, secret_prefix, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).run(id, req.user!.orgId, apiId, url.trim(), JSON.stringify(events?.length ? events : ['request.completed']), `${secret.slice(0, 11)}...`, now);

    res.status(201).json({ id, secret, secretPrefix: `${secret.slice(0, 11)}...` });
  });

  app.delete('/api/marketplace/webhooks/:id', requireAuth, requirePermission('marketplace:manage_keys'), (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM webhooks WHERE id = ? AND org_id = ?').run(req.params.id, req.user!.orgId);
    res.json({ ok: true });
  });

  // Live API Playground & Gateway Execution Engine
  app.post('/api/marketplace/playground/execute', requireAuth, (req: AuthenticatedRequest, res) => {
    const started = Date.now();
    const { apiId, method, path, payload, rawApiKey } = req.body as {
      apiId?: string;
      method?: string;
      path?: string;
      payload?: string;
      rawApiKey?: string;
    };

    const product = db.prepare('SELECT * FROM api_products WHERE id = ?').get(apiId) as Record<string, unknown> | undefined;
    if (!product) {
      res.status(404).json({ error: 'API product not found.' });
      return;
    }

    let keyPrefix = 'sandbox_console';
    let keyId: string | null = null;
    let rateLimit = Number(product.rate_limit_per_min) || 120;

    if (rawApiKey && rawApiKey.trim()) {
      const keyRow = db
        .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND org_id = ?')
        .get(hashSha256(rawApiKey.trim()), req.user!.orgId) as Record<string, unknown> | undefined;

      if (!keyRow || keyRow.status !== 'active') {
        const latency = Math.max(8, Date.now() - started);
        db.prepare(
          `INSERT INTO api_logs (id, org_id, api_id, key_prefix, method, path, status_code, latency_ms, tokens_used, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 401, ?, 0, ?, ?)`,
        ).run(
          `log_${crypto.randomUUID().slice(0, 10)}`,
          req.user!.orgId,
          product.id,
          `${rawApiKey.trim().slice(0, 12)}...`,
          method || 'POST',
          path || '/',
          latency,
          'Invalid or revoked API key',
          new Date().toISOString(),
        );
        res.status(401).json({ error: 'Invalid or revoked API key for this organization.' });
        return;
      }

      keyPrefix = String(keyRow.key_prefix);
      keyId = String(keyRow.id);
      rateLimit = Number(keyRow.rate_limit_per_min);
    } else {
      // Check if org has at least one active key for this API
      const fallbackKey = db
        .prepare('SELECT id, key_prefix, rate_limit_per_min FROM api_keys WHERE org_id = ? AND api_id = ? AND status = ? LIMIT 1')
        .get(req.user!.orgId, product.id, 'active') as { id: string; key_prefix: string; rate_limit_per_min: number } | undefined;
      if (fallbackKey) {
        keyPrefix = fallbackKey.key_prefix;
        keyId = fallbackKey.id;
        rateLimit = fallbackKey.rate_limit_per_min;
      }
    }

    // Rate limit enforcement
    const bucketKey = `${req.user!.orgId}:${product.id}`;
    const currentMinute = Math.floor(Date.now() / 60_000);
    const bucket = slidingRateBuckets.get(bucketKey);
    const count = bucket && bucket.windowStart === currentMinute ? bucket.count : 0;
    const rateResult = evaluateRateLimit({ requestsInWindow: count, limitPerMinute: rateLimit });
    if (!rateResult.allowed) {
      res.status(429).json({ error: `Rate limit exceeded (${rateLimit} req/min).` });
      return;
    }
    slidingRateBuckets.set(bucketKey, { windowStart: currentMinute, count: count + 1 });

    // Validate JSON payload if POST/PUT
    let parsedPayload: Record<string, unknown> = {};
    if (payload && (method === 'POST' || method === 'PUT')) {
      try {
        parsedPayload = JSON.parse(payload);
      } catch {
        const latency = Math.max(10, Date.now() - started);
        db.prepare(
          `INSERT INTO api_logs (id, org_id, api_id, key_prefix, method, path, status_code, latency_ms, tokens_used, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 400, ?, 0, ?, ?)`,
        ).run(
          `log_${crypto.randomUUID().slice(0, 10)}`,
          req.user!.orgId,
          product.id,
          keyPrefix,
          method || 'POST',
          path || '/',
          latency,
          'Malformed JSON request body',
          new Date().toISOString(),
        );
        res.status(400).json({ error: 'Malformed JSON body.' });
        return;
      }
    }

    const now = new Date().toISOString();
    const tokensUsed = product.slug === 'vision-ocr' || product.slug === 'semantic-vector' ? 185 : 0;
    const latency = Math.max(14, Date.now() - started + Number(product.avg_latency_ms || 22));

    if (keyId) {
      db.prepare('UPDATE api_keys SET requests_count = requests_count + 1, last_used_at = ? WHERE id = ?').run(now, keyId);
    }

    db.prepare(
      `UPDATE api_subscriptions
       SET requests_used = requests_used + 1, tokens_used = tokens_used + ?
       WHERE org_id = ? AND api_id = ?`,
    ).run(tokensUsed, req.user!.orgId, product.id);

    db.prepare(
      `UPDATE org_usage_counters
       SET api_requests = api_requests + 1, ai_tokens = ai_tokens + ?
       WHERE org_id = ?`,
    ).run(tokensUsed, req.user!.orgId);

    const logId = `log_${crypto.randomUUID().slice(0, 10)}`;
    db.prepare(
      `INSERT INTO api_logs (id, org_id, api_id, key_prefix, method, path, status_code, latency_ms, tokens_used, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 200, ?, ?, NULL, ?)`,
    ).run(logId, req.user!.orgId, product.id, keyPrefix, method || 'POST', path || '/', latency, tokensUsed, now);

    // Update webhook trigger timestamp if configured
    db.prepare('UPDATE webhooks SET last_triggered_at = ? WHERE org_id = ? AND api_id = ? AND status = ?').run(
      now,
      req.user!.orgId,
      product.id,
      'active',
    );

    const responseBody = {
      requestId: logId,
      gateway: 'kodex-edge-gateway',
      api: product.slug,
      version: product.version,
      executedAt: now,
      latencyMs: latency,
      rateLimitRemaining: rateResult.remaining - 1,
      echoInput: parsedPayload,
      data: JSON.parse(String(product.sample_response || '{}')),
    };

    res.json({
      statusCode: 200,
      latencyMs: latency,
      tokensUsed,
      body: responseBody,
    });
  });
}
