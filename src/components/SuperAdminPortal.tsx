import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, Search, ShieldAlert, ToggleRight, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatCurrencyCents } from '../lib/platformLogic';
import type { AuditLogEntry, PlatformRole } from '../types';

interface AdminOverview {
  users: Array<{
    id: string;
    email: string;
    name: string;
    role: PlatformRole;
    org_name: string;
    status: 'active' | 'suspended';
  }>;
  organizations: Array<{
    id: string;
    name: string;
    plan_id: string;
    billing_cycle: string;
    storage_quota_gb: number;
  }>;
  totalRevenueCents: number;
  auditLogs: AuditLogEntry[];
  featureFlags: Array<{ key: string; description: string; enabled: number }>;
  settings: Array<{ key: string; value: string }>;
  securityAlerts: Array<{
    id: string;
    method: string;
    path: string;
    status_code: number;
    error_message: string | null;
    created_at: string;
  }>;
}

export const SuperAdminPortal: React.FC<{ onSystemChanged?: () => Promise<void> }> = ({
  onSystemChanged,
}) => {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<PlatformRole>('developer');
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [apiName, setApiName] = useState('');
  const [apiCat, setApiCat] = useState('AI & Vision');
  const [apiDesc, setApiDesc] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAdmin = useCallback(async () => {
    try {
      const res = await apiFetch<AdminOverview>('/api/admin/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin console access denied.');
    }
  }, []);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  const handleToggleUser = async (userId: string, currentStatus: 'active' | 'suspended') => {
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: currentStatus === 'active' ? 'suspended' : 'active' }),
      });
      setFeedback('User status updated and audited.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newUserEmail,
          name: newUserName,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      setFeedback('New user account created.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create user failed.');
    }
  };

  const handleToggleFlag = async (key: string, enabled: boolean) => {
    await apiFetch(`/api/admin/feature-flags/${key}`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
    await loadAdmin();
  };

  const handleToggleMaintenance = async (enabled: boolean) => {
    await apiFetch('/api/admin/maintenance-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
    await loadAdmin();
    await onSystemChanged?.();
  };

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ title: annTitle, body: annBody }),
    });
    setAnnTitle('');
    setAnnBody('');
    setFeedback('Platform announcement broadcasted to all organizations.');
    await loadAdmin();
  };

  const handlePublishApi = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/marketplace/products', {
      method: 'POST',
      body: JSON.stringify({ name: apiName, category: apiCat, description: apiDesc }),
    });
    setApiName('');
    setApiDesc('');
    setFeedback('New API product published to Marketplace.');
    await loadAdmin();
  };

  if (error && !data) {
    return (
      <div className="p-6 bg-white border border-red-200 rounded-lg text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) {
    return <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  const maintenanceOn =
    data.settings.find((s) => s.key === 'maintenance_mode')?.value === 'true';

  const filteredUsers = data.users.filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Super Admin Control Center
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Central governance across users, organizations, marketplace products, revenue, flags, and audit logs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => handleToggleMaintenance(!maintenanceOn)}
          className={`px-4 py-2 text-xs font-medium rounded-md border ${
            maintenanceOn
              ? 'bg-amber-600 text-white border-amber-700'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          {maintenanceOn ? 'Maintenance Mode: ON (Disable)' : 'Enable Maintenance Mode'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">{error}</div>
      )}
      {feedback && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800">
          {feedback}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Settled Platform Revenue</div>
          <div className="mt-1 text-2xl font-display font-bold tabular-nums">
            {formatCurrencyCents(data.totalRevenueCents)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Registered Users</div>
          <div className="mt-1 text-2xl font-display font-bold tabular-nums">
            {data.users.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Tenant Organizations</div>
          <div className="mt-1 text-2xl font-display font-bold tabular-nums">
            {data.organizations.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Gateway Security Events</div>
          <div className="mt-1 text-2xl font-display font-bold tabular-nums">
            {data.securityAlerts.length}
          </div>
        </div>
      </div>

      {/* User Management & Organizations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Platform Users ({filteredUsers.length})
            </h2>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Organization</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5">
                      <div className="font-medium text-slate-900">{u.name}</div>
                      <div className="text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-2.5 text-slate-700">{u.org_name}</td>
                    <td className="py-2.5 capitalize text-slate-700">{u.role.replace('_', ' ')}</td>
                    <td className="py-2.5">
                      <span className={u.status === 'active' ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                        {u.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleUser(u.id, u.status)}
                        className="text-blue-700 hover:underline font-medium"
                      >
                        {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form
          onSubmit={handleCreateUser}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3 h-fit"
        >
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-display font-semibold text-slate-900">Create Platform User</h2>
          </div>
          <input
            type="text"
            required
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            placeholder="Full Name"
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />
          <input
            type="email"
            required
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="Email Address"
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />
          <input
            type="password"
            required
            minLength={8}
            value={newUserPassword}
            onChange={(e) => setNewUserPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />
          <select
            aria-label="New User Role"
            value={newUserRole}
            onChange={(e) => setNewUserRole(e.target.value as PlatformRole)}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="developer">Developer</option>
            <option value="org_admin">Org Admin</option>
            <option value="customer">Customer</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <button
            type="submit"
            className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-md"
          >
            Provision User
          </button>
        </form>
      </div>

      {/* Feature Flags, Announcements, Publish API */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ToggleRight className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-display font-semibold text-slate-900">Feature Flags</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {data.featureFlags.map((flag) => (
              <div key={flag.key} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-mono font-medium text-slate-900">{flag.key}</div>
                  <div className="text-slate-500">{flag.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFlag(flag.key, !flag.enabled)}
                  className={`px-2.5 py-1 rounded text-xs font-medium shrink-0 ${
                    flag.enabled
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <form
          onSubmit={handlePublishAnnouncement}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Broadcast Announcement
            </h2>
          </div>
          <input
            type="text"
            required
            value={annTitle}
            onChange={(e) => setAnnTitle(e.target.value)}
            placeholder="Announcement title"
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />
          <textarea
            rows={3}
            required
            value={annBody}
            onChange={(e) => setAnnBody(e.target.value)}
            placeholder="Platform notice to all tenants..."
            className="w-full p-2.5 text-xs border border-slate-300 rounded-md"
          />
          <button
            type="submit"
            className="w-full py-2 bg-slate-900 text-white text-xs font-medium rounded-md"
          >
            Publish Announcement
          </button>
        </form>

        <form
          onSubmit={handlePublishApi}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Publish Marketplace API
            </h2>
          </div>
          <input
            type="text"
            required
            value={apiName}
            onChange={(e) => setApiName(e.target.value)}
            placeholder="API Product Name"
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />
          <input
            type="text"
            required
            value={apiCat}
            onChange={(e) => setApiCat(e.target.value)}
            placeholder="Category"
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />
          <textarea
            rows={2}
            required
            value={apiDesc}
            onChange={(e) => setApiDesc(e.target.value)}
            placeholder="API description..."
            className="w-full p-2.5 text-xs border border-slate-300 rounded-md"
          />
          <button
            type="submit"
            className="w-full py-2 bg-blue-700 text-white text-xs font-medium rounded-md"
          >
            Add API to Catalog
          </button>
        </form>
      </div>

      {/* Immutable Audit Log */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
        <h2 className="text-sm font-display font-semibold text-slate-900 mb-3">
          Global Immutable Audit Trail
        </h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="pb-2 font-medium">Action</th>
              <th className="pb-2 font-medium">Actor</th>
              <th className="pb-2 font-medium">Org</th>
              <th className="pb-2 font-medium">Details</th>
              <th className="pb-2 font-medium text-right">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.auditLogs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className="py-2 pr-3 font-mono text-slate-900">{log.action}</td>
                <td className="py-2 pr-3 text-slate-600">{log.actorEmail || (log as unknown as { actor_email: string }).actor_email}</td>
                <td className="py-2 pr-3 font-mono text-slate-500">{log.orgId || (log as unknown as { org_id: string }).org_id}</td>
                <td className="py-2 pr-3 text-slate-700">{log.details}</td>
                <td className="py-2 text-right text-slate-500 tabular-nums whitespace-nowrap">
                  {new Date(log.createdAt || (log as unknown as { created_at: string }).created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
