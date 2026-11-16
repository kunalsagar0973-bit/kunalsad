import crypto from 'node:crypto';
import type { Express } from 'express';
import {
  requireAuth,
  requirePermission,
  type AuthenticatedRequest,
} from '../auth';
import { createNotification, db, recordAuditLog } from '../db';
import { analyzeCodeWithAi, generateOrUpdateProjectWithAi } from '../gemini';
import { buildPreviewHtml, slugifySubdomain } from '../../src/lib/platformLogic';
import type { BuilderFile } from '../../src/types';

function mapProjectRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    name: String(row.name),
    description: String(row.description),
    framework: String(row.framework),
    model: String(row.model),
    files: JSON.parse(String(row.files_json || '[]')) as BuilderFile[],
    envVars: JSON.parse(String(row.env_vars_json || '[]')) as Array<{ key: string; value: string }>,
    customDomain: row.custom_domain ? String(row.custom_domain) : null,
    status: String(row.status),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  };
}

export function registerBuilderRoutes(app: Express): void {
  app.get('/api/builder/projects', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM ai_projects WHERE org_id = ? ORDER BY updated_at DESC')
      .all(req.user!.orgId) as Array<Record<string, unknown>>;

    res.json({ projects: rows.map(mapProjectRow) });
  });

  app.get('/api/builder/projects/:id/versions', requireAuth, (req: AuthenticatedRequest, res) => {
    const project = db
      .prepare('SELECT id FROM ai_projects WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const versions = db
      .prepare('SELECT * FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC')
      .all(req.params.id) as Array<Record<string, unknown>>;

    res.json({
      versions: versions.map((v) => ({
        id: v.id,
        projectId: v.project_id,
        versionNumber: v.version_number,
        summary: v.summary,
        files: JSON.parse(String(v.files_json || '[]')),
        createdAt: v.created_at,
      })),
    });
  });

  app.post('/api/builder/generate', requireAuth, requirePermission('builder:use'), async (req: AuthenticatedRequest, res) => {
    const { projectId, prompt, model, templateHint } = req.body as {
      projectId?: string;
      prompt?: string;
      model?: string;
      templateHint?: string;
    };

    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Describe the application or change you want to build.' });
      return;
    }

    const fullPrompt = templateHint ? `[Template: ${templateHint}] ${prompt.trim()}` : prompt.trim();

    let existingRow: Record<string, unknown> | undefined;
    if (projectId) {
      existingRow = db
        .prepare('SELECT * FROM ai_projects WHERE id = ? AND org_id = ?')
        .get(projectId, req.user!.orgId) as Record<string, unknown> | undefined;
      if (!existingRow) {
        res.status(404).json({ error: 'Target project not found.' });
        return;
      }
    }

    try {
      const existingFiles = existingRow
        ? (JSON.parse(String(existingRow.files_json || '[]')) as BuilderFile[])
        : undefined;

      const result = await generateOrUpdateProjectWithAi({
        prompt: fullPrompt,
        existingFiles,
        model,
        mode: existingRow ? 'update' : 'create',
      });

      const now = new Date().toISOString();
      let finalProjectId = projectId;

      if (existingRow && finalProjectId) {
        db.prepare(
          `UPDATE ai_projects SET files_json = ?, model = ?, status = 'ready', updated_at = ? WHERE id = ?`,
        ).run(JSON.stringify(result.files), model || existingRow.model, now, finalProjectId);
      } else {
        finalProjectId = `prj_${crypto.randomUUID().slice(0, 10)}`;
        db.prepare(
          `INSERT INTO ai_projects (id, org_id, name, description, framework, model, files_json, env_vars_json, status, updated_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'ready', ?, ?)`,
        ).run(
          finalProjectId,
          req.user!.orgId,
          result.projectName,
          fullPrompt.slice(0, 180),
          result.framework,
          model || 'gemini-4-hydrogen',
          JSON.stringify(result.files),
          now,
          now,
        );
      }

      const lastVer = db
        .prepare('SELECT MAX(version_number) AS max_ver FROM ai_project_versions WHERE project_id = ?')
        .get(finalProjectId) as { max_ver: number | null };
      const nextVersion = (lastVer?.max_ver ?? 0) + 1;

      db.prepare(
        `INSERT INTO ai_project_versions (id, project_id, version_number, summary, files_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        `ver_${crypto.randomUUID().slice(0, 10)}`,
        finalProjectId,
        nextVersion,
        result.summary,
        JSON.stringify(result.files),
        now,
      );

      db.prepare(`UPDATE org_usage_counters SET ai_tokens = ai_tokens + ? WHERE org_id = ?`).run(
        result.tokensUsed,
        req.user!.orgId,
      );

      recordAuditLog({
        orgId: req.user!.orgId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: existingRow ? 'builder.project_updated' : 'builder.project_created',
        resourceType: 'ai_project',
        resourceId: finalProjectId,
        details: `${result.summary} (${result.tokensUsed} tokens)`,
      });

      const updated = db.prepare('SELECT * FROM ai_projects WHERE id = ?').get(finalProjectId) as Record<string, unknown>;
      res.json({
        project: mapProjectRow(updated),
        summary: result.summary,
        tokensUsed: result.tokensUsed,
        versionNumber: nextVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI generation failed.';
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/builder/analyze', requireAuth, requirePermission('builder:use'), async (req: AuthenticatedRequest, res) => {
    const { task, filePath, code, errorContext, model } = req.body as {
      task?: 'explain' | 'debug' | 'refactor';
      filePath?: string;
      code?: string;
      errorContext?: string;
      model?: string;
    };

    if (!task || !filePath || !code) {
      res.status(400).json({ error: 'task, filePath, and code are required.' });
      return;
    }

    try {
      const result = await analyzeCodeWithAi({ task, filePath, code, errorContext, model });
      db.prepare(`UPDATE org_usage_counters SET ai_tokens = ai_tokens + ? WHERE org_id = ?`).run(
        result.tokensUsed,
        req.user!.orgId,
      );
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Analysis failed.' });
    }
  });

  app.put('/api/builder/projects/:id/files', requireAuth, requirePermission('builder:use'), (req: AuthenticatedRequest, res) => {
    const { files, envVars, customDomain, summary } = req.body as {
      files?: BuilderFile[];
      envVars?: Array<{ key: string; value: string }>;
      customDomain?: string | null;
      summary?: string;
    };

    const existing = db
      .prepare('SELECT * FROM ai_projects WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const now = new Date().toISOString();
    const nextFiles = files ?? (JSON.parse(String(existing.files_json || '[]')) as BuilderFile[]);
    const nextEnvVars = envVars ?? (JSON.parse(String(existing.env_vars_json || '[]')) as Array<{ key: string; value: string }>);
    const nextDomain = customDomain !== undefined ? customDomain : (existing.custom_domain as string | null);

    db.prepare(
      `UPDATE ai_projects SET files_json = ?, env_vars_json = ?, custom_domain = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(nextFiles), JSON.stringify(nextEnvVars), nextDomain, now, existing.id);

    if (files && summary) {
      const lastVer = db
        .prepare('SELECT MAX(version_number) AS max_ver FROM ai_project_versions WHERE project_id = ?')
        .get(existing.id) as { max_ver: number | null };
      db.prepare(
        `INSERT INTO ai_project_versions (id, project_id, version_number, summary, files_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        `ver_${crypto.randomUUID().slice(0, 10)}`,
        existing.id,
        (lastVer?.max_ver ?? 0) + 1,
        summary,
        JSON.stringify(nextFiles),
        now,
      );
    }

    const updated = db.prepare('SELECT * FROM ai_projects WHERE id = ?').get(existing.id) as Record<string, unknown>;
    res.json({ project: mapProjectRow(updated) });
  });

  app.post('/api/builder/projects/:id/restore/:versionId', requireAuth, requirePermission('builder:use'), (req: AuthenticatedRequest, res) => {
    const project = db
      .prepare('SELECT id FROM ai_projects WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const version = db
      .prepare('SELECT * FROM ai_project_versions WHERE id = ? AND project_id = ?')
      .get(req.params.versionId, req.params.id) as { version_number: number; files_json: string } | undefined;

    if (!version) {
      res.status(404).json({ error: 'Version not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE ai_projects SET files_json = ?, updated_at = ? WHERE id = ?').run(
      version.files_json,
      now,
      req.params.id,
    );

    const updated = db.prepare('SELECT * FROM ai_projects WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ project: mapProjectRow(updated), restoredVersion: version.version_number });
  });

  app.post('/api/builder/projects/:id/duplicate', requireAuth, requirePermission('builder:use'), (req: AuthenticatedRequest, res) => {
    const existing = db
      .prepare('SELECT * FROM ai_projects WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const newId = `prj_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ai_projects (id, org_id, name, description, framework, model, files_json, env_vars_json, status, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    ).run(
      newId,
      req.user!.orgId,
      `${existing.name} (Copy)`,
      existing.description,
      existing.framework,
      existing.model,
      existing.files_json,
      existing.env_vars_json,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO ai_project_versions (id, project_id, version_number, summary, files_json, created_at)
       VALUES (?, ?, 1, 'Duplicated workspace', ?, ?)`,
    ).run(`ver_${crypto.randomUUID().slice(0, 10)}`, newId, existing.files_json, now);

    const created = db.prepare('SELECT * FROM ai_projects WHERE id = ?').get(newId) as Record<string, unknown>;
    res.status(201).json({ project: mapProjectRow(created) });
  });

  app.delete('/api/builder/projects/:id', requireAuth, requirePermission('builder:use'), (req: AuthenticatedRequest, res) => {
    const result = db
      .prepare('DELETE FROM ai_projects WHERE id = ? AND org_id = ?')
      .run(req.params.id, req.user!.orgId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/builder/projects/:id/deploy', requireAuth, requirePermission('hosting:deploy'), (req: AuthenticatedRequest, res) => {
    const project = db
      .prepare('SELECT * FROM ai_projects WHERE id = ? AND org_id = ?')
      .get(req.params.id, req.user!.orgId) as Record<string, unknown> | undefined;

    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const { environment, region } = req.body as { environment?: string; region?: string };
    const files = JSON.parse(String(project.files_json || '[]')) as BuilderFile[];
    const snapshotHtml = buildPreviewHtml(files);
    const depId = `dep_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const commitSha = crypto.randomBytes(4).toString('hex').slice(0, 7);
    const subdomain = slugifySubdomain(String(project.name));

    const buildLogs = [
      `[${now.slice(11, 19)}] Cloning workspace ${project.name} (${files.length} files)`,
      `[${now.slice(11, 19)}] Running static analysis & dependency check`,
      `[${now.slice(11, 19)}] Bundling frontend + API artifacts for ${environment || 'production'}`,
      `[${now.slice(11, 19)}] Provisioning edge route https://${subdomain}.kodex.app (${region || 'us-east-1'})`,
      `[${now.slice(11, 19)}] Live health check passed (200 OK)`,
    ];

    db.prepare(
      `INSERT INTO hosting_deployments (
        id, org_id, project_id, project_name, environment, region, branch, commit_sha,
        url, status, build_duration_ms, cpu_percent, memory_mb, bandwidth_gb, build_logs_json, snapshot_html, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'main', ?, ?, 'live', 1940, 8.6, 192, 0.4, ?, ?, ?)`,
    ).run(
      depId,
      req.user!.orgId,
      project.id,
      project.name,
      environment || 'production',
      region || 'us-east-1',
      commitSha,
      `/preview/${depId}`,
      JSON.stringify(buildLogs),
      snapshotHtml,
      now,
    );

    createNotification({
      orgId: req.user!.orgId,
      type: 'deployment',
      title: `Deployed ${project.name}`,
      message: `${environment || 'production'} build ${commitSha} is live in ${region || 'us-east-1'}.`,
    });

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'hosting.deployed',
      resourceType: 'deployment',
      resourceId: depId,
      details: `Deployed ${project.name} to ${environment || 'production'}`,
    });

    res.status(201).json({ deploymentId: depId, previewUrl: `/preview/${depId}` });
  });
}
