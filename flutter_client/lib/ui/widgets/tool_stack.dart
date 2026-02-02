import 'package:flutter/material.dart';
import 'package:pretty_diff_text/pretty_diff_text.dart';
import '../../models/tool_activity.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';
import '../theme/typography.dart';

/// Paired tool use + result
class ToolPair {
  final String tool;
  final Map<String, dynamic>? input;
  final String? output;
  final String? error;
  final DateTime timestamp;
  final bool isComplete;

  ToolPair({
    required this.tool,
    this.input,
    this.output,
    this.error,
    required this.timestamp,
    required this.isComplete,
  });

  bool get hasError => error != null && error!.isNotEmpty;
  bool get isSuccess => isComplete && !hasError;
}

/// Parse activity list into paired tool calls
List<ToolPair> parseToolPairs(List<ToolActivity> activities) {
  final pairs = <ToolPair>[];
  ToolActivity? pendingToolUse;

  for (final activity in activities) {
    if (activity.isToolUse) {
      // If we had a pending tool use without result, add it as incomplete
      if (pendingToolUse != null) {
        pairs.add(ToolPair(
          tool: pendingToolUse.tool,
          input: pendingToolUse.input,
          timestamp: pendingToolUse.timestamp,
          isComplete: false,
        ));
      }
      pendingToolUse = activity;
    } else if (activity.isToolResult) {
      // Pair with pending tool use
      if (pendingToolUse != null) {
        pairs.add(ToolPair(
          tool: pendingToolUse.tool,
          input: pendingToolUse.input,
          output: activity.output,
          error: activity.error,
          timestamp: pendingToolUse.timestamp,
          isComplete: true,
        ));
        pendingToolUse = null;
      }
    }
  }

  // Add any remaining pending tool use
  if (pendingToolUse != null) {
    pairs.add(ToolPair(
      tool: pendingToolUse.tool,
      input: pendingToolUse.input,
      timestamp: pendingToolUse.timestamp,
      isComplete: false,
    ));
  }

  return pairs;
}

/// Separate panel showing live tool activity
class ToolStack extends StatelessWidget {
  final List<ToolActivity> activities;
  final bool isLive;

  const ToolStack({
    super.key,
    required this.activities,
    this.isLive = false,
  });

  @override
  Widget build(BuildContext context) {
    if (activities.isEmpty) return const SizedBox.shrink();

    final pairs = parseToolPairs(activities);

    return Container(
      constraints: const BoxConstraints(maxHeight: 250),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.border),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
            child: Row(
              children: [
                const Icon(Icons.build_circle, size: 16, color: AppColors.primary),
                AppSpacing.gapHorizontalSm,
                const Text(
                  'Tools',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (isLive) ...[
                  AppSpacing.gapHorizontalSm,
                  _PulsingDot(),
                ],
                const Spacer(),
                Text(
                  '${pairs.length}',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),

          // Tool cards
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
              itemCount: pairs.length,
              itemBuilder: (context, index) {
                final pair = pairs[index];
                final isLatest = index == pairs.length - 1;
                return Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: ToolCard(
                    pair: pair,
                    isActive: isLive && isLatest && !pair.isComplete,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _PulsingDot extends StatefulWidget {
  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(
            color: AppColors.primary.withOpacity(0.5 + _controller.value * 0.5),
            shape: BoxShape.circle,
          ),
        );
      },
    );
  }
}

/// Individual tool card with expandable details
class ToolCard extends StatefulWidget {
  final ToolPair pair;
  final bool isActive;

  const ToolCard({
    super.key,
    required this.pair,
    this.isActive = false,
  });

  @override
  State<ToolCard> createState() => _ToolCardState();
}

class _ToolCardState extends State<ToolCard> {
  bool _expanded = false;

  Color get _toolColor => AppColors.getToolColor(widget.pair.tool);

  IconData get _toolIcon {
    switch (widget.pair.tool) {
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

  String get _summary {
    final input = widget.pair.input;
    switch (widget.pair.tool) {
      case 'Read':
        final path = input?['file_path'] as String? ?? '';
        return _shortenPath(path);
      case 'Write':
      case 'Edit':
        final path = input?['file_path'] as String? ?? '';
        return _shortenPath(path);
      case 'Bash':
        final cmd = input?['command'] as String? ?? '';
        return cmd.length > 40 ? '${cmd.substring(0, 40)}...' : cmd;
      case 'Glob':
        return input?['pattern'] as String? ?? '';
      case 'Grep':
        final pattern = input?['pattern'] as String? ?? '';
        return pattern.length > 30 ? '${pattern.substring(0, 30)}...' : pattern;
      case 'WebSearch':
        final query = input?['query'] as String? ?? '';
        return '"${query.length > 30 ? '${query.substring(0, 30)}...' : query}"';
      case 'Task':
        final prompt = input?['prompt'] as String? ?? '';
        return prompt.length > 40 ? '${prompt.substring(0, 40)}...' : prompt;
      default:
        return widget.pair.tool;
    }
  }

  String _shortenPath(String path) {
    final parts = path.split('/');
    if (parts.length <= 2) return path;
    return parts.sublist(parts.length - 2).join('/');
  }

  String get _timeAgo {
    final diff = DateTime.now().difference(widget.pair.timestamp);
    if (diff.inSeconds < 60) return '${diff.inSeconds}s';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m';
    return '${diff.inHours}h';
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Container(
        decoration: BoxDecoration(
          color: _toolColor.withOpacity(0.08),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border(
            left: BorderSide(color: _toolColor, width: 3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: [
                  // Expand icon
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 16,
                    color: AppColors.textMuted,
                  ),
                  AppSpacing.gapHorizontalSm,

                  // Tool icon
                  Icon(_toolIcon, size: 14, color: _toolColor),
                  AppSpacing.gapHorizontalSm,

                  // Tool name
                  Text(
                    widget.pair.tool,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                      color: _toolColor,
                    ),
                  ),
                  AppSpacing.gapHorizontalSm,

                  // Summary
                  Expanded(
                    child: Text(
                      _summary,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),

                  // Status badge
                  _buildStatusBadge(),
                  AppSpacing.gapHorizontalSm,

                  // Time
                  Text(
                    _timeAgo,
                    style: AppTypography.mono(
                      fontSize: 10,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),

            // Expanded content
            if (_expanded) _buildExpandedContent(),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBadge() {
    if (widget.isActive) {
      return _PulsingDot();
    }

    if (!widget.pair.isComplete) {
      return const SizedBox.shrink();
    }

    if (widget.pair.hasError) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: AppColors.error.withOpacity(0.2),
          borderRadius: BorderRadius.circular(4),
        ),
        child: const Text(
          'err',
          style: TextStyle(
            color: AppColors.error,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.success.withOpacity(0.2),
        borderRadius: BorderRadius.circular(4),
      ),
      child: const Text(
        'ok',
        style: TextStyle(
          color: AppColors.success,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildExpandedContent() {
    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.md, AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tool-specific input display
          _buildInputDisplay(),

          // Output/Error
          if (widget.pair.isComplete) ...[
            AppSpacing.gapVerticalSm,
            _buildOutputDisplay(),
          ],
        ],
      ),
    );
  }

  Widget _buildInputDisplay() {
    final input = widget.pair.input;
    if (input == null) return const SizedBox.shrink();

    switch (widget.pair.tool) {
      case 'Read':
        return _codeBlock(input['file_path'] as String? ?? '');
      case 'Write':
        final content = input['content'] as String? ?? '';
        final preview = content.length > 300 ? '${content.substring(0, 300)}...' : content;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _codeBlock(input['file_path'] as String? ?? ''),
            AppSpacing.gapVerticalXs,
            _codeBlock(preview, label: 'content'),
          ],
        );
      case 'Edit':
        final oldStr = input['old_string'] as String? ?? '';
        final newStr = input['new_string'] as String? ?? '';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _codeBlock(input['file_path'] as String? ?? ''),
            if (oldStr.isNotEmpty || newStr.isNotEmpty) ...[
              AppSpacing.gapVerticalXs,
              _diffBlock(oldStr, newStr),
            ],
          ],
        );
      case 'Bash':
        return _codeBlock('\$ ${input['command'] ?? ''}');
      case 'Glob':
      case 'Grep':
        return _codeBlock(input['pattern'] as String? ?? '');
      default:
        // JSON for other tools
        return _codeBlock(input.toString());
    }
  }

  Widget _buildOutputDisplay() {
    if (widget.pair.hasError) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.error.withOpacity(0.1),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          widget.pair.error!,
          style: AppTypography.mono(
            fontSize: 11,
            color: AppColors.error,
          ),
        ),
      );
    }

    final output = widget.pair.output;
    if (output == null || output.isEmpty) return const SizedBox.shrink();

    final preview = output.length > 500 ? '${output.substring(0, 500)}...' : output;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        preview,
        style: AppTypography.mono(
          fontSize: 11,
          color: AppColors.textSecondary,
        ),
      ),
    );
  }

  Widget _codeBlock(String text, {String? label}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (label != null) ...[
            Text(
              label,
              style: const TextStyle(
                fontSize: 10,
                color: AppColors.textMuted,
              ),
            ),
            AppSpacing.gapVerticalXs,
          ],
          Text(
            text,
            style: AppTypography.mono(
              fontSize: 11,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _diffBlock(String oldText, String newText) {
    // Limit preview size
    final oldPreview = oldText.length > 500 ? '${oldText.substring(0, 500)}...' : oldText;
    final newPreview = newText.length > 500 ? '${newText.substring(0, 500)}...' : newText;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppColors.border),
      ),
      child: PrettyDiffText(
        oldText: oldPreview,
        newText: newPreview,
        defaultTextStyle: AppTypography.mono(
          fontSize: 11,
          color: AppColors.textPrimary,
        ),
        addedTextStyle: AppTypography.mono(
          fontSize: 11,
          color: AppColors.success,
          backgroundColor: const Color(0x205AAD6A),
        ),
        deletedTextStyle: AppTypography.mono(
          fontSize: 11,
          color: AppColors.error,
          backgroundColor: const Color(0x20E85A5A),
          decoration: TextDecoration.lineThrough,
        ),
      ),
    );
  }
}
