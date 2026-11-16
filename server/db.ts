import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const STORAGE_ROOT = path.join(DATA_DIR, 'storage');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, 'kodex.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan_id TEXT NOT NULL DEFAULT 'pro',
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      storage_quota_gb INTEGER NOT NULL DEFAULT 250,
      db_quota_count INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      org_id TEXT NOT NULL REFERENCES organizations(id),
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      avatar_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      device_label TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_products (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      category TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL,
      base_path TEXT NOT NULL,
      uptime_percent REAL NOT NULL DEFAULT 99.98,
      avg_latency_ms INTEGER NOT NULL DEFAULT 42,
      pricing_model TEXT NOT NULL,
      starter_price_cents INTEGER NOT NULL DEFAULT 0,
      pro_price_cents INTEGER NOT NULL DEFAULT 4900,
      rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
      monthly_quota INTEGER NOT NULL DEFAULT 100000,
      sample_request TEXT NOT NULL,
      sample_response TEXT NOT NULL,
      endpoints_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'operational',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_subscriptions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      api_id TEXT NOT NULL REFERENCES api_products(id),
      plan_name TEXT NOT NULL,
      monthly_quota INTEGER NOT NULL,
      requests_used INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      UNIQUE(org_id, api_id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      api_id TEXT NOT NULL REFERENCES api_products(id),
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL,
      rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
      requests_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      api_id TEXT NOT NULL REFERENCES api_products(id),
      key_prefix TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      api_id TEXT NOT NULL REFERENCES api_products(id),
      url TEXT NOT NULL,
      events_json TEXT NOT NULL,
      secret_prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_triggered_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_projects (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      framework TEXT NOT NULL,
      model TEXT NOT NULL,
      files_json TEXT NOT NULL,
      env_vars_json TEXT NOT NULL DEFAULT '[]',
      custom_domain TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_project_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      summary TEXT NOT NULL,
      files_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hosting_deployments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      project_id TEXT REFERENCES ai_projects(id) ON DELETE SET NULL,
      project_name TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'production',
      region TEXT NOT NULL DEFAULT 'us-east-1',
      branch TEXT NOT NULL DEFAULT 'main',
      commit_sha TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live',
      build_duration_ms INTEGER NOT NULL DEFAULT 2400,
      cpu_percent REAL NOT NULL DEFAULT 14.2,
      memory_mb INTEGER NOT NULL DEFAULT 256,
      bandwidth_gb REAL NOT NULL DEFAULT 1.8,
      build_logs_json TEXT NOT NULL,
      snapshot_html TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hosting_env_vars (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      project_name TEXT NOT NULL,
      env_key TEXT NOT NULL,
      env_value TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'production',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hosting_domains (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      project_name TEXT NOT NULL,
      domain TEXT NOT NULL UNIQUE,
      ssl_status TEXT NOT NULL DEFAULT 'active',
      dns_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_databases (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      engine TEXT NOT NULL,
      version TEXT NOT NULL,
      region TEXT NOT NULL,
      tier TEXT NOT NULL,
      storage_used_gb REAL NOT NULL DEFAULT 2.4,
      storage_limit_gb INTEGER NOT NULL DEFAULT 50,
      connection_limit INTEGER NOT NULL DEFAULT 100,
      active_connections INTEGER NOT NULL DEFAULT 12,
      cpu_percent REAL NOT NULL DEFAULT 18.5,
      iops INTEGER NOT NULL DEFAULT 840,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      db_name TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS db_backups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      database_id TEXT NOT NULL REFERENCES managed_databases(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'manual',
      size_mb INTEGER NOT NULL,
      retention_days INTEGER NOT NULL DEFAULT 30,
      encrypted INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_objects (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      bucket TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT '/',
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'private',
      checksum TEXT NOT NULL,
      disk_path TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      invoice_number TEXT NOT NULL UNIQUE,
      plan_id TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      usage_overage_cents INTEGER NOT NULL DEFAULT 0,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      coupon_code TEXT,
      status TEXT NOT NULL DEFAULT 'paid',
      payment_provider TEXT NOT NULL DEFAULT 'stripe',
      webhook_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      signature_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      author_email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_usage_counters (
      org_id TEXT PRIMARY KEY REFERENCES organizations(id),
      api_requests INTEGER NOT NULL DEFAULT 0,
      ai_tokens INTEGER NOT NULL DEFAULT 0,
      bandwidth_gb REAL NOT NULL DEFAULT 0
    );
  `);

  seedInitialData();
}

export function recordAuditLog(params: {
  orgId: string;
  actorId: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress?: string;
  details: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, org_id, actor_id, actor_email, action, resource_type, resource_id, ip_address, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `aud_${crypto.randomUUID().slice(0, 12)}`,
    params.orgId,
    params.actorId,
    params.actorEmail,
    params.action,
    params.resourceType,
    params.resourceId,
    params.ipAddress ?? '127.0.0.1',
    params.details,
    new Date().toISOString(),
  );
}

export function createNotification(params: {
  orgId: string;
  userId?: string | null;
  type: 'deployment' | 'billing' | 'security' | 'usage' | 'announcement';
  title: string;
  message: string;
}): void {
  db.prepare(
    `INSERT INTO notifications (id, org_id, user_id, type, title, message, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    `ntf_${crypto.randomUUID().slice(0, 12)}`,
    params.orgId,
    params.userId ?? null,
    params.type,
    params.title,
    params.message,
    new Date().toISOString(),
  );
}

function seedInitialData(): void {
  const existingOrg = db.prepare('SELECT id FROM organizations LIMIT 1').get();
  if (existingOrg) return;

  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3600_000 * 18).toISOString();
  const twoDaysAgo = new Date(Date.now() - 3600_000 * 48).toISOString();

  // Organizations (2 distinct tenants for strict isolation testing)
  db.prepare(
    `INSERT INTO organizations (id, name, slug, plan_id, billing_cycle, storage_quota_gb, db_quota_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('org_kodex_core', 'Kodex Core Labs', 'kodex-core', 'pro', 'monthly', 250, 10, twoDaysAgo);

  db.prepare(
    `INSERT INTO organizations (id, name, slug, plan_id, billing_cycle, storage_quota_gb, db_quota_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('org_meridian', 'Meridian FinTech Corp', 'meridian-fintech', 'enterprise', 'annual', 5000, 100, twoDaysAgo);

  // Usage counters
  db.prepare(
    `INSERT INTO org_usage_counters (org_id, api_requests, ai_tokens, bandwidth_gb) VALUES (?, ?, ?, ?)`,
  ).run('org_kodex_core', 48240, 214800, 18.4);

  db.prepare(
    `INSERT INTO org_usage_counters (org_id, api_requests, ai_tokens, bandwidth_gb) VALUES (?, ?, ?, ?)`,
  ).run('org_meridian', 1290400, 1450000, 312.7);

  // Seed users across roles and tenants
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, org_id, email_verified, two_factor_enabled, status, avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insertUser.run(
    'usr_alex',
    'alex.mercer@kodex.cloud',
    'Alex Mercer',
    hashPassword('KodexAdmin!2026'),
    'super_admin',
    'org_kodex_core',
    1,
    0,
    'active',
    '/src/assets/images/avatar_admin_profile_1794794771026.jpg',
    twoDaysAgo,
  );

  insertUser.run(
    'usr_maya',
    'maya.lin@kodex.cloud',
    'Maya Lin',
    hashPassword('KodexDev!2026'),
    'developer',
    'org_kodex_core',
    1,
    0,
    'active',
    null,
    twoDaysAgo,
  );

  insertUser.run(
    'usr_elena',
    'elena.rostova@meridian.io',
    'Elena Rostova',
    hashPassword('Meridian!2026'),
    'enterprise_member',
    'org_meridian',
    1,
    1,
    'active',
    null,
    twoDaysAgo,
  );

  // Seed 6 rich API products
  const insertApi = db.prepare(
    `INSERT INTO api_products (
      id, slug, name, provider, category, version, description, base_path,
      uptime_percent, avg_latency_ms, pricing_model, starter_price_cents, pro_price_cents,
      rate_limit_per_min, monthly_quota, sample_request, sample_response, endpoints_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insertApi.run(
    'api_ocr',
    'vision-ocr',
    'Vision OCR & Document AI',
    'Kodex AI Labs',
    'AI & Vision',
    'v2.4',
    'Extract structured tables, line items, and entities from invoices, receipts, and PDFs with sub-second accuracy.',
    '/api/gateway/vision-ocr',
    99.99,
    38,
    'Tiered + Per 1K pages',
    0,
    4900,
    180,
    250000,
    JSON.stringify({ documentUrl: 'https://cdn.kodex.cloud/samples/invoice-882.pdf', extractTables: true }, null, 2),
    JSON.stringify({ status: 'extracted', confidence: 0.994, vendor: 'Northstar Logistics', totalAmount: 1480.50, currency: 'USD' }, null, 2),
    JSON.stringify([
      { method: 'POST', path: '/extract', summary: 'Parse invoice or receipt payload', scope: 'ocr:write' },
      { method: 'GET', path: '/jobs/latest', summary: 'Fetch latest extraction batch status', scope: 'ocr:read' },
    ]),
    'operational',
    twoDaysAgo,
  );

  insertApi.run(
    'api_fx',
    'global-fx',
    'Global Payments & FX Ledger',
    'Kodex Financial',
    'Fintech',
    'v3.1',
    'Real-time multi-currency exchange quotes, IBAN validation, and settlement reconciliation webhooks.',
    '/api/gateway/global-fx',
    99.98,
    24,
    'Freemium + Volume',
    0,
    7900,
    300,
    500000,
    JSON.stringify({ base: 'USD', target: 'EUR', amount: 12500 }, null, 2),
    JSON.stringify({ pair: 'USD/EUR', rate: 0.9214, convertedAmount: 11517.50, settlementWindow: 'T+0' }, null, 2),
    JSON.stringify([
      { method: 'POST', path: '/quote', summary: 'Calculate live FX conversion quote', scope: 'fx:read' },
      { method: 'GET', path: '/rates', summary: 'List supported settlement pairs', scope: 'fx:read' },
    ]),
    'operational',
    twoDaysAgo,
  );

  insertApi.run(
    'api_vector',
    'semantic-vector',
    'Semantic Vector Search',
    'Kodex Core',
    'Search & Data',
    'v1.8',
    'Low-latency hybrid dense + BM25 vector retrieval with automatic namespace isolation per tenant.',
    '/api/gateway/semantic-vector',
    99.97,
    19,
    'Usage-based',
    2900,
    9900,
    600,
    1000000,
    JSON.stringify({ namespace: 'docs-v2', query: 'zero trust database encryption', topK: 3 }, null, 2),
    JSON.stringify({ matches: [{ id: 'doc_401', score: 0.942, title: 'Tenant KMS Envelope Encryption' }] }, null, 2),
    JSON.stringify([
      { method: 'POST', path: '/query', summary: 'Run hybrid semantic similarity query', scope: 'vector:read' },
      { method: 'POST', path: '/upsert', summary: 'Index embeddings into tenant namespace', scope: 'vector:write' },
    ]),
    'operational',
    twoDaysAgo,
  );

  insertApi.run(
    'api_kyc',
    'kyc-identity',
    'KYC Identity Verification',
    'VeriTrust Cloud',
    'Security & Compliance',
    'v2.0',
    'Automated AML sanctions screening, PEP checks, and biometric document liveness verification.',
    '/api/gateway/kyc-identity',
    99.95,
    64,
    'Per verification',
    4900,
    14900,
    90,
    50000,
    JSON.stringify({ fullName: 'Jordan Vance', country: 'US', checkSanctions: true }, null, 2),
    JSON.stringify({ verificationId: 'kyc_9182', decision: 'approved', sanctionsHit: false, riskScore: 4 }, null, 2),
    JSON.stringify([
      { method: 'POST', path: '/screen', summary: 'Screen individual against global watchlists', scope: 'kyc:write' },
      { method: 'GET', path: '/status', summary: 'Retrieve compliance ruleset status', scope: 'kyc:read' },
    ]),
    'operational',
    twoDaysAgo,
  );

  insertApi.run(
    'api_market',
    'market-feed',
    'Real-Time Market Feed',
    'Apex Telemetry',
    'Fintech',
    'v4.0',
    'Sub-50ms equity, treasury yield, and commodity OHLCV snapshots with historical replay.',
    '/api/gateway/market-feed',
    99.99,
    16,
    'Starter / Pro / Enterprise',
    0,
    12900,
    500,
    2000000,
    JSON.stringify({ symbols: ['AAPL', 'MSFT', 'NVDA'], interval: '1m' }, null, 2),
    JSON.stringify({ ticker: 'AAPL', price: 228.42, changePct: 1.18, volume: 42190300 }, null, 2),
    JSON.stringify([
      { method: 'POST', path: '/quotes', summary: 'Fetch batch ticker snapshots', scope: 'market:read' },
      { method: 'GET', path: '/health', summary: 'Check exchange feed connectivity', scope: 'market:read' },
    ]),
    'operational',
    twoDaysAgo,
  );

  insertApi.run(
    'api_email',
    'email-relay',
    'Transactional Email Relay',
    'Kodex Messaging',
    'Communications',
    'v1.5',
    'High-deliverability DKIM-signed transactional email API with bounce webhooks and template rendering.',
    '/api/gateway/email-relay',
    99.96,
    31,
    'Free up to 10K/mo',
    0,
    2900,
    240,
    300000,
    JSON.stringify({ to: 'customer@example.com', subject: 'Invoice Paid', template: 'receipt_v2' }, null, 2),
    JSON.stringify({ messageId: 'msg_7741a', queued: true, dkim: 'verified' }, null, 2),
    JSON.stringify([
      { method: 'POST', path: '/send', summary: 'Dispatch signed transactional message', scope: 'email:send' },
      { method: 'GET', path: '/deliverability', summary: 'Inspect domain SPF/DKIM metrics', scope: 'email:read' },
    ]),
    'operational',
    twoDaysAgo,
  );

  // Seed subscriptions & API keys for org_kodex_core
  db.prepare(
    `INSERT INTO api_subscriptions (id, org_id, api_id, plan_name, monthly_quota, requests_used, tokens_used, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('sub_1', 'org_kodex_core', 'api_ocr', 'Pro', 250000, 18420, 42100, 'active', twoDaysAgo);

  db.prepare(
    `INSERT INTO api_subscriptions (id, org_id, api_id, plan_name, monthly_quota, requests_used, tokens_used, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('sub_2', 'org_kodex_core', 'api_fx', 'Starter', 100000, 29820, 0, 'active', twoDaysAgo);

  const demoRawKey1 = 'kx_live_kodex_ocr_8a92f1e04b7c';
  const demoRawKey2 = 'kx_live_kodex_fx_3c71d9a42e80';

  db.prepare(
    `INSERT INTO api_keys (id, org_id, user_id, api_id, name, key_prefix, key_hash, scopes_json, rate_limit_per_min, requests_count, last_used_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'key_demo_ocr',
    'org_kodex_core',
    'usr_alex',
    'api_ocr',
    'Production Billing Worker',
    'kx_live_kodex_ocr_...',
    hashSha256(demoRawKey1),
    JSON.stringify(['ocr:read', 'ocr:write']),
    180,
    18420,
    earlier,
    'active',
    twoDaysAgo,
  );

  db.prepare(
    `INSERT INTO api_keys (id, org_id, user_id, api_id, name, key_prefix, key_hash, scopes_json, rate_limit_per_min, requests_count, last_used_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'key_demo_fx',
    'org_kodex_core',
    'usr_alex',
    'api_fx',
    'Checkout FX Service',
    'kx_live_kodex_fx_...',
    hashSha256(demoRawKey2),
    JSON.stringify(['fx:read']),
    300,
    29820,
    earlier,
    'active',
    twoDaysAgo,
  );

  // Seed API logs
  const insertLog = db.prepare(
    `INSERT INTO api_logs (id, org_id, api_id, key_prefix, method, path, status_code, latency_ms, tokens_used, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertLog.run('log_1', 'org_kodex_core', 'api_ocr', 'kx_live_kodex_ocr_...', 'POST', '/extract', 200, 34, 420, null, earlier);
  insertLog.run('log_2', 'org_kodex_core', 'api_fx', 'kx_live_kodex_fx_...', 'POST', '/quote', 200, 21, 0, null, earlier);
  insertLog.run('log_3', 'org_kodex_core', 'api_ocr', 'kx_live_kodex_ocr_...', 'POST', '/extract', 422, 18, 0, 'Missing documentUrl field in request payload', now);

  // Seed webhook
  db.prepare(
    `INSERT INTO webhooks (id, org_id, api_id, url, events_json, secret_prefix, status, last_triggered_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'wh_1',
    'org_kodex_core',
    'api_ocr',
    'https://hooks.kodex.cloud/v1/ocr-callback',
    JSON.stringify(['extraction.completed', 'extraction.failed']),
    'whsec_98a1...',
    'active',
    earlier,
    twoDaysAgo,
  );

  // Seed AI App & Code Builder project
  const starterFiles = [
    {
      path: 'index.html',
      language: 'html',
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PulseMetrics — SaaS Revenue Console</title>
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">PulseMetrics</div>
      <nav class="nav">
        <button class="nav-btn active" onclick="switchTab('revenue')">Revenue</button>
        <button class="nav-btn" onclick="switchTab('customers')">Customers</button>
      </nav>
    </header>
    <main class="content">
      <section class="hero">
        <h1>Monthly Recurring Revenue</h1>
        <p class="subtitle">Real-time subscription telemetry built on Kodex Cloud.</p>
      </section>
      <section class="kpi-grid">
        <div class="kpi"><span class="label">Net MRR</span><strong id="mrr">$142,800</strong></div>
        <div class="kpi"><span class="label">Active Orgs</span><strong id="orgs">318</strong></div>
        <div class="kpi"><span class="label">Net Retention</span><strong>118.4%</strong></div>
      </section>
      <section class="panel" id="tab-panel">
        <h2>Recent Subscriptions</h2>
        <table class="data-table">
          <thead><tr><th>Customer</th><th>Plan</th><th>MRR</th></tr></thead>
          <tbody id="rows">
            <tr><td>Northstar Logistics</td><td>Enterprise</td><td>$2,400</td></tr>
            <tr><td>Vanguard Bio</td><td>Business</td><td>$890</td></tr>
            <tr><td>Helios Robotics</td><td>Pro</td><td>$290</td></tr>
          </tbody>
        </table>
      </section>
    </main>
  </div>
</body>
</html>`,
    },
    {
      path: 'styles.css',
      language: 'css',
      content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; }
.app-shell { max-width: 960px; margin: 0 auto; padding: 24px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
.brand { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; }
.nav { display: flex; gap: 8px; }
.nav-btn { border: 1px solid #cbd5e1; background: #fff; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.nav-btn.active { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
.hero { margin: 28px 0 20px; }
.hero h1 { font-size: 26px; font-weight: 700; margin-bottom: 6px; }
.subtitle { color: #475569; font-size: 14px; }
.kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
.kpi .label { display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; }
.kpi strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
.panel h2 { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { text-align: left; color: #64748b; font-weight: 500; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
.data-table td { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }`,
    },
    {
      path: 'app.js',
      language: 'javascript',
      content: `function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  const panel = document.getElementById('tab-panel');
  if (tab === 'customers') {
    panel.querySelector('h2').textContent = 'Enterprise Customer Health';
  } else {
    panel.querySelector('h2').textContent = 'Recent Subscriptions';
  }
}`,
    },
    {
      path: 'schema.sql',
      language: 'sql',
      content: `CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  customer_name TEXT NOT NULL,
  plan_tier TEXT NOT NULL,
  mrr_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
    },
  ];

  db.prepare(
    `INSERT INTO ai_projects (id, org_id, name, description, framework, model, files_json, env_vars_json, custom_domain, status, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'prj_pulsemetrics',
    'org_kodex_core',
    'PulseMetrics SaaS Console',
    'Executive MRR & subscription telemetry dashboard with SQL schema and responsive UI.',
    'HTML / CSS / JS + SQL',
    'gemini-4-hydrogen',
    JSON.stringify(starterFiles),
    JSON.stringify([{ key: 'DATABASE_URL', value: 'postgres://kodex_admin@pg-core.kodex.internal:5432/pulse' }]),
    'pulse.kodex.app',
    'ready',
    earlier,
    twoDaysAgo,
  );

  db.prepare(
    `INSERT INTO ai_project_versions (id, project_id, version_number, summary, files_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('ver_1', 'prj_pulsemetrics', 1, 'Initial scaffold from prompt', JSON.stringify(starterFiles), twoDaysAgo);

  // Seed Cloud Hosting deployments, env vars & domains
  db.prepare(
    `INSERT INTO hosting_deployments (
      id, org_id, project_id, project_name, environment, region, branch, commit_sha,
      url, status, build_duration_ms, cpu_percent, memory_mb, bandwidth_gb, build_logs_json, snapshot_html, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'dep_pulse_prod',
    'org_kodex_core',
    'prj_pulsemetrics',
    'PulseMetrics SaaS Console',
    'production',
    'us-east-1',
    'main',
    'a4f91c2',
    '/preview/dep_pulse_prod',
    'live',
    2180,
    11.4,
    240,
    6.2,
    JSON.stringify([
      '[00:00.12] Resolving workspace artifacts for PulseMetrics SaaS Console',
      '[00:00.84] Validating HTML/CSS/JS bundle and CSP headers',
      '[00:01.65] Provisioning edge TLS certificate for pulse.kodex.app',
      '[00:02.18] Deployment live across 14 edge POPs (HTTP 200 OK)',
    ]),
    starterFiles[0].content.replace('</head>', `<style>${starterFiles[1].content}</style></head>`).replace('</body>', `<script>${starterFiles[2].content}</script></body>`),
    earlier,
  );

  db.prepare(
    `INSERT INTO hosting_env_vars (id, org_id, project_name, env_key, env_value, environment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('env_1', 'org_kodex_core', 'PulseMetrics SaaS Console', 'KODEX_API_ENV', 'production', 'production', twoDaysAgo);

  db.prepare(
    `INSERT INTO hosting_domains (id, org_id, project_name, domain, ssl_status, dns_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('dom_1', 'org_kodex_core', 'PulseMetrics SaaS Console', 'pulse.kodex.app', 'active', 1, twoDaysAgo);

  // Seed Enterprise Data Cloud Databases (org_kodex_core AND org_meridian for tenant isolation)
  const insertDb = db.prepare(
    `INSERT INTO managed_databases (
      id, org_id, name, engine, version, region, tier, storage_used_gb, storage_limit_gb,
      connection_limit, active_connections, cpu_percent, iops, host, port, db_name, username, password_hash, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insertDb.run(
    'db_core_pg',
    'org_kodex_core',
    'core-ledger-pg',
    'postgresql',
    '16.4',
    'us-east-1',
    'Dedicated 4 vCPU · 16 GB RAM',
    18.6,
    100,
    250,
    28,
    22.4,
    1420,
    'pg-core-01.data.kodex.internal',
    5432,
    'kodex_ledger',
    'kx_pg_admin',
    hashPassword('PgSecret!99'),
    'available',
    twoDaysAgo,
  );

  insertDb.run(
    'db_core_redis',
    'org_kodex_core',
    'gateway-rate-cache',
    'redis',
    '7.2',
    'us-east-1',
    'Cluster 2 vCPU · 8 GB RAM',
    1.2,
    25,
    1000,
    142,
    9.8,
    4800,
    'redis-edge-01.data.kodex.internal',
    6379,
    'default',
    'kx_redis',
    hashPassword('RedisSecret!99'),
    'available',
    twoDaysAgo,
  );

  // Private Meridian tenant database (must NEVER be visible to Kodex Core users)
  insertDb.run(
    'db_meridian_secret',
    'org_meridian',
    'meridian-private-vault',
    'postgresql',
    '16.4',
    'eu-central-1',
    'Isolated Dedicated 16 vCPU · 64 GB RAM',
    412.0,
    2000,
    500,
    64,
    31.2,
    6200,
    'meridian-vault.eu.kodex.internal',
    5432,
    'meridian_settlements',
    'meridian_root',
    hashPassword('MeridianVault!2026'),
    'available',
    twoDaysAgo,
  );

  // Seed DB backups
  db.prepare(
    `INSERT INTO db_backups (id, org_id, database_id, type, size_mb, retention_days, encrypted, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('bak_1', 'org_kodex_core', 'db_core_pg', 'scheduled', 4820, 30, 1, 'completed', earlier);

  // Seed real disk-backed private storage objects
  const coreStorageDir = path.join(STORAGE_ROOT, 'org_kodex_core');
  if (!fs.existsSync(coreStorageDir)) {
    fs.mkdirSync(coreStorageDir, { recursive: true });
  }
  const sampleCsvContent = 'invoice_id,customer,amount_usd,status\nINV-2026-001,Northstar Logistics,1480.50,paid\nINV-2026-002,Vanguard Bio,890.00,paid\n';
  const sampleCsvPath = path.join(coreStorageDir, 'obj_seed_csv_v1.csv');
  fs.writeFileSync(sampleCsvPath, sampleCsvContent, 'utf8');

  db.prepare(
    `INSERT INTO storage_objects (id, org_id, bucket, folder, file_name, mime_type, size_bytes, version, visibility, checksum, disk_path, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'obj_seed_csv',
    'org_kodex_core',
    'kodex-core-vault',
    '/exports/finance',
    'q4-reconciliation.csv',
    'text/csv',
    Buffer.byteLength(sampleCsvContent, 'utf8'),
    1,
    'private',
    hashSha256(sampleCsvContent).slice(0, 16),
    sampleCsvPath,
    'alex.mercer@kodex.cloud',
    earlier,
  );

  // Seed Meridian private object (isolation test)
  const meridianDir = path.join(STORAGE_ROOT, 'org_meridian');
  if (!fs.existsSync(meridianDir)) {
    fs.mkdirSync(meridianDir, { recursive: true });
  }
  const meridianSecretContent = 'CONFIDENTIAL MERIDIAN SETTLEMENT LEDGER\n';
  const meridianFilePath = path.join(meridianDir, 'obj_meridian_1.txt');
  fs.writeFileSync(meridianFilePath, meridianSecretContent, 'utf8');

  db.prepare(
    `INSERT INTO storage_objects (id, org_id, bucket, folder, file_name, mime_type, size_bytes, version, visibility, checksum, disk_path, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'obj_meridian_1',
    'org_meridian',
    'meridian-private-bucket',
    '/compliance',
    'eu-regulatory-audit.txt',
    'text/plain',
    Buffer.byteLength(meridianSecretContent, 'utf8'),
    1,
    'private',
    hashSha256(meridianSecretContent).slice(0, 16),
    meridianFilePath,
    'elena.rostova@meridian.io',
    earlier,
  );

  // Seed Invoices & Payments
  db.prepare(
    `INSERT INTO invoices (id, org_id, invoice_number, plan_id, billing_cycle, subtotal_cents, usage_overage_cents, discount_cents, tax_cents, total_cents, currency, coupon_code, status, payment_provider, webhook_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('inv_1001', 'org_kodex_core', 'KX-2026-1001', 'pro', 'monthly', 9900, 0, 0, 1782, 11682, 'USD', null, 'paid', 'stripe', 1, twoDaysAgo);

  db.prepare(
    `INSERT INTO payments (id, org_id, invoice_id, provider, provider_event_id, amount_cents, status, signature_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('pay_1001', 'org_kodex_core', 'inv_1001', 'stripe', 'evt_stripe_seed_1001', 11682, 'succeeded', 1, twoDaysAgo);

  // Seed Support Tickets
  db.prepare(
    `INSERT INTO support_tickets (id, org_id, user_id, subject, category, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('tkt_401', 'org_kodex_core', 'usr_alex', 'Increase rate limit burst ceiling on Vision OCR v2.4', 'api', 'medium', 'in_progress', earlier, now);

  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_name, sender_role, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('msg_401_1', 'tkt_401', 'usr_alex', 'Alex Mercer', 'super_admin', 'Requesting 300 req/min burst allowance for nightly invoice batch.', earlier);

  // Seed Notifications & Announcements
  createNotification({
    orgId: 'org_kodex_core',
    type: 'deployment',
    title: 'Production deployment live',
    message: 'PulseMetrics SaaS Console deployed to us-east-1 in 2.18s.',
  });
  createNotification({
    orgId: 'org_kodex_core',
    type: 'billing',
    title: 'Invoice KX-2026-1001 paid',
    message: 'Pro Monthly subscription settled via verified Stripe webhook ($116.82).',
  });

  db.prepare(
    `INSERT INTO announcements (id, title, body, severity, author_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'ann_1',
    'Gemini 4 Hydrogen enabled in AI App Builder',
    'All Pro, Business, and Enterprise workspaces now route code generation through Gemini 4 Hydrogen with structured JSON validation.',
    'info',
    'alex.mercer@kodex.cloud',
    earlier,
  );

  // Feature flags & system settings
  const insertFlag = db.prepare(
    `INSERT INTO feature_flags (key, description, enabled, updated_at) VALUES (?, ?, ?, ?)`,
  );
  insertFlag.run('ai_builder_streaming', 'Enable real-time AI code generation in App Builder', 1, now);
  insertFlag.run('multi_region_failover', 'Allow cross-region database read replicas', 1, now);
  insertFlag.run('usage_overage_alerts', 'Dispatch automated alerts at 85% monthly quota', 1, now);

  db.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`).run('maintenance_mode', 'false', now);
  db.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`).run('default_tax_rate_percent', '18', now);

  recordAuditLog({
    orgId: 'org_kodex_core',
    actorId: 'usr_alex',
    actorEmail: 'alex.mercer@kodex.cloud',
    action: 'platform.initialized',
    resourceType: 'system',
    resourceId: 'kodex-cloud',
    details: 'Initial Kodex Cloud unified platform state provisioned.',
  });
}
