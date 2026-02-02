import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../models/task.dart';
import '../models/tool_activity.dart';
import '../core/websocket.dart';
import 'auth_provider.dart';
import 'project_provider.dart';

// Per-project task state
class ProjectTaskState {
  final List<Task> messages;
  final Task? currentTask;
  final bool isStreaming;

  // Streaming buffers
  final String thinkingBuffer;
  final String textBuffer;
  final List<OutputChunk> chunks;
  final List<ToolActivity> activities;
  final String? lastTool;

  const ProjectTaskState({
    this.messages = const [],
    this.currentTask,
    this.isStreaming = false,
    this.thinkingBuffer = '',
    this.textBuffer = '',
    this.chunks = const [],
    this.activities = const [],
    this.lastTool,
  });

  ProjectTaskState copyWith({
    List<Task>? messages,
    Task? currentTask,
    bool? isStreaming,
    String? thinkingBuffer,
    String? textBuffer,
    List<OutputChunk>? chunks,
    List<ToolActivity>? activities,
    String? lastTool,
  }) {
    return ProjectTaskState(
      messages: messages ?? this.messages,
      currentTask: currentTask ?? this.currentTask,
      isStreaming: isStreaming ?? this.isStreaming,
      thinkingBuffer: thinkingBuffer ?? this.thinkingBuffer,
      textBuffer: textBuffer ?? this.textBuffer,
      chunks: chunks ?? this.chunks,
      activities: activities ?? this.activities,
      lastTool: lastTool ?? this.lastTool,
    );
  }

  ProjectTaskState clearBuffers() {
    return copyWith(
      thinkingBuffer: '',
      textBuffer: '',
      chunks: [],
      activities: [],
      lastTool: null,
    );
  }
}

// Overall task manager state
class TaskManagerState {
  final Map<String, ProjectTaskState> projectStates;
  final Set<String> streamingProjectIds;

  const TaskManagerState({
    this.projectStates = const {},
    this.streamingProjectIds = const {},
  });

  ProjectTaskState getProjectState(String projectId) {
    return projectStates[projectId] ?? const ProjectTaskState();
  }

  TaskManagerState copyWith({
    Map<String, ProjectTaskState>? projectStates,
    Set<String>? streamingProjectIds,
  }) {
    return TaskManagerState(
      projectStates: projectStates ?? this.projectStates,
      streamingProjectIds: streamingProjectIds ?? this.streamingProjectIds,
    );
  }

  TaskManagerState updateProject(String projectId, ProjectTaskState Function(ProjectTaskState) updater) {
    final newStates = Map<String, ProjectTaskState>.from(projectStates);
    newStates[projectId] = updater(getProjectState(projectId));
    return copyWith(projectStates: newStates);
  }
}

final taskManagerProvider = StateNotifierProvider<TaskManagerNotifier, TaskManagerState>((ref) {
  final authState = ref.watch(authStateProvider);
  final authNotifier = ref.watch(authStateProvider.notifier);

  return TaskManagerNotifier(
    webSocket: authNotifier.webSocket,
    isAuthenticated: authState.isAuthenticated,
    serverUrl: authState.serverUrl,
  );
});

// Convenience provider for the active project's task state
final activeTaskStateProvider = Provider<ProjectTaskState>((ref) {
  final projectState = ref.watch(projectProvider);
  final taskState = ref.watch(taskManagerProvider);

  if (projectState.activeProjectId == null) {
    return const ProjectTaskState();
  }

  return taskState.getProjectState(projectState.activeProjectId!);
});

class TaskManagerNotifier extends StateNotifier<TaskManagerState> {
  final WebSocketManager? webSocket;
  final bool isAuthenticated;
  final String? serverUrl;
  StreamSubscription? _subscription;

  TaskManagerNotifier({
    required this.webSocket,
    required this.isAuthenticated,
    this.serverUrl,
  }) : super(const TaskManagerState()) {
    if (webSocket != null && isAuthenticated) {
      _subscribe();
    }
  }

  void _subscribe() {
    _subscription = webSocket?.messageStream.listen(_handleMessage);
  }

  void _handleMessage(WebSocketMessage msg) {
    final projectId = msg.projectId;

    switch (msg.type) {
      case 'auth_ok':
        // Handle active project IDs from reconnect
        if (msg.activeProjectIds != null) {
          state = state.copyWith(
            streamingProjectIds: msg.activeProjectIds!.toSet(),
          );
          for (final id in msg.activeProjectIds!) {
            if (id != '__global__') {
              state = state.updateProject(id, (s) => s.copyWith(isStreaming: true));
            }
          }
        }
        break;

      case 'streaming_restore':
        if (projectId != null) {
          // Parse activity from restore message
          List<ToolActivity> restoredActivities = [];
          if (msg.activity != null) {
            for (final item in msg.activity!) {
              if (item is Map<String, dynamic>) {
                restoredActivities.add(ToolActivity.fromJson(item));
              }
            }
          }

          // Create a task to display the restored state
          final restoredTask = Task(
            id: 'restored-${DateTime.now().millisecondsSinceEpoch}',
            prompt: '[Restored session]',
            status: TaskStatus.running,
            startedAt: DateTime.now(),
            thinking: msg.thinking ?? '',
            outputChunks: msg.text != null && msg.text!.isNotEmpty
                ? [OutputChunk(text: msg.text!, timestamp: DateTime.now())]
                : [],
            activities: restoredActivities,
          );

          state = state.updateProject(projectId, (s) => s.copyWith(
            isStreaming: true,
            currentTask: restoredTask,
            thinkingBuffer: msg.thinking ?? '',
            textBuffer: msg.text ?? '',
            activities: restoredActivities,
          ));
        }
        break;

      case 'thinking':
        if (projectId != null) {
          state = state.updateProject(projectId, (s) {
            final newThinking = s.thinkingBuffer + (msg.text ?? '');
            return s.copyWith(
              thinkingBuffer: newThinking,
              currentTask: s.currentTask?.copyWith(thinking: newThinking),
            );
          });
        }
        break;

      case 'text':
        if (projectId != null) {
          state = state.updateProject(projectId, (s) {
            final text = msg.text ?? '';
            final newTextBuffer = s.textBuffer + text;

            // Detect if this should be a new chunk
            final isNewChunk = s.lastTool != null ||
                text.startsWith('\n\n') ||
                RegExp(r"^(Now|Next|Let me|I'll|First|Finally|Done)", caseSensitive: false)
                    .hasMatch(text.trim());

            List<OutputChunk> newChunks;
            if (isNewChunk && s.chunks.isNotEmpty) {
              newChunks = [
                ...s.chunks,
                OutputChunk(
                  text: text,
                  timestamp: DateTime.now(),
                  afterTool: s.lastTool,
                ),
              ];
            } else if (s.chunks.isEmpty) {
              newChunks = [
                OutputChunk(
                  text: text,
                  timestamp: DateTime.now(),
                ),
              ];
            } else {
              final lastChunk = s.chunks.last;
              newChunks = [
                ...s.chunks.take(s.chunks.length - 1),
                OutputChunk(
                  text: lastChunk.text + text,
                  timestamp: lastChunk.timestamp,
                  afterTool: lastChunk.afterTool,
                ),
              ];
            }

            return s.copyWith(
              textBuffer: newTextBuffer,
              chunks: newChunks,
              lastTool: isNewChunk ? null : s.lastTool,
              currentTask: s.currentTask?.copyWith(outputChunks: newChunks),
            );
          });
        }
        break;

      case 'tool_use':
        if (projectId != null && msg.toolUse != null) {
          state = state.updateProject(projectId, (s) {
            final activity = ToolActivity.fromToolUse(msg.toolUse!);
            final newActivities = [...s.activities, activity];
            return s.copyWith(
              activities: newActivities,
              lastTool: activity.tool,
              currentTask: s.currentTask?.copyWith(activities: newActivities),
            );
          });
        }
        break;

      case 'tool_result':
        if (projectId != null && msg.toolResult != null) {
          state = state.updateProject(projectId, (s) {
            final activity = ToolActivity.fromToolResult(msg.toolResult!);
            final newActivities = [...s.activities, activity];
            return s.copyWith(
              activities: newActivities,
              currentTask: s.currentTask?.copyWith(activities: newActivities),
            );
          });
        }
        break;

      case 'done':
        if (projectId != null) {
          // Remove from streaming set
          final newStreaming = Set<String>.from(state.streamingProjectIds);
          newStreaming.remove(projectId);
          state = state.copyWith(streamingProjectIds: newStreaming);

          state = state.updateProject(projectId, (s) {
            final completedTask = s.currentTask?.copyWith(
              status: TaskStatus.completed,
              completedAt: DateTime.now(),
            );

            return ProjectTaskState(
              messages: completedTask != null ? [...s.messages, completedTask] : s.messages,
              isStreaming: false,
            );
          });
        }
        break;

      case 'error':
        if (projectId != null) {
          final newStreaming = Set<String>.from(state.streamingProjectIds);
          newStreaming.remove(projectId);
          state = state.copyWith(streamingProjectIds: newStreaming);

          state = state.updateProject(projectId, (s) {
            final errorTask = s.currentTask?.copyWith(
              status: TaskStatus.error,
              error: msg.error,
              completedAt: DateTime.now(),
            );

            return ProjectTaskState(
              messages: errorTask != null ? [...s.messages, errorTask] : s.messages,
              isStreaming: false,
            );
          });
        }
        break;
    }
  }

  Future<void> sendTask(String projectId, String prompt) async {
    if (webSocket == null) {
      throw StateError('Not connected');
    }

    final task = Task(
      prompt: prompt,
      status: TaskStatus.running,
      startedAt: DateTime.now(),
    );

    // Add to streaming set
    final newStreaming = Set<String>.from(state.streamingProjectIds);
    newStreaming.add(projectId);
    state = state.copyWith(streamingProjectIds: newStreaming);

    // Set current task (don't add to messages yet - that happens on 'done')
    state = state.updateProject(projectId, (s) => s.copyWith(
      currentTask: task,
      isStreaming: true,
      // Clear buffers for new task
      thinkingBuffer: '',
      textBuffer: '',
      chunks: [],
      activities: [],
      lastTool: null,
    ));

    await webSocket!.sendMessage(prompt, projectId: projectId);
  }

  Future<void> cancel(String projectId) async {
    // ALWAYS update UI state first (optimistic update)
    // This ensures cancel always "works" from the user's perspective
    final newStreaming = Set<String>.from(state.streamingProjectIds);
    newStreaming.remove(projectId);
    state = state.copyWith(streamingProjectIds: newStreaming);

    state = state.updateProject(projectId, (s) {
      final cancelledTask = s.currentTask?.copyWith(
        status: TaskStatus.cancelled,
        completedAt: DateTime.now(),
      );

      return ProjectTaskState(
        messages: cancelledTask != null ? [...s.messages, cancelledTask] : s.messages,
        isStreaming: false,
      );
    });

    // Then try to cancel on server (best effort)
    try {
      if (webSocket != null) {
        await webSocket!.cancel(projectId: projectId);
      }
    } catch (e) {
      debugPrint('[cancel] WebSocket cancel failed: $e');
    }
  }

  /// Fetches conversation history for a project from the server
  Future<void> fetchConversationHistory(String projectId) async {
    if (serverUrl == null) {
      debugPrint('[HISTORY] No serverUrl, cannot fetch history');
      return;
    }

    debugPrint('[HISTORY] Fetching conversation history for: $projectId');

    try {
      final response = await http.get(
        Uri.parse('$serverUrl/api/projects/${Uri.encodeComponent(projectId)}/conversation'),
      );

      if (response.statusCode != 200) {
        debugPrint('[HISTORY] Failed to fetch: ${response.statusCode}');
        return;
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final messagesList = (data['messages'] as List<dynamic>?) ?? [];

      debugPrint('[HISTORY] Loaded ${messagesList.length} messages for $projectId');

      if (messagesList.isEmpty) return;

      // Parse messages into Tasks
      // The API returns alternating user/assistant messages
      // We combine each user message with its following assistant response into a Task
      final List<Task> tasks = [];

      for (int i = 0; i < messagesList.length; i++) {
        final msg = messagesList[i] as Map<String, dynamic>;
        final role = msg['role'] as String?;

        if (role == 'user') {
          final prompt = msg['content'] as String? ?? '';

          // Look for the next assistant message
          String content = '';
          String thinking = '';
          DateTime? completedAt;
          DateTime startedAt = DateTime.now();

          if (i + 1 < messagesList.length) {
            final nextMsg = messagesList[i + 1] as Map<String, dynamic>;
            if (nextMsg['role'] == 'assistant') {
              content = nextMsg['content'] as String? ?? '';
              thinking = nextMsg['thinking'] as String? ?? '';
              if (nextMsg['startedAt'] != null) {
                startedAt = DateTime.tryParse(nextMsg['startedAt'] as String) ?? startedAt;
              }
              if (nextMsg['completedAt'] != null) {
                completedAt = DateTime.tryParse(nextMsg['completedAt'] as String);
              }
              i++; // Skip the assistant message in next iteration
            }
          }

          tasks.add(Task(
            prompt: prompt,
            status: TaskStatus.completed,
            startedAt: startedAt,
            completedAt: completedAt,
            thinking: thinking,
            outputChunks: content.isNotEmpty
                ? [OutputChunk(text: content, timestamp: completedAt ?? DateTime.now())]
                : [],
          ));
        }
      }

      debugPrint('[HISTORY] Parsed ${tasks.length} tasks for $projectId');

      // Update state with loaded messages
      state = state.updateProject(projectId, (s) => s.copyWith(
        messages: tasks,
      ));
    } catch (e) {
      debugPrint('[HISTORY] Error fetching history: $e');
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
