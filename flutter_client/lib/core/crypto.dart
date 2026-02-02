import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

/// E2E encryption using ECDH key exchange + AES-256-GCM
/// Compatible with the Node.js server implementation (uses P-256)
class CryptoService {
  final _ecdh = Ecdh.p256(length: 256);
  final _aes = AesGcm.with256bits();

  EcKeyPair? _keyPair;
  SecretKey? _sharedSecret;

  bool get hasSharedSecret => _sharedSecret != null;

  /// Generate a new ECDH P-256 key pair and return the public key as base64
  /// Returns the raw uncompressed public key (65 bytes: 0x04 || x || y)
  Future<String> generateKeyPair() async {
    _keyPair = await _ecdh.newKeyPair();
    final publicKey = await _keyPair!.extractPublicKey();
    // Export as uncompressed point format (what Web Crypto uses)
    final bytes = Uint8List.fromList([0x04, ...publicKey.x, ...publicKey.y]);
    return base64Encode(bytes);
  }

  /// Derive shared secret from server's public key (P-256)
  Future<void> deriveSharedSecret(String serverPublicKeyBase64) async {
    if (_keyPair == null) {
      throw StateError('Must call generateKeyPair first');
    }

    final serverPublicKeyBytes = base64Decode(serverPublicKeyBase64);

    // Parse uncompressed point format (0x04 || x || y)
    if (serverPublicKeyBytes.length != 65 || serverPublicKeyBytes[0] != 0x04) {
      throw ArgumentError('Invalid P-256 public key format');
    }
    final x = serverPublicKeyBytes.sublist(1, 33);
    final y = serverPublicKeyBytes.sublist(33, 65);

    final serverPublicKey = EcPublicKey(
      x: x,
      y: y,
      type: KeyPairType.p256,
    );

    // Derive shared secret via ECDH
    final sharedSecretKey = await _ecdh.sharedSecretKey(
      keyPair: _keyPair!,
      remotePublicKey: serverPublicKey,
    );

    // Hash with SHA-256 to get consistent 32-byte key (matches server/web client)
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
