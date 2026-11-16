import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Bell, BookOpen, CheckCheck, LifeBuoy, Send } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { NotificationItem } from '../types';

interface TicketRecord {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: 'open' | 'in_progress' | 'resolved';
  userName: string;
  createdAt: string;
  messages: Array<{
    id: string;
    sender_name: string;
    sender_role: string;
    message: string;
    created_at: string;
  }>;
}

interface HealthMetrics {
  uptimeSeconds: number;
  nodeVersion: string;
  cpuLoad1m: number;
  heapUsedMb: number;
  rssMb: number;
  gatewayRequestsLogged: number;
  gatewayAvgLatencyMs: number;
  gatewayErrorRatePct: number;
  liveDeployments: number;
  managedDatabases: number;
  services: Array<{ name: string; region: string; status: string; latencyMs: number }>;
}

export const SupportAndOpsPortal: React.FC<{
  initialTab?: 'notifications' | 'tickets' | 'docs' | 'monitoring';
  onNotificationsRead?: () => void;
}> = ({ initialTab = 'notifications', onNotificationsRead }) => {
  const [tab, setTab] = useState<'notifications' | 'tickets' | 'docs' | 'monitoring'>(initialTab);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('api');
  const [priority, setPriority] = useState('medium');
  const [message, setMessage] = useState('');
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadAll = useCallback(async () => {
    const [ntfRes, tktRes, monRes] = await Promise.all([
      apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
      apiFetch<{ tickets: TicketRecord[] }>('/api/support/tickets'),
      apiFetch<HealthMetrics>('/api/monitoring/health'),
    ]);
    setNotifications(ntfRes.notifications);
    setTickets(tktRes.tickets);
    setHealth(monRes);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const markAllRead = async () => {
    await apiFetch('/api/notifications/mark-read', { method: 'POST', body: JSON.stringify({}) });
    await loadAll();
    onNotificationsRead?.();
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/support/tickets', {
      method: 'POST',
      body: JSON.stringify({ subject, category, priority, message }),
    });
    setSubject('');
    setMessage('');
    setFeedback('Support ticket opened and assigned to engineering queue.');
    await loadAll();
  };

  const handleReply = async (ticketId: string, newStatus?: string) => {
    const text = replyText[ticketId] || '';
    await apiFetch(`/api/support/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message: text, status: newStatus }),
    });
    setReplyText((prev) => ({ ...prev, [ticketId]: '' }));
    await loadAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Operations, Support &amp; Documentation
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Real-time alerts, engineering support desk, platform API documentation, and system telemetry.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
          {(
            [
              ['notifications', 'Notifications', Bell],
              ['tickets', 'Support Tickets', LifeBuoy],
              ['docs', 'Documentation', BookOpen],
              ['monitoring', 'System Status', Activity],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                tab === id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800">
          {feedback}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Notifications Centre ({notifications.filter((n) => !n.read).length} unread)
            </h2>
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {notifications.map((n) => (
              <div key={n.id} className={`py-3 flex items-start justify-between gap-4 ${n.read ? 'opacity-70' : ''}`}>
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    {n.title} · <span className="font-normal text-slate-500 capitalize">{n.type}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{n.message}</p>
                </div>
                <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateTicket}
            className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit"
          >
            <h2 className="text-sm font-display font-semibold text-slate-900">Open Support Ticket</h2>
            <div>
              <label htmlFor="tkt-subject" className="block text-xs font-medium text-slate-700 mb-1">
                Subject
              </label>
              <input
                id="tkt-subject"
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief issue summary"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="tkt-cat" className="block text-xs font-medium text-slate-700 mb-1">
                  Portal
                </label>
                <select
                  id="tkt-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="api">API Marketplace</option>
                  <option value="hosting">Cloud Hosting</option>
                  <option value="datacloud">Data Cloud</option>
                  <option value="billing">Billing</option>
                  <option value="security">Security</option>
                </select>
              </div>
              <div>
                <label htmlFor="tkt-prio" className="block text-xs font-medium text-slate-700 mb-1">
                  Priority
                </label>
                <select
                  id="tkt-prio"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="tkt-msg" className="block text-xs font-medium text-slate-700 mb-1">
                Details
              </label>
              <textarea
                id="tkt-msg"
                rows={4}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full p-2.5 text-xs border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-md"
            >
              Submit Ticket
            </button>
          </form>

          <div className="lg:col-span-8 space-y-4">
            {tickets.map((tkt) => (
              <div key={tkt.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-display font-semibold text-slate-900">
                      {tkt.subject}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {tkt.id} · {tkt.category} · Priority {tkt.priority} · Opened by {tkt.userName}
                    </div>
                  </div>
                  <span className="text-xs font-semibold capitalize text-blue-700">
                    {tkt.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {tkt.messages.map((m) => (
                    <div key={m.id} className="p-2.5 rounded bg-slate-50 text-xs">
                      <div className="font-medium text-slate-800">
                        {m.sender_name} ({m.sender_role})
                      </div>
                      <p className="text-slate-600 mt-1">{m.message}</p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <input
                    type="text"
                    value={replyText[tkt.id] || ''}
                    onChange={(e) =>
                      setReplyText((prev) => ({ ...prev, [tkt.id]: e.target.value }))
                    }
                    placeholder="Write a reply..."
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => handleReply(tkt.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md"
                  >
                    <Send className="w-3 h-3" />
                    <span>Reply</span>
                  </button>
                  {tkt.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => handleReply(tkt.id, 'resolved')}
                      className="px-3 py-1.5 border border-slate-300 text-xs font-medium rounded-md hover:bg-slate-50"
                    >
                      Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'docs' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
          <div>
            <h2 className="text-lg font-display font-bold text-slate-900">
              Kodex Cloud Developer Documentation
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Unified authentication, API gateway headers, AI App Builder schema exports, and tenant-isolated storage endpoints.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed">
            <div className="space-y-2">
              <h3 className="text-sm font-display font-semibold text-slate-900">
                01. API Gateway Authentication
              </h3>
              <p className="text-slate-600">
                Pass your generated secret key in the <code className="font-mono">Authorization: Bearer kx_live_...</code> header. All keys are stored solely as SHA-256 hashes and evaluated against per-key rate limits and tenant scopes.
              </p>
              <pre className="p-3 rounded bg-slate-950 text-slate-200 font-mono overflow-x-auto">
{`POST /api/marketplace/playground/execute
Authorization: Bearer kx_live_...
Content-Type: application/json`}
              </pre>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-display font-semibold text-slate-900">
                02. Tenant Data Cloud Isolation
              </h3>
              <p className="text-slate-600">
                Every managed database cluster and object storage bucket is bound to a single <code className="font-mono">orgId</code>. Cross-tenant requests are rejected at the RBAC policy layer with HTTP 403 and recorded in immutable audit logs.
              </p>
              <pre className="p-3 rounded bg-slate-950 text-slate-200 font-mono overflow-x-auto">
{`GET /api/datacloud/storage/:objectId/download
Cookie: kodex_session=<httpOnly>`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {tab === 'monitoring' && health && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Runtime Uptime</div>
              <div className="mt-1 text-xl font-display font-bold tabular-nums">
                {health.uptimeSeconds}s
              </div>
              <div className="text-xs text-slate-500 mt-1">{health.nodeVersion}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Gateway Avg Latency</div>
              <div className="mt-1 text-xl font-display font-bold tabular-nums">
                {health.gatewayAvgLatencyMs} ms
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {health.gatewayRequestsLogged} logged calls
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Process Memory (RSS)</div>
              <div className="mt-1 text-xl font-display font-bold tabular-nums">
                {health.rssMb} MB
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Heap used: {health.heapUsedMb} MB
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Error Rate</div>
              <div className="mt-1 text-xl font-display font-bold tabular-nums">
                {health.gatewayErrorRatePct}%
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {health.liveDeployments} live apps · {health.managedDatabases} DBs
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-display font-semibold text-slate-900 mb-3">
              Regional Service Health
            </h2>
            <div className="divide-y divide-slate-100">
              {health.services.map((svc) => (
                <div key={svc.name} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-slate-900">{svc.name}</div>
                    <div className="text-slate-500">{svc.region}</div>
                  </div>
                  <div className="flex items-center gap-4 tabular-nums">
                    <span className="font-mono text-slate-600">{svc.latencyMs}ms</span>
                    <span className="font-semibold text-emerald-700 capitalize">{svc.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
