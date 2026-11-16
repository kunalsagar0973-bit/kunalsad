import React, { useState } from 'react';
import { ShieldCheck, KeyRound, UserPlus, ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface AuthScreenProps {
  onAuthenticated: () => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('alex.mercer@kodex.cloud');
  const [password, setPassword] = useState('KodexAdmin!2026');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requires2fa, setRequires2fa] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiFetch<{ requiresTwoFactor?: boolean; message?: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password, twoFactorCode: requires2fa ? twoFactorCode : undefined }),
        });
        if (res.requiresTwoFactor) {
          setRequires2fa(true);
          setStatusMessage(res.message || 'Enter your 6-digit 2FA code.');
          return;
        }
        await onAuthenticated();
      } else if (mode === 'register') {
        const res = await apiFetch<{ message: string; verificationToken: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, name, orgName }),
        });
        setStatusMessage(`${res.message} Token: ${res.verificationToken}`);
        await onAuthenticated();
      } else {
        if (!resetToken) {
          const res = await apiFetch<{ message: string; resetToken?: string }>('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email }),
          });
          setStatusMessage(
            res.resetToken
              ? `${res.message} Sandbox token: ${res.resetToken}`
              : res.message,
          );
          if (res.resetToken) setResetToken(res.resetToken);
        } else {
          await apiFetch('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ token: resetToken, newPassword }),
          });
          setStatusMessage('Password updated. You can now sign in.');
          setMode('login');
          setResetToken('');
          setNewPassword('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const quickSwitch = async (targetEmail: string) => {
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/auth/switch-account', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail }),
      });
      await onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Switch failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="lg:col-span-5 bg-slate-900 text-slate-100 p-8 flex flex-col justify-between">
          <div>
            <div className="text-xl font-display font-bold tracking-tight text-white">
              Kodex Cloud
            </div>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              Unified cloud platform combining API Marketplace, AI App &amp; Code Builder,
              Cloud Hosting, and Enterprise Data Cloud under single-tenant isolation.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800">
            <div className="text-xs font-medium text-slate-400 mb-3">
              Sandbox Workspace Personas
            </div>
            <div className="space-y-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => quickSwitch('alex.mercer@kodex.cloud')}
                className="w-full text-left px-3 py-2.5 rounded-md border border-slate-700 hover:border-slate-500 transition-colors"
              >
                <div className="text-xs font-semibold text-white">Alex Mercer</div>
                <div className="text-xs text-slate-400">Super Admin · Kodex Core Labs</div>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => quickSwitch('maya.lin@kodex.cloud')}
                className="w-full text-left px-3 py-2.5 rounded-md border border-slate-700 hover:border-slate-500 transition-colors"
              >
                <div className="text-xs font-semibold text-white">Maya Lin</div>
                <div className="text-xs text-slate-400">Developer · Kodex Core Labs</div>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => quickSwitch('elena.rostova@meridian.io')}
                className="w-full text-left px-3 py-2.5 rounded-md border border-slate-700 hover:border-slate-500 transition-colors"
              >
                <div className="text-xs font-semibold text-white">Elena Rostova</div>
                <div className="text-xs text-slate-400">Enterprise Tenant · Meridian FinTech</div>
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-8">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'reset' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Reset Password
            </button>
          </div>

          <h1 className="text-2xl font-display font-bold text-slate-900 mb-1">
            {mode === 'login' && 'Sign in to Kodex Cloud'}
            {mode === 'register' && 'Provision a new workspace'}
            {mode === 'reset' && 'Recover workspace access'}
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            {mode === 'login' && 'Access all four portals with your unified organization credentials.'}
            {mode === 'register' && 'Creates an isolated tenant workspace with Free tier quotas.'}
            {mode === 'reset' && 'Generate a password reset token and set a new credential.'}
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
              {error}
            </div>
          )}
          {statusMessage && (
            <div className="mb-4 p-3 rounded-md border border-blue-200 bg-blue-50 text-xs text-blue-800">
              {statusMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Vance"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="auth-org" className="block text-xs font-medium text-slate-700 mb-1">
                    Organization Name
                  </label>
                  <input
                    id="auth-org"
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Vance Systems Inc."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 mb-1">
                Work Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {mode === 'login' && requires2fa && (
              <div>
                <label htmlFor="auth-2fa" className="block text-xs font-medium text-slate-700 mb-1">
                  Two-Factor Authentication Code (6 digits)
                </label>
                <input
                  id="auth-2fa"
                  type="text"
                  required
                  maxLength={6}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {mode === 'reset' && resetToken && (
              <>
                <div>
                  <label htmlFor="reset-token" className="block text-xs font-medium text-slate-700 mb-1">
                    Reset Token
                  </label>
                  <input
                    id="reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="new-pass" className="block text-xs font-medium text-slate-700 mb-1">
                    New Password (min 8 chars)
                  </label>
                  <input
                    id="new-pass"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60"
            >
              {mode === 'login' && (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                </>
              )}
              {mode === 'register' && (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{loading ? 'Provisioning...' : 'Create Workspace'}</span>
                </>
              )}
              {mode === 'reset' && (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>{resetToken ? 'Update Password' : 'Issue Reset Token'}</span>
                </>
              )}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-200 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Scrypt salted password hashing · HTTP-only session cookies · Tenant RBAC enforced</span>
          </div>
        </div>
      </div>
    </div>
  );
};
