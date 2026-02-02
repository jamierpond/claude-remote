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
  final _serverUrlController = TextEditingController();
  bool _isScanning = false;
  bool _isPairing = false;
  String? _error;
  String? _lastScanned;
  String? _pairingUrl;
  int _detectCount = 0;

  @override
  void initState() {
    super.initState();
    if (widget.token != null) {
      _handleDeepLink();
    }
  }

  void _handleDeepLink() {
    // Token provided via deep link - not implemented yet
  }

  Future<void> _pair(String serverUrl, String token) async {
    if (!mounted) return;

    setState(() {
      _isPairing = true;
      _error = null;
      _pairingUrl = '$serverUrl/api/pair/$token';
    });

    try {
      debugPrint('[PAIR] Starting pairing with $serverUrl, token=$token');
      await ref.read(authStateProvider.notifier).pair(serverUrl, token);
      debugPrint('[PAIR] Pairing succeeded!');
      if (mounted) {
        context.go('/pin');
      }
    } catch (e, stack) {
      debugPrint('[PAIR] ERROR: $e');
      debugPrint('[PAIR] Stack: $stack');
      if (mounted) {
        setState(() {
          _error = 'Pairing failed!\n\nServer: $serverUrl\nToken: $token\n\nError: $e';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isPairing = false;
        });
      }
    }
  }

  void _onQRScanned(String? code) {
    if (code == null || _isPairing || !_isScanning) return;

    debugPrint('[SCAN] QR scanned: $code');

    // Stop scanning immediately
    setState(() {
      _isScanning = false;
      _lastScanned = code;
    });

    try {
      final uri = Uri.tryParse(code);
      if (uri == null) {
        setState(() => _error = 'Could not parse QR code as URL:\n$code');
        return;
      }

      debugPrint('[SCAN] Parsed URI: scheme=${uri.scheme} host=${uri.host} port=${uri.port} path=${uri.path}');
      debugPrint('[SCAN] Path segments: ${uri.pathSegments}');

      final pathSegments = uri.pathSegments;
      if (pathSegments.length >= 2 && pathSegments[0] == 'pair') {
        final token = pathSegments[1];

        // Construct server URL
        // - localhost: client is 5173, server is 6767
        // - ai.pond.audio (client) -> ai-server.pond.audio (server)
        // - otherwise: assume same host
        String serverUrl;
        if (uri.host == 'localhost' || uri.host == '127.0.0.1') {
          serverUrl = '${uri.scheme}://${uri.host}:6767';
        } else if (uri.host == 'ai.pond.audio') {
          serverUrl = '${uri.scheme}://ai-server.pond.audio';
        } else if (uri.hasPort) {
          serverUrl = '${uri.scheme}://${uri.host}:${uri.port}';
        } else {
          serverUrl = '${uri.scheme}://${uri.host}';
        }

        debugPrint('[SCAN] Derived serverUrl: $serverUrl');
        debugPrint('[SCAN] Token: $token');

        _pair(serverUrl, token);
      } else {
        setState(() => _error = 'Invalid URL format.\n\nExpected path: /pair/TOKEN\nGot: ${uri.path}\n\nFull URL: $code');
      }
    } catch (e, stack) {
      debugPrint('[SCAN] Exception: $e');
      debugPrint('[SCAN] Stack: $stack');
      setState(() => _error = 'Error processing QR code:\n$e\n\nScanned: $code');
    }
  }
  
  @override
  Widget build(BuildContext context) {
    // Debug: show current state
    final stateStr = 'scanning=$_isScanning pairing=$_isPairing err=${_error != null} scanned=${_lastScanned != null}';

    return Scaffold(
      backgroundColor: _isPairing ? Colors.orange : (_error != null ? Colors.red.shade900 : null),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Always visible state debug
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                color: Colors.black87,
                child: Text(
                  stateStr,
                  style: const TextStyle(color: Colors.green, fontSize: 10, fontFamily: 'monospace'),
                ),
              ),
              if (_lastScanned != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(8),
                  color: Colors.blue.shade900,
                  child: Text(
                    'SCANNED: $_lastScanned',
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontFamily: 'monospace'),
                  ),
                ),
              const SizedBox(height: 16),
              const Icon(
                Icons.link,
                size: 64,
                color: Colors.blue,
              ),
              const SizedBox(height: 24),
              const Text(
                'Pair with Server',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Scan the QR code shown on your server',
                style: TextStyle(color: Colors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  constraints: const BoxConstraints(maxHeight: 200),
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red),
                  ),
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.error, color: Colors.red, size: 20),
                            SizedBox(width: 8),
                            Text('ERROR', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
                          ],
                        ),
                        const SizedBox(height: 8),
                        SelectableText(
                          _error!,
                          style: const TextStyle(color: Colors.red, fontSize: 12, fontFamily: 'monospace'),
                        ),
                      ],
                    ),
                  ),
                ),

              if (_lastScanned != null && _error == null && !_isPairing)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.blue.withOpacity(0.3)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Last scanned:', style: TextStyle(fontSize: 12, color: Colors.grey)),
                      const SizedBox(height: 4),
                      SelectableText(
                        _lastScanned!,
                        style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
                      ),
                    ],
                  ),
                ),
              
              if (_isPairing)
                Column(
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 16),
                    const Text('Pairing...'),
                    if (_pairingUrl != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        _pairingUrl!,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey[600],
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ],
                )
              else if (_isScanning)
                Expanded(
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        color: Colors.yellow,
                        child: Text(
                          'SCANNING - detections: $_detectCount',
                          style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
                        ),
                      ),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(16),
                          child: MobileScanner(
                            onDetect: (capture) {
                              debugPrint('[DETECT] onDetect fired! barcodes: ${capture.barcodes.length}');
                              setState(() => _detectCount++);
                              for (final barcode in capture.barcodes) {
                                debugPrint('[DETECT] barcode: format=${barcode.format} rawValue=${barcode.rawValue}');
                              }
                              final barcode = capture.barcodes.firstOrNull;
                              if (barcode != null && barcode.rawValue != null) {
                                _onQRScanned(barcode.rawValue);
                              } else {
                                debugPrint('[DETECT] No valid barcode rawValue');
                                setState(() => _error = 'Detected barcode but no rawValue. Format: ${barcode?.format}');
                              }
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                )
              else
                ElevatedButton.icon(
                  onPressed: () => setState(() => _isScanning = true),
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text('Scan QR Code'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 16,
                    ),
                  ),
                ),
              
              if (_isScanning) ...[
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => setState(() => _isScanning = false),
                  child: const Text('Cancel'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
  
  @override
  void dispose() {
    _serverUrlController.dispose();
    super.dispose();
  }
}
