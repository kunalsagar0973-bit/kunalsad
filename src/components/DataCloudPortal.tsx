import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBytes } from '../lib/platformLogic';
import type { DatabaseBackup, ManagedDatabase, StorageObject } from '../types';

interface DataCloudOverview {
  databases: ManagedDatabase[];
  backups: DatabaseBackup[];
  objects: StorageObject[];
}

export const DataCloudPortal: React.FC<{ orgName: string }> = ({ orgName }) => {
  const [data, setData] = useState<DataCloudOverview | null>(null);
  const [tab, setTab] = useState<'databases' | 'storage' | 'backups'>('databases');
  const [dbName, setDbName] = useState('');
  const [dbEngine, setDbEngine] = useState<'postgresql' | 'mysql' | 'mongodb' | 'redis'>('postgresql');
  const [dbRegion, setDbRegion] = useState('us-east-1');
  const [newConnString, setNewConnString] = useState<string | null>(null);
  const [selectedDb, setSelectedDb] = useState<ManagedDatabase | null>(null);
  const [sqlQuery, setSqlQuery] = useState('SELECT table_name, row_count, size_mb FROM information_schema.tables;');
  const [queryOutput, setQueryOutput] = useState<string | null>(null);
  const [uploadFolder, setUploadFolder] = useState('/exports');
  const [uploadVisibility, setUploadVisibility] = useState<'private' | 'org_shared'>('private');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDataCloud = useCallback(async () => {
    try {
      const res = await apiFetch<DataCloudOverview>('/api/datacloud/overview');
      setData(res);
      if (res.databases.length > 0 && !selectedDb) {
        setSelectedDb(res.databases[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Enterprise Data Cloud.');
    } finally {
      setLoading(false);
    }
  }, [selectedDb]);

  useEffect(() => {
    void loadDataCloud();
  }, [loadDataCloud]);

  const handleProvisionDb = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNewConnString(null);
    try {
      const res = await apiFetch<{ id: string; connectionString: string }>(
        '/api/datacloud/databases',
        {
          method: 'POST',
          body: JSON.stringify({ name: dbName, engine: dbEngine, region: dbRegion }),
        },
      );
      setNewConnString(res.connectionString);
      setDbName('');
      setFeedback(`Provisioned isolated ${dbEngine} cluster.`);
      await loadDataCloud();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database creation failed.');
    }
  };

  const handleRunBackup = async (databaseId: string) => {
    setError(null);
    try {
      const res = await apiFetch<{ id: string; sizeMb: number }>(
        `/api/datacloud/databases/${databaseId}/backup`,
        { method: 'POST' },
      );
      setFeedback(`Encrypted backup ${res.id} (${res.sizeMb} MB) completed.`);
      await loadDataCloud();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed.');
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/datacloud/backups/${backupId}/restore`, { method: 'POST' });
      setFeedback(`Point-in-time restore triggered from snapshot ${backupId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    }
  };

  const handleRunQuery = async () => {
    if (!selectedDb) return;
    setError(null);
    try {
      const res = await apiFetch<{ executionMs: number; rows: unknown[] }>(
        `/api/datacloud/databases/${selectedDb.id}/query`,
        {
          method: 'POST',
          body: JSON.stringify({ query: sqlQuery }),
        },
      );
      setQueryOutput(
        `-- Executed on ${selectedDb.name} (${res.executionMs}ms)\n${JSON.stringify(res.rows, null, 2)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const resultStr = String(reader.result || '');
        const base64 = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
        const res = await apiFetch<{ version: number; checksum: string }>(
          '/api/datacloud/storage/upload',
          {
            method: 'POST',
            body: JSON.stringify({
              folder: uploadFolder,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              contentBase64: base64,
              visibility: uploadVisibility,
            }),
          },
        );
        setFeedback(`Uploaded ${file.name} v${res.version} (checksum ${res.checksum}).`);
        await loadDataCloud();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (loading || !data) {
    return <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Enterprise Data Cloud
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Private tenant isolation for {orgName} · Encrypted databases, point-in-time backups, and versioned object storage.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
          {(
            [
              ['databases', `Managed Databases (${data.databases.length})`],
              ['storage', `Object Storage (${data.objects.length})`],
              ['backups', `Backups & Retention (${data.backups.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                tab === id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 rounded-md border border-slate-200 bg-white flex items-center gap-2 text-xs text-slate-700">
        <Lock className="w-4 h-4 text-blue-700 shrink-0" />
        <span>
          Strict Tenant Isolation Active: Resources are scoped exclusively to <strong>{orgName}</strong>. AES-256 encryption at rest and TLS 1.3 in transit enforced.
        </span>
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
      {newConnString && (
        <div className="p-4 rounded-lg border border-blue-200 bg-blue-50">
          <div className="text-xs font-semibold text-blue-900 mb-1">
            Provisioned Connection URI (copy &amp; store in secrets)
          </div>
          <code className="text-xs font-mono text-blue-800 break-all">{newConnString}</code>
        </div>
      )}

      {tab === 'databases' && (
        <div className="space-y-6">
          <form
            onSubmit={handleProvisionDb}
            className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-4">
              <label htmlFor="db-name" className="block text-xs font-medium text-slate-700 mb-1">
                Cluster Name
              </label>
              <input
                id="db-name"
                type="text"
                required
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                placeholder="e.g. analytics-warehouse"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="md:col-span-3">
              <label htmlFor="db-engine" className="block text-xs font-medium text-slate-700 mb-1">
                Database Engine
              </label>
              <select
                id="db-engine"
                value={dbEngine}
                onChange={(e) =>
                  setDbEngine(e.target.value as 'postgresql' | 'mysql' | 'mongodb' | 'redis')
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="postgresql">PostgreSQL 16.4</option>
                <option value="mysql">MySQL 8.4</option>
                <option value="mongodb">MongoDB 7.0</option>
                <option value="redis">Redis 7.2</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label htmlFor="db-region" className="block text-xs font-medium text-slate-700 mb-1">
                Residency Region
              </label>
              <select
                id="db-region"
                value={dbRegion}
                onChange={(e) => setDbRegion(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="us-east-1">us-east-1 (US East)</option>
                <option value="eu-central-1">eu-central-1 (EU GDPR)</option>
                <option value="ap-south-1">ap-south-1 (Mumbai)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Create DB</span>
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
              <h2 className="text-sm font-display font-semibold text-slate-900 mb-4">
                Tenant Database Clusters
              </h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-2 font-medium">Cluster</th>
                    <th className="pb-2 font-medium">Engine</th>
                    <th className="pb-2 font-medium text-right">Storage</th>
                    <th className="pb-2 font-medium text-right">Connections</th>
                    <th className="pb-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.databases.map((dbItem) => (
                    <tr
                      key={dbItem.id}
                      className={`hover:bg-slate-50 ${selectedDb?.id === dbItem.id ? 'bg-blue-50/40' : ''}`}
                    >
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          onClick={() => setSelectedDb(dbItem)}
                          className="font-medium text-slate-900 hover:text-blue-700 text-left"
                        >
                          {dbItem.name}
                        </button>
                        <div className="text-slate-500 font-mono mt-0.5">{dbItem.host}</div>
                      </td>
                      <td className="py-3 pr-3 text-slate-700 capitalize">
                        {dbItem.engine} {dbItem.version}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono tabular-nums">
                        {dbItem.storageUsedGb} / {dbItem.storageLimitGb} GB
                      </td>
                      <td className="py-3 pr-3 text-right font-mono tabular-nums">
                        {dbItem.activeConnections} / {dbItem.connectionLimit}
                      </td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleRunBackup(dbItem.id)}
                          className="text-blue-700 hover:underline font-medium"
                        >
                          Backup
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/datacloud/databases/${dbItem.id}`, {
                              method: 'DELETE',
                            });
                            await loadDataCloud();
                          }}
                          aria-label={`Delete database ${dbItem.name}`}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-700" />
                  <h2 className="text-sm font-display font-semibold text-slate-900">
                    Cluster Telemetry &amp; Query Inspector
                  </h2>
                </div>
                {selectedDb && (
                  <span className="text-xs font-mono text-slate-500">{selectedDb.region}</span>
                )}
              </div>

              {selectedDb && (
                <>
                  <div className="grid grid-cols-3 gap-3 text-xs border-y border-slate-100 py-3">
                    <div>
                      <div className="text-slate-500">CPU Load</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {selectedDb.cpuPercent}%
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">IOPS</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {selectedDb.iops}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Port / User</div>
                      <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                        {selectedDb.port} · {selectedDb.username}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="db-sql" className="block text-xs font-medium text-slate-700 mb-1">
                      Read-Only Schema &amp; Query Monitor
                    </label>
                    <textarea
                      id="db-sql"
                      rows={3}
                      value={sqlQuery}
                      onChange={(e) => setSqlQuery(e.target.value)}
                      className="w-full p-2.5 text-xs font-mono bg-slate-950 text-slate-100 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleRunQuery}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Execute Inspection</span>
                    </button>
                  </div>

                  {queryOutput && (
                    <pre className="p-3 rounded-md bg-slate-950 text-emerald-300 text-xs font-mono overflow-x-auto max-h-48">
                      {queryOutput}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'storage' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
              <div>
                <label htmlFor="obj-folder" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Folder Path
                </label>
                <input
                  id="obj-folder"
                  type="text"
                  value={uploadFolder}
                  onChange={(e) => setUploadFolder(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="obj-vis" className="block text-xs font-medium text-slate-700 mb-1">
                  Access Policy
                </label>
                <select
                  id="obj-vis"
                  value={uploadVisibility}
                  onChange={(e) => setUploadVisibility(e.target.value as 'private' | 'org_shared')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="private">Private (Tenant Admins &amp; Owner)</option>
                  <option value="org_shared">Organization Shared (All Org Members)</option>
                </select>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-md cursor-pointer whitespace-nowrap">
              <Upload className="w-4 h-4" />
              <span>Upload Encrypted Object</span>
              <input type="file" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
            <div className="flex items-center gap-2 mb-4">
              <HardDrive className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-display font-semibold text-slate-900">
                Private Object Storage ({data.objects.length} objects)
              </h2>
            </div>

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 font-medium">File Name</th>
                  <th className="pb-2 font-medium">Folder</th>
                  <th className="pb-2 font-medium">Version</th>
                  <th className="pb-2 font-medium text-right">Size</th>
                  <th className="pb-2 font-medium">Policy</th>
                  <th className="pb-2 font-medium">SHA-256</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.objects.map((obj) => (
                  <tr key={obj.id} className="hover:bg-slate-50">
                    <td className="py-3 font-medium text-slate-900">{obj.fileName}</td>
                    <td className="py-3 font-mono text-slate-600">{obj.folder}</td>
                    <td className="py-3 font-mono tabular-nums">v{obj.version}</td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatBytes(obj.sizeBytes)}
                    </td>
                    <td className="py-3 text-slate-700">{obj.visibility}</td>
                    <td className="py-3 font-mono text-slate-500">{obj.checksum}</td>
                    <td className="py-3 text-right space-x-3 whitespace-nowrap">
                      <a
                        href={`/api/datacloud/storage/${obj.id}/download`}
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/datacloud/storage/${obj.id}`, { method: 'DELETE' });
                          await loadDataCloud();
                        }}
                        aria-label={`Delete ${obj.fileName}`}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'backups' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
          <h2 className="text-sm font-display font-semibold text-slate-900 mb-4">
            Encrypted Database Backups &amp; Retention Policies
          </h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 font-medium">Database</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium text-right">Size</th>
                <th className="pb-2 font-medium text-right">Retention</th>
                <th className="pb-2 font-medium">Encryption</th>
                <th className="pb-2 font-medium text-right">Restore</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.backups.map((bak) => (
                <tr key={bak.id} className="hover:bg-slate-50">
                  <td className="py-3 font-medium text-slate-900">{bak.databaseName}</td>
                  <td className="py-3 capitalize text-slate-700">{bak.type}</td>
                  <td className="py-3 text-right font-mono tabular-nums">{bak.sizeMb} MB</td>
                  <td className="py-3 text-right tabular-nums">{bak.retentionDays} days</td>
                  <td className="py-3 text-emerald-700 font-medium">
                    {bak.encrypted ? 'AES-256 Encrypted' : 'Standard'}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRestoreBackup(bak.id)}
                      className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore Snapshot</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
