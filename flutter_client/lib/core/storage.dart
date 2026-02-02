import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
  
  // === Regular Storage (UI state) ===
  
  Future<void> saveServerUrl(String url) async {
    await _prefs?.setString('server_url', url);
  }
  
  String? getServerUrl() {
    return _prefs?.getString('server_url');
  }
  
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
  
  bool get isPaired {
    return _prefs?.getBool('is_paired') ?? false;
  }
  
  Future<void> setIsPaired(bool value) async {
    await _prefs?.setBool('is_paired', value);
  }
}
