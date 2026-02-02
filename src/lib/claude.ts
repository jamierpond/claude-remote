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
    stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin, pipe stdout/stderr
  });

  console.log('[claude] Process spawned, PID:', proc.pid);

  if (!proc.pid) {
    const err = '[claude] FATAL: No PID - process failed to spawn!';
    console.error(err);
    throw new Error(err);
  }

  console.log('[claude] stdin ignored (not piped)');

  // TIMEOUT: If no output after 10 seconds, something is wrong
  let receivedOutput = false;
  const timeout = setTimeout(() => {
    if (!receivedOutput) {
      const err = `[claude] FATAL: No output received after 10 seconds! Process may be hung. PID: ${proc.pid}`;
      console.error(err);
      console.error('[claude] Killing hung process...');
      proc.kill('SIGKILL');
      onEvent({ type: 'error', text: err });
      onEvent({ type: 'done' });
    }
  }, 10000);

  const markOutputReceived = () => {
    if (!receivedOutput) {
      receivedOutput = true;
      clearTimeout(timeout);
      console.log('[claude] First output received, timeout cleared');
    }
  };

  let buffer = '';

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
    markOutputReceived();
    const text = chunk.toString();
    console.log('[claude] STDOUT received, length:', text.length);
    console.log('[claude] STDOUT content:', text.substring(0, 200));
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(processLine);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    markOutputReceived();
    const text = chunk.toString();
    console.error('[claude] STDERR:', text);
    onEvent({ type: 'error', text });
  });

  proc.on('close', (code, signal) => {
    clearTimeout(timeout);
    console.log('[claude] CLOSED - code:', code, 'signal:', signal);
    if (buffer.trim()) {
      processLine(buffer);
    }
    if (code !== 0 && code !== null) {
      const err = `[claude] FATAL: Process exited with code ${code}, signal: ${signal}`;
      console.error(err);
      onEvent({ type: 'error', text: err });
    }
    onEvent({ type: 'done' });
  });

  proc.on('error', (err) => {
    clearTimeout(timeout);
    const msg = `[claude] FATAL PROCESS ERROR: ${err.message}`;
    console.error(msg, err);
    onEvent({ type: 'error', text: msg });
    onEvent({ type: 'done' });
  });

  proc.on('spawn', () => {
    console.log('[claude] SPAWN EVENT - process started successfully');
  });

  proc.on('disconnect', () => {
    console.log('[claude] DISCONNECT EVENT');
  });

  proc.on('exit', (code, signal) => {
    console.log('[claude] EXIT EVENT - code:', code, 'signal:', signal);
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });
  }

  return proc;
}
