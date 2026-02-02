import 'package:flutter/material.dart';
import '../../models/project.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';

class GitStatusBadge extends StatefulWidget {
  final GitStatus? status;
  final bool isLoading;
  final VoidCallback? onRefresh;

  const GitStatusBadge({
    super.key,
    this.status,
    this.isLoading = false,
    this.onRefresh,
  });

  @override
  State<GitStatusBadge> createState() => _GitStatusBadgeState();
}

class _GitStatusBadgeState extends State<GitStatusBadge> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    if (widget.status == null && !widget.isLoading) {
      return const SizedBox.shrink();
    }

    if (widget.isLoading && widget.status == null) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: const SizedBox(
          width: 12,
          height: 12,
          child: CircularProgressIndicator(strokeWidth: 1.5),
        ),
      );
    }

    final status = widget.status!;

    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Main badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
            decoration: BoxDecoration(
              color: status.isDirty
                  ? AppColors.gitDirty.withOpacity(0.15)
                  : AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Branch icon
                Icon(
                  Icons.call_split,
                  size: 14,
                  color: status.isDirty ? AppColors.gitDirty : AppColors.textSecondary,
                ),
                AppSpacing.gapHorizontalXs,

                // Branch name
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 100),
                  child: Text(
                    status.branch,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: status.isDirty ? AppColors.gitDirty : AppColors.textSecondary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),

                // Dirty indicator
                if (status.isDirty) ...[
                  AppSpacing.gapHorizontalXs,
                  Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppColors.gitDirty,
                      shape: BoxShape.circle,
                    ),
                  ),
                ],

                // Ahead/behind indicators
                if (status.ahead > 0) ...[
                  AppSpacing.gapHorizontalXs,
                  Text(
                    '↑${status.ahead}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.gitAhead,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
                if (status.behind > 0) ...[
                  AppSpacing.gapHorizontalXs,
                  Text(
                    '↓${status.behind}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.gitBehind,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Expanded dropdown
          if (_expanded)
            Positioned(
              top: 32,
              right: 0,
              child: _GitStatusDropdown(
                status: status,
                isLoading: widget.isLoading,
                onRefresh: widget.onRefresh,
                onClose: () => setState(() => _expanded = false),
              ),
            ),
        ],
      ),
    );
  }
}

class _GitStatusDropdown extends StatelessWidget {
  final GitStatus status;
  final bool isLoading;
  final VoidCallback? onRefresh;
  final VoidCallback onClose;

  const _GitStatusDropdown({
    required this.status,
    required this.isLoading,
    this.onRefresh,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 8,
      borderRadius: BorderRadius.circular(AppRadius.md),
      color: AppColors.surface,
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Branch
            Row(
              children: [
                const Icon(Icons.call_split, size: 16, color: AppColors.textMuted),
                AppSpacing.gapHorizontalSm,
                Expanded(
                  child: Text(
                    status.branch,
                    style: const TextStyle(
                      fontWeight: FontWeight.w500,
                      color: AppColors.textPrimary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),

            AppSpacing.gapVerticalMd,

            // Status
            Row(
              children: [
                if (status.isDirty) ...[
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppColors.gitDirty,
                      shape: BoxShape.circle,
                    ),
                  ),
                  AppSpacing.gapHorizontalSm,
                  Text(
                    '${status.changedFiles} file${status.changedFiles != 1 ? "s" : ""} changed',
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.gitDirty,
                    ),
                  ),
                ] else ...[
                  const Icon(Icons.check_circle, size: 16, color: AppColors.gitClean),
                  AppSpacing.gapHorizontalSm,
                  const Text(
                    'Clean working tree',
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.gitClean,
                    ),
                  ),
                ],
              ],
            ),

            // Ahead/behind
            if (status.ahead > 0 || status.behind > 0) ...[
              AppSpacing.gapVerticalSm,
              Row(
                children: [
                  if (status.ahead > 0)
                    Text(
                      '↑ ${status.ahead} ahead',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.gitAhead,
                      ),
                    ),
                  if (status.ahead > 0 && status.behind > 0)
                    AppSpacing.gapHorizontalMd,
                  if (status.behind > 0)
                    Text(
                      '↓ ${status.behind} behind',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.gitBehind,
                      ),
                    ),
                ],
              ),
            ],

            const Divider(height: 24, color: AppColors.divider),

            // Refresh button
            SizedBox(
              width: double.infinity,
              child: TextButton.icon(
                onPressed: onRefresh,
                icon: isLoading
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 1.5),
                      )
                    : const Icon(Icons.refresh, size: 14),
                label: const Text('Refresh'),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
