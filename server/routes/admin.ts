import crypto from 'node:crypto';
import os from 'node:os';
import type { Express } from 'express';
import {
  requireAuth,
  requirePermission,
  type AuthenticatedRequest,
} from '../auth';
import { createNotification, db, hashPassword, recordAuditLog } from '../db';
import type { PlatformRole } from '../../src/types';

export function registerAdminAndOpsRoutes(app: Express): void {
  // Dashboard overview summary across all 4 portals
  app.get('/api/platform/overview', requireAuth, (req: AuthenticatedRequest, res) => {
    const orgId = req.user!.orgId;

    const apiSubs = db.prepare('SELECT COUNT(*) AS cnt FROM api_subscriptions WHERE org_id = ? AND status = ?').get(orgId, 'active') as { cnt: number };
    const apiKeys = db.prepare('SELECT COUNT(*) AS cnt FROM api_keys WHERE org_id = ? AND status = ?').get(orgId, 'active') as { cnt: number };
    const aiProjects = db.prepare('SELECT COUNT(*) AS cnt FROM ai_projects WHERE org_id = ?').get(orgId) as { cnt: number };
    const deployments = db.prepare('SELECT COUNT(*) AS cnt FROM hosting_deployments WHERE org_id = ? AND status = ?').get(orgId, 'live') as { cnt: number };
    const dbs = db.prepare('SELECT COUNT(*) AS cnt FROM managed_databases WHERE org_id = ?').get(orgId) as { cnt: number };
    const storageObjs = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes FROM storage_objects WHERE org_id = ?').get(orgId) as { cnt: number; bytes: number };
    const usage = db.prepare('SELECT * FROM org_usage_counters WHERE org_id = ?').get(orgId) as { api_requests: number; ai_tokens: number; bandwidth_gb: number } | undefined;
    const recentLogs = db
      .prepare('SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 8')
      .all(orgId);
    const announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3').all();
    const maintenance = db.prepare("SELECT value FROM system_settings WHERE key = 'maintenance_mode'").get() as { value: string } | undefined;

    res.json({
      stats: {
        activeApiSubscriptions: apiSubs.cnt,
        activeApiKeys: apiKeys.cnt,
        aiProjectsCount: aiProjects.cnt,
        liveDeploymentsCount: deployments.cnt,
        managedDatabasesCount: dbs.cnt,
        storageObjectsCount: storageObjs.cnt,
        storageBytes: storageObjs.bytes,
        apiRequestsMonth: usage?.api_requests ?? 0,
        aiTokensMonth: usage?.ai_tokens ?? 0,
        bandwidthGbMonth: usage?.bandwidth_gb ?? 0,
      },
      recentAuditLogs: recentLogs,
      announcements,
      maintenanceMode: maintenance?.value === 'true',
    });
  });

  // Notifications
  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const items = db
      .prepare(
        `SELECT * FROM notifications
         WHERE org_id = ? AND (user_id IS NULL OR user_id = ?)
         ORDER BY created_at DESC
         LIMIT 40`,
      )
      .all(req.user!.orgId, req.user!.id) as Array<Record<string, unknown>>;

    res.json({
      notifications: items.map((n) => ({
        id: n.id,
        orgId: n.org_id,
        userId: n.user_id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: Boolean(n.is_read),
        createdAt: n.created_at,
      })),
    });
  });

  app.post('/api/notifications/mark-read', requireAuth, (req: AuthenticatedRequest, res) => {
    const { id } = req.body as { id?: string };
    if (id) {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND org_id = ?').run(id, req.user!.orgId);
    } else {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE org_id = ?').run(req.user!.orgId);
    }
    res.json({ ok: true });
  });

  // Support Tickets
  app.get('/api/support/tickets', requireAuth, (req: AuthenticatedRequest, res) => {
    const isAdmin = req.user!.role === 'super_admin';
    const tickets = isAdmin
      ? (db
          .prepare(
            `SELECT t.*, u.name AS user_name
             FROM support_tickets t
             JOIN users u ON u.id = t.user_id
             ORDER BY t.updated_at DESC`,
          )
          .all() as Array<Record<string, unknown>>)
      : (db
          .prepare(
            `SELECT t.*, u.name AS user_name
             FROM support_tickets t
             JOIN users u ON u.id = t.user_id
             WHERE t.org_id = ?
             ORDER BY t.updated_at DESC`,
          )
          .all(req.user!.orgId) as Array<Record<string, unknown>>);

    const messages = db.prepare('SELECT * FROM ticket_messages ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
    const byTicket = new Map<string, Array<Record<string, unknown>>>();
    for (const msg of messages) {
      const tId = String(msg.ticket_id);
      if (!byTicket.has(tId)) byTicket.set(tId, []);
      byTicket.get(tId)!.push(msg);
    }

    res.json({
      tickets: tickets.map((t) => ({
        id: t.id,
        orgId: t.org_id,
        userId: t.user_id,
        userName: t.user_name,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        messages: byTicket.get(String(t.id)) ?? [],
      })),
    });
  });

  app.post('/api/support/tickets', requireAuth, (req: AuthenticatedRequest, res) => {
    const { subject, category, priority, message } = req.body as {
      subject?: string;
      category?: string;
      priority?: string;
      message?: string;
    };

    if (!subject?.trim() || !message?.trim()) {
      res.status(400).json({ error: 'Ticket subject and initial message are required.' });
      return;
    }

    const id = `tkt_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO support_tickets (id, org_id, user_id, subject, category, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, req.user!.orgId, req.user!.id, subject.trim(), category || 'api', priority || 'medium', now, now);

    db.prepare(
      `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `msg_${crypto.randomUUID().slice(0, 8)}`,
      id,
      req.user!.id,
      req.user!.name,
      req.user!.role,
      message.trim(),
      now,
    );

    res.status(201).json({ id });
  });

  app.post('/api/support/tickets/:id/reply', requireAuth, (req: AuthenticatedRequest, res) => {
    const { message, status } = req.body as { message?: string; status?: string };
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id) as
      | { id: string; org_id: string }
      | undefined;

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found.' });
      return;
    }
    if (req.user!.role !== 'super_admin' && ticket.org_id !== req.user!.orgId) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const now = new Date().toISOString();
    if (message?.trim()) {
      db.prepare(
        `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `msg_${crypto.randomUUID().slice(0, 8)}`,
        ticket.id,
        req.user!.id,
        req.user!.name,
        req.user!.role,
        message.trim(),
        now,
      );
    }

    if (status && ['open', 'in_progress', 'resolved'].includes(status)) {
      db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, ticket.id);
    } else {
      db.prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
    }

    res.json({ ok: true });
  });

  // System Monitoring (real Node process + SQLite metrics)
  app.get('/api/monitoring/health', requireAuth, (req: AuthenticatedRequest, res) => {
    const totalRequests = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(AVG(latency_ms), 0) AS avg_lat FROM api_logs').get() as {
      cnt: number;
      avg_lat: number;
    };
    const errorCount = db.prepare('SELECT COUNT(*) AS cnt FROM api_logs WHERE status_code >= 400').get() as { cnt: number };
    const activeDeployments = db.prepare("SELECT COUNT(*) AS cnt FROM hosting_deployments WHERE status = 'live'").get() as { cnt: number };
    const dbCount = db.prepare('SELECT COUNT(*) AS cnt FROM managed_databases').get() as { cnt: number };

    const mem = process.memoryUsage();
    res.json({
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      cpuLoad1m: Number(os.loadavg()[0].toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      gatewayRequestsLogged: totalRequests.cnt,
      gatewayAvgLatencyMs: Math.round(totalRequests.avg_lat),
      gatewayErrorRatePct: totalRequests.cnt > 0 ? Number(((errorCount.cnt / totalRequests.cnt) * 100).toFixed(2)) : 0,
      liveDeployments: activeDeployments.cnt,
      managedDatabases: dbCount.cnt,
      services: [
        { name: 'API Gateway Edge', region: 'Global Anycast', status: 'operational', latencyMs: Math.round(totalRequests.avg_lat) || 24 },
        { name: 'AI App Builder Engine', region: 'us-east-1', status: 'operational', latencyMs: 142 },
        { name: 'Cloud Hosting Runtime', region: 'Multi-Region', status: 'operational', latencyMs: 18 },
        { name: 'Enterprise Data Cloud', region: 'us-east-1 / eu-central-1', status: 'operational', latencyMs: 12 },
      ],
    });
  });

  // Super Admin Console
  app.get('/api/admin/overview', requireAuth, requirePermission('admin:platform'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.org_id, o.name AS org_name, u.email_verified, u.two_factor_enabled, u.status, u.created_at
         FROM users u
         JOIN organizations o ON o.id = u.org_id
         ORDER BY u.created_at DESC`,
      )
      .all();

    const organizations = db.prepare('SELECT * FROM organizations ORDER BY created_at DESC').all();
    const revenueAgg = db
      .prepare("SELECT COALESCE(SUM(total_cents), 0) AS total_revenue_cents FROM invoices WHERE status = 'paid'")
      .get() as { total_revenue_cents: number };
    const invoices = db.prepare('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 30').all();
    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60').all();
    const featureFlags = db.prepare('SELECT * FROM feature_flags ORDER BY key ASC').all();
    const settings = db.prepare('SELECT * FROM system_settings').all();
    const announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
    const securityAlerts = db
      .prepare("SELECT * FROM api_logs WHERE status_code >= 400 ORDER BY created_at DESC LIMIT 20")
      .all();

    res.json({
      users,
      organizations,
      totalRevenueCents: revenueAgg.total_revenue_cents,
      invoices,
      auditLogs,
      featureFlags,
      settings,
      announcements,
      securityAlerts,
    });
  });

  app.post('/api/admin/users', requireAuth, requirePermission('admin:platform'), (req: AuthenticatedRequest, res) => {
    const { email, name, role, orgId, password } = req.body as {
      email?: string;
      name?: string;
      role?: PlatformRole;
      orgId?: string;
      password?: string;
    };

    if (!email || !name || !password || password.length < 8) {
      res.status(400).json({ error: 'Name, email, and 8+ character password are required.' });
      return;
    }

    const id = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, org_id, email_verified, two_factor_enabled, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'active', ?)`,
      ).run(
        id,
        email.trim().toLowerCase(),
        name.trim(),
        hashPassword(password),
        role ?? 'developer',
        orgId ?? 'org_kodex_core',
        now,
      );
    } catch {
      res.status(409).json({ error: 'User with this email already exists.' });
      return;
    }

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'admin.user_created',
      resourceType: 'user',
      resourceId: id,
      details: `Created user ${email} (${role ?? 'developer'})`,
    });

    res.status(201).json({ id });
  });

  app.patch('/api/admin/users/:id/status', requireAuth, requirePermission('admin:platform'), (req: AuthenticatedRequest, res) => {
    const { status } = req.body as { status?: 'active' | 'suspended' };
    if (req.params.id === req.user!.id) {
      res.status(400).json({ error: 'Cannot suspend your own active admin account.' });
      return;
    }
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status === 'suspended' ? 'suspended' : 'active', req.params.id);

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: status === 'suspended' ? 'admin.user_suspended' : 'admin.user_reactivated',
      resourceType: 'user',
      resourceId: req.params.id,
      details: `Set user status to ${status}`,
    });

    res.json({ ok: true });
  });

  app.post('/api/admin/feature-flags/:key', requireAuth, requirePermission('admin:platform'), (req: AuthenticatedRequest, res) => {
    const { enabled } = req.body as { enabled?: boolean };
    db.prepare('UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?').run(
      enabled ? 1 : 0,
      new Date().toISOString(),
      req.params.key,
    );

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'admin.feature_flag_toggled',
      resourceType: 'feature_flag',
      resourceId: req.params.key,
      details: `Set ${req.params.key} = ${Boolean(enabled)}`,
    });

    res.json({ ok: true });
  });

  app.post('/api/admin/maintenance-mode', requireAuth, requirePermission('admin:platform'), (req: AuthenticatedRequest, res) => {
    const { enabled } = req.body as { enabled?: boolean };
    db.prepare(`UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'maintenance_mode'`).run(
      enabled ? 'true' : 'false',
      new Date().toISOString(),
    );

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'admin.maintenance_mode',
      resourceType: 'system_setting',
      resourceId: 'maintenance_mode',
      details: `Maintenance mode set to ${Boolean(enabled)}`,
    });

    res.json({ maintenanceMode: Boolean(enabled) });
  });

  app.post('/api/admin/announcements', requireAuth, requirePermission('admin:platform'), (req: AuthenticatedRequest, res) => {
    const { title, body, severity } = req.body as { title?: string; body?: string; severity?: string };
    if (!title?.trim() || !body?.trim()) {
      res.status(400).json({ error: 'Announcement title and body are required.' });
      return;
    }

    const id = `ann_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO announcements (id, title, body, severity, author_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, title.trim(), body.trim(), severity || 'info', req.user!.email, now);

    const orgs = db.prepare('SELECT id FROM organizations').all() as Array<{ id: string }>;
    for (const org of orgs) {
      createNotification({
        orgId: org.id,
        type: 'announcement',
        title: title.trim(),
        message: body.trim(),
      });
    }

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'admin.announcement_published',
      resourceType: 'announcement',
      resourceId: id,
      details: title.trim(),
    });

    res.status(201).json({ id });
  });

  app.post('/api/admin/marketplace/products', requireAuth, requirePermission('admin:platform'), (req: AuthenticatedRequest, res) => {
    const { name, category, description, proPriceCents } = req.body as {
      name?: string;
      category?: string;
      description?: string;
      proPriceCents?: number;
    };

    if (!name?.trim() || !description?.trim()) {
      res.status(400).json({ error: 'API name and description are required.' });
      return;
    }

    const id = `api_${crypto.randomUUID().slice(0, 8)}`;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO api_products (
        id, slug, name, provider, category, version, description, base_path,
        uptime_percent, avg_latency_ms, pricing_model, starter_price_cents, pro_price_cents,
        rate_limit_per_min, monthly_quota, sample_request, sample_response, endpoints_json, status, created_at
      ) VALUES (?, ?, ?, 'Kodex Cloud Platform', ?, 'v1.0', ?, ?, 99.99, 28, 'Tiered', 0, ?, 200, 250000, '{}', '{"ok":true}', ?, 'operational', ?)`,
    ).run(
      id,
      slug,
      name.trim(),
      category || 'Platform',
      description.trim(),
      `/api/gateway/${slug}`,
      proPriceCents ?? 4900,
      JSON.stringify([{ method: 'POST', path: '/execute', summary: 'Primary API execution endpoint', scope: `${slug}:write` }]),
      now,
    );

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'admin.api_product_created',
      resourceType: 'api_product',
      resourceId: id,
      details: `Published API "${name.trim()}" to marketplace`,
    });

    res.status(201).json({ id, slug });
  });
}
