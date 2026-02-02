import 'dart:async';
import 'package:flutter/material.dart';
import '../../models/task.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';
import '../theme/typography.dart';

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
        statusColor = AppColors.primary;
        statusIcon = Icons.sync;
        statusText = 'Working...';
        break;
      case TaskStatus.completed:
        statusColor = AppColors.success;
        statusIcon = Icons.check_circle;
        statusText = 'Complete';
        break;
      case TaskStatus.error:
        statusColor = AppColors.error;
        statusIcon = Icons.error;
        statusText = 'Error';
        break;
      case TaskStatus.cancelled:
        statusColor = AppColors.warning;
        statusIcon = Icons.cancel;
        statusText = 'Cancelled';
        break;
      case TaskStatus.idle:
        statusColor = AppColors.textMuted;
        statusIcon = Icons.hourglass_empty;
        statusText = 'Idle';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      decoration: const BoxDecoration(
        color: AppColors.surfaceVariant,
        border: Border(
          bottom: BorderSide(color: AppColors.border),
        ),
      ),
      child: Row(
        children: [
          // Status indicator
          Container(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 6),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(AppRadius.lg),
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
                AppSpacing.gapHorizontalXs,
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

          AppSpacing.gapHorizontalMd,

          // Elapsed time
          Text(
            _formatDuration(task.elapsed),
            style: AppTypography.mono(
              fontSize: 12,
              color: AppColors.textMuted,
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
                foregroundColor: AppColors.error,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
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
