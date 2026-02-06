export interface ToolActivity {
  type: 'tool_use' | 'tool_result';
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  timestamp: number;
}
