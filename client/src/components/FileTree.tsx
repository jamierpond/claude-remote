import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../lib/api';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';

interface FileTreeProps {
  projectId: string | null;
  serverId?: string;
  serverUrl?: string;
  isOpen: boolean;
  onClose: () => void;
}

interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modified?: string;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  css: 'css', json: 'json', sh: 'bash', bash: 'bash',
  py: 'python', md: 'markdown', yml: 'yaml', yaml: 'yaml',
  toml: 'toml', rs: 'rust', go: 'go', html: 'markup',
  xml: 'markup', svg: 'markup', makefile: 'bash',
};

function getLang(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower === 'makefile' || lower === 'dockerfile') return 'bash';
  const ext = lower.split('.').pop() || '';
  return EXT_TO_LANG[ext] || null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HighlightedCode({ content, filename }: { content: string; filename: string }) {
  const lang = getLang(filename);
  const html = useMemo(() => {
    if (!lang || !Prism.languages[lang]) return null;
    try {
      return Prism.highlight(content, Prism.languages[lang], lang);
    } catch {
      return null;
    }
  }, [content, lang]);

  if (html) {
    return (
      <pre className="p-4 text-sm whitespace-pre overflow-x-auto font-mono leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    );
  }

  return (
    <pre className="p-4 text-sm text-[var(--color-text-primary)] whitespace-pre overflow-x-auto font-mono leading-relaxed">
      {content}
    </pre>
  );
}

interface ChangedFileInfo {
  status: string;
}

function statusDotColor(status: string): string {
  if (status === '??') return 'bg-blue-400';
  if (status.includes('M')) return 'bg-yellow-400';
  if (status.includes('A')) return 'bg-green-400';
  if (status.includes('D')) return 'bg-red-400';
  return 'bg-[var(--color-text-tertiary)]';
}

export default function FileTree({ projectId, serverId, serverUrl, isOpen, onClose }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Git change tracking
  const [changedFiles, setChangedFiles] = useState<Map<string, ChangedFileInfo>>(new Map());
  const [dirtyDirs, setDirtyDirs] = useState<Set<string>>(new Set());

  // File viewer state
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const fetchTree = useCallback(async (subPath: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const pathSuffix = subPath ? `/${encodeURIComponent(subPath).replace(/%2F/g, '/')}` : '';
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tree${pathSuffix}`, { serverId, serverUrl });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setCurrentPath(data.path || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [projectId, serverId, serverUrl]);

  const fetchFile = useCallback(async (filePath: string) => {
    if (!projectId) return;
    setFileLoading(true);
    setFileError(null);
    setFileContent('');
    setViewingFile(filePath);
    try {
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/blob/${encodedPath}`, { serverId, serverUrl });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to fetch: ${res.status}`);
      }
      const data = await res.json();
      setFileContent(data.content);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setFileLoading(false);
    }
  }, [projectId, serverId, serverUrl]);

  const fetchChanges = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/diff`, { serverId, serverUrl });
      if (!res.ok) return;
      const data = await res.json();
      const files = new Map<string, ChangedFileInfo>();
      const dirs = new Set<string>();
      for (const f of (data.files || [])) {
        files.set(f.path, { status: f.status });
        // Mark all parent directories as dirty
        const parts = f.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join('/'));
        }
      }
      setChangedFiles(files);
      setDirtyDirs(dirs);
    } catch {
      // Non-critical, just won't show change indicators
    }
  }, [projectId, serverId, serverUrl]);

  useEffect(() => {
    if (isOpen && projectId) {
      setCurrentPath('');
      setViewingFile(null);
      fetchTree('');
      fetchChanges();
    }
  }, [isOpen, projectId, fetchTree, fetchChanges]);

  const navigateTo = (dirName: string) => {
    const newPath = currentPath ? `${currentPath}/${dirName}` : dirName;
    fetchTree(newPath);
  };

  const openFile = (fileName: string) => {
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
    fetchFile(filePath);
  };

  const closeFile = () => {
    setViewingFile(null);
    setFileContent('');
    setFileError(null);
  };

  const navigateUp = (targetIdx: number) => {
    const segments = currentPath.split('/').filter(Boolean);
    const newPath = segments.slice(0, targetIdx + 1).join('/');
    fetchTree(newPath);
  };

  const navigateRoot = () => {
    fetchTree('');
  };

  if (!isOpen) return null;

  const pathSegments = currentPath ? currentPath.split('/').filter(Boolean) : [];

  // File viewer mode
  if (viewingFile) {
    const fileName = viewingFile.split('/').pop() || viewingFile;

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        <div className="relative w-full sm:max-w-lg bg-[var(--color-bg-secondary)] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                onClick={closeFile}
                className="shrink-0 p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label="Back to files"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{fileName}</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* File path */}
          <div className="px-4 py-1.5 border-b border-[var(--color-border-default)] text-xs text-[var(--color-text-tertiary)] truncate">
            {viewingFile}
          </div>

          {/* File content */}
          <div className="flex-1 overflow-auto">
            {fileLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : fileError ? (
              <div className="text-center py-8 text-red-400">
                <p>{fileError}</p>
                <button
                  onClick={() => fetchFile(viewingFile)}
                  className="mt-2 text-sm text-[var(--color-accent)] hover:text-[#d97a5a]"
                >
                  Retry
                </button>
              </div>
            ) : (
              <HighlightedCode content={fileContent} filename={viewingFile} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Directory browser mode
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full sm:max-w-md bg-[var(--color-bg-secondary)] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Files</h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="px-4 py-2 border-b border-[var(--color-border-default)] flex items-center gap-1 text-sm overflow-x-auto whitespace-nowrap">
          <button
            onClick={navigateRoot}
            className={`shrink-0 hover:text-[var(--color-accent)] transition-colors ${
              pathSegments.length === 0 ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            /
          </button>
          {pathSegments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-[var(--color-text-tertiary)]">/</span>
              <button
                onClick={() => navigateUp(i)}
                className={`hover:text-[var(--color-accent)] transition-colors ${
                  i === pathSegments.length - 1 ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-secondary)]'
                }`}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400">
              <p>{error}</p>
              <button
                onClick={() => fetchTree(currentPath)}
                className="mt-2 text-sm text-[var(--color-accent)] hover:text-[#d97a5a]"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-tertiary)]">
              Empty directory
            </div>
          ) : (
            <div className="space-y-0.5">
              {entries.map((entry) => {
                const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                const fileChange = entry.type === 'file' ? changedFiles.get(fullPath) : null;
                const isDirDirty = entry.type === 'dir' && dirtyDirs.has(fullPath);

                return (
                  <button
                    key={entry.name}
                    onClick={() => entry.type === 'dir' ? navigateTo(entry.name) : openFile(entry.name)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-[var(--color-bg-hover)] cursor-pointer"
                  >
                    {/* Icon */}
                    {entry.type === 'dir' ? (
                      <div className="relative shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[var(--color-accent)]" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        {isDirDirty && (
                          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-yellow-400 rounded-full" />
                        )}
                      </div>
                    ) : (
                      <div className="relative shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${fileChange ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'}`} viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                        </svg>
                        {fileChange && (
                          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${statusDotColor(fileChange.status)}`} />
                        )}
                      </div>
                    )}

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <span className={`truncate block ${
                        entry.type === 'dir' ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-primary)]'
                      }`}>
                        {entry.name}
                      </span>
                    </div>

                    {/* Size */}
                    {entry.type === 'file' && entry.size !== undefined && (
                      <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                        {formatSize(entry.size)}
                      </span>
                    )}

                    {/* Arrow for dirs */}
                    {entry.type === 'dir' && (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--color-text-tertiary)] shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
