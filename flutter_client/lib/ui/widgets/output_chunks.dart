import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/task.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';
import '../theme/typography.dart';

class OutputChunks extends StatelessWidget {
  final List<OutputChunk> chunks;

  const OutputChunks({super.key, required this.chunks});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Row(
            children: [
              const Icon(
                Icons.chat_bubble_outline,
                size: 16,
                color: AppColors.textMuted,
              ),
              AppSpacing.gapHorizontalSm,
              const Text(
                'Response',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const Spacer(),
              Text(
                '${chunks.length} chunks',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),

        // Chunks
        ...chunks.asMap().entries.map((entry) {
          final index = entry.key;
          final chunk = entry.value;
          final isFirst = index == 0;

          return _ChunkCard(
            chunk: chunk,
            showDivider: !isFirst,
          );
        }),
      ],
    );
  }
}

class _ChunkCard extends StatelessWidget {
  final OutputChunk chunk;
  final bool showDivider;

  const _ChunkCard({
    required this.chunk,
    this.showDivider = false,
  });

  @override
  Widget build(BuildContext context) {
    final timeFormat = DateFormat('HH:mm:ss');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showDivider)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Row(
              children: [
                const Expanded(
                  child: Divider(color: AppColors.divider),
                ),
                if (chunk.afterTool != null) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                    child: Text(
                      'after ${chunk.afterTool}',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10,
                      ),
                    ),
                  ),
                  const Expanded(
                    child: Divider(color: AppColors.divider),
                  ),
                ],
              ],
            ),
          ),

        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Timestamp (subtle)
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    timeFormat.format(chunk.timestamp),
                    style: AppTypography.mono(
                      fontSize: 10,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
              AppSpacing.gapVerticalXs,

              // Content
              SelectableText(
                chunk.text,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.6,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
