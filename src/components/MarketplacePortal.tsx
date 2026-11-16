import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Key,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Webhook,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatCurrencyCents } from '../lib/platformLogic';
import type {
  ApiKeyRecord,
  ApiLogRecord,
  ApiProduct,
  ApiSubscription,
  WebhookRecord,
} from '../types';

interface CatalogPayload {
  products: ApiProduct[];
  subscriptions: ApiSubscription[];
  keys: ApiKeyRecord[];
  logs: ApiLogRecord[];
  webhooks: WebhookRecord[];
}

export const MarketplacePortal: React.FC = () => {
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [tab, setTab] = useState<'catalog' | 'keys' | 'logs' | 'webhooks'>('catalog');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedApi, setSelectedApi] = useState<ApiProduct | null>(null);
  const [snippetLang, setSnippetLang] = useState<'curl' | 'javascript' | 'python' | 'php'>('curl');
  const [playgroundMethod, setPlaygroundMethod] = useState<'POST' | 'GET'>('POST');
  const [playgroundPath, setPlaygroundPath] = useState('/extract');
  const [playgroundPayload, setPlaygroundPayload] = useState('{}');
  const [playgroundKey, setPlaygroundKey] = useState('');
  const [playgroundResult, setPlaygroundResult] = useState<string | null>(null);
  const [playgroundMeta, setPlaygroundMeta] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyApiId, setNewKeyApiId] = useState('');
  const [revealedRawKey, setRevealedRawKey] = useState<string | null>(null);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookApiId, setNewWebhookApiId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCatalog = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (category !== 'all') params.set('category', category);
      const res = await apiFetch<CatalogPayload>(`/api/marketplace/catalog?${params.toString()}`);
      setData(res);
      if (res.products.length > 0 && !selectedApi) {
        const first = res.products[0];
        setSelectedApi(first);
        setPlaygroundPayload(first.sampleRequest);
        setPlaygroundPath(first.endpoints[0]?.path || '/execute');
        setPlaygroundMethod((first.endpoints[0]?.method as 'POST' | 'GET') || 'POST');
        setNewKeyApiId(first.id);
        setNewWebhookApiId(first.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace.');
    } finally {
      setLoading(false);
    }
  }, [search, category, selectedApi]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleSelectApi = (api: ApiProduct) => {
    setSelectedApi(api);
    setPlaygroundPayload(api.sampleRequest);
    setPlaygroundPath(api.endpoints[0]?.path || '/execute');
    setPlaygroundMethod((api.endpoints[0]?.method as 'POST' | 'GET') || 'POST');
    setPlaygroundResult(null);
    setPlaygroundMeta(null);
  };

  const handleSubscribe = async (apiId: string, planName: string) => {
    setError(null);
    setFeedback(null);
    try {
      await apiFetch('/api/marketplace/subscribe', {
        method: 'POST',
        body: JSON.stringify({ apiId, planName }),
      });
      setFeedback(`Activated ${planName} subscription.`);
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription failed.');
    }
  };

  const handleCancelSubscription = async (subId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/marketplace/subscriptions/${subId}/cancel`, { method: 'POST' });
      setFeedback('Subscription cancelled.');
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRevealedRawKey(null);
    try {
      const res = await apiFetch<{ rawKey: string }>('/api/marketplace/keys', {
        method: 'POST',
        body: JSON.stringify({ apiId: newKeyApiId, name: newKeyName }),
      });
      setRevealedRawKey(res.rawKey);
      setNewKeyName('');
      setFeedback('API key generated. Copy it now—only its SHA-256 hash is persisted.');
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key.');
    }
  };

  const handleRotateKey = async (id: string) => {
    setError(null);
    try {
      const res = await apiFetch<{ rawKey: string }>(`/api/marketplace/keys/${id}/rotate`, {
        method: 'POST',
      });
      setRevealedRawKey(res.rawKey);
      setFeedback('Key rotated. Previous secret invalidated immediately.');
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotate failed.');
    }
  };

  const handleRevokeKey = async (id: string) => {
    setError(null);
    try {
      await apiFetch(`/api/marketplace/keys/${id}/revoke`, { method: 'POST' });
      setFeedback('API key revoked.');
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed.');
    }
  };

  const handleRunPlayground = async () => {
    if (!selectedApi) return;
    setError(null);
    setPlaygroundResult(null);
    try {
      const res = await apiFetch<{
        statusCode: number;
        latencyMs: number;
        tokensUsed: number;
        body: unknown;
      }>('/api/marketplace/playground/execute', {
        method: 'POST',
        body: JSON.stringify({
          apiId: selectedApi.id,
          method: playgroundMethod,
          path: playgroundPath,
          payload: playgroundPayload,
          rawApiKey: playgroundKey || undefined,
        }),
      });
      setPlaygroundMeta(
        `HTTP ${res.statusCode} · ${res.latencyMs}ms · ${res.tokensUsed} tokens`,
      );
      setPlaygroundResult(JSON.stringify(res.body, null, 2));
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playground call failed.');
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ secret: string }>('/api/marketplace/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          apiId: newWebhookApiId,
          url: newWebhookUrl,
          events: ['request.completed', 'quota.threshold'],
        }),
      });
      setNewWebhookUrl('');
      setFeedback(`Webhook endpoint registered. Signing secret: ${res.secret}`);
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook creation failed.');
    }
  };

  const buildCodeSnippet = (api: ApiProduct): string => {
    const endpoint = `https://gateway.kodex.cloud${api.basePath}${playgroundPath}`;
    if (snippetLang === 'curl') {
      return `curl -X ${playgroundMethod} "${endpoint}" \\\n  -H "Authorization: Bearer YOUR_KODEX_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${playgroundPayload.replace(/\n/g, ' ')}'`;
    }
    if (snippetLang === 'javascript') {
      return `const res = await fetch("${endpoint}", {\n  method: "${playgroundMethod}",\n  headers: {\n    "Authorization": "Bearer " + process.env.KODEX_API_KEY,\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify(${playgroundPayload})\n});\nconst data = await res.json();`;
    }
    if (snippetLang === 'python') {
      return `import os, requests\n\nres = requests.request(\n    "${playgroundMethod}",\n    "${endpoint}",\n    headers={"Authorization": f"Bearer {os.environ['KODEX_API_KEY']}"},\n    json=${playgroundPayload}\n)\nprint(res.json())`;
    }
    return `<?php\n$ch = curl_init("${endpoint}");\ncurl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${playgroundMethod}");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "Authorization: Bearer " . getenv("KODEX_API_KEY"),\n  "Content-Type: application/json"\n]);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, '${playgroundPayload.replace(/\n/g, ' ')}');\n$response = curl_exec($ch);`;
  };

  if (loading || !data) {
    return <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  const categories = ['all', 'AI & Vision', 'Fintech', 'Search & Data', 'Security & Compliance', 'Communications'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">API Marketplace</h1>
          <p className="text-sm text-slate-600 mt-1">
            Discover commercial APIs, generate SHA-256 hashed keys, test endpoints live, and inspect gateway telemetry.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
          {(
            [
              ['catalog', 'API Catalog & Playground'],
              ['keys', `API Keys (${data.keys.length})`],
              ['logs', `Request Logs (${data.logs.length})`],
              ['webhooks', `Webhooks (${data.webhooks.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                tab === id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {feedback && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {revealedRawKey && (
        <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-blue-900">
              New Secret API Key (displayed once)
            </div>
            <code className="text-xs font-mono text-blue-800 break-all">{revealedRawKey}</code>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(revealedRawKey);
              setFeedback('API key copied to clipboard.');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white text-xs font-medium rounded-md whitespace-nowrap shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Key</span>
          </button>
        </div>
      )}

      {tab === 'catalog' && (
        <div className="space-y-6">
          {/* Search & Category Filter */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search APIs by name, capability, or category..."
                aria-label="Search APIs"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    category === cat
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat === 'all' ? 'All Categories' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* API List */}
            <div className="lg:col-span-5 space-y-3">
              {data.products.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-600">
                  No APIs match your current search or category filter.
                </div>
              ) : (
                data.products.map((api) => {
                  const sub = data.subscriptions.find(
                    (s) => s.apiId === api.id && s.status === 'active',
                  );
                  const isSelected = selectedApi?.id === api.id;
                  return (
                    <button
                      key={api.id}
                      type="button"
                      onClick={() => handleSelectApi(api)}
                      className={`w-full text-left bg-white border rounded-lg p-4 transition-colors ${
                        isSelected
                          ? 'border-blue-600 ring-1 ring-blue-600'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-display font-semibold text-sm text-slate-900">
                          {api.name}
                        </div>
                        <span className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                          {api.version}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {api.category} · {api.provider} · {api.avgLatencyMs}ms avg
                      </div>
                      <p className="mt-2 text-xs text-slate-600 line-clamp-2">{api.description}</p>
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-slate-700 font-medium tabular-nums">
                          {api.starterPriceCents === 0
                            ? 'Free tier available'
                            : `From ${formatCurrencyCents(api.starterPriceCents)}/mo`}
                        </span>
                        <span className={sub ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                          {sub ? `Subscribed · ${sub.planName}` : 'Not subscribed'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Selected API Detail & Interactive Playground */}
            {selectedApi && (
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4 border-b border-slate-200">
                  <div>
                    <div className="text-xs text-slate-500">
                      {selectedApi.category} · {selectedApi.provider} · {selectedApi.uptimePercent}% uptime
                    </div>
                    <h2 className="text-xl font-display font-bold text-slate-900 mt-1">
                      {selectedApi.name}
                    </h2>
                    <p className="text-sm text-slate-600 mt-1">{selectedApi.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSubscribe(selectedApi.id, 'Starter')}
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                    >
                      Starter Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSubscribe(selectedApi.id, 'Pro')}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-md whitespace-nowrap"
                    >
                      Subscribe Pro ({formatCurrencyCents(selectedApi.proPriceCents)}/mo)
                    </button>
                  </div>
                </div>

                {/* Endpoints */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">Available Endpoints</h3>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {selectedApi.endpoints.map((ep) => (
                      <button
                        key={ep.path}
                        type="button"
                        onClick={() => {
                          setPlaygroundMethod(ep.method as 'POST' | 'GET');
                          setPlaygroundPath(ep.path);
                        }}
                        className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-semibold text-blue-700 w-10">
                            {ep.method}
                          </span>
                          <span className="font-mono text-slate-900">
                            {selectedApi.basePath}
                            {ep.path}
                          </span>
                        </div>
                        <span className="text-slate-500">{ep.summary}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live API Playground */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-700">
                      Live Gateway Playground
                    </h3>
                    {playgroundMeta && (
                      <span className="text-xs font-mono text-emerald-700 tabular-nums">
                        {playgroundMeta}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      aria-label="HTTP Method"
                      value={playgroundMethod}
                      onChange={(e) => setPlaygroundMethod(e.target.value as 'POST' | 'GET')}
                      className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white"
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                    <input
                      type="text"
                      aria-label="Endpoint path"
                      value={playgroundPath}
                      onChange={(e) => setPlaygroundPath(e.target.value)}
                      className="sm:col-span-2 px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label htmlFor="pg-key" className="block text-xs text-slate-600 mb-1">
                      Optional Raw API Key (leave blank to use org sandbox credential)
                    </label>
                    <input
                      id="pg-key"
                      type="text"
                      value={playgroundKey}
                      onChange={(e) => setPlaygroundKey(e.target.value)}
                      placeholder="kx_live_..."
                      className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label htmlFor="pg-payload" className="block text-xs text-slate-600 mb-1">
                      JSON Request Body
                    </label>
                    <textarea
                      id="pg-payload"
                      rows={4}
                      value={playgroundPayload}
                      onChange={(e) => setPlaygroundPayload(e.target.value)}
                      className="w-full p-3 text-xs font-mono bg-slate-950 text-slate-100 rounded-md border border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleRunPlayground}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Send Request</span>
                  </button>

                  {playgroundResult && (
                    <pre className="p-3 rounded-md bg-slate-950 text-emerald-300 text-xs font-mono overflow-x-auto max-h-56">
                      {playgroundResult}
                    </pre>
                  )}
                </div>

                {/* Code Examples */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-slate-700">SDK &amp; CLI Examples</h3>
                    <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded">
                      {(['curl', 'javascript', 'python', 'php'] as const).map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => setSnippetLang(lang)}
                          className={`px-2 py-1 text-xs rounded capitalize ${
                            snippetLang === lang
                              ? 'bg-white text-slate-900 shadow-xs font-medium'
                              : 'text-slate-600'
                          }`}
                        >
                          {lang === 'curl' ? 'cURL' : lang}
                        </button>
                      ))}
                    </div>
                  </div>
                  <pre className="p-3 rounded-md bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto">
                    {buildCodeSnippet(selectedApi)}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Active Subscriptions Table */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-display font-semibold text-slate-900 mb-3">
              Active Organization Subscriptions
            </h2>
            {data.subscriptions.length === 0 ? (
              <p className="text-xs text-slate-500">No API subscriptions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="pb-2 font-medium">API</th>
                      <th className="pb-2 font-medium">Plan</th>
                      <th className="pb-2 font-medium text-right">Requests Used</th>
                      <th className="pb-2 font-medium text-right">Monthly Quota</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.subscriptions.map((sub) => (
                      <tr key={sub.id}>
                        <td className="py-2.5 font-medium text-slate-900">{sub.apiName}</td>
                        <td className="py-2.5 text-slate-700">{sub.planName}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums">
                          {sub.requestsUsed.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums">
                          {sub.monthlyQuota.toLocaleString()}
                        </td>
                        <td className="py-2.5 capitalize">
                          <span className={sub.status === 'active' ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                            {sub.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          {sub.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleCancelSubscription(sub.id)}
                              className="text-red-600 hover:underline font-medium"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'keys' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateKey}
            className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-4">
              <label htmlFor="key-api" className="block text-xs font-medium text-slate-700 mb-1">
                Target API Product
              </label>
              <select
                id="key-api"
                value={newKeyApiId}
                onChange={(e) => setNewKeyApiId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-5">
              <label htmlFor="key-label" className="block text-xs font-medium text-slate-700 mb-1">
                Key Label
              </label>
              <input
                id="key-label"
                type="text"
                required
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Production Invoice Worker"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md"
              >
                <Key className="w-4 h-4" />
                <span>Generate API Key</span>
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 font-medium">Label</th>
                  <th className="pb-2 font-medium">API</th>
                  <th className="pb-2 font-medium">Prefix</th>
                  <th className="pb-2 font-medium">Scopes</th>
                  <th className="pb-2 font-medium text-right">Requests</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.keys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50">
                    <td className="py-3 font-medium text-slate-900">{k.name}</td>
                    <td className="py-3 text-slate-700">{k.apiName}</td>
                    <td className="py-3 font-mono text-slate-600">{k.keyPrefix}</td>
                    <td className="py-3 text-slate-600">{k.scopes.join(', ')}</td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {k.requestsCount.toLocaleString()}
                    </td>
                    <td className="py-3">
                      <span className={k.status === 'active' ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                        {k.status}
                      </span>
                    </td>
                    <td className="py-3 text-right space-x-3 whitespace-nowrap">
                      {k.status === 'active' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRotateKey(k.id)}
                            className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Rotate</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeKey(k.id)}
                            className="text-red-600 hover:underline font-medium"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
          <h2 className="text-sm font-display font-semibold text-slate-900 mb-4">
            Gateway Request &amp; Error Logs
          </h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 font-medium">API</th>
                <th className="pb-2 font-medium">Method / Path</th>
                <th className="pb-2 font-medium">Key Prefix</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Latency</th>
                <th className="pb-2 font-medium">Error</th>
                <th className="pb-2 font-medium text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2.5 font-medium text-slate-900">{log.apiName}</td>
                  <td className="py-2.5 font-mono text-slate-700">
                    {log.method} {log.path}
                  </td>
                  <td className="py-2.5 font-mono text-slate-500">{log.keyPrefix}</td>
                  <td className="py-2.5 font-mono tabular-nums">
                    <span className={log.statusCode >= 400 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                      {log.statusCode}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums">{log.latencyMs}ms</td>
                  <td className="py-2.5 text-red-600">{log.errorMessage || '—'}</td>
                  <td className="py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'webhooks' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateWebhook}
            className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-4">
              <label htmlFor="wh-api" className="block text-xs font-medium text-slate-700 mb-1">
                API Product
              </label>
              <select
                id="wh-api"
                value={newWebhookApiId}
                onChange={(e) => setNewWebhookApiId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-5">
              <label htmlFor="wh-url" className="block text-xs font-medium text-slate-700 mb-1">
                HTTPS Callback Endpoint
              </label>
              <input
                id="wh-url"
                type="url"
                required
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                placeholder="https://api.yourcompany.com/webhooks/kodex"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md"
              >
                <Webhook className="w-4 h-4" />
                <span>Add Webhook</span>
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            {data.webhooks.length === 0 ? (
              <p className="text-xs text-slate-500">No webhooks configured.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.webhooks.map((wh) => (
                  <div key={wh.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <div className="font-mono font-medium text-slate-900">{wh.url}</div>
                      <div className="text-slate-500 mt-0.5">
                        Secret {wh.secretPrefix} · Events: {wh.events.join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/marketplace/webhooks/${wh.id}`, { method: 'DELETE' });
                        await loadCatalog();
                      }}
                      aria-label={`Delete webhook ${wh.url}`}
                      className="p-1.5 text-slate-500 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
