import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Laptop, MailCheck, Shield, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Organization, PlatformRole, UserProfile } from '../types';

interface SessionRow {
  id: string;
  device_label: string;
  ip_address: string;
  last_active_at: string;
  created_at: string;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  status: string;
}

export const AccountSecurityPortal: React.FC<{
  user: UserProfile;
  organization: Organization;
  sessions: SessionRow[];
  currentSessionId?: string;
  onRefreshSession: () => Promise<void>;
}> = ({ user, organization, sessions, currentSessionId, onRefreshSession }) => {
  const [name, setName] = useState(user.name);
  const [twoFaSecret, setTwoFaSecret] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<PlatformRole>('developer');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    try {
      const res = await apiFetch<{ members: TeamMember[] }>('/api/org/team');
      setMembers(res.members);
    } catch {
      // ignore if restricted
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    setFeedback('Profile updated.');
    await onRefreshSession();
  };

  const handleVerifyEmail = async () => {
    await apiFetch('/api/auth/verify-email', { method: 'POST' });
    setFeedback('Email address verified.');
    await onRefreshSession();
  };

  const handleToggle2fa = async () => {
    const res = await apiFetch<{ twoFactorEnabled: boolean; secret: string | null }>(
      '/api/auth/2fa/toggle',
      {
        method: 'POST',
        body: JSON.stringify({ enabled: !user.twoFactorEnabled }),
      },
    );
    setTwoFaSecret(res.secret);
    setFeedback(
      res.twoFactorEnabled ? 'Two-factor authentication enabled.' : 'Two-factor authentication disabled.',
    );
    await onRefreshSession();
  };

  const handleRevokeSession = async (sessionId: string) => {
    await apiFetch(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
    setFeedback('Session terminated.');
    await onRefreshSession();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/org/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail('');
      setFeedback(`Invitation dispatched to ${inviteEmail}.`);
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation failed.');
    }
  };

  const handleSwitchPersona = async (email: string) => {
    await apiFetch('/api/auth/switch-account', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    await onRefreshSession();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">
          Account, Team &amp; Security Settings
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Manage credentials, 2FA, active browser sessions, and {organization.name} team access.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">{error}</div>
      )}
      {feedback && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Profile & 2FA */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex items-center gap-4">
            <img
              src={user.avatarUrl || '/src/assets/images/avatar_admin_profile_1794794771026.jpg'}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-full object-cover border border-slate-200"
            />
            <div>
              <div className="text-base font-display font-semibold text-slate-900">{user.name}</div>
              <div className="text-xs text-slate-500">
                {user.email} · {user.role.replace('_', ' ')}
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="flex gap-2 items-end">
            <div className="flex-1">
              <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 mb-1">
                Display Name
              </label>
              <input
                id="prof-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-md"
            >
              Update Profile
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <MailCheck className="w-4 h-4 text-slate-500" />
                <span>Email Verification</span>
              </div>
              {user.emailVerified ? (
                <span className="font-semibold text-emerald-700">Verified</span>
              ) : (
                <button
                  type="button"
                  onClick={handleVerifyEmail}
                  className="text-blue-700 hover:underline font-medium"
                >
                  Verify Now
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-500" />
                <span>Two-Factor Authentication (2FA)</span>
              </div>
              <button
                type="button"
                onClick={handleToggle2fa}
                className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-50 font-medium"
              >
                {user.twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
              </button>
            </div>

            {twoFaSecret && (
              <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono">
                TOTP Setup Secret: {twoFaSecret}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-700 mb-2">
              Test RBAC &amp; Tenant Isolation (Quick Switch)
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleSwitchPersona('alex.mercer@kodex.cloud')}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50"
              >
                Alex (Super Admin · Kodex Core)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPersona('maya.lin@kodex.cloud')}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50"
              >
                Maya (Developer · Kodex Core)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPersona('elena.rostova@meridian.io')}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50"
              >
                Elena (Enterprise · Meridian Tenant)
              </button>
            </div>
          </div>
        </div>

        {/* Sessions & Team */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <Laptop className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-display font-semibold text-slate-900">
                Active Sessions &amp; Devices ({sessions.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {sessions.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-slate-900">
                      {s.device_label}{' '}
                      {s.id === currentSessionId && (
                        <span className="text-blue-700 font-semibold">· Current</span>
                      )}
                    </div>
                    <div className="text-slate-500 font-mono mt-0.5 tabular-nums">
                      IP {s.ip_address} · Last active {new Date(s.last_active_at).toLocaleTimeString()}
                    </div>
                  </div>
                  {s.id !== currentSessionId && (
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(s.id)}
                      className="text-red-600 hover:underline font-medium"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-display font-semibold text-slate-900">
                Organization Team ({organization.name})
              </h2>
            </div>

            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
              <select
                aria-label="Invite Role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as PlatformRole)}
                className="px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="developer">Developer</option>
                <option value="org_admin">Org Admin</option>
                <option value="enterprise_member">Enterprise Member</option>
              </select>
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-700 text-white text-xs font-medium rounded-md"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite</span>
              </button>
            </form>

            <div className="divide-y divide-slate-100">
              {members.map((m) => (
                <div key={m.id} className="py-2 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-medium text-slate-900">{m.name}</div>
                    <div className="text-slate-500">{m.email}</div>
                  </div>
                  <span className="text-slate-600 capitalize">{m.role.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
