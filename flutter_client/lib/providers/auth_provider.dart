import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../core/storage.dart';
import '../core/crypto.dart';
import '../core/websocket.dart';
import '../models/server.dart';

class AuthState {
  final List<Server> servers;
  final Server? activeServer;
  final bool isAuthenticated;
  final String? error;
  final bool isLoading;

  const AuthState({
    this.servers = const [],
    this.activeServer,
    this.isAuthenticated = false,
    this.error,
    this.isLoading = true,
  });

  bool get isPaired => servers.isNotEmpty;
  String? get serverUrl => activeServer?.serverUrl;
  String? get deviceId => activeServer?.deviceId;

  AuthState copyWith({
    List<Server>? servers,
    Server? activeServer,
    bool? isAuthenticated,
    String? error,
    bool? isLoading,
    bool clearActiveServer = false,
  }) {
    return AuthState(
      servers: servers ?? this.servers,
      activeServer: clearActiveServer ? null : (activeServer ?? this.activeServer),
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      error: error,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

final storageProvider = Provider<StorageService>((ref) {
  final storage = StorageService();
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

    // Run migration from single-server format if needed
    await storage.migrateFromSingleServer();

    // Load servers and active server ID
    final servers = await storage.getServers();
    final activeServerId = storage.getActiveServerId();

    Server? activeServer;
    if (servers.isNotEmpty) {
      // Find active server, or default to first one
      activeServer = servers.firstWhere(
        (s) => s.id == activeServerId,
        orElse: () => servers.first,
      );
      // Restore crypto state for active server
      await crypto.restoreSharedSecret(activeServer.sharedSecret);
    }

    state = state.copyWith(
      servers: servers,
      activeServer: activeServer,
      isLoading: false,
    );
  }

  /// Pair with a new server and add it to the list
  Future<void> pair(String serverUrl, String token) async {
    final getUrl = '$serverUrl/pair/$token';

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

    // Step 5: Create and save server
    debugPrint('[AUTH] Step 5: Saving server...');
    try {
      final secret = await crypto.exportSharedSecret();
      if (secret == null) {
        throw Exception('Failed to export shared secret');
      }

      // Generate name from hostname
      final uri = Uri.parse(serverUrl);
      final name = Server.nameFromHostname(uri.host);

      final server = Server(
        id: _generateUuid(),
        name: name,
        serverUrl: serverUrl,
        deviceId: deviceId,
        sharedSecret: secret,
        pairedAt: DateTime.now(),
      );

      // Add to existing servers
      final updatedServers = [...state.servers, server];
      await storage.saveServers(updatedServers);
      await storage.saveActiveServerId(server.id);

      state = state.copyWith(
        servers: updatedServers,
        activeServer: server,
        isAuthenticated: false,
      );

      debugPrint('[AUTH] Step 5 OK: Server saved as "${server.name}"');
    } catch (e, stack) {
      debugPrint('[AUTH] Step 5 FAILED: $e\n$stack');
      throw Exception('Failed to save pairing data: $e');
    }

    debugPrint('[AUTH] Pairing complete!');
  }

  /// Authenticate with the active server using PIN
  Future<void> authenticate(String pin) async {
    final server = state.activeServer;
    if (server == null) {
      throw StateError('No active server');
    }

    // Ensure crypto is set up with this server's secret
    await crypto.restoreSharedSecret(server.sharedSecret);

    _ws = WebSocketManager(serverUrl: server.serverUrl, crypto: crypto);

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

  /// Switch to a different server (disconnects current, requires re-auth)
  Future<void> selectServer(String serverId) async {
    final server = state.servers.firstWhere(
      (s) => s.id == serverId,
      orElse: () => throw StateError('Server not found: $serverId'),
    );

    // Disconnect current WebSocket
    _ws?.dispose();
    _ws = null;

    // Restore crypto for new server
    await crypto.restoreSharedSecret(server.sharedSecret);

    // Save active server
    await storage.saveActiveServerId(server.id);

    state = state.copyWith(
      activeServer: server,
      isAuthenticated: false,
      error: null,
    );
  }

  /// Rename a server
  Future<void> renameServer(String serverId, String newName) async {
    final updatedServers = state.servers.map((s) {
      if (s.id == serverId) {
        return s.copyWith(name: newName);
      }
      return s;
    }).toList();

    await storage.saveServers(updatedServers);

    final updatedActive = state.activeServer?.id == serverId
        ? updatedServers.firstWhere((s) => s.id == serverId)
        : state.activeServer;

    state = state.copyWith(
      servers: updatedServers,
      activeServer: updatedActive,
    );
  }

  /// Unpair a specific server
  Future<void> unpairServer(String serverId) async {
    // Disconnect if this is the active server
    if (state.activeServer?.id == serverId) {
      _ws?.dispose();
      _ws = null;
    }

    final updatedServers = state.servers.where((s) => s.id != serverId).toList();
    await storage.saveServers(updatedServers);

    // Select a new active server if needed
    Server? newActive;
    if (state.activeServer?.id == serverId && updatedServers.isNotEmpty) {
      newActive = updatedServers.first;
      await storage.saveActiveServerId(newActive.id);
      await crypto.restoreSharedSecret(newActive.sharedSecret);
    } else if (updatedServers.isEmpty) {
      await storage.saveActiveServerId(null);
      newActive = null;
    } else {
      newActive = state.activeServer;
    }

    state = state.copyWith(
      servers: updatedServers,
      activeServer: newActive,
      clearActiveServer: updatedServers.isEmpty,
      isAuthenticated: false,
    );
  }

  /// Unpair all servers (legacy method for compatibility)
  Future<void> unpair() async {
    _ws?.dispose();
    _ws = null;

    await storage.saveServers([]);
    await storage.saveActiveServerId(null);
    await storage.clearPin();

    state = const AuthState(isLoading: false);
  }

  /// Disconnect WebSocket without unpairing
  void disconnect() {
    _ws?.dispose();
    _ws = null;
    state = state.copyWith(isAuthenticated: false);
  }

  String _generateUuid() {
    final random = DateTime.now().millisecondsSinceEpoch;
    return '${random.toRadixString(16)}-${(random ~/ 1000).toRadixString(16)}-4${(random % 0xfff).toRadixString(16)}-${(0x8 + (random % 4)).toRadixString(16)}${((random * 17) % 0xfff).toRadixString(16)}-${(random * 31).toRadixString(16).padLeft(12, '0').substring(0, 12)}';
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
