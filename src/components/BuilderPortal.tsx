import React, { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import {
  Copy,
  Download,
  FileCode2,
  FolderGit2,
  History,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Send,
  Sparkles,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { buildPreviewHtml } from '../lib/platformLogic';
import type { AiProject, AiProjectVersion, BuilderFile } from '../types';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface BuilderPortalProps {
  onDeployed?: () => void;
}

const TEMPLATE_PRESETS = [
  'SaaS Billing & Subscription Dashboard',
  'E-Commerce Storefront with Cart',
  'Enterprise Admin Panel & User CRM',
  'REST API Docs & Developer Landing Page',
];

export const BuilderPortal: React.FC<BuilderPortalProps> = ({ onDeployed }) => {
  const [projects, setProjects] = useState<AiProject[]>([]);
  const [activeProject, setActiveProject] = useState<AiProject | null>(null);
  const [versions, setVersions] = useState<AiProjectVersion[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string>('index.html');
  const [rightTab, setRightTab] = useState<'preview' | 'code' | 'versions' | 'settings'>('preview');
  const [mobilePane, setMobilePane] = useState<'chat' | 'workspace'>('chat');
  const [model, setModel] = useState('gemini-4-hydrogen');
  const [promptInput, setPromptInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([
    {
      role: 'assistant',
      text: 'Describe an application, dashboard, SaaS product, or change. I will generate the frontend UI, backend API schema, and update the live preview.',
    },
  ]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[sandbox] Isolated container initialized · Node 22 + Vite runtime ready.',
  ]);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadVersions = useCallback(async (projectId: string) => {
    const res = await apiFetch<{ versions: AiProjectVersion[] }>(
      `/api/builder/projects/${projectId}/versions`,
    );
    setVersions(res.versions);
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await apiFetch<{ projects: AiProject[] }>('/api/builder/projects');
    setProjects(res.projects);
    if (res.projects.length > 0 && !activeProject) {
      const first = res.projects[0];
      setActiveProject(first);
      setActiveFilePath(first.files[0]?.path || 'index.html');
      setDomainInput(first.customDomain || '');
      await loadVersions(first.id);
    }
  }, [activeProject, loadVersions]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const selectProject = async (proj: AiProject) => {
    setActiveProject(proj);
    setActiveFilePath(proj.files[0]?.path || 'index.html');
    setDomainInput(proj.customDomain || '');
    setAiAnalysis(null);
    await loadVersions(proj.id);
  };

  const handleGenerate = async (e: React.FormEvent, createNew = false) => {
    e.preventDefault();
    if (!promptInput.trim()) return;
    const text = promptInput.trim();
    setPromptInput('');
    setError(null);
    setStatusMsg(null);
    setBusy(true);

    setChatHistory((prev) => [...prev, { role: 'user', text }]);
    setTerminalLogs((prev) => [
      ...prev,
      `[builder] Sending specification to ${model}...`,
      '[builder] Generating frontend, backend & database schema files...',
    ]);

    try {
      const res = await apiFetch<{
        project: AiProject;
        summary: string;
        tokensUsed: number;
        versionNumber: number;
      }>('/api/builder/generate', {
        method: 'POST',
        body: JSON.stringify({
          projectId: createNew ? undefined : activeProject?.id,
          prompt: text,
          model,
        }),
      });

      setActiveProject(res.project);
      setActiveFilePath(res.project.files[0]?.path || 'index.html');
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `${res.summary} (v${res.versionNumber} · ${res.tokensUsed.toLocaleString()} tokens)`,
        },
      ]);
      setTerminalLogs((prev) => [
        ...prev,
        `[sandbox] Built ${res.project.files.length} files cleanly. Live preview refreshed.`,
      ]);
      setRightTab('preview');
      await loadProjects();
      await loadVersions(res.project.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed.';
      setError(msg);
      setTerminalLogs((prev) => [...prev, `[error] ${msg}`]);
    } finally {
      setBusy(false);
    }
  };

  const handleAnalyzeCode = async (task: 'explain' | 'debug' | 'refactor') => {
    if (!activeProject) return;
    const file = activeProject.files.find((f) => f.path === activeFilePath);
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ analysis: string; tokensUsed: number }>('/api/builder/analyze', {
        method: 'POST',
        body: JSON.stringify({
          task,
          filePath: file.path,
          code: file.content,
          model,
        }),
      });
      setAiAnalysis(res.analysis);
      setTerminalLogs((prev) => [
        ...prev,
        `[assistant] Completed ${task} analysis on ${file.path} (${res.tokensUsed} tokens).`,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEditedFile = async (newContent: string) => {
    if (!activeProject) return;
    const updatedFiles: BuilderFile[] = activeProject.files.map((f) =>
      f.path === activeFilePath ? { ...f, content: newContent } : f,
    );
    setActiveProject({ ...activeProject, files: updatedFiles });
  };

  const persistFilesToServer = async () => {
    if (!activeProject) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ project: AiProject }>(
        `/api/builder/projects/${activeProject.id}/files`,
        {
          method: 'PUT',
          body: JSON.stringify({
            files: activeProject.files,
            envVars: activeProject.envVars,
            customDomain: domainInput.trim() || null,
            summary: `Manual edit saved (${activeFilePath})`,
          }),
        },
      );
      setActiveProject(res.project);
      setStatusMsg('Workspace changes saved & versioned.');
      await loadVersions(res.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!activeProject) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ project: AiProject; restoredVersion: number }>(
        `/api/builder/projects/${activeProject.id}/restore/${versionId}`,
        { method: 'POST' },
      );
      setActiveProject(res.project);
      setStatusMsg(`Restored snapshot v${res.restoredVersion}.`);
      setRightTab('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportZip = async () => {
    if (!activeProject) return;
    const zip = new JSZip();
    for (const file of activeProject.files) {
      zip.file(file.path, file.content);
    }
    zip.file(
      'kodex.config.json',
      JSON.stringify(
        {
          name: activeProject.name,
          framework: activeProject.framework,
          customDomain: activeProject.customDomain,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Exported project ZIP archive.');
  };

  const handleGithubExport = () => {
    if (!activeProject) return;
    const manifest = {
      repository: activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      defaultBranch: 'main',
      files: activeProject.files,
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manifest.repository}-github-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Downloaded GitHub repository import bundle.');
  };

  const handleDuplicate = async () => {
    if (!activeProject) return;
    const res = await apiFetch<{ project: AiProject }>(
      `/api/builder/projects/${activeProject.id}/duplicate`,
      { method: 'POST' },
    );
    await loadProjects();
    await selectProject(res.project);
    setStatusMsg('Project duplicated.');
  };

  const handleDelete = async () => {
    if (!activeProject) return;
    await apiFetch(`/api/builder/projects/${activeProject.id}`, { method: 'DELETE' });
    setActiveProject(null);
    await loadProjects();
    setStatusMsg('Project deleted.');
  };

  const handleDeploy = async () => {
    if (!activeProject) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ deploymentId: string; previewUrl: string }>(
        `/api/builder/projects/${activeProject.id}/deploy`,
        {
          method: 'POST',
          body: JSON.stringify({ environment: 'production', region: 'us-east-1' }),
        },
      );
      setStatusMsg(`Deployed live to Cloud Hosting (${res.previewUrl}).`);
      setTerminalLogs((prev) => [
        ...prev,
        `[deploy] Production build ${res.deploymentId} live at ${res.previewUrl}`,
      ]);
      onDeployed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed.');
    } finally {
      setBusy(false);
    }
  };

  const currentFile = activeProject?.files.find((f) => f.path === activeFilePath);
  const previewDoc = activeProject ? buildPreviewHtml(activeProject.files) : '';

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Select AI project"
            value={activeProject?.id || ''}
            onChange={(e) => {
              const found = projects.find((p) => p.id === e.target.value);
              if (found) void selectProject(found);
            }}
            className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white max-w-[200px]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Select AI Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
          >
            <option value="gemini-4-hydrogen">gemini-4-hydrogen</option>
            <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
          </select>

          <button
            type="button"
            onClick={() => {
              setActiveProject(null);
              setChatHistory([
                { role: 'assistant', text: 'New workspace ready. Describe the app you want to build.' },
              ]);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New App</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportZip}
            disabled={!activeProject}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>ZIP</span>
          </button>
          <button
            type="button"
            onClick={handleGithubExport}
            disabled={!activeProject}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={!activeProject}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Duplicate</span>
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!activeProject}
            aria-label="Delete project"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 border border-slate-300 rounded-md hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDeploy}
            disabled={!activeProject || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-md disabled:opacity-60 whitespace-nowrap"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Deploy Live</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}

      {/* Mobile Tab Switcher */}
      <div className="flex lg:hidden items-center gap-1 p-1 bg-slate-100 rounded-md">
        <button
          type="button"
          onClick={() => setMobilePane('chat')}
          className={`flex-1 py-1.5 text-xs font-medium rounded ${
            mobilePane === 'chat' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          AI Prompt &amp; Chat
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('workspace')}
          className={`flex-1 py-1.5 text-xs font-medium rounded ${
            mobilePane === 'workspace' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          Preview &amp; Code
        </button>
      </div>

      {/* Split-Screen Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[640px]">
        {/* Left: Chat & Prompt Interface */}
        <div
          className={`lg:col-span-4 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden ${
            mobilePane === 'chat' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-display font-semibold text-slate-900">
              AI Architect Chat
            </span>
            <span className="text-xs text-slate-500">
              {busy ? 'Generating...' : activeProject ? 'Workspace ready' : 'New build'}
            </span>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-3 max-h-[420px]">
            {chatHistory.map((turn, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg text-xs leading-relaxed ${
                  turn.role === 'user'
                    ? 'bg-blue-700 text-white ml-6'
                    : 'bg-slate-100 text-slate-800 mr-4'
                }`}
              >
                {turn.text}
              </div>
            ))}

            {aiAnalysis && (
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 whitespace-pre-wrap">
                {aiAnalysis}
              </div>
            )}
          </div>

          {/* Quick Templates */}
          <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap gap-1.5">
            {TEMPLATE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setPromptInput(`Build a responsive ${preset}`)}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:border-blue-500 text-slate-600 hover:text-blue-700 transition-colors"
              >
                {preset.split(' ')[0]} {preset.split(' ')[1]}
              </button>
            ))}
          </div>

          <form onSubmit={(e) => handleGenerate(e, !activeProject)} className="p-3 border-t border-slate-200 space-y-2">
            <textarea
              rows={3}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder={
                activeProject
                  ? 'Request a feature change, UI tweak, or backend endpoint...'
                  : 'Describe the website, SaaS, e-commerce, or admin panel to generate...'
              }
              className="w-full p-2.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <div className="flex items-center justify-between gap-2">
              {activeProject && (
                <button
                  type="button"
                  disabled={busy || !promptInput.trim()}
                  onClick={(e) => void handleGenerate(e, true)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                >
                  Build as New App
                </button>
              )}
              <button
                type="submit"
                disabled={busy || !promptInput.trim()}
                className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium rounded-md disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{busy ? 'Generating...' : activeProject ? 'Apply Update' : 'Generate App'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right: Preview / Code Editor / Terminal / Versions */}
        <div
          className={`lg:col-span-8 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden ${
            mobilePane === 'workspace' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {(
                [
                  ['preview', 'Live Preview', Play],
                  ['code', 'Code & Terminal', FileCode2],
                  ['versions', `History (${versions.length})`, History],
                  ['settings', 'Env & Domain', Sparkles],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRightTab(id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                    rightTab === id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {activeProject && (
              <span className="text-xs font-mono text-slate-500">
                {activeProject.framework}
              </span>
            )}
          </div>

          {!activeProject ? (
            <div className="flex-1 flex items-center justify-center p-12 text-center text-sm text-slate-500">
              Describe an application in the left chat panel to scaffold and launch a live preview.
            </div>
          ) : rightTab === 'preview' ? (
            <div className="flex-1 bg-slate-100 p-3 flex flex-col">
              <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex-1 min-h-[540px]">
                <iframe
                  title={`${activeProject.name} live preview`}
                  sandbox="allow-scripts allow-forms"
                  srcDoc={previewDoc}
                  className="w-full h-full min-h-[540px] border-0"
                />
              </div>
            </div>
          ) : rightTab === 'code' ? (
            <div className="flex-1 flex flex-col">
              <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-[400px]">
                {/* File Explorer */}
                <div className="md:col-span-3 border-r border-slate-200 bg-slate-50 p-3 space-y-1">
                  <div className="text-xs font-semibold text-slate-500 mb-2">File Explorer</div>
                  {activeProject.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setActiveFilePath(file.path)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono truncate ${
                        activeFilePath === file.path
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>

                {/* Code Editor */}
                <div className="md:col-span-9 flex flex-col bg-slate-950">
                  <div className="px-3 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono text-slate-300">{activeFilePath}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAnalyzeCode('explain')}
                        className="px-2 py-1 text-xs text-slate-300 border border-slate-700 rounded hover:border-slate-500"
                      >
                        Explain
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAnalyzeCode('debug')}
                        className="px-2 py-1 text-xs text-slate-300 border border-slate-700 rounded hover:border-slate-500"
                      >
                        Debug
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAnalyzeCode('refactor')}
                        className="px-2 py-1 text-xs text-slate-300 border border-slate-700 rounded hover:border-slate-500"
                      >
                        Refactor
                      </button>
                      <button
                        type="button"
                        onClick={persistFilesToServer}
                        className="px-3 py-1 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white rounded"
                      >
                        Save File
                      </button>
                    </div>
                  </div>

                  <textarea
                    aria-label="Code editor"
                    value={currentFile?.content ?? ''}
                    onChange={(e) => handleSaveEditedFile(e.target.value)}
                    className="flex-1 w-full p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed focus:outline-none min-h-[300px]"
                  />
                </div>
              </div>

              {/* Build Terminal */}
              <div className="border-t border-slate-800 bg-slate-900 text-slate-200 p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
                  <TerminalIcon className="w-3.5 h-3.5" />
                  <span>Build &amp; Execution Logs</span>
                </div>
                <div className="font-mono text-xs space-y-1 max-h-28 overflow-y-auto">
                  {terminalLogs.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : rightTab === 'versions' ? (
            <div className="p-5 space-y-3 overflow-y-auto">
              <h3 className="text-sm font-display font-semibold text-slate-900">
                Project Version Snapshots
              </h3>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                {versions.map((ver) => (
                  <div key={ver.id} className="p-3 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        Version {ver.versionNumber} · {ver.summary}
                      </div>
                      <div className="text-slate-500 mt-0.5 tabular-nums">
                        {ver.files.length} files · {new Date(ver.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreVersion(ver.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50 font-medium"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-6">
              <div>
                <h3 className="text-sm font-display font-semibold text-slate-900 mb-2">
                  Custom Domain Mapping
                </h3>
                <div className="flex gap-2 max-w-md">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="app.yourdomain.com"
                    className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={persistFilesToServer}
                    className="px-4 py-2 bg-blue-700 text-white text-xs font-medium rounded-md"
                  >
                    Save Domain
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-display font-semibold text-slate-900 mb-2">
                  Project Environment Variables
                </h3>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value)}
                    placeholder="API_SECRET"
                    className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    value={newEnvVal}
                    onChange={(e) => setNewEnvVal(e.target.value)}
                    placeholder="Value"
                    className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newEnvKey.trim() || !activeProject) return;
                      setActiveProject({
                        ...activeProject,
                        envVars: [
                          ...activeProject.envVars,
                          { key: newEnvKey.trim().toUpperCase(), value: newEnvVal },
                        ],
                      });
                      setNewEnvKey('');
                      setNewEnvVal('');
                    }}
                    className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md"
                  >
                    Add Variable
                  </button>
                </div>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                  {activeProject.envVars.map((ev, i) => (
                    <div key={i} className="px-3 py-2 flex items-center justify-between text-xs font-mono">
                      <span>{ev.key}</span>
                      <span className="text-slate-500">••••••••</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
