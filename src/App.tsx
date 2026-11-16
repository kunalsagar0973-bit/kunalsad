import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Code2,
  CreditCard,
  Database,
  Globe,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AccountSecurityPortal } from './components/AccountSecurityPortal';
import { AuthScreen } from './components/AuthScreen';
import { BillingPortal } from './components/BillingPortal';
import { BuilderPortal } from './components/BuilderPortal';
import { DataCloudPortal } from './components/DataCloudPortal';
import { HostingPortal } from './components/HostingPortal';
import { MarketplacePortal } from './components/MarketplacePortal';
import { OverviewPortal } from './components/OverviewPortal';
import { SuperAdminPortal } from './components/SuperAdminPortal';
import { SupportAndOpsPortal } from './components/SupportAndOpsPortal';
import { apiFetch } from './lib/api';
import type { NotificationItem, Organization, PortalSection, UserProfile } from './types';

interface AuthMeResponse {
  user: UserProfile;
  organization: Organization;
  currentSessionId: string;
  sessions: Array<{
    id: string;
    device_label: string;
    ip_address: string;
    last_active_at: string;
    created_at: string;
  }>;
}

const SECTION_LABELS: Record<PortalSection, string> = {
  overview: 'Workspace Overview',
  marketplace: 'API Marketplace',
  builder: 'AI App & Code Builder',
  hosting: 'Cloud Hosting & Deployment',
  datacloud: 'Enterprise Data Cloud',
  billing: 'Billing & Subscriptions',
  support: 'Notifications & Support',
  docs: 'Documentation & Monitoring',
  account: 'Account & Security',
  admin: 'Super Admin Console',
};

export default function App() {
  const [authData, setAuthData] = useState<AuthMeResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [section, setSection] = useState<PortalSection>('overview');
  const [opsInitialTab, setOpsInitialTab] = useState<'notifications' | 'tickets' | 'docs' | 'monitoring'>('notifications');
  const [unreadCount, setUnreadCount] = useState(0);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadNotificationsAndStatus = useCallback(async () => {
    try {
      const [ntfRes, ovRes] = await Promise.all([
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
        apiFetch<{ maintenanceMode?: boolean }>('/api/platform/overview'),
      ]);
      setUnreadCount(ntfRes.notifications.filter((n) => !n.read).length);
      setMaintenanceMode(Boolean(ovRes.maintenanceMode));
    } catch {
      // ignore before auth
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const me = await apiFetch<AuthMeResponse>('/api/auth/me');
      setAuthData(me);
      await loadNotificationsAndStatus();
    } catch {
      setAuthData(null);
    } finally {
      setAuthChecked(true);
    }
  }, [loadNotificationsAndStatus]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setAuthData(null);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Initializing Kodex Cloud workspace...
      </div>
    );
  }

  if (!authData) {
    return <AuthScreen onAuthenticated={loadSession} />;
  }

  const { user, organization } = authData;

  const portalNav: Array<{ id: PortalSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'marketplace', label: 'API Marketplace', icon: Layers },
    { id: 'builder', label: 'AI App Builder', icon: Code2 },
    { id: 'hosting', label: 'Cloud Hosting', icon: Globe },
    { id: 'datacloud', label: 'Enterprise Data Cloud', icon: Database },
  ];

  const opsNav: Array<{ id: PortalSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'billing', label: 'Billing & Plans', icon: CreditCard },
    { id: 'support', label: 'Notifications & Support', icon: LifeBuoy },
    { id: 'docs', label: 'Docs & Monitoring', icon: Activity },
    { id: 'account', label: 'Account & Security', icon: Settings },
  ];

  if (user.role === 'super_admin') {
    opsNav.push({ id: 'admin', label: 'Super Admin', icon: ShieldCheck });
  }

  const navigateTo = (target: PortalSection, subTab?: 'notifications' | 'tickets' | 'docs' | 'monitoring') => {
    setSection(target);
    if (subTab) {
      setOpsInitialTab(subTab);
    } else if (target === 'docs') {
      setOpsInitialTab('docs');
    } else if (target === 'support') {
      setOpsInitialTab('notifications');
    }
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`w-64 bg-white border-r border-slate-200 flex-col justify-between shrink-0 ${
          mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 flex shadow-xl' : 'hidden lg:flex'
        }`}
      >
        <div className="p-4 space-y-6 overflow-y-auto">
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="text-lg font-display font-bold tracking-tight text-slate-900 whitespace-nowrap">
                Kodex Cloud
              </div>
              <div className="text-xs text-slate-500 truncate max-w-[180px]">
                {organization.name}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation"
              className="lg:hidden p-1 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav aria-label="Core Cloud Portals" className="space-y-1">
            <div className="px-2 pb-1 text-xs font-medium text-slate-400">Cloud Portals</div>
            {portalNav.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <nav aria-label="Operations and Governance" className="space-y-1">
            <div className="px-2 pb-1 text-xs font-medium text-slate-400">Operations</div>
            {opsNav.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Account Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <button
            type="button"
            onClick={() => navigateTo('account')}
            className="w-full flex items-center gap-2.5 text-left hover:bg-slate-50 p-1.5 rounded-md transition-colors"
          >
            <img
              src={user.avatarUrl || '/src/assets/images/avatar_admin_profile_1794794771026.jpg'}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">{user.name}</div>
              <div className="text-xs text-slate-500 truncate capitalize">
                {user.role.replace('_', ' ')}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-100"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb + Utility Action */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 text-slate-600 border border-slate-200 rounded-md"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 truncate">
              <span>{organization.name}</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-900">{SECTION_LABELS[section]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigateTo('support', 'notifications')}
              aria-label="Open notifications"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="tabular-nums">Alerts ({unreadCount})</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('builder')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-md whitespace-nowrap"
            >
              <span>Launch Builder</span>
            </button>
          </div>
        </header>

        {maintenanceMode && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-900 font-medium">
            Platform Maintenance Mode is enabled by Super Admin. Non-critical deployments may be queued.
          </div>
        )}

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          {section === 'overview' && (
            <OverviewPortal
              user={user}
              organization={organization}
              onNavigate={(target) => navigateTo(target)}
            />
          )}
          {section === 'marketplace' && <MarketplacePortal />}
          {section === 'builder' && (
            <BuilderPortal onDeployed={() => void loadNotificationsAndStatus()} />
          )}
          {section === 'hosting' && <HostingPortal />}
          {section === 'datacloud' && <DataCloudPortal orgName={organization.name} />}
          {section === 'billing' && <BillingPortal onPlanChanged={loadSession} />}
          {(section === 'support' || section === 'docs') && (
            <SupportAndOpsPortal
              initialTab={opsInitialTab}
              onNotificationsRead={() => void loadNotificationsAndStatus()}
            />
          )}
          {section === 'account' && (
            <AccountSecurityPortal
              user={user}
              organization={organization}
              sessions={authData.sessions}
              currentSessionId={authData.currentSessionId}
              onRefreshSession={loadSession}
            />
          )}
          {section === 'admin' && (
            <SuperAdminPortal onSystemChanged={loadNotificationsAndStatus} />
          )}
        </main>
      </div>
    </div>
  );
}
