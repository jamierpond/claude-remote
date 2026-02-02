import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import '../models/tool_activity.dart';
import '../core/websocket.dart';
import 'auth_provider.dart';

final taskProvider = StateNotifierProvider<TaskNotifier, Task?>((ref) {
  final authState = ref.watch(authStateProvider);
  final authNotifier = ref.watch(authStateProvider.notifier);
  
  return TaskNotifier(
    webSocket: authNotifier.webSocket,
    isAuthenticated: authState.isAuthenticated,
  );
});

final taskHistoryProvider = StateNotifierProvider<TaskHistoryNotifier, List<Task>>((ref) {
  return TaskHistoryNotifier();
});

class TaskNotifier extends StateNotifier<Task?> {
  final WebSocketManager? webSocket;
  final bool isAuthenticated;
  StreamSubscription? _subscription;
  
  // Accumulators for streaming
  String _thinkingBuffer = '';
  String _textBuffer = '';
  List<OutputChunk> _chunks = [];
  List<ToolActivity> _activities = [];
  String? _lastTool;
  
  TaskNotifier({
    required this.webSocket,
    required this.isAuthenticated,
  }) : super(null) {
    if (webSocket != null && isAuthenticated) {
      _subscribe();
    }
  }
  
  void _subscribe() {
    _subscription = webSocket?.messageStream.listen(_handleMessage);
  }
  
  void _handleMessage(WebSocketMessage msg) {
    if (state == null && msg.type != 'auth_ok') return;
    
    switch (msg.type) {
      case 'thinking':
        _thinkingBuffer += msg.text ?? '';
        state = state?.copyWith(thinking: _thinkingBuffer);
        break;
        
      case 'text':
        final text = msg.text ?? '';
        _textBuffer += text;
        
        // Detect if this should be a new chunk
        final isNewChunk = _lastTool != null ||
            text.startsWith('\n\n') ||
            RegExp(r'^(Now|Next|Let me|I\'ll|First|Finally|Done)', caseSensitive: false)
                .hasMatch(text.trim());
        
        if (isNewChunk && _chunks.isNotEmpty) {
          // Start new chunk
          _chunks = [
            ..._chunks,
            OutputChunk(
              text: text,
              timestamp: DateTime.now(),
              afterTool: _lastTool,
            ),
          ];
          _lastTool = null;
        } else if (_chunks.isEmpty) {
          // First chunk
          _chunks = [
            OutputChunk(
              text: text,
              timestamp: DateTime.now(),
            ),
          ];
        } else {
          // Append to last chunk
          final lastChunk = _chunks.last;
          _chunks = [
            ..._chunks.take(_chunks.length - 1),
            OutputChunk(
              text: lastChunk.text + text,
              timestamp: lastChunk.timestamp,
              afterTool: lastChunk.afterTool,
            ),
          ];
        }
        
        state = state?.copyWith(outputChunks: _chunks);
        break;
        
      case 'tool_use':
        if (msg.toolUse != null) {
          final activity = ToolActivity.fromToolUse(msg.toolUse!);
          _activities = [..._activities, activity];
          _lastTool = activity.tool;
          state = state?.copyWith(activities: _activities);
        }
        break;
        
      case 'tool_result':
        if (msg.toolResult != null) {
          final activity = ToolActivity.fromToolResult(msg.toolResult!);
          _activities = [..._activities, activity];
          state = state?.copyWith(activities: _activities);
        }
        break;
        
      case 'done':
        state = state?.copyWith(
          status: TaskStatus.completed,
          completedAt: DateTime.now(),
        );
        _resetBuffers();
        break;
        
      case 'error':
        state = state?.copyWith(
          status: TaskStatus.error,
          error: msg.error,
          completedAt: DateTime.now(),
        );
        _resetBuffers();
        break;
    }
  }
  
  Future<void> sendTask(String prompt) async {
    if (webSocket == null) {
      throw StateError('Not connected');
    }
    
    _resetBuffers();
    
    state = Task(
      prompt: prompt,
      status: TaskStatus.running,
      startedAt: DateTime.now(),
    );
    
    await webSocket!.sendMessage(prompt);
  }
  
  Future<void> cancel() async {
    if (webSocket == null || state == null) return;
    
    await webSocket!.cancel();
    state = state?.copyWith(
      status: TaskStatus.cancelled,
      completedAt: DateTime.now(),
    );
    _resetBuffers();
  }
  
  void _resetBuffers() {
    _thinkingBuffer = '';
    _textBuffer = '';
    _chunks = [];
    _activities = [];
    _lastTool = null;
  }
  
  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}

class TaskHistoryNotifier extends StateNotifier<List<Task>> {
  TaskHistoryNotifier() : super([]);
  
  void addTask(Task task) {
    state = [task, ...state];
  }
  
  void clearHistory() {
    state = [];
  }
}
