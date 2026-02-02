import { NextResponse } from 'next/server';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.config', 'claude-remote');

export async function POST() {
  const devicePath = join(CONFIG_DIR, 'device.json');

  if (existsSync(devicePath)) {
    unlinkSync(devicePath);
  }

  // Server needs restart to regenerate pairing token
  return NextResponse.json({ success: true, message: 'Device unpaired. Restart server to get new pairing token.' });
}
