import { useState, useMemo } from 'react';

// Tool activity types
export interface ToolActivity {
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

// Render inline formatting (bold, italic, code, links)
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-semibold text-white">{boldMatch[2]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)([^*_]+)\1/);
    if (italicMatch) {
      parts.push(<em key={key++} className="italic text-gray-300">{italicMatch[2]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 bg-gray-900 rounded text-sm font-mono text-cyan-300">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline decoration-blue-400/50 hover:decoration-blue-300 underline-offset-2">
          {linkMatch[1]}
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.25-1.25a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V6.31l-5.72 5.72a.75.75 0 11-1.06-1.06l5.72-5.72h-2.69a.75.75 0 01-.75-.75z" clipRule="evenodd" />
          </svg>
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bare URL: https://... or http://...
    const urlMatch = remaining.match(/^(https?:\/\/[^\s<>)"']+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      // Clean trailing punctuation that's likely not part of URL
      const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
      const trailingPunct = url.slice(cleanUrl.length);
      // Show shortened display text for long URLs
      const displayUrl = cleanUrl.length > 40
        ? cleanUrl.slice(0, 35) + '...'
        : cleanUrl;
      parts.push(
        <a key={key++} href={cleanUrl} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline decoration-blue-400/50 hover:decoration-blue-300 underline-offset-2 break-all">
          {displayUrl}
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.25-1.25a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V6.31l-5.72 5.72a.75.75 0 11-1.06-1.06l5.72-5.72h-2.69a.75.75 0 01-.75-.75z" clipRule="evenodd" />
          </svg>
        </a>
      );
      if (trailingPunct) parts.push(trailingPunct);
      remaining = remaining.slice(url.length);
      continue;
    }

    // Regular text until next special char or URL
    const nextSpecial = remaining.search(/[*_`\[]|https?:\/\//);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Special char that didn't match a pattern - treat as literal
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts;
}

// Parse and render markdown-like content
function TextBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```lang ... ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <div key={key++} className="my-2">
          {lang && <div className="text-xs text-gray-500 mb-1">{lang}</div>}
          <pre className="p-3 bg-gray-900 rounded-lg overflow-x-auto text-sm font-mono text-gray-300 border border-gray-700">
            {codeLines.join('\n')}
          </pre>
        </div>
      );
      continue;
    }

    // Header: # ## ### etc
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const headerText = headerMatch[2];
      const sizes = ['text-xl font-bold', 'text-lg font-bold', 'text-base font-semibold', 'text-sm font-semibold'];
      elements.push(
        <div key={key++} className={`${sizes[level - 1]} text-white mt-3 mb-2`}>
          {renderInline(headerText)}
        </div>
      );
      i++;
      continue;
    }

    // Bullet list: - or * or •
    if (/^[\-\*•]\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[\-\*•]\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^[\-\*•]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc list-inside space-y-1 my-2 text-sm text-gray-200">
          {listItems.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list: 1. 2. etc
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="list-decimal list-inside space-y-1 my-2 text-sm text-gray-200">
          {listItems.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph - collect consecutive non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') &&
           !lines[i].match(/^#{1,4}\s/) && !/^[\-\*•]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={key++} className="text-sm text-gray-200 leading-relaxed my-2">
          {renderInline(paraLines.join(' '))}
        </p>
      );
    }
  }

  // Add streaming cursor to the last element
  if (isStreaming && elements.length > 0) {
    const cursor = <span key="cursor" className="inline-block w-2 h-4 bg-blue-400 ml-0.5 animate-pulse" />;
    const last = elements[elements.length - 1];
    // Wrap last element with cursor
    elements[elements.length - 1] = (
      <span key={`last-${key}`} className="contents">
        {last}
        {cursor}
      </span>
    );
  }

  if (elements.length === 0) return null;

  return <div className="space-y-1">{elements}</div>;
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

// Main streaming response component (text only - tools shown in ToolStack)
export default function StreamingResponse({
  thinking,
  activity = [],
  content,
  isStreaming = false,
  task,
  startedAt,
  completedAt,
}: StreamingResponseProps) {
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

        {/* Response text */}
        {content && (
          <div>
            <TextBlock text={content} isStreaming={isStreaming && phase === 'responding'} />
          </div>
        )}

        {/* Loading state when nothing to show yet */}
        {isStreaming && !thinking && !content && (
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
