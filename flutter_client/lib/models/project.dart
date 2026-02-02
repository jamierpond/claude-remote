import 'package:equatable/equatable.dart';

class Project extends Equatable {
  final String id;
  final String path;
  final String name;
  final String? lastAccessed;

  const Project({
    required this.id,
    required this.path,
    required this.name,
    this.lastAccessed,
  });

  factory Project.fromJson(Map<String, dynamic> json) {
    return Project(
      id: json['id'] as String,
      path: json['path'] as String,
      name: json['name'] as String,
      lastAccessed: json['lastAccessed'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'path': path,
      'name': name,
      if (lastAccessed != null) 'lastAccessed': lastAccessed,
    };
  }

  @override
  List<Object?> get props => [id, path, name, lastAccessed];
}

class GitStatus extends Equatable {
  final String branch;
  final bool isDirty;
  final int changedFiles;
  final int ahead;
  final int behind;

  const GitStatus({
    required this.branch,
    required this.isDirty,
    required this.changedFiles,
    required this.ahead,
    required this.behind,
  });

  factory GitStatus.fromJson(Map<String, dynamic> json) {
    return GitStatus(
      branch: json['branch'] as String? ?? 'unknown',
      isDirty: json['isDirty'] as bool? ?? false,
      changedFiles: json['changedFiles'] as int? ?? 0,
      ahead: json['ahead'] as int? ?? 0,
      behind: json['behind'] as int? ?? 0,
    );
  }

  @override
  List<Object?> get props => [branch, isDirty, changedFiles, ahead, behind];
}
