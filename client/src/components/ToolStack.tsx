import { useState, useEffect, useRef } from 'react';
import type { ToolActivity } from './StreamingResponse';

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

// Format timestamp as relative time or HH:MM:SS
function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 5) return 'now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;

  // Fall back to absolute time
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour12: false });
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

  if (pendingToolUse) {
    pairs.push(pendingToolUse);
  }

  return pairs;
}

// Compact tool card for the stack
function StackToolCard({ tool, input, result, timestamp, isLatest }: {
  tool: string;
  input: Record<string, unknown>;
  result?: { output?: string; error?: string };
  timestamp: number;
  isLatest?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = getToolConfig(tool);

  // Get a summary based on tool type
  const getSummary = () => {
    if (['Read', 'Write', 'Edit'].includes(tool) && input.file_path) {
      return String(input.file_path).split('/').slice(-2).join('/');
    }
    if (tool === 'Bash' && input.command) {
      const cmd = String(input.command);
      return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
    }
    if (['Glob', 'Grep'].includes(tool) && input.pattern) {
      return String(input.pattern).substring(0, 30);
    }
    if (tool === 'WebSearch' && input.query) {
      return `"${String(input.query).substring(0, 30)}"`;
    }
    if (tool === 'Task' && input.prompt) {
      return String(input.prompt).substring(0, 40) + '...';
    }
    return null;
  };

  const summary = getSummary();

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} overflow-hidden ${isLatest ? 'ring-1 ring-blue-500/50' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-base">{config.icon}</span>
        <span className={`font-medium text-xs ${config.color}`}>{tool}</span>
        {summary && (
          <span className="text-xs text-gray-400 truncate flex-1 font-mono">{summary}</span>
        )}
        {!summary && <div className="flex-1" />}

        {/* Status indicator */}
        {result?.error ? (
          <span className="text-xs text-red-400">err</span>
        ) : result ? (
          <span className="text-xs text-green-400">ok</span>
        ) : isLatest ? (
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        ) : null}

        {/* Timestamp */}
        <span className="text-xs text-gray-500 tabular-nums">{formatTimestamp(timestamp)}</span>

        {/* Expand arrow */}
        <span className={`text-xs text-gray-500 transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-700/50 p-3 space-y-2 text-xs">
          {/* Edit diff view */}
          {tool === 'Edit' && input.old_string && (
            <div className="space-y-2">
              <div>
                <div className="text-red-400 mb-1 flex items-center gap-1">
                  <span className="font-bold">−</span> Removed
                </div>
                <pre className="p-2 bg-red-950/40 border-l-2 border-red-500 rounded text-red-200 whitespace-pre-wrap overflow-x-auto max-h-24">
                  {String(input.old_string).substring(0, 300)}
                  {String(input.old_string).length > 300 && <span className="text-red-400/50">...</span>}
                </pre>
              </div>
              <div>
                <div className="text-green-400 mb-1 flex items-center gap-1">
                  <span className="font-bold">+</span> Added
                </div>
                <pre className="p-2 bg-green-950/40 border-l-2 border-green-500 rounded text-green-200 whitespace-pre-wrap overflow-x-auto max-h-24">
                  {String(input.new_string || '').substring(0, 300)}
                  {String(input.new_string || '').length > 300 && <span className="text-green-400/50">...</span>}
                </pre>
              </div>
            </div>
          )}

          {/* Write content */}
          {tool === 'Write' && input.content && (
            <pre className="p-2 bg-green-950/40 border-l-2 border-green-500 rounded text-green-200 whitespace-pre-wrap overflow-x-auto max-h-24">
              {String(input.content).substring(0, 300)}
              {String(input.content).length > 300 && <span className="text-green-400/50">...</span>}
            </pre>
          )}

          {/* Bash command */}
          {tool === 'Bash' && input.command && (
            <pre className="p-2 bg-gray-950 rounded text-yellow-200 font-mono whitespace-pre-wrap overflow-x-auto">
              <span className="text-yellow-500">$</span> {String(input.command)}
            </pre>
          )}

          {/* Result output */}
          {result?.output && (
            <pre className="p-2 bg-gray-900 rounded text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-24">
              {result.output.substring(0, 300)}
              {result.output.length > 300 && <span className="text-gray-500">...</span>}
            </pre>
          )}

          {/* Error */}
          {result?.error && (
            <div className="text-red-400 bg-red-950/30 p-2 rounded">
              {result.error.substring(0, 200)}
            </div>
          )}

          {/* Generic input for other tools */}
          {!['Read', 'Write', 'Edit', 'Bash'].includes(tool) && Object.keys(input).length > 0 && (
            <pre className="p-2 bg-gray-900 rounded text-gray-400 whitespace-pre-wrap overflow-x-auto max-h-24">
              {JSON.stringify(input, null, 2).substring(0, 300)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface ToolStackProps {
  activity: ToolActivity[];
  isStreaming: boolean;
}

export default function ToolStack({ activity, isStreaming }: ToolStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolPairs = parseActivityPairs(activity);

  // Auto-scroll to bottom when new tools arrive
  useEffect(() => {
    if (scrollRef.current && toolPairs.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolPairs.length]);

  // Don't render if no tools
  if (toolPairs.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-gray-700 bg-gray-900/80">
      {/* Header */}
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-gray-800">
        <span className="text-xs text-gray-500 font-medium">Tools</span>
        <span className="text-xs text-gray-600">({toolPairs.length})</span>
        {isStreaming && (
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        )}
      </div>

      {/* Scrollable tool list */}
      <div
        ref={scrollRef}
        className="max-h-[30vh] overflow-y-auto px-3 py-2 space-y-1.5"
      >
        {toolPairs.map((pair, i) => (
          <StackToolCard
            key={i}
            tool={pair.tool}
            input={pair.input}
            result={pair.result}
            timestamp={pair.timestamp}
            isLatest={isStreaming && i === toolPairs.length - 1 && !pair.result}
          />
        ))}
      </div>
    </div>
  );
}
