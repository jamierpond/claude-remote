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
  const proc = spawn('claude', ['--print', '--output-format', 'stream-json', '-p', message], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let currentType: 'thinking' | 'text' | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;

    try {
      const data = JSON.parse(line);

      if (data.type === 'content_block_start') {
        if (data.content_block?.type === 'thinking') {
          currentType = 'thinking';
        } else if (data.content_block?.type === 'text') {
          currentType = 'text';
        }
      } else if (data.type === 'content_block_delta') {
        if (data.delta?.type === 'thinking_delta' && data.delta.thinking) {
          onEvent({ type: 'thinking', text: data.delta.thinking });
        } else if (data.delta?.type === 'text_delta' && data.delta.text) {
          onEvent({ type: 'text', text: data.delta.text });
        }
      } else if (data.type === 'content_block_stop') {
        currentType = null;
      } else if (data.type === 'message_stop') {
        onEvent({ type: 'done' });
      }
    } catch {
      // Ignore JSON parse errors for non-JSON lines
    }
  };

  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(processLine);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.trim()) {
      onEvent({ type: 'error', text });
    }
  });

  proc.on('close', (code) => {
    if (buffer.trim()) {
      processLine(buffer);
    }
    if (code !== 0 && code !== null) {
      onEvent({ type: 'error', text: `Process exited with code ${code}` });
    }
    onEvent({ type: 'done' });
  });

  proc.on('error', (err) => {
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
