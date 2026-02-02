import { useState, useMemo } from 'react';

// Tool activity types
interface ToolActivity {
  type: 'tool_use' | 'tool_result';
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  timestamp: number;
}

interface StreamingResponseProps {
  thinking?: string;
  activity?: ToolActivity[];
  content?: string;
  isStreaming?: boolean;
  task?: string;
  startedAt?: string;
  completedAt?: string;
}

// Tool category colors and icons
const toolConfig: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  Read: { icon: '📄', color: 'text-cyan-400', bg: 'bg-cyan-950/30', border: 'border-cyan-500/50' },
  Write: { icon: '✏️', color: 'text-green-400', bg: 'bg-green-950/30', border: 'border-green-500/50' },
  Edit: { icon: '🔧', color: 'text-green-400', bg: 'bg-green-950/30', border: 'border-green-500/50' },
  Bash: { icon: '💻', color: 'text-yellow-400', bg: 'bg-yellow-950/30', border: 'border-yellow-500/50' },
  Glob: { icon: '🔍', color: 'text-purple-400', bg: 'bg-purple-950/30', border: 'border-purple-500/50' },
  Grep: { icon: '🔎', color: 'text-purple-400', bg: 'bg-purple-950/30', border: 'border-purple-500/50' },
  Task: { icon: '🤖', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-500/50' },
  WebFetch: { icon: '🌐', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-500/50' },
  WebSearch: { icon: '🔍', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-500/50' },
  TodoWrite: { icon: '📝', color: 'text-orange-400', bg: 'bg-orange-950/30', border: 'border-orange-500/50' },
  AskUserQuestion: { icon: '❓', color: 'text-pink-400', bg: 'bg-pink-950/30', border: 'border-pink-500/50' },
};

const defaultToolConfig = { icon: '⚙️', color: 'text-gray-400', bg: 'bg-gray-800/50', border: 'border-gray-600/50' };

function getToolConfig(tool: string) {
  return toolConfig[tool] || defaultToolConfig;
}

// Format elapsed time
function formatElapsedTime(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const elapsed = Math.floor((end - start) / 1000);

  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${seconds}s`;
}

// Compact tool display for file operations
function FileToolCard({ tool, input, result, isLatest }: {
  tool: string;
  input: Record<string, unknown>;
  result?: { output?: string; error?: string };
  isLatest?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = getToolConfig(tool);
  const filePath = String(input.file_path || '');
  const fileName = filePath.split('/').slice(-2).join('/');

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} overflow-hidden ${isLatest ? 'ring-1 ring-blue-500/50' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-lg">{config.icon}</span>
        <span className={`font-medium text-sm ${config.color}`}>{tool}</span>
        <span className="text-xs text-gray-400 truncate flex-1">{fileName}</span>
        {result?.error ? (
          <span className="text-xs text-red-400">failed</span>
        ) : result ? (
          <span className="text-xs text-green-400">done</span>
        ) : isLatest ? (
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        ) : null}
        <span className={`text-xs text-gray-500 transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-700/50 p-3 space-y-2">
          {tool === 'Edit' && input.old_string && (
            <div className="space-y-2">
              <div>
                <div className="text-xs text-red-400 mb-1 flex items-center gap-1">
                  <span className="font-bold">−</span> Removed
                </div>
                <pre className="p-2 bg-red-950/40 border-l-2 border-red-500 rounded text-xs text-red-200 whitespace-pre-wrap overflow-x-auto max-h-32">
                  {String(input.old_string).substring(0, 500)}
                  {String(input.old_string).length > 500 && <span className="text-red-400/50">...</span>}
                </pre>
              </div>
              <div>
                <div className="text-xs text-green-400 mb-1 flex items-center gap-1">
                  <span className="font-bold">+</span> Added
                </div>
                <pre className="p-2 bg-green-950/40 border-l-2 border-green-500 rounded text-xs text-green-200 whitespace-pre-wrap overflow-x-auto max-h-32">
                  {String(input.new_string || '').substring(0, 500)}
                  {String(input.new_string || '').length > 500 && <span className="text-green-400/50">...</span>}
                </pre>
              </div>
            </div>
          )}

          {tool === 'Write' && input.content && (
            <div>
              <div className="text-xs text-green-400 mb-1">New file content</div>
              <pre className="p-2 bg-green-950/40 border-l-2 border-green-500 rounded text-xs text-green-200 whitespace-pre-wrap overflow-x-auto max-h-32">
                {String(input.content).substring(0, 500)}
                {String(input.content).length > 500 && <span className="text-green-400/50">...</span>}
              </pre>
            </div>
          )}

          {tool === 'Read' && result?.output && (
            <pre className="p-2 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-32">
              {result.output.substring(0, 500)}
              {result.output.length > 500 && <span className="text-gray-500">...</span>}
            </pre>
          )}

          {result?.error && (
            <div className="text-xs text-red-400 bg-red-950/30 p-2 rounded">
              {result.error.substring(0, 200)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Bash command display
function BashToolCard({ input, result, isLatest }: {
  input: Record<string, unknown>;
  result?: { output?: string; error?: string };
  isLatest?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const command = String(input.command || '');
  const description = input.description ? String(input.description) : null;

  return (
    <div className={`rounded-lg border border-yellow-500/50 bg-yellow-950/20 overflow-hidden ${isLatest ? 'ring-1 ring-blue-500/50' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">💻</span>
          <span className="font-medium text-sm text-yellow-400">Bash</span>
          {description && <span className="text-xs text-gray-400">{description}</span>}
          <div className="flex-1" />
          {result?.error ? (
            <span className="text-xs text-red-400">failed</span>
          ) : result ? (
            <span className="text-xs text-green-400">done</span>
          ) : isLatest ? (
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          ) : null}
          <span className={`text-xs text-gray-500 transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        </div>
        <pre className="text-xs text-yellow-200 font-mono truncate">
          <span className="text-yellow-500">$</span> {command.substring(0, 60)}{command.length > 60 ? '...' : ''}
        </pre>
      </button>

      {expanded && (
        <div className="border-t border-yellow-700/30 p-3 space-y-2">
          <pre className="p-2 bg-gray-950 rounded text-xs text-yellow-200 font-mono whitespace-pre-wrap overflow-x-auto">
            <span className="text-yellow-500">$</span> {command}
          </pre>
          {result?.output && (
            <pre className="p-2 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-48">
              {result.output.substring(0, 1000)}
              {result.output.length > 1000 && <span className="text-gray-500">... ({result.output.length - 1000} more)</span>}
            </pre>
          )}
          {result?.error && (
            <div className="text-xs text-red-400 bg-red-950/30 p-2 rounded">
              {result.error.substring(0, 300)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Search tool display (Glob/Grep)
function SearchToolCard({ tool, input, result, isLatest }: {
  tool: string;
  input: Record<string, unknown>;
  result?: { output?: string; error?: string };
  isLatest?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = getToolConfig(tool);
  const pattern = String(input.pattern || '');
  const path = input.path ? String(input.path) : null;

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} overflow-hidden ${isLatest ? 'ring-1 ring-blue-500/50' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-lg">{config.icon}</span>
        <span className={`font-medium text-sm ${config.color}`}>{tool}</span>
        <code className="text-xs text-purple-300 bg-purple-950/50 px-1.5 py-0.5 rounded truncate">
          {pattern.substring(0, 30)}{pattern.length > 30 ? '...' : ''}
        </code>
        {path && <span className="text-xs text-gray-500 truncate">in {path.split('/').slice(-2).join('/')}</span>}
        <div className="flex-1" />
        {result?.error ? (
          <span className="text-xs text-red-400">failed</span>
        ) : result ? (
          <span className="text-xs text-green-400">done</span>
        ) : isLatest ? (
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        ) : null}
        <span className={`text-xs text-gray-500 transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {expanded && result?.output && (
        <div className="border-t border-gray-700/50 p-3">
          <pre className="p-2 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-48">
            {result.output.substring(0, 1000)}
            {result.output.length > 1000 && <span className="text-gray-500">...</span>}
          </pre>
        </div>
      )}
    </div>
  );
}

// Generic tool card for other tools
function GenericToolCard({ tool, input, result, isLatest }: {
  tool: string;
  input: Record<string, unknown>;
  result?: { output?: string; error?: string };
  isLatest?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = getToolConfig(tool);

  // Get a summary of the input
  const getSummary = () => {
    if (tool === 'WebSearch' && input.query) return `"${String(input.query).substring(0, 40)}"`;
    if (tool === 'WebFetch' && input.url) return String(input.url).substring(0, 50);
    if (tool === 'Task' && input.prompt) return String(input.prompt).substring(0, 50) + '...';
    return null;
  };

  const summary = getSummary();

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} overflow-hidden ${isLatest ? 'ring-1 ring-blue-500/50' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-lg">{config.icon}</span>
        <span className={`font-medium text-sm ${config.color}`}>{tool}</span>
        {summary && <span className="text-xs text-gray-400 truncate flex-1">{summary}</span>}
        {!summary && <div className="flex-1" />}
        {result?.error ? (
          <span className="text-xs text-red-400">failed</span>
        ) : result ? (
          <span className="text-xs text-green-400">done</span>
        ) : isLatest ? (
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        ) : null}
        <span className={`text-xs text-gray-500 transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-700/50 p-3 space-y-2">
          <pre className="p-2 bg-gray-900 rounded text-xs text-gray-400 whitespace-pre-wrap overflow-x-auto max-h-32">
            {JSON.stringify(input, null, 2).substring(0, 500)}
          </pre>
          {result?.output && (
            <pre className="p-2 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-32">
              {result.output.substring(0, 500)}
            </pre>
          )}
          {result?.error && (
            <div className="text-xs text-red-400 bg-red-950/30 p-2 rounded">
              {result.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Render appropriate tool card based on tool type
function ToolCard({ tool, input, result, isLatest }: {
  tool: string;
  input: Record<string, unknown>;
  result?: { output?: string; error?: string };
  isLatest?: boolean;
}) {
  if (['Read', 'Write', 'Edit'].includes(tool)) {
    return <FileToolCard tool={tool} input={input} result={result} isLatest={isLatest} />;
  }
  if (tool === 'Bash') {
    return <BashToolCard input={input} result={result} isLatest={isLatest} />;
  }
  if (['Glob', 'Grep'].includes(tool)) {
    return <SearchToolCard tool={tool} input={input} result={result} isLatest={isLatest} />;
  }
  return <GenericToolCard tool={tool} input={input} result={result} isLatest={isLatest} />;
}

// Parse activity into paired tool uses and results
function parseActivityPairs(activity: ToolActivity[]) {
  const pairs: Array<{
    tool: string;
    input: Record<string, unknown>;
    result?: { output?: string; error?: string };
    timestamp: number;
  }> = [];

  let pendingToolUse: { tool: string; input: Record<string, unknown>; timestamp: number } | null = null;

  for (const item of activity) {
    if (item.type === 'tool_use') {
      // If there's a pending tool use without result, add it
      if (pendingToolUse) {
        pairs.push(pendingToolUse);
      }
      pendingToolUse = { tool: item.tool, input: item.input || {}, timestamp: item.timestamp };
    } else if (item.type === 'tool_result' && pendingToolUse) {
      pairs.push({
        ...pendingToolUse,
        result: { output: item.output, error: item.error },
      });
      pendingToolUse = null;
    }
  }

  // Add any remaining pending tool use
  if (pendingToolUse) {
    pairs.push(pendingToolUse);
  }

  return pairs;
}

// Split text into paragraphs for better readability
function TextBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  // Split on double newlines to create paragraphs
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  if (paragraphs.length === 0) return null;

  return (
    <div className="space-y-3">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
          {para}
          {isStreaming && i === paragraphs.length - 1 && (
            <span className="inline-block w-2 h-4 bg-blue-400 ml-0.5 animate-pulse" />
          )}
        </p>
      ))}
    </div>
  );
}

// Thinking indicator
function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!thinking) return null;

  return (
    <div className="border-l-2 border-gray-600 pl-3 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="italic">Thinking</span>
        {isStreaming && <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-pulse" />}
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-gray-500 italic whitespace-pre-wrap max-h-32 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  );
}

// Main streaming response component
export default function StreamingResponse({
  thinking,
  activity = [],
  content,
  isStreaming = false,
  task,
  startedAt,
  completedAt,
}: StreamingResponseProps) {
  // Parse tool activity
  const toolPairs = useMemo(() => parseActivityPairs(activity), [activity]);

  // Calculate elapsed time
  const elapsedTime = startedAt ? formatElapsedTime(startedAt, isStreaming ? undefined : completedAt) : '';

  // Determine current phase
  const phase = useMemo(() => {
    if (!isStreaming) return 'done';
    if (content) return 'responding';
    if (activity.length > 0) return 'working';
    if (thinking) return 'thinking';
    return 'starting';
  }, [isStreaming, content, activity.length, thinking]);

  const phaseLabels: Record<string, { label: string; color: string }> = {
    starting: { label: 'Starting...', color: 'text-gray-400' },
    thinking: { label: 'Thinking...', color: 'text-gray-400' },
    working: { label: 'Working...', color: 'text-blue-400' },
    responding: { label: 'Responding...', color: 'text-green-400' },
    done: { label: 'Done', color: 'text-gray-500' },
  };

  const currentPhase = phaseLabels[phase];

  return (
    <div className="bg-gray-800/40 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-800/60 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isStreaming ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              <span className={`text-sm font-medium ${currentPhase.color}`}>{currentPhase.label}</span>
            </div>
          ) : (
            <span className="text-sm text-gray-500">Response</span>
          )}
          {task && (
            <span className="text-xs text-gray-500 truncate" title={task}>
              {task.length > 50 ? task.substring(0, 50) + '...' : task}
            </span>
          )}
        </div>
        {elapsedTime && (
          <span className="text-xs text-gray-500 tabular-nums shrink-0">{elapsedTime}</span>
        )}
      </div>

      {/* Content area */}
      <div className="p-4 space-y-4">
        {/* Thinking (collapsed by default) */}
        {thinking && <ThinkingBlock thinking={thinking} isStreaming={isStreaming && phase === 'thinking'} />}

        {/* Tool activity */}
        {toolPairs.length > 0 && (
          <div className="space-y-2">
            {toolPairs.map((pair, i) => (
              <ToolCard
                key={i}
                tool={pair.tool}
                input={pair.input}
                result={pair.result}
                isLatest={isStreaming && i === toolPairs.length - 1 && !pair.result}
              />
            ))}
          </div>
        )}

        {/* Response text */}
        {content && (
          <div className="pt-2">
            <TextBlock text={content} isStreaming={isStreaming && phase === 'responding'} />
          </div>
        )}

        {/* Loading state when nothing to show yet */}
        {isStreaming && !thinking && toolPairs.length === 0 && !content && (
          <div className="flex items-center justify-center py-4">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:0.1s]" />
              <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type { ToolActivity };
