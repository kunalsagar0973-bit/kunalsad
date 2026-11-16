import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Plus,
  RotateCcw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { HostingDeployment, HostingDomain } from '../types';

interface HostingEnvVar {
  id: string;
  projectName: string;
  envKey: string;
  envValue: string;
  environment: string;
  createdAt: string;
}

interface HostingOverview {
  deployments: HostingDeployment[];
  envVars: HostingEnvVar[];
  domains: HostingDomain[];
}

export const HostingPortal: React.FC = () => {
  const [data, setData] = useState<HostingOverview | null>(null);
  const [selectedDep, setSelectedDep] = useState<HostingDeployment | null>(null);
  const [projectName, setProjectName] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'staging' | 'preview'>('production');
  const [region, setRegion] = useState('us-east-1');
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [envProject, setEnvProject] = useState('PulseMetrics SaaS Console');
  const [domainName, setDomainName] = useState('');
  const [domainProject, setDomainProject] = useState('PulseMetrics SaaS Console');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHosting = useCallback(async () => {
    try {
      const res = await apiFetch<HostingOverview>('/api/hosting/overview');
      setData(res);
      if (res.deployments.length > 0 && !selectedDep) {
        setSelectedDep(res.deployments[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hosting telemetry.');
    } finally {
      setLoading(false);
    }
  }, [selectedDep]);

  useEffect(() => {
    void loadHosting();
  }, [loadHosting]);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ id: string; url: string }>('/api/hosting/deployments', {
        method: 'POST',
        body: JSON.stringify({ projectName, environment, region }),
      });
      setProjectName('');
      setFeedback(`Deployment ${res.id} is live at ${res.url}.`);
      await loadHosting();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed.');
    }
  };

  const handleRollback = async (id: string) => {
    setError(null);
    await apiFetch(`/api/hosting/deployments/${id}/rollback`, { method: 'POST' });
    setFeedback(`Rolled back deployment ${id}.`);
    await loadHosting();
  };

  const handleAddEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/hosting/env-vars', {
        method: 'POST',
        body: JSON.stringify({ projectName: envProject, envKey, envValue, environment: 'production' }),
      });
      setEnvKey('');
      setEnvValue('');
      setFeedback('Environment variable encrypted and attached.');
      await loadHosting();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save env variable.');
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/hosting/domains', {
        method: 'POST',
        body: JSON.stringify({ projectName: domainProject, domain: domainName }),
      });
      setDomainName('');
      setFeedback('Custom domain verified and TLS certificate provisioned.');
      await loadHosting();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Domain attachment failed.');
    }
  };

  if (loading || !data) {
    return <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">
          Cloud Hosting &amp; Deployment
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Multi-region edge deployments, build log inspection, instant rollbacks, environment secrets, and custom TLS domains.
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

      {/* Trigger New Deployment */}
      <form
        onSubmit={handleDeploy}
        className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
      >
        <div className="md:col-span-4">
          <label htmlFor="dep-name" className="block text-xs font-medium text-slate-700 mb-1">
            Application / Service Name
          </label>
          <input
            id="dep-name"
            type="text"
            required
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Customer Billing Gateway"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <div className="md:col-span-3">
          <label htmlFor="dep-env" className="block text-xs font-medium text-slate-700 mb-1">
            Environment
          </label>
          <select
            id="dep-env"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as 'production' | 'staging' | 'preview')}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
          >
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="preview">Preview</option>
          </select>
        </div>
        <div className="md:col-span-3">
          <label htmlFor="dep-region" className="block text-xs font-medium text-slate-700 mb-1">
            Primary Region
          </label>
          <select
            id="dep-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
          >
            <option value="us-east-1">us-east-1 (N. Virginia)</option>
            <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
            <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Deploy</span>
          </button>
        </div>
      </form>

      {/* Deployments Table + Build Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
          <h2 className="text-sm font-display font-semibold text-slate-900 mb-4">
            Deployments ({data.deployments.length})
          </h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 font-medium">Env / Region</th>
                <th className="pb-2 font-medium">Commit</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.deployments.map((dep) => (
                <tr
                  key={dep.id}
                  className={`hover:bg-slate-50 ${selectedDep?.id === dep.id ? 'bg-blue-50/40' : ''}`}
                >
                  <td className="py-3 pr-3">
                    <button
                      type="button"
                      onClick={() => setSelectedDep(dep)}
                      className="font-medium text-slate-900 hover:text-blue-700 text-left"
                    >
                      {dep.projectName}
                    </button>
                    <div className="text-slate-500 tabular-nums mt-0.5">
                      {dep.cpuPercent}% CPU · {dep.memoryMb} MB · {dep.bandwidthGb} GB
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-slate-700 whitespace-nowrap">
                    {dep.environment} · {dep.region}
                  </td>
                  <td className="py-3 pr-3 font-mono text-slate-600">{dep.commitSha}</td>
                  <td className="py-3 pr-3">
                    <span
                      className={
                        dep.status === 'live'
                          ? 'text-emerald-700 font-semibold'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      {dep.status}
                    </span>
                  </td>
                  <td className="py-3 text-right space-x-3 whitespace-nowrap">
                    <a
                      href={dep.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                    >
                      <span>Open</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {dep.status === 'live' && (
                      <button
                        type="button"
                        onClick={() => handleRollback(dep.id)}
                        className="inline-flex items-center gap-1 text-slate-600 hover:text-red-600 font-medium"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Rollback</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-5 bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span>Build Logs · {selectedDep?.projectName || 'Select deployment'}</span>
            </div>
            {selectedDep && (
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {selectedDep.buildDurationMs}ms
              </span>
            )}
          </div>
          <div className="mt-3 font-mono text-xs space-y-2 overflow-y-auto flex-1">
            {selectedDep?.buildLogs.map((line, i) => (
              <div key={i} className="text-slate-300 leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Environment Variables & Custom Domains */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-display font-semibold text-slate-900">
            Encrypted Environment Variables
          </h2>
          <form onSubmit={handleAddEnv} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={envProject}
              onChange={(e) => setEnvProject(e.target.value)}
              placeholder="Project Name"
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
            />
            <input
              type="text"
              required
              value={envKey}
              onChange={(e) => setEnvKey(e.target.value)}
              placeholder="VARIABLE_KEY"
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
            />
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={envValue}
                onChange={(e) => setEnvValue(e.target.value)}
                placeholder="Value"
                className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md min-w-0"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md shrink-0"
              >
                Save
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-100">
            {data.envVars.map((ev) => (
              <div key={ev.id} className="py-2 flex items-center justify-between text-xs">
                <div>
                  <span className="font-mono font-medium text-slate-900">{ev.envKey}</span>
                  <span className="text-slate-500 ml-2">
                    {ev.projectName} · {ev.environment}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/hosting/env-vars/${ev.id}`, { method: 'DELETE' });
                    await loadHosting();
                  }}
                  aria-label={`Delete env var ${ev.envKey}`}
                  className="text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-display font-semibold text-slate-900">
            Custom Domains &amp; Automatic SSL
          </h2>
          <form onSubmit={handleAddDomain} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              required
              value={domainProject}
              onChange={(e) => setDomainProject(e.target.value)}
              placeholder="Project Name"
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md"
            />
            <input
              type="text"
              required
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              placeholder="api.yourdomain.com"
              className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white text-xs font-medium rounded-md shrink-0"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Attach Domain</span>
            </button>
          </form>

          <div className="divide-y divide-slate-100">
            {data.domains.map((dom) => (
              <div key={dom.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-mono font-medium text-slate-900">{dom.domain}</div>
                  <div className="text-slate-500 mt-0.5">
                    {dom.projectName} · TLS {dom.sslStatus} · DNS {dom.dnsVerified ? 'Verified' : 'Pending'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/hosting/domains/${dom.id}`, { method: 'DELETE' });
                    await loadHosting();
                  }}
                  aria-label={`Remove domain ${dom.domain}`}
                  className="text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
