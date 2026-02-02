import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../providers/auth_provider.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';
import '../theme/typography.dart';

class PairScreen extends ConsumerStatefulWidget {
  final String? token;

  const PairScreen({super.key, this.token});

  @override
  ConsumerState<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends ConsumerState<PairScreen> {
  final _urlController = TextEditingController();
  bool _showScanner = false;
  bool _isPairing = false;
  String? _inputUrl;
  String? _serverUrl;
  String? _token;
  String? _error;
  String _log = '';

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  void _addLog(String msg) {
    debugPrint(msg);
    setState(() => _log = '$_log\n$msg');
  }

  /// Parse a pairing URL and extract server URL + token
  void _parseUrl(String url, {String source = 'INPUT'}) {
    _addLog('[$source] Parsing: $url');

    setState(() {
      _inputUrl = url;
      _error = null;
    });

    final uri = Uri.tryParse(url.trim());
    if (uri == null) {
      setState(() => _error = 'Failed to parse URL: $url');
      return;
    }

    _addLog('[$source] host=${uri.host} path=${uri.path}');

    // Extract token from path
    final segments = uri.pathSegments;
    if (segments.length < 2 || segments[0] != 'pair') {
      setState(() => _error = 'Invalid path. Expected /pair/TOKEN, got ${uri.path}');
      return;
    }

    final token = segments[1];

    // Map client URL to server URL
    String serverUrl;
    if (uri.host == 'localhost' || uri.host == '127.0.0.1') {
      serverUrl = '${uri.scheme}://${uri.host}:6767';
    } else if (uri.host == 'ai.pond.audio') {
      serverUrl = 'https://ai-server.pond.audio';
    } else {
      serverUrl = '${uri.scheme}://${uri.host}';
      if (uri.hasPort) serverUrl += ':${uri.port}';
    }

    _addLog('[$source] serverUrl=$serverUrl token=$token');

    setState(() {
      _serverUrl = serverUrl;
      _token = token;
    });
  }

  void _onDetect(BarcodeCapture capture) {
    final code = capture.barcodes.firstOrNull?.rawValue;
    if (code == null) return;

    setState(() => _showScanner = false);
    _parseUrl(code, source: 'QR');
  }

  void _onPasteUrl() {
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Please enter a URL');
      return;
    }
    _parseUrl(url, source: 'PASTE');
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null && data!.text!.isNotEmpty) {
      _urlController.text = data.text!;
      _onPasteUrl();
    }
  }

  Future<void> _doPairing() async {
    if (_serverUrl == null || _token == null) {
      setState(() => _error = 'No server URL or token. Scan QR or paste link first.');
      return;
    }

    setState(() {
      _isPairing = true;
      _error = null;
    });

    _addLog('[PAIR] Starting: $_serverUrl/api/pair/$_token');

    try {
      await ref.read(authStateProvider.notifier).pair(_serverUrl!, _token!);
      _addLog('[PAIR] SUCCESS!');
      if (mounted) {
        context.go('/pin');
      }
    } catch (e, stack) {
      _addLog('[PAIR] FAILED: $e');
      _addLog('[PAIR] Stack: $stack');
      setState(() => _error = e.toString());
    } finally {
      if (mounted) {
        setState(() => _isPairing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _error != null ? AppColors.errorMuted : AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Error display
            if (_error != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.lg),
                color: AppColors.error,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('ERROR', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: AppColors.textOnPrimary)),
                    AppSpacing.gapVerticalSm,
                    SelectableText(_error!, style: AppTypography.mono(color: AppColors.textOnPrimary)),
                  ],
                ),
              ),

            // Scanner or main content
            Expanded(
              child: _showScanner
                  ? MobileScanner(onDetect: _onDetect)
                  : SingleChildScrollView(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // === Option 1: QR Code ===
                          ElevatedButton.icon(
                            onPressed: () => setState(() => _showScanner = true),
                            icon: const Icon(Icons.qr_code_scanner),
                            label: const Text('SCAN QR CODE'),
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.all(20),
                              backgroundColor: AppColors.primary,
                              foregroundColor: AppColors.textOnPrimary,
                            ),
                          ),

                          AppSpacing.gapVerticalLg,

                          // Divider
                          Row(
                            children: [
                              const Expanded(child: Divider(color: AppColors.border)),
                              Padding(
                                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                                child: Text('OR', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                              ),
                              const Expanded(child: Divider(color: AppColors.border)),
                            ],
                          ),

                          AppSpacing.gapVerticalLg,

                          // === Option 2: Paste Link ===
                          const Text(
                            'Paste pairing link',
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 14, fontWeight: FontWeight.w500),
                          ),
                          AppSpacing.gapVerticalSm,

                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _urlController,
                                  style: AppTypography.mono(fontSize: 13, color: AppColors.textPrimary),
                                  decoration: InputDecoration(
                                    hintText: 'https://ai.pond.audio/pair/...',
                                    hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                                    filled: true,
                                    fillColor: AppColors.surface,
                                    border: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(AppRadius.sm),
                                      borderSide: BorderSide.none,
                                    ),
                                    contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.md),
                                  ),
                                  onSubmitted: (_) => _onPasteUrl(),
                                ),
                              ),
                              AppSpacing.gapHorizontalSm,
                              IconButton(
                                onPressed: _pasteFromClipboard,
                                icon: const Icon(Icons.content_paste, color: AppColors.primary),
                                tooltip: 'Paste from clipboard',
                                style: IconButton.styleFrom(
                                  backgroundColor: AppColors.surface,
                                  padding: const EdgeInsets.all(AppSpacing.md),
                                ),
                              ),
                            ],
                          ),

                          AppSpacing.gapVerticalSm,

                          OutlinedButton.icon(
                            onPressed: _onPasteUrl,
                            icon: const Icon(Icons.link),
                            label: const Text('USE LINK'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.all(16),
                              foregroundColor: AppColors.primary,
                              side: const BorderSide(color: AppColors.primary),
                            ),
                          ),

                          AppSpacing.gapVerticalXl,

                          // Parsed info
                          _infoBox('Input URL', _inputUrl ?? '(none)'),
                          AppSpacing.gapVerticalMd,
                          _infoBox('Server URL', _serverUrl ?? '(none)'),
                          AppSpacing.gapVerticalMd,
                          _infoBox('Token', _token ?? '(none)'),

                          AppSpacing.gapVerticalXl,

                          // PAIR button
                          ElevatedButton(
                            onPressed: (_serverUrl != null && _token != null && !_isPairing)
                                ? _doPairing
                                : null,
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.all(20),
                              backgroundColor: AppColors.success,
                              foregroundColor: AppColors.textOnPrimary,
                              disabledBackgroundColor: AppColors.surfaceVariant,
                            ),
                            child: _isPairing
                                ? const Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textOnPrimary)),
                                      SizedBox(width: 12),
                                      Text('PAIRING...'),
                                    ],
                                  )
                                : const Text('PAIR WITH SERVER', style: TextStyle(fontSize: 18)),
                          ),

                          AppSpacing.gapVerticalXl,

                          // Log
                          Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceVariant,
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Log:', style: TextStyle(color: AppColors.textMuted)),
                                AppSpacing.gapVerticalSm,
                                SelectableText(
                                  _log.isEmpty ? '(empty)' : _log,
                                  style: AppTypography.mono(fontSize: 11, color: AppColors.success),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
            ),

            // Cancel button when scanning
            if (_showScanner)
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: ElevatedButton(
                  onPressed: () => setState(() => _showScanner = false),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.error,
                    foregroundColor: AppColors.textOnPrimary,
                  ),
                  child: const Text('CANCEL'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _infoBox(String label, String value) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
          AppSpacing.gapVerticalXs,
          SelectableText(value, style: AppTypography.mono(fontSize: 14, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}
