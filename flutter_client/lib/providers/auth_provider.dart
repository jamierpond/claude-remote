import 'package:flutter_riverpod/flutter_riverpod.dart';
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
    try {
      // Generate key pair
      final publicKey = await crypto.generateKeyPair();
      
      // Get server's public key
      final response = await _httpGet('$serverUrl/api/pair/$token');
      final serverPublicKey = response['serverPublicKey'] as String;
      
      // Complete pairing
      final pairResponse = await _httpPost(
        '$serverUrl/api/pair/$token',
        {'clientPublicKey': publicKey},
      );
      
      final deviceId = pairResponse['deviceId'] as String;
      
      // Derive shared secret
      await crypto.deriveSharedSecret(serverPublicKey);
      
      // Save to secure storage
      final secret = await crypto.exportSharedSecret();
      if (secret != null) {
        await storage.saveSharedSecret(secret);
      }
      await storage.saveDeviceId(deviceId);
      await storage.saveServerUrl(serverUrl);
      await storage.setIsPaired(true);
      
      state = state.copyWith(
        isPaired: true,
        serverUrl: serverUrl,
        deviceId: deviceId,
      );
    } catch (e) {
      state = state.copyWith(error: 'Pairing failed: $e');
      rethrow;
    }
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
  
  // HTTP helpers (simplified - use http package in real impl)
  Future<Map<String, dynamic>> _httpGet(String url) async {
    // TODO: implement with http package
    throw UnimplementedError();
  }
  
  Future<Map<String, dynamic>> _httpPost(String url, Map<String, dynamic> body) async {
    // TODO: implement with http package
    throw UnimplementedError();
  }
}
