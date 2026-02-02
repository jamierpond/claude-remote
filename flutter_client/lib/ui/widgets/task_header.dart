import 'dart:async';
import 'package:flutter/material.dart';
import '../../models/task.dart';

class TaskHeader extends StatefulWidget {
  final Task task;
  final VoidCallback onCancel;
  
  const TaskHeader({
    super.key,
    required this.task,
    required this.onCancel,
  });
  
  @override
  State<TaskHeader> createState() => _TaskHeaderState();
}

class _TaskHeaderState extends State<TaskHeader> {
  Timer? _timer;
  
  @override
  void initState() {
    super.initState();
    if (widget.task.isRunning) {
      _startTimer();
    }
  }
  
  @override
  void didUpdateWidget(TaskHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.task.isRunning && !oldWidget.task.isRunning) {
      _startTimer();
    } else if (!widget.task.isRunning && oldWidget.task.isRunning) {
      _timer?.cancel();
    }
  }
  
  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }
  
  String _formatDuration(Duration d) {
    final minutes = d.inMinutes;
    final seconds = d.inSeconds % 60;
    return '${minutes}m ${seconds}s';
  }
  
  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    
    Color statusColor;
    IconData statusIcon;
    String statusText;
    
    switch (task.status) {
      case TaskStatus.running:
        statusColor = Colors.blue;
        statusIcon = Icons.sync;
        statusText = 'Working...';
        break;
      case TaskStatus.completed:
        statusColor = Colors.green;
        statusIcon = Icons.check_circle;
        statusText = 'Complete';
        break;
      case TaskStatus.error:
        statusColor = Colors.red;
        statusIcon = Icons.error;
        statusText = 'Error';
        break;
      case TaskStatus.cancelled:
        statusColor = Colors.orange;
        statusIcon = Icons.cancel;
        statusText = 'Cancelled';
        break;
      case TaskStatus.idle:
        statusColor = Colors.grey;
        statusIcon = Icons.hourglass_empty;
        statusText = 'Idle';
        break;
    }
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.grey[900],
        border: Border(
          bottom: BorderSide(color: Colors.grey[800]!),
        ),
      ),
      child: Row(
        children: [
          // Status indicator
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: statusColor.withOpacity(0.3)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (task.isRunning)
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: statusColor,
                    ),
                  )
                else
                  Icon(statusIcon, size: 14, color: statusColor),
                const SizedBox(width: 6),
                Text(
                  statusText,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          
          const SizedBox(width: 12),
          
          // Elapsed time
          Text(
            _formatDuration(task.elapsed),
            style: TextStyle(
              color: Colors.grey[500],
              fontSize: 12,
              fontFamily: 'monospace',
            ),
          ),
          
          const Spacer(),
          
          // Cancel button
          if (task.isRunning)
            TextButton.icon(
              onPressed: widget.onCancel,
              icon: const Icon(Icons.stop, size: 16),
              label: const Text('Cancel'),
              style: TextButton.styleFrom(
                foregroundColor: Colors.red,
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
        ],
      ),
    );
  }
  
  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
