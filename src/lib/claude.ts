import { spawn, ChildProcess } from 'child_process';

export interface ClaudeEvent {
  type: 'thinking' | 'text' | 'error' | 'done';
  text?: string;
}

export function spawnClaude(
  message: string,
  onEvent: (event: ClaudeEvent) => void,
  signal?: AbortSignal
): ChildProcess {
  const args = ['--print', '--output-format', 'stream-json', '--verbose', '-p', message];

  console.log('='.repeat(60));
  console.log('[claude] SPAWNING PROCESS');
  console.log('[claude] Command: claude', args.join(' '));
  console.log('[claude] Full args array:', JSON.stringify(args));
  console.log('[claude] Message:', message);
  console.log('='.repeat(60));

  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  console.log('[claude] Process spawned, PID:', proc.pid);

  if (!proc.pid) {
    console.error('[claude] FATAL: No PID - process failed to spawn!');
    onEvent({ type: 'error', text: 'Failed to spawn claude process' });
    onEvent({ type: 'done' });
  }

  let buffer = '';
  let currentType: 'thinking' | 'text' | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;

    console.log('[claude] Raw line:', line.substring(0, 150));

    let data;
    try {
      data = JSON.parse(line);
    } catch (err) {
      console.error('[claude] Failed to parse JSON line:', line.substring(0, 100), err);
      return;
    }

    console.log('[claude] Parsed event type:', data.type, data.subtype || '');

    // Handle the actual Claude CLI stream-json format
    if (data.type === 'system' && data.subtype === 'init') {
      console.log('[claude] Session initialized');
    } else if (data.type === 'assistant' && data.message) {
      // Extract text content from the message
      const content = data.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'thinking' && block.thinking) {
            console.log('[claude] Sending thinking');
            onEvent({ type: 'thinking', text: block.thinking });
          } else if (block.type === 'text' && block.text) {
            console.log('[claude] Sending text');
            onEvent({ type: 'text', text: block.text });
          }
        }
      }
    } else if (data.type === 'result') {
      console.log('[claude] Result received, sending done');
      onEvent({ type: 'done' });
    }
  };

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    console.log('[claude] stdout chunk received, length:', text.length);
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(processLine);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    console.error('[claude] stderr:', text);
    if (text.trim()) {
      onEvent({ type: 'error', text });
    }
  });

  proc.on('close', (code) => {
    console.log('[claude] Process closed with code:', code);
    if (buffer.trim()) {
      processLine(buffer);
    }
    if (code !== 0 && code !== null) {
      console.error('[claude] Non-zero exit code:', code);
      onEvent({ type: 'error', text: `Process exited with code ${code}` });
    }
    onEvent({ type: 'done' });
  });

  proc.on('error', (err) => {
    console.error('[claude] Process error:', err);
    onEvent({ type: 'error', text: err.message });
    onEvent({ type: 'done' });
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });
  }

  return proc;
}
