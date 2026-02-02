import 'package:flutter/material.dart';
import '../../models/tool_activity.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';

class ActivityFeed extends StatefulWidget {
  final List<ToolActivity> activities;
  final bool isLive;

  const ActivityFeed({
    super.key,
    required this.activities,
    this.isLive = false,
  });

  @override
  State<ActivityFeed> createState() => _ActivityFeedState();
}

class _ActivityFeedState extends State<ActivityFeed> {
  bool _expanded = true;

  IconData _getToolIcon(String tool) {
    switch (tool) {
      case 'Read':
        return Icons.description;
      case 'Write':
        return Icons.edit_document;
      case 'Edit':
        return Icons.build;
      case 'Bash':
        return Icons.terminal;
      case 'Glob':
      case 'Grep':
        return Icons.search;
      case 'Task':
        return Icons.smart_toy;
      case 'WebFetch':
      case 'WebSearch':
        return Icons.language;
      default:
        return Icons.extension;
    }
  }

  @override
  Widget build(BuildContext context) {
    final toolUseCount = widget.activities.where((a) => a.isToolUse).length;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          // Header
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.md)),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: [
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 20,
                    color: AppColors.textMuted,
                  ),
                  AppSpacing.gapHorizontalSm,
                  const Icon(
                    Icons.build_circle,
                    size: 16,
                    color: AppColors.primary,
                  ),
                  AppSpacing.gapHorizontalSm,
                  const Text(
                    'Activity',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (widget.isLive) ...[
                    AppSpacing.gapHorizontalSm,
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                  const Spacer(),
                  Text(
                    '$toolUseCount tools',
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Activity list
          if (_expanded)
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: widget.activities.length,
              itemBuilder: (context, index) {
                final activity = widget.activities[index];
                return _buildActivityItem(activity);
              },
            ),
        ],
      ),
    );
  }

  Widget _buildActivityItem(ToolActivity activity) {
    if (activity.isToolResult) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(48, 0, AppSpacing.md, AppSpacing.sm),
        child: Row(
          children: [
            Icon(
              activity.hasError ? Icons.error_outline : Icons.check,
              size: 14,
              color: activity.hasError ? AppColors.error : AppColors.success,
            ),
            AppSpacing.gapHorizontalXs,
            Expanded(
              child: Text(
                activity.hasError
                    ? 'Error: ${activity.error}'
                    : 'Done${activity.output != null ? ' (${activity.output!.length} chars)' : ''}',
                style: TextStyle(
                  color: activity.hasError ? AppColors.error : AppColors.success,
                  fontSize: 11,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );
    }

    final color = AppColors.getToolColor(activity.tool);

    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.xs),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(
              _getToolIcon(activity.tool),
              size: 14,
              color: color,
            ),
          ),
          AppSpacing.gapHorizontalMd,
          Text(
            activity.tool,
            style: const TextStyle(
              fontWeight: FontWeight.w500,
              fontSize: 13,
              color: AppColors.textPrimary,
            ),
          ),
          AppSpacing.gapHorizontalSm,
          Expanded(
            child: Text(
              activity.shortDescription,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 12,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
