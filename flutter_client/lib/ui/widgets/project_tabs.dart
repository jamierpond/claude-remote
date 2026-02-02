import 'package:flutter/material.dart';
import '../../models/project.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';

class ProjectTabs extends StatelessWidget {
  final List<Project> projects;
  final String? activeProjectId;
  final Set<String> streamingProjectIds;
  final ValueChanged<String> onSelectProject;
  final ValueChanged<String> onCloseProject;
  final VoidCallback onAddProject;

  const ProjectTabs({
    super.key,
    required this.projects,
    required this.activeProjectId,
    required this.streamingProjectIds,
    required this.onSelectProject,
    required this.onCloseProject,
    required this.onAddProject,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 44,
      decoration: BoxDecoration(
        color: AppColors.surface.withOpacity(0.5),
        border: const Border(
          bottom: BorderSide(color: AppColors.border),
        ),
      ),
      child: Row(
        children: [
          // Add project button
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onAddProject,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                decoration: const BoxDecoration(
                  border: Border(
                    right: BorderSide(color: AppColors.border),
                  ),
                ),
                child: const Center(
                  child: Icon(Icons.add, size: 20, color: AppColors.textSecondary),
                ),
              ),
            ),
          ),

          // Scrollable tabs
          Expanded(
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: projects.length,
              itemBuilder: (context, index) {
                final project = projects[index];
                final isActive = project.id == activeProjectId;
                final isStreaming = streamingProjectIds.contains(project.id);

                return _ProjectTab(
                  project: project,
                  isActive: isActive,
                  isStreaming: isStreaming,
                  onTap: () => onSelectProject(project.id),
                  onClose: () => onCloseProject(project.id),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ProjectTab extends StatelessWidget {
  final Project project;
  final bool isActive;
  final bool isStreaming;
  final VoidCallback onTap;
  final VoidCallback onClose;

  const _ProjectTab({
    required this.project,
    required this.isActive,
    required this.isStreaming,
    required this.onTap,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 160),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          decoration: BoxDecoration(
            color: isActive ? AppColors.background : null,
            border: Border(
              right: const BorderSide(color: AppColors.border),
              bottom: isActive
                  ? const BorderSide(color: AppColors.primary, width: 2)
                  : BorderSide.none,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Streaming indicator
              if (isStreaming)
                Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.only(right: AppSpacing.sm),
                  decoration: const BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                ),

              // Project name
              Flexible(
                child: Text(
                  project.name,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: isActive ? AppColors.textPrimary : AppColors.textSecondary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),

              AppSpacing.gapHorizontalSm,

              // Close button
              GestureDetector(
                onTap: onClose,
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Icon(
                    Icons.close,
                    size: 14,
                    color: isActive ? AppColors.textSecondary : AppColors.textMuted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
