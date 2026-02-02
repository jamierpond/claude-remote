import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/project_provider.dart';
import '../../providers/auth_provider.dart';
import '../widgets/project_tabs.dart';
import '../widgets/project_picker.dart';
import '../widgets/git_status_badge.dart';
import '../widgets/task_header.dart';
import '../widgets/thinking_panel.dart';
import '../widgets/activity_feed.dart';
import '../widgets/output_chunks.dart';

class TaskScreen extends ConsumerStatefulWidget {
  const TaskScreen({super.key});

  @override
  ConsumerState<TaskScreen> createState() => _TaskScreenState();
}

class _TaskScreenState extends ConsumerState<TaskScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  bool _showProjectPicker = false;

  @override
  void initState() {
    super.initState();
    _restoreState();
  }

  Future<void> _restoreState() async {
    final storage = ref.read(storageProvider);
    _inputController.text = storage.getInputDraft();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final position = storage.getScrollPosition();
      if (_scrollController.hasClients && position > 0) {
        _scrollController.jumpTo(position);
      }
    });
  }

  void _saveState() {
    final storage = ref.read(storageProvider);
    storage.saveInputDraft(_inputController.text);
    if (_scrollController.hasClients) {
      storage.saveScrollPosition(_scrollController.offset);
    }
  }

  Future<void> _sendTask() async {
    final projectState = ref.read(projectProvider);
    final projectId = projectState.activeProjectId;

    if (projectId == null) {
      setState(() => _showProjectPicker = true);
      return;
    }

    final text = _inputController.text.trim();
    if (text.isEmpty) return;

    _inputController.clear();
    ref.read(storageProvider).clearInputDraft();

    try {
      await ref.read(taskManagerProvider.notifier).sendTask(projectId, text);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _cancel() async {
    final projectId = ref.read(projectProvider).activeProjectId;
    if (projectId == null) return;
    await ref.read(taskManagerProvider.notifier).cancel(projectId);
  }

  @override
  Widget build(BuildContext context) {
    final projectState = ref.watch(projectProvider);
    final taskState = ref.watch(taskManagerProvider);
    final activeTaskState = ref.watch(activeTaskStateProvider);
    final isStreaming = activeTaskState.isStreaming;

    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              children: [
                // Project Tabs
                ProjectTabs(
                  projects: projectState.openProjects,
                  activeProjectId: projectState.activeProjectId,
                  streamingProjectIds: taskState.streamingProjectIds,
                  onSelectProject: (id) =>
                      ref.read(projectProvider.notifier).setActiveProject(id),
                  onCloseProject: (id) =>
                      ref.read(projectProvider.notifier).closeProject(id),
                  onAddProject: () => setState(() => _showProjectPicker = true),
                ),

                // Header with project name and git status
                _buildHeader(projectState, activeTaskState),

                // Main content
                Expanded(
                  child: projectState.activeProjectId == null
                      ? _buildEmptyState()
                      : _buildTaskContent(activeTaskState),
                ),

                // Input area
                _buildInputArea(isStreaming),
              ],
            ),

            // Project picker overlay
            if (_showProjectPicker)
              GestureDetector(
                onTap: () => setState(() => _showProjectPicker = false),
                child: Container(
                  color: Colors.black54,
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: GestureDetector(
                      onTap: () {}, // Absorb taps on the picker
                      child: ProjectPicker(
                        onClose: () => setState(() => _showProjectPicker = false),
                        openProjectIds: projectState.openProjects.map((p) => p.id).toSet(),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(ProjectState projectState, ProjectTaskState taskState) {
    final activeProject = projectState.activeProject;
    final gitStatus = projectState.activeGitStatus;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        border: Border(
          bottom: BorderSide(color: Colors.grey[800]!),
        ),
      ),
      child: Row(
        children: [
          // Project name
          Expanded(
            child: Text(
              activeProject?.name ?? 'Select a project',
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),

          // Git status
          if (gitStatus != null)
            Padding(
              padding: const EdgeInsets.only(left: 12),
              child: GitStatusBadge(
                status: gitStatus,
                onRefresh: () =>
                    ref.read(projectProvider.notifier).refreshActiveGitStatus(),
              ),
            ),

          // Reset button
          IconButton(
            onPressed: () {
              // TODO: implement reset
            },
            icon: Icon(Icons.refresh, color: Colors.grey[500], size: 20),
            tooltip: 'Reset',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.grey[800]?.withOpacity(0.5),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.folder_open,
                  size: 48,
                  color: Colors.grey[600],
                ),
                const SizedBox(height: 16),
                Text(
                  'Select a project to start',
                  style: TextStyle(
                    fontSize: 16,
                    color: Colors.grey[500],
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: () => setState(() => _showProjectPicker = true),
                  icon: const Icon(Icons.add),
                  label: const Text('Open Project'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskContent(ProjectTaskState state) {
    final task = state.currentTask;
    final messages = state.messages;

    return ListView(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      children: [
        // Message history
        for (final msg in messages) ...[
          _buildMessageBubble(msg),
          const SizedBox(height: 12),
        ],

        // Current task (if streaming)
        if (task != null && state.isStreaming) ...[
          // Prompt
          _buildPromptBubble(task.prompt),
          const SizedBox(height: 16),

          // Response card
          Container(
            decoration: BoxDecoration(
              color: Colors.grey[800]?.withOpacity(0.4),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.grey[700]!),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                TaskHeader(task: task, onCancel: _cancel),

                // Thinking
                if (task.thinking.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: ThinkingPanel(text: task.thinking),
                  ),

                // Activity
                if (task.activities.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: ActivityFeed(
                      activities: task.activities,
                      isLive: state.isStreaming,
                    ),
                  ),

                // Output
                if (task.outputChunks.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: OutputChunks(chunks: task.outputChunks),
                  ),

                // Loading
                if (task.outputChunks.isEmpty && task.activities.isEmpty && task.thinking.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(32),
                    child: Center(
                      child: Column(
                        children: [
                          SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          SizedBox(height: 12),
                          Text('Starting...', style: TextStyle(color: Colors.grey)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],

        // No content state
        if (messages.isEmpty && task == null)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(48),
              child: Column(
                children: [
                  Icon(Icons.chat_bubble_outline, size: 48, color: Colors.grey[700]),
                  const SizedBox(height: 16),
                  Text(
                    'Start a conversation',
                    style: TextStyle(color: Colors.grey[600]),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildPromptBubble(String prompt) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.85,
        ),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.blue[700],
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          prompt,
          style: const TextStyle(fontSize: 15),
        ),
      ),
    );
  }

  Widget _buildMessageBubble(Task msg) {
    // User message (prompt)
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.85,
            ),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.blue[700],
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              msg.prompt,
              style: const TextStyle(fontSize: 15),
            ),
          ),
        ),

        if (msg.fullOutput.isNotEmpty) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey[800]?.withOpacity(0.4),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              msg.fullOutput,
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey[200],
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildInputArea(bool isStreaming) {
    return Container(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 12,
        bottom: MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: BoxDecoration(
        color: Colors.grey[900],
        border: Border(
          top: BorderSide(color: Colors.grey[800]!),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _inputController,
              enabled: !isStreaming,
              maxLines: null,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                hintText: isStreaming ? 'Working...' : 'Enter a task...',
                filled: true,
                fillColor: Colors.grey[850],
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 12,
                ),
              ),
              onChanged: (_) => _saveState(),
              onSubmitted: (_) => _sendTask(),
            ),
          ),
          const SizedBox(width: 12),
          _buildActionButton(isStreaming),
        ],
      ),
    );
  }

  Widget _buildActionButton(bool isStreaming) {
    if (isStreaming) {
      return Container(
        width: 48,
        height: 48,
        decoration: const BoxDecoration(
          color: Colors.red,
          shape: BoxShape.circle,
        ),
        child: IconButton(
          onPressed: _cancel,
          icon: const Icon(Icons.stop, color: Colors.white),
        ),
      );
    }

    return Container(
      width: 48,
      height: 48,
      decoration: const BoxDecoration(
        color: Colors.blue,
        shape: BoxShape.circle,
      ),
      child: IconButton(
        onPressed: _sendTask,
        icon: const Icon(Icons.send, color: Colors.white),
      ),
    );
  }

  @override
  void dispose() {
    _saveState();
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}
