import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../providers/auth_provider.dart';

class PairScreen extends ConsumerStatefulWidget {
  final String? token;

  const PairScreen({super.key, this.token});

  @override
  ConsumerState<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends ConsumerState<PairScreen> {
  bool _showScanner = false;
  bool _isPairing = false;
  String? _scannedUrl;
  String? _serverUrl;
  String? _token;
  String? _error;
  String _log = '';

  void _addLog(String msg) {
    debugPrint(msg);
    setState(() => _log = '$_log\n$msg');
  }

  void _onDetect(BarcodeCapture capture) {
    final code = capture.barcodes.firstOrNull?.rawValue;
    if (code == null) return;

    _addLog('[SCAN] Detected: $code');

    setState(() {
      _showScanner = false;
      _scannedUrl = code;
      _error = null;
    });

    // Parse the URL
    final uri = Uri.tryParse(code);
    if (uri == null) {
      setState(() => _error = 'Failed to parse URL: $code');
      return;
    }

    _addLog('[SCAN] host=${uri.host} path=${uri.path}');

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

    _addLog('[SCAN] serverUrl=$serverUrl token=$token');

    setState(() {
      _serverUrl = serverUrl;
      _token = token;
    });
  }

  Future<void> _doPairing() async {
    if (_serverUrl == null || _token == null) {
      setState(() => _error = 'No server URL or token. Scan a QR code first.');
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
      backgroundColor: _error != null ? Colors.red.shade900 : Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            // Error display - always visible if error
            if (_error != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                color: Colors.red,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('ERROR', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                    const SizedBox(height: 8),
                    SelectableText(_error!, style: const TextStyle(fontFamily: 'monospace')),
                  ],
                ),
              ),

            // Scanner or main content
            Expanded(
              child: _showScanner
                  ? MobileScanner(onDetect: _onDetect)
                  : SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Scan button
                          ElevatedButton.icon(
                            onPressed: () => setState(() => _showScanner = true),
                            icon: const Icon(Icons.qr_code_scanner),
                            label: const Text('SCAN QR CODE'),
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.all(20),
                              backgroundColor: Colors.blue,
                            ),
                          ),

                          const SizedBox(height: 24),

                          // Scanned URL
                          _infoBox('Scanned URL', _scannedUrl ?? '(none)'),

                          const SizedBox(height: 12),

                          // Derived server URL
                          _infoBox('Server URL', _serverUrl ?? '(none)'),

                          const SizedBox(height: 12),

                          // Token
                          _infoBox('Token', _token ?? '(none)'),

                          const SizedBox(height: 24),

                          // PAIR button
                          ElevatedButton(
                            onPressed: (_serverUrl != null && _token != null && !_isPairing)
                                ? _doPairing
                                : null,
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.all(20),
                              backgroundColor: Colors.green,
                            ),
                            child: _isPairing
                                ? const Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                                      SizedBox(width: 12),
                                      Text('PAIRING...'),
                                    ],
                                  )
                                : const Text('PAIR WITH SERVER', style: TextStyle(fontSize: 18)),
                          ),

                          const SizedBox(height: 24),

                          // Log
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.grey.shade900,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Log:', style: TextStyle(color: Colors.grey)),
                                const SizedBox(height: 8),
                                SelectableText(
                                  _log.isEmpty ? '(empty)' : _log,
                                  style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.green),
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
                padding: const EdgeInsets.all(16),
                child: ElevatedButton(
                  onPressed: () => setState(() => _showScanner = false),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
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
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade800,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 4),
          SelectableText(value, style: const TextStyle(fontFamily: 'monospace', fontSize: 14)),
        ],
      ),
    );
  }
}
