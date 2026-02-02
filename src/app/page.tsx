import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { loadDevice, loadServerState } from '@/lib/store';

export const dynamic = 'force-dynamic';

async function generateQRDataURL(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

export default async function Home() {
  const device = loadDevice();
  const serverState = loadServerState();
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3001';
  const protocol = headersList.get('x-forwarded-proto') || 'http';

  if (device) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">&#x2713;</div>
          <h1 className="text-2xl font-bold mb-2">Device Paired</h1>
          <p className="text-gray-400 mb-4">
            Your device is connected and ready.
          </p>
          <p className="text-sm text-gray-500">
            Device ID: {device.id}
          </p>
          <p className="text-sm text-gray-500">
            Paired: {new Date(device.createdAt).toLocaleDateString()}
          </p>
        </div>
      </main>
    );
  }

  if (!serverState?.pairingToken) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="text-gray-400">No pairing token available. Restart the server.</p>
        </div>
      </main>
    );
  }

  const pairUrl = `${protocol}://${host}/pair/${serverState.pairingToken}`;
  const qrDataUrl = await generateQRDataURL(pairUrl);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
        <p className="text-gray-400 mb-6">Scan to pair your device</p>
        <div className="bg-white p-4 rounded-lg inline-block mb-6">
          <img src={qrDataUrl} alt="Pairing QR Code" className="w-64 h-64" />
        </div>
        <p className="text-sm text-gray-500 max-w-md break-all">
          {pairUrl}
        </p>
      </div>
    </main>
  );
}
