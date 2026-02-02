import 'package:flutter/material.dart';
import '../../models/project.dart';

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
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.grey[800],
          borderRadius: BorderRadius.circular(8),
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
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: status.isDirty
                  ? Colors.yellow.withOpacity(0.15)
                  : Colors.grey[800],
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Branch icon
                Icon(
                  Icons.call_split,
                  size: 14,
                  color: status.isDirty ? Colors.yellow[300] : Colors.grey[400],
                ),
                const SizedBox(width: 4),

                // Branch name
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 100),
                  child: Text(
                    status.branch,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: status.isDirty ? Colors.yellow[300] : Colors.grey[300],
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),

                // Dirty indicator
                if (status.isDirty) ...[
                  const SizedBox(width: 6),
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: Colors.yellow[400],
                      shape: BoxShape.circle,
                    ),
                  ),
                ],

                // Ahead/behind indicators
                if (status.ahead > 0) ...[
                  const SizedBox(width: 6),
                  Text(
                    '↑${status.ahead}',
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.green[400],
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
                if (status.behind > 0) ...[
                  const SizedBox(width: 4),
                  Text(
                    '↓${status.behind}',
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.red[400],
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
      borderRadius: BorderRadius.circular(12),
      color: const Color(0xFF1F2937),
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Branch
            Row(
              children: [
                Icon(Icons.call_split, size: 16, color: Colors.grey[500]),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    status.branch,
                    style: const TextStyle(
                      fontWeight: FontWeight.w500,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Status
            Row(
              children: [
                if (status.isDirty) ...[
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: Colors.yellow[400],
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${status.changedFiles} file${status.changedFiles != 1 ? "s" : ""} changed',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.yellow[300],
                    ),
                  ),
                ] else ...[
                  Icon(Icons.check_circle, size: 16, color: Colors.green[400]),
                  const SizedBox(width: 8),
                  Text(
                    'Clean working tree',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.green[300],
                    ),
                  ),
                ],
              ],
            ),

            // Ahead/behind
            if (status.ahead > 0 || status.behind > 0) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  if (status.ahead > 0)
                    Text(
                      '↑ ${status.ahead} ahead',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.green[400],
                      ),
                    ),
                  if (status.ahead > 0 && status.behind > 0)
                    const SizedBox(width: 12),
                  if (status.behind > 0)
                    Text(
                      '↓ ${status.behind} behind',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.red[400],
                      ),
                    ),
                ],
              ),
            ],

            const Divider(height: 24),

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
                  padding: const EdgeInsets.symmetric(vertical: 8),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
