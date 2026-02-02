import 'package:equatable/equatable.dart';

enum ToolActivityType { toolUse, toolResult }

class ToolActivity extends Equatable {
  final ToolActivityType type;
  final String tool;
  final Map<String, dynamic>? input;
  final String? output;
  final String? error;
  final DateTime timestamp;
  
  const ToolActivity({
    required this.type,
    required this.tool,
    this.input,
    this.output,
    this.error,
    required this.timestamp,
  });
  
  bool get isToolUse => type == ToolActivityType.toolUse;
  bool get isToolResult => type == ToolActivityType.toolResult;
  bool get hasError => error != null && error!.isNotEmpty;
  
  factory ToolActivity.fromToolUse(Map<String, dynamic> data) {
    return ToolActivity(
      type: ToolActivityType.toolUse,
      tool: data['tool'] as String,
      input: data['input'] as Map<String, dynamic>?,
      timestamp: DateTime.now(),
    );
  }
  
  factory ToolActivity.fromToolResult(Map<String, dynamic> data) {
    return ToolActivity(
      type: ToolActivityType.toolResult,
      tool: data['tool'] as String,
      output: data['output'] as String?,
      error: data['error'] as String?,
      timestamp: DateTime.now(),
    );
  }
  
  /// Get a short description for the activity feed
  String get shortDescription {
    if (isToolUse) {
      switch (tool) {
        case 'Read':
          return input?['file_path'] ?? 'file';
        case 'Write':
        case 'Edit':
          final path = input?['file_path'] ?? 'file';
          return path;
        case 'Bash':
          final cmd = input?['command'] as String? ?? '';
          return cmd.length > 40 ? '${cmd.substring(0, 40)}...' : cmd;
        case 'Glob':
        case 'Grep':
          return input?['pattern'] ?? '';
        default:
          return tool;
      }
    } else {
      return hasError ? 'Error' : 'Done';
    }
  }
  
  @override
  List<Object?> get props => [type, tool, input, output, error, timestamp];
}
