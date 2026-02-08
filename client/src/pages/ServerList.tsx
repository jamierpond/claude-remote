import { useState, useEffect, useRef } from "react";
import {
  type ServerConfig,
  getServers,
  addServer,
  removeServer,
  setActiveServerId,
} from "../lib/servers";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedSecret,
} from "../lib/crypto-client";

interface Props {
  onNavigate: (route: "servers" | "chat") => void;
  pairInfo?: { serverUrl: string; token: string } | null;
}

interface ServerStatus {
  online: boolean;
  serverName?: string;
}

export default function ServerList({ onNavigate, pairInfo }: Props) {
  const [servers, setServers] = useState<ServerConfig[]>(getServers);
  const [statuses, setStatuses] = useState<Map<string, ServerStatus>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  // Pairing state
  const [showPairing, setShowPairing] = useState(false);
  const [pairingUrl, setPairingUrl] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [pairingLog, setPairingLog] = useState<string[]>([]);
  const autoPairingStarted = useRef(false);

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const addLog = (msg: string) => {
    console.log(msg);
    setPairingLog((prev) => [...prev, msg]);
  };

  // Check server statuses on mount
  useEffect(() => {
    servers.forEach(async (server) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${server.serverUrl}/api/status`, {
          signal: controller.signal,
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

  // Auto-pair if pairInfo provided from URL
  useEffect(() => {
    if (pairInfo && !autoPairingStarted.current) {
      autoPairingStarted.current = true;
      doPairingWithInfo(pairInfo.serverUrl, pairInfo.token);
    }
  }, [pairInfo]);

  const parseUrl = (
    url: string,
  ): { serverUrl: string; token: string } | null => {
    try {
      const uri = new URL(url.trim());
      const params = new URLSearchParams(uri.search);
      const segments = uri.pathname.split("/").filter(Boolean);

      const serverParam = params.get("server");
      const tokenParam = params.get("token");
      if (serverParam && tokenParam) {
        return { serverUrl: serverParam, token: tokenParam };
      }

      if (segments.length >= 2 && segments[0] === "pair") {
        const token = segments[1];
        const serverUrl = `${uri.protocol}//${uri.host}`;
        return { serverUrl, token };
      }

      return null;
    } catch {
      return null;
    }
  };

  const doPairing = () => {
    const parsed = parseUrl(pairingUrl);
    if (!parsed) {
      setError("Invalid URL. Expected: https://server/pair/TOKEN");
      return;
    }
    doPairingWithInfo(parsed.serverUrl, parsed.token);
  };

  const doPairingWithInfo = async (serverUrl: string, token: string) => {
    setPairingLog([]);
    setError(null);
    setShowPairing(true);
    setIsPairing(true);

    addLog(`Server: ${serverUrl}`);
    addLog(`Token: ${token}`);

    try {
      addLog("Generating keypair...");
      const keyPair = await generateKeyPair();
      const clientPublicKey = await exportPublicKey(keyPair.publicKey);
      const privateKeyJwk = await crypto.subtle.exportKey(
        "jwk",
        keyPair.privateKey,
      );
      addLog("Keypair generated");

      addLog(`GET ${serverUrl}/pair/${token}`);
      const getRes = await fetch(`${serverUrl}/pair/${token}`);
      if (!getRes.ok) {
        const data = await getRes.json().catch(() => ({}));
        throw new Error(
          `Failed to get server key: ${data.error || getRes.status}`,
        );
      }
      const { serverPublicKey } = await getRes.json();
      if (!serverPublicKey) throw new Error("Server returned empty public key");
      addLog("Got server public key");

      addLog(`POST ${serverUrl}/pair/${token}`);
      const postRes = await fetch(`${serverUrl}/pair/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientPublicKey }),
      });
      if (!postRes.ok) {
        const data = await postRes.json().catch(() => ({}));
        throw new Error(
          `Failed to complete pairing: ${data.error || postRes.status}`,
        );
      }
      const { deviceId } = await postRes.json();
      if (!deviceId) throw new Error("Server returned empty device ID");
      addLog(`Device ID: ${deviceId}`);

      // Verify key derivation works
      addLog("Deriving shared secret...");
      const serverKey = await importPublicKey(serverPublicKey);
      await deriveSharedSecret(keyPair.privateKey, serverKey);

      // Detect server name
      let name: string;
      try {
        const statusRes = await fetch(`${serverUrl}/api/status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          name = statusData.serverName || new URL(serverUrl).hostname;
        } else {
          name = new URL(serverUrl).hostname;
        }
      } catch {
        name = new URL(serverUrl).hostname;
      }

      const config: ServerConfig = {
        id: crypto.randomUUID(),
        name,
        serverUrl,
        deviceId,
        privateKey: JSON.stringify(privateKeyJwk),
        serverPublicKey,
        pairedAt: new Date().toISOString(),
      };

      addServer(config);
      setActiveServerId(config.id);
      setServers(getServers());

      addLog("Pairing complete!");

      setTimeout(() => {
        onNavigate("chat");
      }, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`ERROR: ${msg}`);
      setError(msg);
    } finally {
      setIsPairing(false);
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
            ? "Pair with a server to get started"
            : "Select a server"}
        </p>

        {error && !pairingLog.length && (
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
                    {/* Status dot */}
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

                  {/* Delete confirmation */}
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
                        Paired {new Date(server.pairedAt).toLocaleDateString()}
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

        {/* Add server / pairing */}
        {!showPairing ? (
          <button
            onClick={() => setShowPairing(true)}
            className="w-full px-4 py-3 bg-[var(--color-accent)] rounded-xl font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            Add Server
          </button>
        ) : (
          <div className="bg-[var(--color-bg-secondary)] rounded-xl p-4">
            <h2 className="font-semibold mb-3">Pair with Server</h2>

            {error && pairingLog.length > 0 && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <input
                type="text"
                value={pairingUrl}
                onChange={(e) => setPairingUrl(e.target.value)}
                placeholder="https://server/pair/token..."
                className="w-full px-4 py-3 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
              />

              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setPairingUrl(text);
                    } catch {
                      setError("Failed to read clipboard");
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-[var(--color-bg-hover)] rounded-lg font-semibold hover:bg-[var(--color-border-emphasis)] transition-colors"
                >
                  Paste
                </button>
                <button
                  onClick={doPairing}
                  disabled={isPairing || !pairingUrl.trim()}
                  className="flex-1 px-4 py-3 bg-[var(--color-accent)] rounded-lg font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
                >
                  {isPairing ? "Pairing..." : "Pair"}
                </button>
              </div>

              {servers.length > 0 && !isPairing && (
                <button
                  onClick={() => {
                    setShowPairing(false);
                    setPairingLog([]);
                    setError(null);
                  }}
                  className="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>

            {pairingLog.length > 0 && (
              <div className="mt-4 bg-[var(--color-bg-primary)] rounded-lg p-3">
                <div className="font-mono text-xs text-green-400 space-y-1">
                  {pairingLog.map((log, i) => (
                    <p key={i}>{log}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
