import { NextRequest, NextResponse } from 'next/server';
import { loadDevice, loadServerState, saveDevice, saveServerState } from '@/lib/store';
import { deriveSharedSecret } from '@/lib/crypto';
import { randomBytes } from 'crypto';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const accept = request.headers.get('accept') || '';

  // If browser request, redirect to chat page with token
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL(`/chat?token=${token}`, request.url));
  }

  // API request - return server public key
  const serverState = loadServerState();
  const device = loadDevice();

  if (device) {
    return NextResponse.json({ error: 'Already paired' }, { status: 400 });
  }

  if (!serverState || serverState.pairingToken !== token) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  return NextResponse.json({
    serverPublicKey: serverState.publicKey,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const serverState = loadServerState();
  const device = loadDevice();

  if (device) {
    return NextResponse.json({ error: 'Already paired' }, { status: 400 });
  }

  if (!serverState || serverState.pairingToken !== token) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const body = await request.json();
  const { clientPublicKey } = body;

  if (!clientPublicKey) {
    return NextResponse.json({ error: 'Missing clientPublicKey' }, { status: 400 });
  }

  const sharedSecret = deriveSharedSecret(serverState.privateKey, clientPublicKey);
  const newDevice = {
    id: randomBytes(8).toString('hex'),
    publicKey: clientPublicKey,
    sharedSecret,
    createdAt: new Date().toISOString(),
  };

  saveDevice(newDevice);
  saveServerState({ ...serverState, pairingToken: null });

  return NextResponse.json({
    serverPublicKey: serverState.publicKey,
    deviceId: newDevice.id,
  });
}
