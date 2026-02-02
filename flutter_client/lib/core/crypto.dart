import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

/// E2E encryption using ECDH key exchange + AES-256-GCM
/// Compatible with the Node.js server implementation
class CryptoService {
  final _ecdh = X25519();
  final _aes = AesGcm.with256bits();
  
  SimpleKeyPair? _keyPair;
  SecretKey? _sharedSecret;
  
  bool get hasSharedSecret => _sharedSecret != null;
  
  /// Generate a new ECDH key pair and return the public key as base64
  Future<String> generateKeyPair() async {
    _keyPair = await _ecdh.newKeyPair();
    final publicKey = await _keyPair!.extractPublicKey();
    return base64Encode(publicKey.bytes);
  }
  
  /// Derive shared secret from server's public key
  /// Server uses P-256, but we use X25519 for simplicity
  /// NOTE: Server needs to support X25519 or we need to use pointycastle for P-256
  Future<void> deriveSharedSecret(String serverPublicKeyBase64) async {
    if (_keyPair == null) {
      throw StateError('Must call generateKeyPair first');
    }
    
    final serverPublicKeyBytes = base64Decode(serverPublicKeyBase64);
    final serverPublicKey = SimplePublicKey(
      serverPublicKeyBytes,
      type: KeyPairType.x25519,
    );
    
    // Derive shared secret via ECDH
    final sharedSecretKey = await _ecdh.sharedSecretKey(
      keyPair: _keyPair!,
      remotePublicKey: serverPublicKey,
    );
    
    // Hash with SHA-256 to get consistent 32-byte key (matches server)
    final sharedSecretBytes = await sharedSecretKey.extractBytes();
    final hash = await Sha256().hash(sharedSecretBytes);
    _sharedSecret = SecretKey(hash.bytes);
  }
  
  /// Restore shared secret from stored bytes
  Future<void> restoreSharedSecret(Uint8List secretBytes) async {
    _sharedSecret = SecretKey(secretBytes);
  }
  
  /// Export shared secret for secure storage
  Future<Uint8List?> exportSharedSecret() async {
    if (_sharedSecret == null) return null;
    final bytes = await _sharedSecret!.extractBytes();
    return Uint8List.fromList(bytes);
  }
  
  /// Encrypt plaintext, returns {iv, ct, tag} matching server format
  Future<Map<String, String>> encrypt(String plaintext) async {
    if (_sharedSecret == null) {
      throw StateError('No shared secret - must pair first');
    }
    
    final nonce = _aes.newNonce();
    final plaintextBytes = utf8.encode(plaintext);
    
    final secretBox = await _aes.encrypt(
      plaintextBytes,
      secretKey: _sharedSecret!,
      nonce: nonce,
    );
    
    return {
      'iv': base64Encode(nonce),
      'ct': base64Encode(secretBox.cipherText),
      'tag': base64Encode(secretBox.mac.bytes),
    };
  }
  
  /// Decrypt {iv, ct, tag} from server
  Future<String> decrypt(Map<String, dynamic> data) async {
    if (_sharedSecret == null) {
      throw StateError('No shared secret - must pair first');
    }
    
    final iv = base64Decode(data['iv'] as String);
    final ct = base64Decode(data['ct'] as String);
    final tag = base64Decode(data['tag'] as String);
    
    final secretBox = SecretBox(
      ct,
      nonce: iv,
      mac: Mac(tag),
    );
    
    final decryptedBytes = await _aes.decrypt(
      secretBox,
      secretKey: _sharedSecret!,
    );
    
    return utf8.decode(decryptedBytes);
  }
}
