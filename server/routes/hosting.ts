import crypto from 'node:crypto';
import type { Express } from 'express';
import {
  requireAuth,
  requirePermission,
  type AuthenticatedRequest,
} from '../auth';
import { createNotification, db, recordAuditLog } from '../db';

export function registerHostingRoutes(app: Express): void {
  app.get('/api/hosting/overview', requireAuth, (req: AuthenticatedRequest, res) => {
    const deployments = db
      .prepare('SELECT * FROM hosting_deployments WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    const envVars = db
      .prepare('SELECT * FROM hosting_env_vars WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    const domains = db
      .prepare('SELECT * FROM hosting_domains WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    res.json({
      deployments: deployments.map((d) => ({
        id: d.id,
        orgId: d.org_id,
        projectId: d.project_id,
        projectName: d.project_name,
        environment: d.environment,
        region: d.region,
        branch: d.branch,
        commitSha: d.commit_sha,
        url: d.url,
        status: d.status,
        buildDurationMs: d.build_duration_ms,
        cpuPercent: d.cpu_percent,
        memoryMb: d.memory_mb,
        bandwidthGb: d.bandwidth_gb,
        buildLogs: JSON.parse(String(d.build_logs_json || '[]')),
        createdAt: d.created_at,
      })),
      envVars: envVars.map((e) => ({
        id: e.id,
        projectName: e.project_name,
        envKey: e.env_key,
        envValue: e.env_value,
        environment: e.environment,
        createdAt: e.created_at,
      })),
      domains: domains.map((dom) => ({
        id: dom.id,
        orgId: dom.org_id,
        projectName: dom.project_name,
        domain: dom.domain,
        sslStatus: dom.ssl_status,
        dnsVerified: Boolean(dom.dns_verified),
        createdAt: dom.created_at,
      })),
    });
  });

  app.post('/api/hosting/deployments', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    const { projectName, environment, region, branch } = req.body as {
      projectName?: string;
      environment?: 'production' | 'staging' | 'preview';
      region?: string;
      branch?: string;
    };

    if (!projectName?.trim()) {
      res.status(400).json({ error: 'Project name is required.' });
      return;
    }

    const depId = `dep_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const commitSha = crypto.randomBytes(4).toString('hex').slice(0, 7);
    const logs = [
      `[${now.slice(11, 19)}] Fetching repository branch ${branch || 'main'} @ ${commitSha}`,
      `[${now.slice(11, 19)}] Installing production dependencies in isolated container`,
      `[${now.slice(11, 19)}] Building optimized bundle (1.82s)`,
      `[${now.slice(11, 19)}] Routing traffic in ${region || 'us-east-1'} (${environment || 'production'})`,
    ];

    const fallbackHtml = `<!doctype html><html><body style="font-family:system-ui;padding:40px;color:#0f172a;"><h1>${projectName.trim()}</h1><p>Deployment <code>${depId}</code> (${environment || 'production'}) is live in ${region || 'us-east-1'}.</p></body></html>`;

    db.prepare(
      `INSERT INTO hosting_deployments (
        id, org_id, project_id, project_name, environment, region, branch, commit_sha,
        url, status, build_duration_ms, cpu_percent, memory_mb, bandwidth_gb, build_logs_json, snapshot_html, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'live', 1820, 12.1, 224, 0.6, ?, ?, ?)`,
    ).run(
      depId,
      req.user!.orgId,
      projectName.trim(),
      environment || 'production',
      region || 'us-east-1',
      branch || 'main',
      commitSha,
      `/preview/${depId}`,
      JSON.stringify(logs),
      fallbackHtml,
      now,
    );

    createNotification({
      orgId: req.user!.orgId,
      type: 'deployment',
      title: `Deployment ${commitSha} live`,
      message: `${projectName.trim()} deployed to ${environment || 'production'} (${region || 'us-east-1'}).`,
    });

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hosting.deployment_created',
      resourceType: 'deployment',
      resourceId: depId,
      details: `Created deployment for ${projectName.trim()}`,
    });

    res.status(201).json({ id: depId, url: `/preview/${depId}` });
  });

  app.post('/api/hosting/deployments/:id/rollback', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    const dep = db
      .prepare('SELECT id, project_name FROM hosting_deployments WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId) as { id: string; project_name: string } | undefined;

    if (!dep) {
      res.status(404).json({ error: 'Deployment not found.' });
      return;
    }

    db.prepare('UPDATE hosting_deployments SET status = ? WHERE id = ?').run('rolled_back', dep.id);
    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hosting.rollback',
      resourceType: 'deployment',
      resourceId: dep.id,
      details: `Rolled back deployment for ${dep.project_name}`,
    });

    res.json({ ok: true });
  });

  app.post('/api/hosting/env-vars', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    const { projectName, envKey, envValue, environment } = req.body as {
      projectName?: string;
      envKey?: string;
      envValue?: string;
      environment?: string;
    };

    if (!projectName?.trim() || !envKey?.trim()) {
      res.status(400).json({ error: 'Project name and variable key are required.' });
      return;
    }

    const id = `env_${crypto.randomUUID().slice(0, 10)}`;
    db.prepare(
      `INSERT INTO hosting_env_vars (id, org_id, project_name, env_key, env_value, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.orgId,
      projectName.trim(),
      envKey.trim().toUpperCase(),
      envValue ?? '',
      environment || 'production',
      new Date().toISOString(),
    );

    res.status(201).json({ id });
  });

  app.delete('/api/hosting/env-vars/:id', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM hosting_env_vars WHERE id = ? AND org_id = ?').run(req.params.id, req.user!.orgId);
    res.json({ ok: true });
  });

  app.post('/api/hosting/domains', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    const { projectName, domain } = req.body as { projectName?: string; domain?: string };
    if (!projectName?.trim() || !domain?.trim() || !domain.includes('.')) {
      res.status(400).json({ error: 'Valid project name and domain (e.g. app.company.com) are required.' });
      return;
    }

    const cleanDomain = domain.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM hosting_domains WHERE domain = ?').get(cleanDomain);
    if (existing) {
      res.status(409).json({ error: 'This domain is already mapped.' });
      return;
    }

    const id = `dom_${crypto.randomUUID().slice(0, 10)}`;
    db.prepare(
      `INSERT INTO hosting_domains (id, org_id, project_name, domain, ssl_status, dns_verified, created_at)
       VALUES (?, ?, ?, ?, 'active', 1, ?)`,
    ).run(id, req.user!.orgId, projectName.trim(), cleanDomain, new Date().toISOString());

    res.status(201).json({ id, domain: cleanDomain });
  });

  app.delete('/api/hosting/domains/:id', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM hosting_domains WHERE id = ? AND org_id = ?').run(req.params.id, req.user!.orgId);
    res.json({ ok: true });
  });

  // Live hosted preview endpoint
  app.get('/preview/:deploymentId', (req, res) => {
    const dep = db
      .prepare('SELECT project_name, snapshot_html FROM hosting_deployments WHERE id = ?')
      .get(req.params.deploymentId) as { project_name: string; snapshot_html: string | null } | undefined;

    if (!dep) {
      res.status(404).send('<h1>Deployment Not Found</h1>');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      dep.snapshot_html ||
        `<!doctype html><html><body><h1>${dep.project_name}</h1><p>Deployment live.</p></body></html>`,
    );
  });
}
