import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/server.dart';
import '../../providers/auth_provider.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';

/// Bottom sheet for switching between paired servers
class ServerSwitcher extends ConsumerStatefulWidget {
  const ServerSwitcher({super.key});

  @override
  ConsumerState<ServerSwitcher> createState() => _ServerSwitcherState();
}

class _ServerSwitcherState extends ConsumerState<ServerSwitcher> {
  String? _editingServerId;
  final _nameController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _selectServer(Server server) async {
    final authState = ref.read(authStateProvider);
    if (server.id == authState.activeServer?.id) {
      // Already selected
      Navigator.of(context).pop();
      return;
    }

    await ref.read(authStateProvider.notifier).selectServer(server.id);
    if (mounted) {
      Navigator.of(context).pop();
      // Navigate to PIN screen since switching servers requires re-auth
      context.go('/pin');
    }
  }

  Future<void> _unpairServer(Server server) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Remove Server?'),
        content: Text('Remove "${server.name}" from your paired servers?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await ref.read(authStateProvider.notifier).unpairServer(server.id);

      // Check if we need to navigate
      if (mounted) {
        final authState = ref.read(authStateProvider);
        if (authState.servers.isEmpty) {
          Navigator.of(context).pop();
          context.go('/pair');
        }
      }
    }
  }

  void _startRename(Server server) {
    setState(() {
      _editingServerId = server.id;
      _nameController.text = server.name;
    });
  }

  Future<void> _saveRename(Server server) async {
    final newName = _nameController.text.trim();
    if (newName.isNotEmpty && newName != server.name) {
      await ref.read(authStateProvider.notifier).renameServer(server.id, newName);
    }
    setState(() {
      _editingServerId = null;
    });
  }

  void _cancelRename() {
    setState(() {
      _editingServerId = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final servers = authState.servers;
    final activeServer = authState.activeServer;

    return Container(
      padding: EdgeInsets.only(
        top: AppSpacing.lg,
        bottom: MediaQuery.of(context).padding.bottom + AppSpacing.lg,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Row(
              children: [
                const Icon(Icons.dns, color: AppColors.primary, size: 24),
                AppSpacing.gapHorizontalMd,
                const Text(
                  'Servers',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                const Spacer(),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, color: AppColors.textMuted),
                ),
              ],
            ),
          ),

          const Divider(color: AppColors.border),

          // Server list
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.4,
            ),
            child: ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              itemCount: servers.length,
              itemBuilder: (context, index) {
                final server = servers[index];
                final isActive = server.id == activeServer?.id;
                final isEditing = _editingServerId == server.id;

                return Dismissible(
                  key: Key(server.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: AppSpacing.lg),
                    color: AppColors.error,
                    child: const Icon(Icons.delete, color: AppColors.textOnPrimary),
                  ),
                  confirmDismiss: (_) async {
                    await _unpairServer(server);
                    return false; // We handle removal ourselves
                  },
                  child: Card(
                    color: isActive ? AppColors.primary.withOpacity(0.1) : AppColors.surfaceVariant,
                    margin: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                    child: InkWell(
                      onTap: isEditing ? null : () => _selectServer(server),
                      onLongPress: () => _startRename(server),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: Row(
                          children: [
                            // Status indicator
                            Container(
                              width: 12,
                              height: 12,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: isActive ? AppColors.success : AppColors.textMuted.withOpacity(0.3),
                              ),
                            ),
                            AppSpacing.gapHorizontalMd,

                            // Server info
                            Expanded(
                              child: isEditing
                                  ? TextField(
                                      controller: _nameController,
                                      autofocus: true,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w500,
                                        color: AppColors.textPrimary,
                                      ),
                                      decoration: const InputDecoration(
                                        border: InputBorder.none,
                                        isDense: true,
                                        contentPadding: EdgeInsets.zero,
                                      ),
                                      onSubmitted: (_) => _saveRename(server),
                                    )
                                  : Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          server.name,
                                          style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w500,
                                            color: isActive ? AppColors.primary : AppColors.textPrimary,
                                          ),
                                        ),
                                        Text(
                                          server.serverUrl,
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: AppColors.textMuted,
                                          ),
                                        ),
                                      ],
                                    ),
                            ),

                            // Actions
                            if (isEditing) ...[
                              IconButton(
                                onPressed: () => _saveRename(server),
                                icon: const Icon(Icons.check, color: AppColors.success, size: 20),
                                constraints: const BoxConstraints(),
                                padding: const EdgeInsets.all(AppSpacing.sm),
                              ),
                              IconButton(
                                onPressed: _cancelRename,
                                icon: const Icon(Icons.close, color: AppColors.textMuted, size: 20),
                                constraints: const BoxConstraints(),
                                padding: const EdgeInsets.all(AppSpacing.sm),
                              ),
                            ] else ...[
                              if (isActive)
                                const Icon(Icons.check_circle, color: AppColors.success, size: 20)
                              else
                                Icon(Icons.chevron_right, color: AppColors.textMuted.withOpacity(0.5)),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),

          const Divider(color: AppColors.border),

          // Add server button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: TextButton.icon(
              onPressed: () {
                Navigator.of(context).pop();
                context.go('/pair');
              },
              icon: const Icon(Icons.add_circle_outline),
              label: const Text('Add New Server'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primary,
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Show the server switcher as a modal bottom sheet
Future<void> showServerSwitcher(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (_) => const ServerSwitcher(),
  );
}
