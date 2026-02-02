import 'package:flutter/material.dart';
import '../../models/project.dart';

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
        color: const Color(0xFF1F2937).withOpacity(0.5),
        border: const Border(
          bottom: BorderSide(color: Color(0xFF374151)),
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
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: const BoxDecoration(
                  border: Border(
                    right: BorderSide(color: Color(0xFF374151)),
                  ),
                ),
                child: const Center(
                  child: Icon(Icons.add, size: 20),
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
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: isActive ? const Color(0xFF111827) : null,
            border: Border(
              right: const BorderSide(color: Color(0xFF374151)),
              bottom: isActive
                  ? const BorderSide(color: Colors.blue, width: 2)
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
                  margin: const EdgeInsets.only(right: 8),
                  decoration: BoxDecoration(
                    color: Colors.blue[400],
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
                    color: isActive ? Colors.white : Colors.grey[400],
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),

              const SizedBox(width: 8),

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
                    color: isActive ? Colors.grey[400] : Colors.grey[600],
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
