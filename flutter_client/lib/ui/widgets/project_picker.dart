import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/project.dart';
import '../../providers/project_provider.dart';

class ProjectPicker extends ConsumerStatefulWidget {
  final VoidCallback? onClose;
  final Set<String> openProjectIds;

  const ProjectPicker({
    super.key,
    this.onClose,
    this.openProjectIds = const {},
  });

  @override
  ConsumerState<ProjectPicker> createState() => _ProjectPickerState();
}

class _ProjectPickerState extends ConsumerState<ProjectPicker> {
  final _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    // Fetch projects when picker opens
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(projectProvider.notifier).fetchProjects();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Project> _filterProjects(List<Project> projects) {
    if (_searchQuery.isEmpty) return projects;
    final query = _searchQuery.toLowerCase();
    return projects.where((p) =>
      p.name.toLowerCase().contains(query) ||
      p.id.toLowerCase().contains(query)
    ).toList();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(projectProvider);
    final filtered = _filterProjects(state.availableProjects);

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.8,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFF1F2937),
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey[600],
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                const Text(
                  'Open Project',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                IconButton(
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          ),

          // Search
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _searchController,
              onChanged: (v) => setState(() => _searchQuery = v),
              decoration: InputDecoration(
                hintText: 'Search projects...',
                prefixIcon: const Icon(Icons.search, size: 20),
                filled: true,
                fillColor: const Color(0xFF111827),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
            ),
          ),

          const SizedBox(height: 8),

          // Project list
          Flexible(
            child: state.isLoading
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: CircularProgressIndicator(),
                    ),
                  )
                : state.error != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                state.error!,
                                style: const TextStyle(color: Colors.red),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 16),
                              TextButton(
                                onPressed: () => ref.read(projectProvider.notifier).fetchProjects(),
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                      )
                    : filtered.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(32),
                              child: Text(
                                _searchQuery.isNotEmpty
                                    ? 'No matching projects'
                                    : 'No projects found',
                                style: TextStyle(color: Colors.grey[500]),
                              ),
                            ),
                          )
                        : ListView.builder(
                            shrinkWrap: true,
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                            itemCount: filtered.length,
                            itemBuilder: (context, index) {
                              final project = filtered[index];
                              final isOpen = widget.openProjectIds.contains(project.id);
                              return _ProjectTile(
                                project: project,
                                isOpen: isOpen,
                                onTap: () {
                                  ref.read(projectProvider.notifier).openProject(project);
                                  widget.onClose?.call();
                                },
                              );
                            },
                          ),
          ),

          // Footer
          Padding(
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 8,
              bottom: MediaQuery.of(context).padding.bottom + 16,
            ),
            child: Text(
              'Projects from ~/projects',
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey[600],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProjectTile extends StatelessWidget {
  final Project project;
  final bool isOpen;
  final VoidCallback onTap;

  const _ProjectTile({
    required this.project,
    required this.isOpen,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: isOpen ? Colors.blue.withOpacity(0.1) : null,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              // Folder icon
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: isOpen ? Colors.blue.withOpacity(0.2) : Colors.grey[800],
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.folder,
                  size: 20,
                  color: isOpen ? Colors.blue[300] : Colors.grey[400],
                ),
              ),
              const SizedBox(width: 12),

              // Project info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            project.name,
                            style: TextStyle(
                              fontWeight: FontWeight.w500,
                              color: isOpen ? Colors.blue[300] : Colors.white,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (isOpen) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.blue,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              'Open',
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      project.path,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey[600],
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),

              // Arrow
              Icon(
                Icons.chevron_right,
                color: Colors.grey[600],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
