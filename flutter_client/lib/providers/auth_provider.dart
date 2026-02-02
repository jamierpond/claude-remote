import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../core/storage.dart';
import '../core/crypto.dart';
import '../core/websocket.dart';

class AuthState {
  final bool isPaired;
  final bool isAuthenticated;
  final String? serverUrl;
  final String? deviceId;
  final String? error;
  
  const AuthState({
    this.isPaired = false,
    this.isAuthenticated = false,
    this.serverUrl,
    this.deviceId,
    this.error,
  });
  
  AuthState copyWith({
    bool? isPaired,
    bool? isAuthenticated,
    String? serverUrl,
    String? deviceId,
    String? error,
  }) {
    return AuthState(
      isPaired: isPaired ?? this.isPaired,
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      serverUrl: serverUrl ?? this.serverUrl,
      deviceId: deviceId ?? this.deviceId,
      error: error,
    );
  }
}

final storageProvider = Provider<StorageService>((ref) {
  final storage = StorageService();
  // Note: init() must be called before use
  return storage;
});

final cryptoProvider = Provider<CryptoService>((ref) {
  return CryptoService();
});

final authStateProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(
    storage: ref.watch(storageProvider),
    crypto: ref.watch(cryptoProvider),
  );
});

class AuthNotifier extends StateNotifier<AuthState> {
  final StorageService storage;
  final CryptoService crypto;
  WebSocketManager? _ws;
  
  AuthNotifier({
    required this.storage,
    required this.crypto,
  }) : super(const AuthState()) {
    _init();
  }
  
  WebSocketManager? get webSocket => _ws;
  
  Future<void> _init() async {
    await storage.init();
    
    final serverUrl = storage.getServerUrl();
    final deviceId = await storage.getDeviceId();
    final sharedSecret = await storage.getSharedSecret();
    final isPaired = storage.isPaired && sharedSecret != null;
    
    if (isPaired && sharedSecret != null) {
      await crypto.restoreSharedSecret(sharedSecret);
    }
    
    state = state.copyWith(
      isPaired: isPaired,
      serverUrl: serverUrl,
      deviceId: deviceId,
    );
  }
  
  Future<void> pair(String serverUrl, String token) async {
    final getUrl = '$serverUrl/api/pair/$token';

    // Step 1: Generate key pair
    debugPrint('[AUTH] Step 1: Generating key pair...');
    String publicKey;
    try {
      publicKey = await crypto.generateKeyPair();
      debugPrint('[AUTH] Step 1 OK: Generated public key (${publicKey.length} chars)');
    } catch (e, stack) {
      debugPrint('[AUTH] Step 1 FAILED: $e\n$stack');
      throw Exception('Failed to generate key pair: $e');
    }

    // Step 2: GET server's public key
    debugPrint('[AUTH] Step 2: GET $getUrl');
    Map<String, dynamic> getResponse;
    try {
      getResponse = await _httpGet(getUrl);
      debugPrint('[AUTH] Step 2 OK: Got response: $getResponse');
    } catch (e, stack) {
      debugPrint('[AUTH] Step 2 FAILED: $e\n$stack');
      throw Exception('Failed to get server public key from $getUrl: $e');
    }

    final serverPublicKey = getResponse['serverPublicKey'] as String?;
    if (serverPublicKey == null || serverPublicKey.isEmpty) {
      debugPrint('[AUTH] Step 2 FAILED: No serverPublicKey in response');
      throw Exception('Server response missing serverPublicKey. Got: $getResponse');
    }
    debugPrint('[AUTH] Step 2 OK: Server public key (${serverPublicKey.length} chars)');

    // Step 3: POST client's public key
    debugPrint('[AUTH] Step 3: POST $getUrl with clientPublicKey');
    Map<String, dynamic> postResponse;
    try {
      postResponse = await _httpPost(getUrl, {'clientPublicKey': publicKey});
      debugPrint('[AUTH] Step 3 OK: Got response: $postResponse');
    } catch (e, stack) {
      debugPrint('[AUTH] Step 3 FAILED: $e\n$stack');
      throw Exception('Failed to complete pairing POST: $e');
    }

    final deviceId = postResponse['deviceId'] as String?;
    if (deviceId == null || deviceId.isEmpty) {
      debugPrint('[AUTH] Step 3 FAILED: No deviceId in response');
      throw Exception('Server response missing deviceId. Got: $postResponse');
    }
    debugPrint('[AUTH] Step 3 OK: Got deviceId: $deviceId');

    // Step 4: Derive shared secret
    debugPrint('[AUTH] Step 4: Deriving shared secret...');
    try {
      await crypto.deriveSharedSecret(serverPublicKey);
      debugPrint('[AUTH] Step 4 OK: Derived shared secret');
    } catch (e, stack) {
      debugPrint('[AUTH] Step 4 FAILED: $e\n$stack');
      throw Exception('Failed to derive shared secret: $e');
    }

    // Step 5: Save to storage
    debugPrint('[AUTH] Step 5: Saving to storage...');
    try {
      final secret = await crypto.exportSharedSecret();
      if (secret != null) {
        await storage.saveSharedSecret(secret);
      }
      await storage.saveDeviceId(deviceId);
      await storage.saveServerUrl(serverUrl);
      await storage.setIsPaired(true);
      debugPrint('[AUTH] Step 5 OK: Saved to storage');
    } catch (e, stack) {
      debugPrint('[AUTH] Step 5 FAILED: $e\n$stack');
      throw Exception('Failed to save pairing data: $e');
    }

    state = state.copyWith(
      isPaired: true,
      serverUrl: serverUrl,
      deviceId: deviceId,
    );
    debugPrint('[AUTH] Pairing complete!');
  }
  
  Future<void> authenticate(String pin) async {
    final serverUrl = state.serverUrl;
    if (serverUrl == null) {
      throw StateError('Not paired');
    }
    
    _ws = WebSocketManager(serverUrl: serverUrl, crypto: crypto);
    
    // Listen for auth response
    _ws!.messageStream.listen((msg) {
      if (msg.type == 'auth_ok') {
        state = state.copyWith(isAuthenticated: true, error: null);
      } else if (msg.type == 'auth_error') {
        state = state.copyWith(error: msg.error ?? 'Authentication failed');
      }
    });
    
    await _ws!.connect();
    await _ws!.authenticate(pin);
  }
  
  Future<void> unpair() async {
    await storage.clearSecure();
    await storage.setIsPaired(false);
    _ws?.dispose();
    _ws = null;
    state = const AuthState();
  }
  
  Future<Map<String, dynamic>> _httpGet(String url) async {
    final response = await http.get(Uri.parse(url));
    if (response.statusCode != 200) {
      throw Exception('HTTP ${response.statusCode}: ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _httpPost(String url, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    if (response.statusCode != 200) {
      throw Exception('HTTP ${response.statusCode}: ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }
}
