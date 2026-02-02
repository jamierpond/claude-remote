import { useState, useEffect } from 'react';

interface Props {
  onNavigate: (route: 'home' | 'chat' | 'pair') => void;
}

interface Status {
  paired: boolean;
  deviceId: string | null;
  pairedAt: string | null;
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

  if (status.paired) {
    const hasBrowserCredentials = !!localStorage.getItem('claude-remote-paired');

    if (!hasBrowserCredentials) {
      return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
          <div className="text-center">
            <div className="text-6xl mb-4">&#x26A0;</div>
            <h1 className="text-2xl font-bold mb-2">Paired to Different Device</h1>
            <p className="text-gray-400 mb-4">
              Server is paired, but this browser doesn't have the credentials.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Unpair to get a new pairing URL in the server logs.
            </p>
            <button
              onClick={handleUnpair}
              disabled={unpairing}
              className="px-6 py-3 bg-red-600 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {unpairing ? 'Unpairing...' : 'Unpair & Reset'}
            </button>
          </div>
        </main>
      );
    }

    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">&#x2713;</div>
          <h1 className="text-2xl font-bold mb-2">Device Paired</h1>
          <p className="text-gray-400 mb-4">Your device is connected and ready.</p>
          <p className="text-sm text-gray-500">Device ID: {status.deviceId}</p>
          <p className="text-sm text-gray-500 mb-6">
            Paired: {status.pairedAt ? new Date(status.pairedAt).toLocaleDateString() : 'Unknown'}
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => onNavigate('chat')}
              className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Open Chat
            </button>
            <button
              onClick={handleUnpair}
              disabled={unpairing}
              className="px-6 py-3 bg-gray-700 rounded-lg font-semibold hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              {unpairing ? 'Unpairing...' : 'Unpair Device'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Not paired - tell user to check server logs
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
        <p className="text-gray-400 mb-6">
          Check server logs for the pairing URL or QR code.
        </p>
        <p className="text-sm text-gray-500">
          Waiting for pairing...
        </p>
      </div>
    </main>
  );
}
