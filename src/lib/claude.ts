import { spawn, ChildProcess } from "child_process";

export interface ToolUseEvent {
  tool: string;
  id?: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  tool: string;
  output?: string;
  error?: string;
}

export interface ClaudeEvent {
  type:
    | "thinking"
    | "text"
    | "error"
    | "done"
    | "session_init"
    | "status"
    | "tool_use"
    | "tool_result";
  text?: string;
  sessionId?: string;
  toolUse?: ToolUseEvent;
  toolResult?: ToolResultEvent;
}

export function spawnClaude(
  message: string,
  onEvent: (event: ClaudeEvent) => void,
  signal?: AbortSignal,
  sessionId?: string | null,
  workingDirectory?: string,
): ChildProcess {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];

  if (sessionId) {
    // Resume existing session
    args.push("--resume", sessionId, "-p", message);
    console.log("[claude] Resuming session:", sessionId);
  } else {
    // New session
    args.push("-p", message);
    console.log("[claude] Starting new session");
  }

  console.log("=".repeat(60));
  console.log("[claude] SPAWNING PROCESS");
  console.log("[claude] Command: claude", args.join(" "));
  console.log("[claude] Full args array:", JSON.stringify(args));
  console.log("[claude] Message:", message);
  console.log("[claude] Working directory:", workingDirectory || "(current)");
  console.log("=".repeat(60));

  const proc = spawn("claude", args, {
    stdio: ["ignore", "pipe", "pipe"], // ignore stdin, pipe stdout/stderr
    cwd: workingDirectory,
  });

  console.log("[claude] Process spawned, PID:", proc.pid);

  if (!proc.pid) {
    const err = "[claude] FATAL: No PID - process failed to spawn!";
    console.error(err);
    throw new Error(err);
  }

  console.log("[claude] stdin ignored (not piped)");

  // TIMEOUT: If no output after 10 seconds, something is wrong
  let receivedOutput = false;
  const timeout = setTimeout(() => {
    if (!receivedOutput) {
      const err = `[claude] FATAL: No output received after 10 seconds! Process may be hung. PID: ${proc.pid}`;
      console.error(err);
      console.error("[claude] Killing hung process...");
      proc.kill("SIGKILL");
      onEvent({ type: "error", text: err });
      onEvent({ type: "done" });
    }
  }, 10000);

  const markOutputReceived = () => {
    if (!receivedOutput) {
      receivedOutput = true;
      clearTimeout(timeout);
      console.log("[claude] First output received, timeout cleared");
    }
  };

  let buffer = "";
  let sentAnyText = false;
  let sentDone = false;

  const processLine = (line: string) => {
    if (!line.trim()) return;

    console.log("[claude] Raw line:", line.substring(0, 150));

    let data;
    try {
      data = JSON.parse(line);
    } catch (err) {
      console.error(
        "[claude] Failed to parse JSON line:",
        line.substring(0, 100),
        err,
      );
      return;
    }

    console.log("[claude] Parsed event type:", data.type, data.subtype || "");

    // Handle the actual Claude CLI stream-json format
    if (data.type === "system" && data.subtype === "init") {
      const newSessionId = data.session_id;
      console.log("[claude] Session initialized, ID:", newSessionId);
      if (newSessionId) {
        onEvent({ type: "session_init", sessionId: newSessionId });
      }
    } else if (data.type === "system" && data.subtype === "status") {
      console.log("[claude] Status:", data.status);
      onEvent({ type: "status", text: data.status });
    } else if (data.type === "assistant" && data.message) {
      // Extract content from the message
      const content = data.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            console.log("[claude] Sending thinking");
            onEvent({ type: "thinking", text: block.thinking });
          } else if (block.type === "text" && block.text) {
            console.log("[claude] Sending text");
            onEvent({ type: "text", text: block.text });
            sentAnyText = true;
          } else if (block.type === "tool_use") {
            // Send full tool use event
            const toolName = block.name || "unknown";
            const toolUseId = block.id || "";
            const input = block.input || {};

            console.log("[claude] Tool use:", toolName, "id:", toolUseId);
            onEvent({
              type: "tool_use",
              toolUse: {
                tool: toolName,
                id: toolUseId,
                input: input as Record<string, unknown>,
              },
            });
          }
        }
      }
    } else if (data.type === "user" && data.message) {
      // Tool results
      const content = data.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            console.log("[claude] Tool result received");
            // Extract tool result content
            let output = "";
            if (typeof block.content === "string") {
              output = block.content;
            } else if (Array.isArray(block.content)) {
              output = block.content
                .filter((c: { type: string }) => c.type === "text")
                .map((c: { text: string }) => c.text)
                .join("\n");
            }

            onEvent({
              type: "tool_result",
              toolResult: {
                tool: block.tool_use_id || "unknown",
                output: output.substring(0, 5000), // Limit size
                error: block.is_error ? output : undefined,
              },
            });
          }
        }
      }
    } else if (data.type === "result") {
      console.log(
        "[claude] Result received, sentAnyText:",
        sentAnyText,
        "sentDone:",
        sentDone,
      );
      // Only send result text if we haven't sent any text blocks yet
      // (avoids duplication for simple responses)
      if (!sentAnyText && data.result && typeof data.result === "string") {
        console.log("[claude] Sending final result text (no prior text sent)");
        onEvent({ type: "text", text: data.result });
      }
      if (!sentDone) {
        sentDone = true;
        onEvent({ type: "done" });
      }
    }
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    markOutputReceived();
    const text = chunk.toString();
    console.log("[claude] STDOUT received, length:", text.length);
    console.log("[claude] STDOUT content:", text.substring(0, 200));
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    markOutputReceived();
    const text = chunk.toString();
    console.error("[claude] STDERR:", text);
    onEvent({ type: "error", text });
  });

  proc.on("close", (code, signal) => {
    clearTimeout(timeout);
    console.log(
      "[claude] CLOSED - code:",
      code,
      "signal:",
      signal,
      "sentDone:",
      sentDone,
    );
    if (buffer.trim()) {
      processLine(buffer);
    }
    if (code !== 0 && code !== null) {
      const err = `[claude] FATAL: Process exited with code ${code}, signal: ${signal}`;
      console.error(err);
      onEvent({ type: "error", text: err });
    }
    if (!sentDone) {
      sentDone = true;
      onEvent({ type: "done" });
    }
  });

  proc.on("error", (err) => {
    clearTimeout(timeout);
    const msg = `[claude] FATAL PROCESS ERROR: ${err.message}`;
    console.error(msg, err);
    onEvent({ type: "error", text: msg });
    onEvent({ type: "done" });
  });

  proc.on("spawn", () => {
    console.log("[claude] SPAWN EVENT - process started successfully");
  });

  proc.on("disconnect", () => {
    console.log("[claude] DISCONNECT EVENT");
  });

  proc.on("exit", (code, signal) => {
    console.log("[claude] EXIT EVENT - code:", code, "signal:", signal);
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      proc.kill("SIGTERM");
    });
  }

  return proc;
}
