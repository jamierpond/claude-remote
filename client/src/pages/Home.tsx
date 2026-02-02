import { useState, useEffect } from 'react';

interface Props {
  onNavigate: (route: 'home' | 'chat' | 'pair') => void;
}

interface Status {
  paired: boolean;
  deviceId: string | null;
  pairedAt: string | null;
  pairingUrl: string | null;
}

export default function Home({ onNavigate }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [unpairing, setUnpairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleUnpair = async () => {
    setUnpairing(true);
    try {
      const res = await fetch('/api/unpair', { method: 'POST' });
      if (res.ok) {
        localStorage.removeItem('claude-remote-paired');
        localStorage.removeItem('claude-remote-device-id');
        localStorage.removeItem('claude-remote-private-key');
        localStorage.removeItem('claude-remote-server-public-key');
        await fetchStatus();
      }
    } catch {
      setError('Failed to unpair');
    } finally {
      setUnpairing(false);
    }
  };

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="text-red-400">{error}</p>
        </div>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      </main>
    );
  }

  const handleForceRepair = async () => {
    // Clear both sides and re-pair
    setUnpairing(true);
    try {
      await fetch('/api/unpair', { method: 'POST' });
      localStorage.clear(); // Clear everything to be safe
      window.location.reload();
    } catch {
      setError('Failed to reset');
    } finally {
      setUnpairing(false);
    }
  };

  if (status.paired) {
    const hasBrowserCredentials = !!localStorage.getItem('claude-remote-paired');

    if (!hasBrowserCredentials) {
      return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
          <div className="text-center">
            <div className="text-6xl mb-4">!</div>
            <h1 className="text-2xl font-bold mb-2">Crypto Mismatch</h1>
            <p className="text-gray-400 mb-4">
              Server is paired but this browser has no/wrong credentials.
            </p>
            <button
              onClick={handleForceRepair}
              disabled={unpairing}
              className="px-6 py-3 bg-red-600 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {unpairing ? 'Resetting...' : 'Reset & Re-pair'}
            </button>
          </div>
        </main>
      );
    }

    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
          <p className="text-gray-400 mb-4">Device paired and ready.</p>
          <p className="text-sm text-gray-500 mb-6">ID: {status.deviceId}</p>
          <div className="flex flex-col gap-3">
            <a
              href="/chat"
              className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-center"
            >
              Open Chat
            </a>
            <button
              onClick={handleForceRepair}
              disabled={unpairing}
              className="px-6 py-3 bg-gray-700 rounded-lg font-semibold hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              {unpairing ? 'Resetting...' : 'Reset & Re-pair'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Not paired - show pairing link directly
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
        <p className="text-gray-400 mb-6">Not paired yet.</p>
        {status.pairingUrl ? (
          <a
            href={status.pairingUrl}
            className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors inline-block"
          >
            Click to Pair
          </a>
        ) : (
          <p className="text-red-400">No pairing URL available - restart server</p>
        )}
      </div>
    </main>
  );
}
