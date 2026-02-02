import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/auth_provider.dart';
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
  final _inputFocusNode = FocusNode();
  
  @override
  void initState() {
    super.initState();
    _restoreState();
  }
  
  Future<void> _restoreState() async {
    final storage = ref.read(storageProvider);
    _inputController.text = storage.getInputDraft();
    
    // Restore scroll position after build
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
    final text = _inputController.text.trim();
    if (text.isEmpty) return;
    
    _inputController.clear();
    ref.read(storageProvider).clearInputDraft();
    
    try {
      await ref.read(taskProvider.notifier).sendTask(text);
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
    await ref.read(taskProvider.notifier).cancel();
  }
  
  @override
  Widget build(BuildContext context) {
    final task = ref.watch(taskProvider);
    final isRunning = task?.isRunning ?? false;
    
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Task header (if task is active)
            if (task != null)
              TaskHeader(
                task: task,
                onCancel: _cancel,
              ),
            
            // Main content
            Expanded(
              child: task == null
                  ? _buildEmptyState()
                  : _buildTaskContent(task),
            ),
            
            // Input area
            _buildInputArea(isRunning),
          ],
        ),
      ),
    );
  }
  
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.chat_bubble_outline,
            size: 64,
            color: Colors.grey[700],
          ),
          const SizedBox(height: 16),
          Text(
            'Ready for a task',
            style: TextStyle(
              fontSize: 18,
              color: Colors.grey[500],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Enter a prompt below to get started',
            style: TextStyle(
              color: Colors.grey[600],
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildTaskContent(Task task) {
    return ListView(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      children: [
        // Prompt
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.blue.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.blue.withOpacity(0.3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.person, size: 16, color: Colors.blue),
                  const SizedBox(width: 8),
                  Text(
                    'You',
                    style: TextStyle(
                      color: Colors.blue[300],
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                task.prompt,
                style: const TextStyle(fontSize: 15),
              ),
            ],
          ),
        ),
        
        const SizedBox(height: 16),
        
        // Thinking panel
        if (task.thinking.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: ThinkingPanel(text: task.thinking),
          ),
        
        // Activity feed
        if (task.activities.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: ActivityFeed(
              activities: task.activities,
              isLive: task.isRunning,
            ),
          ),
        
        // Output chunks
        if (task.outputChunks.isNotEmpty)
          OutputChunks(chunks: task.outputChunks),
        
        // Loading indicator
        if (task.isRunning && task.outputChunks.isEmpty && task.activities.isEmpty)
          const Padding(
            padding: EdgeInsets.all(32),
            child: Center(
              child: Column(
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Starting...'),
                ],
              ),
            ),
          ),
        
        // Error display
        if (task.error != null)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.red.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.red.withOpacity(0.3)),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.red),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    task.error!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
  
  Widget _buildInputArea(bool isRunning) {
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
              focusNode: _inputFocusNode,
              enabled: !isRunning,
              maxLines: null,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                hintText: isRunning ? 'Working...' : 'Enter a task...',
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
          _buildActionButton(isRunning),
        ],
      ),
    );
  }
  
  Widget _buildActionButton(bool isRunning) {
    if (isRunning) {
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
    _inputFocusNode.dispose();
    super.dispose();
  }
}
