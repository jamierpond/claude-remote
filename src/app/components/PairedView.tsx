'use client';

import { useState } from 'react';

interface Props {
  deviceId: string;
  pairedAt: string;
}

export default function PairedView({ deviceId, pairedAt }: Props) {
  const [unpairing, setUnpairing] = useState(false);

  const handleUnpair = async () => {
    setUnpairing(true);
    try {
      const res = await fetch('/unpair', { method: 'POST' });
      if (res.ok) {
        // Clear client-side storage too
        localStorage.removeItem('claude-remote-paired');
        localStorage.removeItem('claude-remote-device-id');
        localStorage.removeItem('claude-remote-private-key');
        localStorage.removeItem('claude-remote-server-public-key');
        window.location.reload();
      }
    } catch {
      setUnpairing(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="text-center">
        <div className="text-6xl mb-4">&#x2713;</div>
        <h1 className="text-2xl font-bold mb-2">Device Paired</h1>
        <p className="text-gray-400 mb-4">
          Your device is connected and ready.
        </p>
        <p className="text-sm text-gray-500">
          Device ID: {deviceId}
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Paired: {new Date(pairedAt).toLocaleDateString()}
        </p>

        <div className="flex flex-col gap-3">
          <a
            href="/chat"
            className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Open Chat
          </a>
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
