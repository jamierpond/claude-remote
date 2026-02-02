import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../models/project.dart';
import 'auth_provider.dart';

// State for project management
class ProjectState {
  final List<Project> availableProjects;
  final List<Project> openProjects;
  final String? activeProjectId;
  final bool isLoading;
  final String? error;
  final Map<String, GitStatus> gitStatuses;

  const ProjectState({
    this.availableProjects = const [],
    this.openProjects = const [],
    this.activeProjectId,
    this.isLoading = false,
    this.error,
    this.gitStatuses = const {},
  });

  Project? get activeProject {
    if (activeProjectId == null) return null;
    return openProjects.firstWhere(
      (p) => p.id == activeProjectId,
      orElse: () => openProjects.isNotEmpty ? openProjects.first : throw StateError('No project'),
    );
  }

  GitStatus? get activeGitStatus => activeProjectId != null ? gitStatuses[activeProjectId] : null;

  ProjectState copyWith({
    List<Project>? availableProjects,
    List<Project>? openProjects,
    String? activeProjectId,
    bool? isLoading,
    String? error,
    Map<String, GitStatus>? gitStatuses,
  }) {
    return ProjectState(
      availableProjects: availableProjects ?? this.availableProjects,
      openProjects: openProjects ?? this.openProjects,
      activeProjectId: activeProjectId ?? this.activeProjectId,
      isLoading: isLoading ?? this.isLoading,
      error: error,
      gitStatuses: gitStatuses ?? this.gitStatuses,
    );
  }
}

final projectProvider = StateNotifierProvider<ProjectNotifier, ProjectState>((ref) {
  final authState = ref.watch(authStateProvider);
  return ProjectNotifier(serverUrl: authState.serverUrl);
});

class ProjectNotifier extends StateNotifier<ProjectState> {
  final String? serverUrl;

  ProjectNotifier({this.serverUrl}) : super(const ProjectState());

  Future<void> fetchProjects() async {
    if (serverUrl == null) {
      state = state.copyWith(error: 'Not connected to server');
      return;
    }

    state = state.copyWith(isLoading: true, error: null);

    try {
      final response = await http.get(Uri.parse('$serverUrl/api/projects'));
      if (response.statusCode != 200) {
        throw Exception('Failed to fetch projects: ${response.statusCode}');
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final projectsList = (data['projects'] as List<dynamic>?) ?? [];
      final projects = projectsList
          .map((p) => Project.fromJson(p as Map<String, dynamic>))
          .toList();

      state = state.copyWith(
        availableProjects: projects,
        isLoading: false,
      );
      debugPrint('[PROJECTS] Loaded ${projects.length} projects');
    } catch (e) {
      debugPrint('[PROJECTS] Failed to fetch: $e');
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  void openProject(Project project) {
    final alreadyOpen = state.openProjects.any((p) => p.id == project.id);
    if (!alreadyOpen) {
      state = state.copyWith(
        openProjects: [...state.openProjects, project],
        activeProjectId: project.id,
      );
      // Fetch git status for new project
      fetchGitStatus(project.id);
    } else {
      state = state.copyWith(activeProjectId: project.id);
    }
  }

  void closeProject(String projectId) {
    final remaining = state.openProjects.where((p) => p.id != projectId).toList();
    String? newActiveId = state.activeProjectId;

    if (state.activeProjectId == projectId) {
      newActiveId = remaining.isNotEmpty ? remaining.last.id : null;
    }

    final newGitStatuses = Map<String, GitStatus>.from(state.gitStatuses);
    newGitStatuses.remove(projectId);

    state = state.copyWith(
      openProjects: remaining,
      activeProjectId: newActiveId,
      gitStatuses: newGitStatuses,
    );
  }

  void setActiveProject(String projectId) {
    if (state.openProjects.any((p) => p.id == projectId)) {
      state = state.copyWith(activeProjectId: projectId);
    }
  }

  Future<void> fetchGitStatus(String projectId) async {
    if (serverUrl == null) return;

    try {
      final response = await http.get(
        Uri.parse('$serverUrl/api/projects/${Uri.encodeComponent(projectId)}/git'),
      );

      if (response.statusCode != 200) {
        debugPrint('[GIT] Failed to fetch status: ${response.statusCode}');
        return;
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final gitStatus = GitStatus.fromJson(data);

      final newStatuses = Map<String, GitStatus>.from(state.gitStatuses);
      newStatuses[projectId] = gitStatus;

      state = state.copyWith(gitStatuses: newStatuses);
      debugPrint('[GIT] ${projectId}: ${gitStatus.branch} ${gitStatus.isDirty ? "(dirty)" : "(clean)"}');
    } catch (e) {
      debugPrint('[GIT] Failed to fetch status: $e');
    }
  }

  void refreshActiveGitStatus() {
    if (state.activeProjectId != null) {
      fetchGitStatus(state.activeProjectId!);
    }
  }
}
