import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/server.dart';

/// Secure storage for sensitive data (keys, etc)
/// Regular storage for UI state
class StorageService {
  final _secureStorage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  
  SharedPreferences? _prefs;
  
  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }
  
  // === Secure Storage (keys, secrets) ===
  
  Future<void> saveSharedSecret(Uint8List secret) async {
    await _secureStorage.write(
      key: 'shared_secret',
      value: base64Encode(secret),
    );
  }
  
  Future<Uint8List?> getSharedSecret() async {
    final value = await _secureStorage.read(key: 'shared_secret');
    if (value == null) return null;
    return base64Decode(value);
  }
  
  Future<void> saveDeviceId(String deviceId) async {
    await _secureStorage.write(key: 'device_id', value: deviceId);
  }
  
  Future<String?> getDeviceId() async {
    return await _secureStorage.read(key: 'device_id');
  }
  
  Future<void> clearSecure() async {
    await _secureStorage.deleteAll();
  }

  // Store PIN securely for biometric unlock
  Future<void> savePin(String pin) async {
    await _secureStorage.write(key: 'auth_pin', value: pin);
  }

  Future<String?> getPin() async {
    return await _secureStorage.read(key: 'auth_pin');
  }

  Future<void> clearPin() async {
    await _secureStorage.delete(key: 'auth_pin');
  }

  // === Multi-Server Storage ===

  /// Save the list of paired servers
  Future<void> saveServers(List<Server> servers) async {
    final jsonList = servers.map((s) => s.toJson()).toList();
    await _secureStorage.write(
      key: 'servers',
      value: jsonEncode(jsonList),
    );
  }

  /// Get all paired servers
  Future<List<Server>> getServers() async {
    final value = await _secureStorage.read(key: 'servers');
    if (value == null) return [];
    try {
      final jsonList = jsonDecode(value) as List<dynamic>;
      return jsonList
          .map((j) => Server.fromJson(j as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('[storage] Failed to parse servers: $e');
      return [];
    }
  }

  /// Save the active server ID
  Future<void> saveActiveServerId(String? serverId) async {
    if (serverId == null) {
      await _prefs?.remove('active_server_id');
    } else {
      await _prefs?.setString('active_server_id', serverId);
    }
  }

  /// Get the active server ID
  String? getActiveServerId() {
    return _prefs?.getString('active_server_id');
  }

  /// Migrate from single-server storage to multi-server
  /// Returns true if migration was performed
  Future<bool> migrateFromSingleServer() async {
    // Check if migration is needed (old keys exist, new format doesn't)
    final existingServers = await getServers();
    if (existingServers.isNotEmpty) {
      debugPrint('[storage] Migration skipped: already have servers');
      return false;
    }

    final sharedSecret = await getSharedSecret();
    final deviceId = await getDeviceId();
    final serverUrl = _prefs?.getString('server_url');
    final isPaired = _prefs?.getBool('is_paired') ?? false;

    if (!isPaired || sharedSecret == null || deviceId == null || serverUrl == null) {
      debugPrint('[storage] Migration skipped: no legacy pairing data');
      return false;
    }

    debugPrint('[storage] Migrating legacy server: $serverUrl');

    // Create server from legacy data
    final uri = Uri.tryParse(serverUrl);
    final hostname = uri?.host ?? 'Server';
    final name = Server.nameFromHostname(hostname);

    final server = Server(
      id: _generateUuid(),
      name: name,
      serverUrl: serverUrl,
      deviceId: deviceId,
      sharedSecret: sharedSecret,
      pairedAt: DateTime.now(),
    );

    // Save in new format
    await saveServers([server]);
    await saveActiveServerId(server.id);

    // Clear old keys
    await _secureStorage.delete(key: 'shared_secret');
    await _secureStorage.delete(key: 'device_id');
    await _prefs?.remove('server_url');
    await _prefs?.remove('is_paired');

    debugPrint('[storage] Migration complete: ${server.name}');
    return true;
  }

  String _generateUuid() {
    // Simple UUID v4 generation
    final random = DateTime.now().millisecondsSinceEpoch;
    return '${random.toRadixString(16)}-${(random ~/ 1000).toRadixString(16)}-4${(random % 0xfff).toRadixString(16)}-${(0x8 + (random % 4)).toRadixString(16)}${((random * 17) % 0xfff).toRadixString(16)}-${(random * 31).toRadixString(16).padLeft(12, '0').substring(0, 12)}';
  }

  // === Regular Storage (UI state) ===
  
  Future<void> saveActiveProject(String? projectId) async {
    if (projectId == null) {
      await _prefs?.remove('active_project');
    } else {
      await _prefs?.setString('active_project', projectId);
    }
  }
  
  String? getActiveProject() {
    return _prefs?.getString('active_project');
  }
  
  Future<void> saveInputDraft(String text) async {
    await _prefs?.setString('input_draft', text);
  }
  
  String getInputDraft() {
    return _prefs?.getString('input_draft') ?? '';
  }
  
  Future<void> clearInputDraft() async {
    await _prefs?.remove('input_draft');
  }
  
  Future<void> saveScrollPosition(double position) async {
    await _prefs?.setDouble('scroll_position', position);
  }
  
  double getScrollPosition() {
    return _prefs?.getDouble('scroll_position') ?? 0.0;
  }
}
