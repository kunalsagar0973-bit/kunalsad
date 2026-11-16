import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Code2,
  Database,
  Globe,
  Layers,
  Shield,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBytes } from '../lib/platformLogic';
import type { Organization, PortalSection, UserProfile } from '../types';

interface OverviewResponse {
  stats: {
    activeApiSubscriptions: number;
    activeApiKeys: number;
    aiProjectsCount: number;
    liveDeploymentsCount: number;
    managedDatabasesCount: number;
    storageObjectsCount: number;
    storageBytes: number;
    apiRequestsMonth: number;
    aiTokensMonth: number;
    bandwidthGbMonth: number;
  };
  recentAuditLogs: Array<{
    id: string;
    actor_email: string;
    action: string;
    resource_type: string;
    details: string;
    created_at: string;
  }>;
  announcements: Array<{
    id: string;
    title: string;
    body: string;
    severity: string;
    created_at: string;
  }>;
}

interface OverviewPortalProps {
  user: UserProfile;
  organization: Organization;
  onNavigate: (section: PortalSection) => void;
}

export const OverviewPortal: React.FC<OverviewPortalProps> = ({
  user,
  organization,
  onNavigate,
}) => {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [perspective, setPerspective] = useState<'unified' | 'developer' | 'customer'>('unified');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<OverviewResponse>('/api/platform/overview')
      .then((res) => {
        if (active) setData(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organization.id]);

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-20 bg-white border border-slate-200 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">
            {organization.name} Workspace
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Signed in as {user.name} · {user.role.replace('_', ' ')} · {organization.planId.toUpperCase()} {organization.billingCycle} plan
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
          {(
            [
              ['unified', 'Unified View'],
              ['developer', 'Developer View'],
              ['customer', 'Customer View'],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => setPerspective(view)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                perspective === view
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">API Gateway Volume</div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 tabular-nums">
            {stats.apiRequestsMonth.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-600 tabular-nums">
            {stats.activeApiSubscriptions} active subscriptions · {stats.activeApiKeys} keys
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">AI Builder Workspaces</div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 tabular-nums">
            {stats.aiProjectsCount}
          </div>
          <div className="mt-1 text-xs text-slate-600 tabular-nums">
            {stats.aiTokensMonth.toLocaleString()} tokens consumed this cycle
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Cloud Deployments</div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 tabular-nums">
            {stats.liveDeploymentsCount}
          </div>
          <div className="mt-1 text-xs text-slate-600 tabular-nums">
            {stats.bandwidthGbMonth} GB edge egress bandwidth
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Enterprise Data Cloud</div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 tabular-nums">
            {stats.managedDatabasesCount} DBs
          </div>
          <div className="mt-1 text-xs text-slate-600 tabular-nums">
            {stats.storageObjectsCount} {stats.storageObjectsCount === 1 ? 'object' : 'objects'} · {formatBytes(stats.storageBytes)}
          </div>
        </div>
      </div>

      {/* Four Integrated Portals */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-display font-semibold text-slate-900">
            {perspective === 'developer'
              ? 'Developer Engineering Portals'
              : perspective === 'customer'
                ? 'Customer Subscription & Infrastructure Portals'
                : 'Integrated Cloud Portals'}
          </h2>
          <span className="text-xs text-slate-500">Single sign-on &amp; unified billing active</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onNavigate('marketplace')}
            className="text-left bg-white border border-slate-200 hover:border-blue-600 rounded-lg p-5 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Layers className="w-5 h-5 text-blue-700" />
                <span className="text-base font-display font-semibold text-slate-900">
                  API Marketplace
                </span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-700 transition-colors" />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {perspective === 'developer'
                ? 'Manage SHA-256 hashed API keys, test endpoints in the live playground, and inspect latency logs.'
                : 'Discover commercial APIs, compare Starter/Pro/Enterprise tiers, and track monthly request quotas.'}
            </p>
            <div className="mt-3 text-xs text-slate-500 tabular-nums">
              {stats.activeApiSubscriptions} subscribed APIs · {stats.activeApiKeys} active keys
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('builder')}
            className="text-left bg-white border border-slate-200 hover:border-blue-600 rounded-lg p-5 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Code2 className="w-5 h-5 text-blue-700" />
                <span className="text-base font-display font-semibold text-slate-900">
                  AI App &amp; Code Builder
                </span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-700 transition-colors" />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {perspective === 'developer'
                ? 'Prompt full-stack apps with Gemini 4 Hydrogen, edit source files, restore versions, or export ZIP.'
                : 'Describe SaaS portals, dashboards, or landing pages in plain English with instant live preview.'}
            </p>
            <div className="mt-3 text-xs text-slate-500 tabular-nums">
              {stats.aiProjectsCount} saved {stats.aiProjectsCount === 1 ? 'workspace' : 'workspaces'} · {stats.aiTokensMonth.toLocaleString()} tokens used
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('hosting')}
            className="text-left bg-white border border-slate-200 hover:border-blue-600 rounded-lg p-5 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-blue-700" />
                <span className="text-base font-display font-semibold text-slate-900">
                  Cloud Hosting &amp; Deployment
                </span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-700 transition-colors" />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {perspective === 'developer'
                ? 'Inspect build logs, configure encrypted environment variables, map custom domains, and roll back.'
                : 'Monitor live production endpoints, regional TLS status, and monthly bandwidth utilization.'}
            </p>
            <div className="mt-3 text-xs text-slate-500 tabular-nums">
              {stats.liveDeploymentsCount} live {stats.liveDeploymentsCount === 1 ? 'deployment' : 'deployments'} · {stats.bandwidthGbMonth} GB served
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('datacloud')}
            className="text-left bg-white border border-slate-200 hover:border-blue-600 rounded-lg p-5 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-blue-700" />
                <span className="text-base font-display font-semibold text-slate-900">
                  Enterprise Data Cloud
                </span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-700 transition-colors" />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {perspective === 'developer'
                ? 'Provision PostgreSQL, MySQL, MongoDB & Redis clusters, run backups, and manage versioned object buckets.'
                : 'Strict single-tenant isolation with encrypted backups, RBAC controls, and compliant data residency.'}
            </p>
            <div className="mt-3 text-xs text-slate-500 tabular-nums">
              {stats.managedDatabasesCount} managed {stats.managedDatabasesCount === 1 ? 'cluster' : 'clusters'} · {stats.storageObjectsCount} private {stats.storageObjectsCount === 1 ? 'object' : 'objects'}
            </div>
          </button>
        </div>
      </div>

      {/* Announcements & Recent Audit Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-semibold text-slate-900">
              Platform Announcements
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('support')}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              View Alerts
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.announcements.map((ann) => (
              <div key={ann.id} className="py-3 first:pt-0 last:pb-0">
                <div className="text-sm font-medium text-slate-900">{ann.title}</div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{ann.body}</p>
                <div className="text-xs text-slate-400 mt-1.5 tabular-nums">
                  {new Date(ann.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-display font-semibold text-slate-900">
                Tenant Audit Trail
              </h2>
            </div>
            <span className="text-xs text-slate-500">Scoped to {organization.name}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 font-medium w-[28%]">Action</th>
                  <th className="pb-2 font-medium w-[28%]">Actor</th>
                  <th className="pb-2 font-medium w-[30%]">Details</th>
                  <th className="pb-2 font-medium text-right w-[14%]">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentAuditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-2 font-mono text-slate-800 truncate">
                      {log.action}
                    </td>
                    <td className="py-2.5 pr-2 text-slate-600 truncate">
                      {log.actor_email}
                    </td>
                    <td className="py-2.5 pr-2 text-slate-700 truncate">
                      {log.details}
                    </td>
                    <td className="py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(log.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
