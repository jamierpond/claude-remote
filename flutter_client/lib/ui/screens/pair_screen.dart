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
  
  @override
  void initState() {
    super.initState();
    if (widget.token != null) {
      // Token provided via deep link - extract server URL
      _handleDeepLink();
    }
  }
  
  void _handleDeepLink() {
    // Parse token from URL - format: https://ai.pond.audio/pair/{token}
    // For now, require manual server URL entry
  }
  
  String? _pairingUrl;

  Future<void> _pair(String serverUrl, String token) async {
    setState(() {
      _isPairing = true;
      _error = null;
      _pairingUrl = '$serverUrl/pair/$token';
    });

    try {
      await ref.read(authStateProvider.notifier).pair(serverUrl, token);
      if (mounted) {
        context.go('/pin');
      }
    } catch (e) {
      setState(() {
        _error = 'Failed to pair with $serverUrl\n\nError: $e';
      });
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

    // Stop scanning immediately
    setState(() => _isScanning = false);

    // Parse URL: https://server/pair/{token}
    final uri = Uri.tryParse(code);
    if (uri == null) {
      setState(() => _error = 'Invalid QR code: $code');
      return;
    }

    final pathSegments = uri.pathSegments;
    if (pathSegments.length >= 2 && pathSegments[0] == 'pair') {
      final token = pathSegments[1];

      // QR code contains client URL (port 5173), but API is on server (port 6767)
      // For localhost, swap ports. For production, assume same host.
      var serverUrl = '${uri.scheme}://${uri.host}';
      if (uri.host == 'localhost' || uri.host == '127.0.0.1') {
        // Local dev: client is 5173, server is 6767
        serverUrl = '${uri.scheme}://${uri.host}:6767';
      } else if (uri.hasPort) {
        serverUrl = '${uri.scheme}://${uri.host}:${uri.port}';
      }

      _pair(serverUrl, token);
    } else {
      setState(() => _error = 'Invalid pairing URL format.\nExpected: https://server/pair/TOKEN\nGot: $code');
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
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
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.red),
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
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: MobileScanner(
                      onDetect: (capture) {
                        final barcode = capture.barcodes.firstOrNull;
                        if (barcode != null) {
                          _onQRScanned(barcode.rawValue);
                        }
                      },
                    ),
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
