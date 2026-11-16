import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, hashPassword, hashSha256, recordAuditLog, verifyPassword } from './db';
import { hasPermission, type PermissionAction } from '../src/lib/platformLogic';
import type { PlatformRole, UserProfile } from '../src/types';

export const SESSION_COOKIE_NAME = 'kodex_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionId?: string;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: PlatformRole;
  org_id: string;
  org_name: string;
  email_verified: number;
  two_factor_enabled: number;
  two_factor_secret: string | null;
  status: 'active' | 'suspended';
  avatar_url: string | null;
  created_at: string;
}

function mapUserRow(row: DbUserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    orgId: row.org_id,
    orgName: row.org_name,
    emailVerified: Boolean(row.email_verified),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    status: row.status,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

export function createSessionForUser(params: {
  userId: string;
  deviceLabel?: string;
  ipAddress?: string;
}): { rawToken: string; sessionId: string } {
  const rawToken = `kxs_${crypto.randomBytes(32).toString('hex')}`;
  const sessionId = `ses_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, ip_address, last_active_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    params.userId,
    hashSha256(rawToken),
    params.deviceLabel ?? 'Web Browser',
    params.ipAddress ?? '127.0.0.1',
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
  );

  return { rawToken, sessionId };
}

export function resolveSessionUser(req: Request): { user: UserProfile; sessionId: string } | null {
  const rawToken =
    (req.cookies?.[SESSION_COOKIE_NAME] as string | undefined) ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined);

  if (!rawToken) return null;

  const sessionRow = db
    .prepare(
      `SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?`,
    )
    .get(hashSha256(rawToken)) as { id: string; user_id: string; expires_at: string } | undefined;

  if (!sessionRow) return null;
  if (new Date(sessionRow.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionRow.id);
    return null;
  }

  const userRow = db
    .prepare(
      `SELECT u.*, o.name AS org_name
       FROM users u
       JOIN organizations o ON o.id = u.org_id
       WHERE u.id = ?`,
    )
    .get(sessionRow.user_id) as DbUserRow | undefined;

  if (!userRow || userRow.status === 'suspended') {
    return null;
  }

  db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    sessionRow.id,
  );

  return { user: mapUserRow(userRow), sessionId: sessionRow.id };
}

export function attachDemoOrSessionUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const resolved = resolveSessionUser(req);
  if (resolved) {
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
    next();
    return;
  }

  // Only auto-attach demo session on initial workspace bootstrap if user hasn't explicitly signed out
  if (req.cookies?.kodex_logged_out === '1') {
    next();
    return;
  }

  const demoUser = db
    .prepare(
      `SELECT u.*, o.name AS org_name
       FROM users u
       JOIN organizations o ON o.id = u.org_id
       WHERE u.id = 'usr_alex' AND u.status = 'active'`,
    )
    .get() as DbUserRow | undefined;

  if (demoUser) {
    const { rawToken, sessionId } = createSessionForUser({
      userId: demoUser.id,
      deviceLabel: req.headers['user-agent']?.slice(0, 60) || 'Browser Session',
      ipAddress: req.ip || '127.0.0.1',
    });
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    req.user = mapUserRow(demoUser);
    req.sessionId = sessionId;
  }

  next();
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  next();
}

export function requirePermission(action: PermissionAction) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!hasPermission(req.user.role, action)) {
      res.status(403).json({ error: `Insufficient permissions for ${action}.` });
      return;
    }
    next();
  };
}

export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(payload: string, signatureHex: string, secret: string): boolean {
  const expected = signWebhookPayload(payload, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function registerAuthRoutes(app: import('express').Express): void {
  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.orgId) as {
      id: string;
      name: string;
      slug: string;
      plan_id: string;
      billing_cycle: string;
      storage_quota_gb: number;
      db_quota_count: number;
      created_at: string;
    };

    const sessions = db
      .prepare('SELECT id, device_label, ip_address, last_active_at, created_at FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC')
      .all(req.user.id);

    res.json({
      user: req.user,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        planId: org.plan_id,
        billingCycle: org.billing_cycle,
        storageQuotaGb: org.storage_quota_gb,
        dbQuotaCount: org.db_quota_count,
        createdAt: org.created_at,
      },
      currentSessionId: req.sessionId,
      sessions,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const { email, password, name, orgName, role } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      orgName?: string;
      role?: PlatformRole;
    };

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const orgId = `org_${crypto.randomUUID().slice(0, 10)}`;
    const userId = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const verificationToken = `vrf_${crypto.randomBytes(12).toString('hex')}`;
    const safeOrgName = (orgName?.trim() || `${name.trim()} Workspace`).slice(0, 64);
    const orgSlug = `${safeOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${orgId.slice(-4)}`;
    const allowedSelfRoles: PlatformRole[] = ['org_admin', 'developer', 'customer'];
    const assignedRole: PlatformRole = role && allowedSelfRoles.includes(role) ? role : 'org_admin';

    db.prepare(
      `INSERT INTO organizations (id, name, slug, plan_id, billing_cycle, storage_quota_gb, db_quota_count, created_at)
       VALUES (?, ?, ?, 'free', 'monthly', 5, 1, ?)`,
    ).run(orgId, safeOrgName, orgSlug, now);

    db.prepare(`INSERT INTO org_usage_counters (org_id, api_requests, ai_tokens, bandwidth_gb) VALUES (?, 0, 0, 0)`).run(orgId);

    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, org_id, email_verified, verification_token, two_factor_enabled, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 'active', ?)`,
    ).run(userId, normalizedEmail, name.trim(), hashPassword(password), assignedRole, orgId, verificationToken, now);

    const { rawToken } = createSessionForUser({
      userId,
      deviceLabel: req.headers['user-agent']?.slice(0, 60) || 'Web Browser',
      ipAddress: req.ip || '127.0.0.1',
    });

    res.clearCookie('kodex_logged_out', { path: '/' });
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    recordAuditLog({
      orgId,
      actorId: userId,
      actorEmail: normalizedEmail,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: userId,
      details: `Registered new workspace ${safeOrgName}`,
    });

    res.status(201).json({
      message: 'Account created. Verification token issued.',
      verificationToken,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password, twoFactorCode } = req.body as {
      email?: string;
      password?: string;
      twoFactorCode?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT u.*, o.name AS org_name
         FROM users u
         JOIN organizations o ON o.id = u.org_id
         WHERE u.email = ?`,
      )
      .get(email.trim().toLowerCase()) as DbUserRow | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (row.status === 'suspended') {
      res.status(403).json({ error: 'This account has been suspended by an administrator.' });
      return;
    }

    if (row.two_factor_enabled) {
      if (!twoFactorCode || !/^\d{6}$/.test(twoFactorCode)) {
        res.status(202).json({
          requiresTwoFactor: true,
          message: 'Enter your 6-digit two-factor authentication code.',
        });
        return;
      }
    }

    const { rawToken } = createSessionForUser({
      userId: row.id,
      deviceLabel: req.headers['user-agent']?.slice(0, 60) || 'Web Browser',
      ipAddress: req.ip || '127.0.0.1',
    });

    res.clearCookie('kodex_logged_out', { path: '/' });
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    recordAuditLog({
      orgId: row.org_id,
      actorId: row.id,
      actorEmail: row.email,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: row.id,
      details: 'User authenticated via password',
    });

    res.json({ user: mapUserRow(row) });
  });

  app.post('/api/auth/switch-account', (req, res) => {
    // Allows switching between seeded demo personas (Admin, Developer, External Tenant) for instant RBAC & isolation verification
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const allowedDemoEmails = [
      'alex.mercer@kodex.cloud',
      'maya.lin@kodex.cloud',
      'elena.rostova@meridian.io',
    ];
    if (!allowedDemoEmails.includes(email)) {
      res.status(403).json({ error: 'Quick switch is only available for sandbox personas.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT u.*, o.name AS org_name
         FROM users u
         JOIN organizations o ON o.id = u.org_id
         WHERE u.email = ? AND u.status = 'active'`,
      )
      .get(email) as DbUserRow | undefined;

    if (!row) {
      res.status(404).json({ error: 'Persona account not found or suspended.' });
      return;
    }

    const { rawToken } = createSessionForUser({
      userId: row.id,
      deviceLabel: 'Workspace Switcher',
      ipAddress: req.ip || '127.0.0.1',
    });

    res.clearCookie('kodex_logged_out', { path: '/' });
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    res.json({ user: mapUserRow(row) });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    if (req.sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.cookie('kodex_logged_out', '1', { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  app.post('/api/auth/verify-email', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(req.user!.id);
    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'auth.email_verified',
      resourceType: 'user',
      resourceId: req.user!.id,
      details: 'Email verified',
    });
    res.json({ verified: true });
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }
    const user = db.prepare('SELECT id, org_id FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
      | { id: string; org_id: string }
      | undefined;

    const resetToken = `rst_${crypto.randomBytes(12).toString('hex')}`;
    if (user) {
      db.prepare('UPDATE users SET reset_token = ? WHERE id = ?').run(resetToken, user.id);
    }
    res.json({
      message: 'If an account matches that email, a password reset token has been generated.',
      resetToken: user ? resetToken : undefined,
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    if (!token || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'Valid reset token and 8+ character password are required.' });
      return;
    }
    const user = db.prepare('SELECT id, email, org_id FROM users WHERE reset_token = ?').get(token) as
      | { id: string; email: string; org_id: string }
      | undefined;
    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token.' });
      return;
    }
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL WHERE id = ?').run(
      hashPassword(newPassword),
      user.id,
    );
    recordAuditLog({
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.password_reset',
      resourceType: 'user',
      resourceId: user.id,
      details: 'Password reset completed',
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/2fa/toggle', requireAuth, (req: AuthenticatedRequest, res) => {
    const { enabled } = req.body as { enabled?: boolean };
    const secret = enabled ? crypto.randomBytes(10).toString('hex').toUpperCase() : null;
    db.prepare('UPDATE users SET two_factor_enabled = ?, two_factor_secret = ? WHERE id = ?').run(
      enabled ? 1 : 0,
      secret,
      req.user!.id,
    );
    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: enabled ? 'auth.2fa_enabled' : 'auth.2fa_disabled',
      resourceType: 'user',
      resourceId: req.user!.id,
      details: `2FA ${enabled ? 'enabled' : 'disabled'}`,
    });
    res.json({ twoFactorEnabled: Boolean(enabled), secret });
  });

  app.delete('/api/auth/sessions/:sessionId', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(
      req.params.sessionId,
      req.user!.id,
    );
    res.json({ ok: true });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Display name cannot be empty.' });
      return;
    }
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user!.id);
    res.json({ ok: true, name: name.trim() });
  });

  app.delete('/api/auth/account', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.user!.id === 'usr_alex') {
      res.status(400).json({ error: 'Primary platform super-admin demo account cannot be deleted.' });
      return;
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user!.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user!.id);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/org/team', requireAuth, (req: AuthenticatedRequest, res) => {
    const members = db
      .prepare('SELECT id, email, name, role, status, email_verified, two_factor_enabled, created_at FROM users WHERE org_id = ?')
      .all(req.user!.orgId);
    const invitations = db
      .prepare('SELECT id, email, role, invited_by, status, created_at FROM org_invitations WHERE org_id = ? ORDER BY created_at DESC')
      .all(req.user!.orgId);
    res.json({ members, invitations });
  });

  app.post('/api/org/invite', requireAuth, requirePermission('org:manage_team'), (req: AuthenticatedRequest, res) => {
    const { email, role } = req.body as { email?: string; role?: PlatformRole };
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email address required.' });
      return;
    }
    const id = `invt_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO org_invitations (id, org_id, email, role, invited_by, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, req.user!.orgId, email.trim().toLowerCase(), role ?? 'developer', req.user!.email, now);

    recordAuditLog({
      orgId: req.user!.orgId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'org.member_invited',
      resourceType: 'invitation',
      resourceId: id,
      details: `Invited ${email} as ${role ?? 'developer'}`,
    });

    res.status(201).json({ id, email, role: role ?? 'developer', status: 'pending', created_at: now });
  });
}
