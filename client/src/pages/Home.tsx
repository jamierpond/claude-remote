import { useState, useEffect } from 'react';

interface Props {
  onNavigate: (route: 'home' | 'chat' | 'pair') => void;
}

interface DeviceInfo {
  id: string;
  createdAt: string;
}

interface Status {
  paired: boolean;
  devices: DeviceInfo[];
  deviceCount: number;
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

  const hasBrowserCredentials = !!localStorage.getItem('claude-remote-paired');
  const myDeviceId = localStorage.getItem('claude-remote-device-id');

  // This browser is paired
  if (hasBrowserCredentials && myDeviceId) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
          <p className="text-gray-400 mb-4">Device paired and ready.</p>
          <p className="text-sm text-gray-500 mb-2">This device: {myDeviceId}</p>
          <p className="text-sm text-gray-500 mb-6">Total devices: {status.deviceCount}</p>
          <div className="flex flex-col gap-3">
            <a
              href="/chat"
              className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-center"
            >
              Open Chat
            </a>
            {status.pairingUrl && (
              <a
                href={status.pairingUrl}
                className="px-6 py-3 bg-green-600 rounded-lg font-semibold hover:bg-green-700 transition-colors text-center"
              >
                Pair Another Device
              </a>
            )}
            <button
              onClick={handleForceRepair}
              disabled={unpairing}
              className="px-6 py-3 bg-gray-700 rounded-lg font-semibold hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              {unpairing ? 'Resetting...' : 'Unpair All & Reset'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Server has devices but this browser isn't paired - allow pairing
  if (status.paired && !hasBrowserCredentials) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
          <p className="text-gray-400 mb-4">
            {status.deviceCount} device(s) paired. This browser is not paired.
          </p>
          {status.pairingUrl ? (
            <a
              href={status.pairingUrl}
              className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors inline-block"
            >
              Pair This Device
            </a>
          ) : (
            <p className="text-red-400">No pairing URL available - restart server</p>
          )}
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
