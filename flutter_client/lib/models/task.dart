import 'package:equatable/equatable.dart';
import 'tool_activity.dart';

enum TaskStatus { idle, running, completed, error, cancelled }

class OutputChunk extends Equatable {
  final String text;
  final DateTime timestamp;
  final String? afterTool;
  
  const OutputChunk({
    required this.text,
    required this.timestamp,
    this.afterTool,
  });
  
  @override
  List<Object?> get props => [text, timestamp, afterTool];
}

class Task extends Equatable {
  final String? id;
  final String prompt;
  final TaskStatus status;
  final DateTime startedAt;
  final DateTime? completedAt;
  final String thinking;
  final List<OutputChunk> outputChunks;
  final List<ToolActivity> activities;
  final String? error;
  
  const Task({
    this.id,
    required this.prompt,
    this.status = TaskStatus.idle,
    required this.startedAt,
    this.completedAt,
    this.thinking = '',
    this.outputChunks = const [],
    this.activities = const [],
    this.error,
  });
  
  bool get isRunning => status == TaskStatus.running;
  
  Duration get elapsed {
    final end = completedAt ?? DateTime.now();
    return end.difference(startedAt);
  }
  
  String get fullOutput => outputChunks.map((c) => c.text).join('');
  
  Task copyWith({
    String? id,
    String? prompt,
    TaskStatus? status,
    DateTime? startedAt,
    DateTime? completedAt,
    String? thinking,
    List<OutputChunk>? outputChunks,
    List<ToolActivity>? activities,
    String? error,
  }) {
    return Task(
      id: id ?? this.id,
      prompt: prompt ?? this.prompt,
      status: status ?? this.status,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
      thinking: thinking ?? this.thinking,
      outputChunks: outputChunks ?? this.outputChunks,
      activities: activities ?? this.activities,
      error: error ?? this.error,
    );
  }
  
  @override
  List<Object?> get props => [
    id, prompt, status, startedAt, completedAt, 
    thinking, outputChunks, activities, error
  ];
}
