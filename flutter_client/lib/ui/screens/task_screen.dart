import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/project_provider.dart';
import '../../providers/auth_provider.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';
import '../widgets/project_tabs.dart';
import '../widgets/project_picker.dart';
import '../widgets/git_status_badge.dart';
import '../widgets/task_header.dart';
import '../widgets/thinking_panel.dart';
import '../widgets/tool_stack.dart';
import '../widgets/output_chunks.dart';

class TaskScreen extends ConsumerStatefulWidget {
  const TaskScreen({super.key});

  @override
  ConsumerState<TaskScreen> createState() => _TaskScreenState();
}

class _TaskScreenState extends ConsumerState<TaskScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  final _inputFocusNode = FocusNode();
  bool _showProjectPicker = false;
  bool _initialPickerShown = false;

  @override
  void initState() {
    super.initState();
    _restoreState();
    // Show project picker on first load if no projects open
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkInitialProjectPicker();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Listen for task state changes to scroll to bottom
    ref.listenManual(activeTaskStateProvider, (previous, next) {
      // Scroll to bottom when messages change or streaming starts
      if (previous?.messages.length != next.messages.length ||
          (previous?.isStreaming == false && next.isStreaming == true) ||
          previous?.currentTask?.outputChunks.length != next.currentTask?.outputChunks.length) {
        _scrollToBottom();
      }
    });

    // Scroll to bottom when active project changes
    ref.listenManual(projectProvider, (previous, next) {
      if (previous?.activeProjectId != next.activeProjectId) {
        // Delay to allow messages to load
        Future.delayed(const Duration(milliseconds: 100), _scrollToBottom);
      }
    });
  }

  void _checkInitialProjectPicker() {
    if (_initialPickerShown) return;
    final projectState = ref.read(projectProvider);
    if (projectState.openProjects.isEmpty) {
      setState(() {
        _showProjectPicker = true;
        _initialPickerShown = true;
      });
    }
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

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      });
    }
  }

  Future<void> _devReload() async {
    final authState = ref.read(authStateProvider);
    final serverUrl = authState.serverUrl;
    if (serverUrl == null) return;

    try {
      // Map client URL to server URL (ai.pond.audio -> ai-server.pond.audio)
      var apiUrl = serverUrl;
      if (serverUrl.contains('ai.pond.audio')) {
        apiUrl = serverUrl.replaceFirst('ai.pond.audio', 'ai-server.pond.audio');
      }
      await http.post(Uri.parse('$apiUrl/api/dev/full-reload'));
      print('[dev] Triggered full reload');
    } catch (e) {
      print('[dev] Failed to trigger reload: $e');
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
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  Future<void> _cancel() async {
    final projectId = ref.read(projectProvider).activeProjectId;
    if (projectId == null) return;

    // Update UI immediately via provider (optimistic cancel)
    // This ensures the UI always responds, even if network fails
    ref.read(taskManagerProvider.notifier).cancel(projectId);

    // Also send HTTP cancel to server (more reliable than WebSocket)
    // Don't await - fire and forget for responsiveness
    final authState = ref.read(authStateProvider);
    final serverUrl = authState.serverUrl;
    if (serverUrl != null) {
      var apiUrl = serverUrl;
      if (serverUrl.contains('ai.pond.audio')) {
        apiUrl = serverUrl.replaceFirst('ai.pond.audio', 'ai-server.pond.audio');
      }
      http.post(
        Uri.parse('$apiUrl/api/projects/${Uri.encodeComponent(projectId)}/cancel'),
      ).then((_) => print('[cancel] HTTP cancel sent'))
       .catchError((e) => print('[cancel] HTTP cancel failed: $e'));
    }
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

                // Tool Stack (separate panel for live tool activity)
                if (activeTaskState.currentTask != null &&
                    activeTaskState.currentTask!.activities.isNotEmpty)
                  ToolStack(
                    activities: activeTaskState.currentTask!.activities,
                    isLive: activeTaskState.isStreaming,
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
                  color: AppColors.background.withOpacity(0.8),
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
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      decoration: const BoxDecoration(
        color: AppColors.background,
        border: Border(
          bottom: BorderSide(color: AppColors.border),
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
                color: AppColors.textPrimary,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),

          // Git status
          if (gitStatus != null)
            Padding(
              padding: const EdgeInsets.only(left: AppSpacing.md),
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
            icon: const Icon(Icons.refresh, color: AppColors.textSecondary, size: 20),
            tooltip: 'Reset',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),

          // Dev reload button (web only)
          if (kIsWeb)
            IconButton(
              onPressed: _devReload,
              icon: const Icon(Icons.build, color: AppColors.warning, size: 20),
              tooltip: 'Dev Reload',
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
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                const Icon(
                  Icons.folder_open,
                  size: 48,
                  color: AppColors.textMuted,
                ),
                AppSpacing.gapVerticalLg,
                const Text(
                  'Select a project to start',
                  style: TextStyle(
                    fontSize: 16,
                    color: AppColors.textSecondary,
                  ),
                ),
                AppSpacing.gapVerticalLg,
                ElevatedButton.icon(
                  onPressed: () => setState(() => _showProjectPicker = true),
                  icon: const Icon(Icons.add),
                  label: const Text('Open Project'),
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
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        // Message history
        for (final msg in messages) ...[
          _buildMessageBubble(msg),
          AppSpacing.gapVerticalMd,
        ],

        // Current task (if streaming)
        if (task != null && state.isStreaming) ...[
          // Prompt
          _buildPromptBubble(task.prompt),
          AppSpacing.gapVerticalLg,

          // Response card (text/thinking only - tools shown in ToolStack)
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                TaskHeader(task: task, onCancel: _cancel),

                // Thinking
                if (task.thinking.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: ThinkingPanel(text: task.thinking),
                  ),

                // Output
                if (task.outputChunks.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: OutputChunks(chunks: task.outputChunks),
                  ),

                // Loading (only if no content yet)
                if (task.outputChunks.isEmpty && task.thinking.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(AppSpacing.xxl),
                    child: Center(
                      child: Column(
                        children: [
                          SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          AppSpacing.gapVerticalMd,
                          Text('Working...', style: TextStyle(color: AppColors.textMuted)),
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
          const Center(
            child: Padding(
              padding: EdgeInsets.all(48),
              child: Column(
                children: [
                  Icon(Icons.chat_bubble_outline, size: 48, color: AppColors.textMuted),
                  AppSpacing.gapVerticalLg,
                  Text(
                    'Start a conversation',
                    style: TextStyle(color: AppColors.textSecondary),
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
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(AppRadius.lg),
        ),
        child: Text(
          prompt,
          style: const TextStyle(fontSize: 15, color: AppColors.textOnPrimary),
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
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(AppRadius.lg),
            ),
            child: Text(
              msg.prompt,
              style: const TextStyle(fontSize: 15, color: AppColors.textOnPrimary),
            ),
          ),
        ),

        if (msg.fullOutput.isNotEmpty) ...[
          AppSpacing.gapVerticalMd,
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Text(
              msg.fullOutput,
              style: const TextStyle(
                fontSize: 14,
                color: AppColors.textPrimary,
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
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).padding.bottom + AppSpacing.md,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.border),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Focus(
              focusNode: _inputFocusNode,
              onKeyEvent: _handleKeyEvent,
              child: TextField(
                controller: _inputController,
                enabled: !isStreaming,
                maxLines: null,
                textCapitalization: TextCapitalization.sentences,
                textInputAction: TextInputAction.newline, // Allow multiline
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: InputDecoration(
                  hintText: isStreaming ? 'Working...' : 'Enter a task...',
                  hintStyle: const TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.surfaceVariant,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.xl),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: AppSpacing.md,
                  ),
                ),
                onChanged: (_) => _saveState(),
              ),
            ),
          ),
          AppSpacing.gapHorizontalMd,
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
          color: AppColors.error,
          shape: BoxShape.circle,
        ),
        child: IconButton(
          onPressed: _cancel,
          icon: const Icon(Icons.stop, color: AppColors.textOnPrimary),
        ),
      );
    }

    return Container(
      width: 48,
      height: 48,
      decoration: const BoxDecoration(
        color: AppColors.primary,
        shape: BoxShape.circle,
      ),
      child: IconButton(
        onPressed: _sendTask,
        icon: const Icon(Icons.send, color: AppColors.textOnPrimary),
      ),
    );
  }

  /// Handle keyboard events for Enter/Shift+Enter behavior
  KeyEventResult _handleKeyEvent(FocusNode node, KeyEvent event) {
    if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.enter) {
      final isShiftPressed = HardwareKeyboard.instance.isShiftPressed;
      if (!isShiftPressed) {
        // Enter without Shift: send the task
        _sendTask();
        return KeyEventResult.handled;
      }
      // Shift+Enter: allow default behavior (newline)
    }
    return KeyEventResult.ignored;
  }

  @override
  void dispose() {
    _saveState();
    _inputController.dispose();
    _scrollController.dispose();
    _inputFocusNode.dispose();
    super.dispose();
  }
}
