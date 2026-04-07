import { useState, useEffect } from "react";
import {
  type ServerConfig,
  getServers,
  addServer,
  removeServer,
  setActiveServerId,
} from "../lib/servers";

interface Props {
  onNavigate: (route: "servers" | "chat") => void;
}

interface ServerStatus {
  online: boolean;
  serverName?: string;
}

export default function ServerList({ onNavigate }: Props) {
  const [servers, setServers] = useState<ServerConfig[]>(getServers);
  const [statuses, setStatuses] = useState<Map<string, ServerStatus>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Check server statuses on mount
  useEffect(() => {
    servers.forEach(async (server) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${server.serverUrl}/api/status`, {
          signal: controller.signal,
          credentials: "include",
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          setStatuses((prev) =>
            new Map(prev).set(server.id, {
              online: true,
              serverName: data.serverName,
            }),
          );
        } else {
          setStatuses((prev) =>
            new Map(prev).set(server.id, { online: false }),
          );
        }
      } catch {
        setStatuses((prev) => new Map(prev).set(server.id, { online: false }));
      }
    });
  }, [servers]);

  const handleAddServer = async () => {
    setError(null);
    setIsAdding(true);

    let url = serverUrl.trim().replace(/\/+$/, "");
    if (!url) {
      setError("Enter a server URL");
      setIsAdding(false);
      return;
    }

    // Add protocol if missing
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    try {
      // Verify the server is reachable
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${url}/api/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = await res.json();
      const name = data.serverName || new URL(url).hostname;

      const config: ServerConfig = {
        id: crypto.randomUUID(),
        name,
        serverUrl: url,
        addedAt: new Date().toISOString(),
      };

      addServer(config);
      setActiveServerId(config.id);
      setServers(getServers());
      setShowAdd(false);
      setServerUrl("");

      setTimeout(() => onNavigate("chat"), 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Could not reach server: ${msg}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleSelectServer = (server: ServerConfig) => {
    setActiveServerId(server.id);
    onNavigate("chat");
  };

  const handleRemoveServer = (serverId: string) => {
    removeServer(serverId);
    setServers(getServers());
    setConfirmDeleteId(null);
  };

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-2xl font-bold mb-1 text-center">Claude Remote</h1>
        <p className="text-[var(--color-text-secondary)] text-sm mb-6 text-center">
          {servers.length === 0
            ? "Add a server to get started"
            : "Select a server"}
        </p>

        {error && !showAdd && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Server list */}
        {servers.length > 0 && (
          <div className="space-y-2 mb-6">
            {servers.map((server) => {
              const status = statuses.get(server.id);
              const isConfirming = confirmDeleteId === server.id;

              return (
                <div
                  key={server.id}
                  className="bg-[var(--color-bg-secondary)] rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => handleSelectServer(server)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        status?.online
                          ? "bg-green-400"
                          : status === undefined
                            ? "bg-gray-500 animate-pulse"
                            : "bg-gray-500"
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {status?.serverName || server.name}
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)] truncate">
                        {server.serverUrl}
                      </div>
                    </div>

                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-[var(--color-text-tertiary)] shrink-0"
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

                  {isConfirming ? (
                    <div className="flex items-center justify-between px-4 py-2 bg-red-900/30 border-t border-[var(--color-border-default)]">
                      <span className="text-sm text-red-300">
                        Remove this server?
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1 text-xs bg-[var(--color-bg-hover)] rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRemoveServer(server.id)}
                          className="px-3 py-1 text-xs bg-red-600 rounded-lg"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--color-border-default)]">
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        Added {new Date(server.addedAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => setConfirmDeleteId(server.id)}
                        className="text-xs text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add server */}
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full px-4 py-3 bg-[var(--color-accent)] rounded-xl font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            Add Server
          </button>
        ) : (
          <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4">
            <h2 className="font-semibold mb-3">Add Server</h2>

            {error && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://your-server:6767"
                className="w-full px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
                onKeyDown={(e) => e.key === "Enter" && handleAddServer()}
              />

              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setServerUrl(text);
                    } catch {
                      setError("Failed to read clipboard");
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-[var(--color-bg-hover)] rounded-lg font-semibold hover:bg-[var(--color-border-emphasis)] transition-colors"
                >
                  Paste
                </button>
                <button
                  onClick={handleAddServer}
                  disabled={isAdding || !serverUrl.trim()}
                  className="flex-1 px-4 py-3 bg-[var(--color-accent)] rounded-lg font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
                >
                  {isAdding ? "Connecting..." : "Add"}
                </button>
              </div>

              {servers.length > 0 && !isAdding && (
                <button
                  onClick={() => {
                    setShowAdd(false);
                    setError(null);
                  }}
                  className="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
