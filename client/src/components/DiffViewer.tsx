import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/api";

interface DiffViewerProps {
  projectId: string | null;
  serverId?: string;
  serverUrl?: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ChangedFile {
  path: string;
  status: string;
}

function statusLabel(status: string): string {
  if (status === "??") return "new";
  if (status.includes("M")) return "mod";
  if (status.includes("A")) return "add";
  if (status.includes("D")) return "del";
  if (status.includes("R")) return "ren";
  return status;
}

function statusColor(status: string): string {
  if (status === "??") return "text-blue-300 bg-blue-900/40";
  if (status.includes("M")) return "text-yellow-300 bg-yellow-900/40";
  if (status.includes("A")) return "text-green-300 bg-green-900/40";
  if (status.includes("D")) return "text-red-300 bg-red-900/40";
  if (status.includes("R")) return "text-purple-300 bg-purple-900/40";
  return "text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)]";
}

function DiffContent({ diff, isNew }: { diff: string; isNew: boolean }) {
  if (!diff) {
    return (
      <div className="p-4 text-center text-[var(--color-text-tertiary)]">
        No changes
      </div>
    );
  }

  const lines = diff.split("\n");

  // For unified diffs, skip the header lines (---, +++, etc.)
  const isUnifiedDiff = !isNew && lines.some((l) => l.startsWith("@@"));

  return (
    <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
      {lines.map((line, i) => {
        let bg = "";
        let textColor = "text-[var(--color-text-primary)]";

        if (isNew || isUnifiedDiff) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            bg = "bg-green-900/30";
            textColor = "text-green-300";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            bg = "bg-red-900/30";
            textColor = "text-red-300";
          } else if (line.startsWith("@@")) {
            bg = "bg-blue-900/20";
            textColor = "text-blue-300";
          } else if (
            line.startsWith("diff ") ||
            line.startsWith("index ") ||
            line.startsWith("---") ||
            line.startsWith("+++")
          ) {
            textColor = "text-[var(--color-text-tertiary)]";
          }
        }

        return (
          <div key={i} className={`px-4 py-0 ${bg}`}>
            <span className={textColor}>{line}</span>
          </div>
        );
      })}
    </pre>
  );
}

export default function DiffViewer({
  projectId,
  serverId,
  serverUrl,
  isOpen,
  onClose,
}: DiffViewerProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diff viewer state
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/diff`,
        { serverId, serverUrl },
      );
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load changes");
    } finally {
      setLoading(false);
    }
  }, [projectId, serverId, serverUrl]);

  const fetchDiff = useCallback(
    async (filePath: string) => {
      if (!projectId) return;
      setDiffLoading(true);
      setDiffError(null);
      setDiff("");
      setViewingFile(filePath);
      try {
        const encodedPath = filePath
          .split("/")
          .map(encodeURIComponent)
          .join("/");
        const res = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/diff/${encodedPath}`,
          { serverId, serverUrl },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to fetch: ${res.status}`);
        }
        const data = await res.json();
        setDiff(data.diff || "");
        setIsNew(data.isNew || false);
      } catch (err) {
        setDiffError(
          err instanceof Error ? err.message : "Failed to load diff",
        );
      } finally {
        setDiffLoading(false);
      }
    },
    [projectId, serverId, serverUrl],
  );

  useEffect(() => {
    if (isOpen && projectId) {
      setViewingFile(null);
      fetchFiles();
    }
  }, [isOpen, projectId, fetchFiles]);

  const closeFile = () => {
    setViewingFile(null);
    setDiff("");
    setDiffError(null);
  };

  if (!isOpen) return null;

  // Diff view mode
  if (viewingFile) {
    const fileName = viewingFile.split("/").pop() || viewingFile;

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <div className="relative w-full sm:max-w-lg bg-[var(--color-bg-secondary)] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                onClick={closeFile}
                className="shrink-0 p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label="Back to changes"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {fileName}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* File path */}
          <div className="px-4 py-1.5 border-b border-[var(--color-border-default)] text-xs text-[var(--color-text-tertiary)] truncate">
            {viewingFile}
          </div>

          {/* Diff content */}
          <div className="flex-1 overflow-auto">
            {diffLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : diffError ? (
              <div className="text-center py-8 text-red-400">
                <p>{diffError}</p>
                <button
                  onClick={() => fetchDiff(viewingFile)}
                  className="mt-2 text-sm text-[var(--color-accent)] hover:text-[#d97a5a]"
                >
                  Retry
                </button>
              </div>
            ) : (
              <DiffContent diff={diff} isNew={isNew} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Changed files list mode
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full sm:max-w-md bg-[var(--color-bg-secondary)] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Changes
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
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
                onClick={fetchFiles}
                className="mt-2 text-sm text-[var(--color-accent)] hover:text-[#d97a5a]"
              >
                Retry
              </button>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-tertiary)]">
              No changes
            </div>
          ) : (
            <div className="space-y-0.5">
              {files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => fetchDiff(file.path)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--color-bg-hover)] cursor-pointer"
                >
                  {/* Status badge */}
                  <span
                    className={`shrink-0 text-xs font-mono font-bold px-1.5 py-0.5 rounded ${statusColor(file.status)}`}
                  >
                    {statusLabel(file.status)}
                  </span>

                  {/* File path */}
                  <span className="flex-1 min-w-0 text-sm text-[var(--color-text-primary)] truncate font-mono">
                    {file.path}
                  </span>

                  {/* Arrow */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-[var(--color-text-tertiary)] shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {files.length > 0 && (
          <div className="p-3 border-t border-[var(--color-border-default)] text-center text-xs text-[var(--color-text-tertiary)]">
            {files.length} file{files.length !== 1 ? "s" : ""} changed
          </div>
        )}
      </div>
    </div>
  );
}
