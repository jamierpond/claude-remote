import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/api";

interface GitFile {
  status: string;
  path: string;
}

interface GitStatusData {
  branch: string;
  isDirty: boolean;
  changedFiles: number;
  files: GitFile[];
  ahead: number;
  behind: number;
}

// Git status code to color/label
function fileStatusColor(status: string): string {
  if (status.includes("M")) return "text-yellow-300";
  if (status.includes("A")) return "text-green-300";
  if (status.includes("D")) return "text-red-300";
  if (status.includes("R")) return "text-blue-300";
  if (status === "??") return "text-[var(--color-text-tertiary)]";
  return "text-[var(--color-text-secondary)]";
}

function fileStatusLabel(status: string): string {
  if (status === "??") return "new";
  if (status.includes("M")) return "mod";
  if (status.includes("A")) return "add";
  if (status.includes("D")) return "del";
  if (status.includes("R")) return "ren";
  return status;
}

interface GitStatusProps {
  projectId: string | null;
  serverId?: string;
  serverUrl?: string;
}

export default function GitStatus({
  projectId,
  serverId,
  serverUrl,
}: GitStatusProps) {
  const [status, setStatus] = useState<GitStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!projectId) {
      console.log("[GitStatus] No projectId, skipping fetch");
      setStatus(null);
      return;
    }

    console.log("[GitStatus] Fetching git status for:", projectId);
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/git`,
        { serverId, serverUrl },
      );
      if (!res.ok) {
        const data = await res.json();
        console.error("[GitStatus] API error:", data);
        throw new Error(data.error || "Failed to fetch git status");
      }
      const data = await res.json();
      console.log("[GitStatus] Got status:", data);
      setStatus(data);
      setError(null);
    } catch (err) {
      console.error("[GitStatus] Fetch failed:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Fetch on mount and when projectId changes
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Refresh periodically (every 30s)
  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [projectId, fetchStatus]);

  if (!projectId || error) {
    return null;
  }

  if (loading && !status) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--color-bg-secondary)] rounded-lg">
        <div className="w-3 h-3 border border-[var(--color-text-tertiary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors
          ${
            status.isDirty
              ? "bg-yellow-900/50 text-yellow-300 hover:bg-yellow-900/70"
              : "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
          }
        `}
        title={`${status.branch}${status.isDirty ? " (uncommitted changes)" : ""}`}
      >
        {/* Git branch icon */}
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"
          />
        </svg>

        <span className="truncate max-w-[100px]">{status.branch}</span>

        {/* Dirty indicator */}
        {status.isDirty && (
          <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full" />
        )}

        {/* Ahead/behind indicators */}
        {status.ahead > 0 && (
          <span
            className="text-green-400"
            title={`${status.ahead} commits ahead`}
          >
            ↑{status.ahead}
          </span>
        )}
        {status.behind > 0 && (
          <span
            className="text-red-400"
            title={`${status.behind} commits behind`}
          >
            ↓{status.behind}
          </span>
        )}
      </button>

      {/* Expanded details dropdown */}
      {expanded && (
        <>
          {/* Backdrop to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(false)}
          />

          <div className="absolute top-full right-0 mt-1 z-50 w-56 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg shadow-xl overflow-hidden">
            <div className="p-3 space-y-2">
              {/* Branch */}
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-[var(--color-text-tertiary)]"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"
                  />
                </svg>
                <span className="text-sm text-[var(--color-text-primary)] font-medium">
                  {status.branch}
                </span>
              </div>

              {/* Status summary */}
              {status.isDirty ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 flex items-center justify-center">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                  </div>
                  <span className="text-sm text-yellow-300">
                    {status.changedFiles} file
                    {status.changedFiles !== 1 ? "s" : ""} changed
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-green-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-green-300">
                    Clean working tree
                  </span>
                </div>
              )}

              {/* Ahead/behind */}
              {(status.ahead > 0 || status.behind > 0) && (
                <div className="flex items-center gap-3 text-sm">
                  {status.ahead > 0 && (
                    <span className="text-green-400">
                      ↑ {status.ahead} ahead
                    </span>
                  )}
                  {status.behind > 0 && (
                    <span className="text-red-400">
                      ↓ {status.behind} behind
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Changed files list */}
            {status.files && status.files.length > 0 && (
              <div className="border-t border-[var(--color-border-default)] max-h-48 overflow-y-auto">
                {status.files.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono hover:bg-[var(--color-bg-hover)]"
                  >
                    <span
                      className={`shrink-0 w-7 text-right ${fileStatusColor(file.status)}`}
                    >
                      {fileStatusLabel(file.status)}
                    </span>
                    <span
                      className="text-[var(--color-text-secondary)] truncate"
                      title={file.path}
                    >
                      {file.path}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Refresh button */}
            <div className="border-t border-[var(--color-border-default)] p-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fetchStatus();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
              >
                <svg
                  className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                    clipRule="evenodd"
                  />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
