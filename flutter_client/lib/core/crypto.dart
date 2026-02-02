import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:pointycastle/export.dart';

/// E2E encryption using ECDH key exchange + AES-256-GCM
/// Compatible with the Node.js server implementation (uses P-256)
class CryptoService {
  AsymmetricKeyPair<ECPublicKey, ECPrivateKey>? _keyPair;
  Uint8List? _sharedSecret;

  bool get hasSharedSecret => _sharedSecret != null;

  /// Generate a new ECDH P-256 key pair and return the public key as base64
  /// Returns the raw uncompressed public key (65 bytes: 0x04 || x || y)
  Future<String> generateKeyPair() async {
    final ecDomainParams = ECCurve_secp256r1(); // P-256
    final keyGenerator = ECKeyGenerator()
      ..init(ParametersWithRandom(
        ECKeyGeneratorParameters(ecDomainParams),
        _secureRandom(),
      ));

    final pair = keyGenerator.generateKeyPair();
    _keyPair = AsymmetricKeyPair<ECPublicKey, ECPrivateKey>(
      pair.publicKey as ECPublicKey,
      pair.privateKey as ECPrivateKey,
    );

    final publicKey = _keyPair!.publicKey;
    final q = publicKey.Q!;

    // Export as uncompressed point format (what Web Crypto uses)
    // 0x04 || x (32 bytes) || y (32 bytes)
    final x = _bigIntToBytes(q.x!.toBigInteger()!, 32);
    final y = _bigIntToBytes(q.y!.toBigInteger()!, 32);
    final bytes = Uint8List.fromList([0x04, ...x, ...y]);

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
      throw ArgumentError(
        'Invalid P-256 public key format. Expected 65 bytes starting with 0x04, '
        'got ${serverPublicKeyBytes.length} bytes starting with 0x${serverPublicKeyBytes[0].toRadixString(16)}'
      );
    }

    final x = _bytesToBigInt(serverPublicKeyBytes.sublist(1, 33));
    final y = _bytesToBigInt(serverPublicKeyBytes.sublist(33, 65));

    final ecDomainParams = ECCurve_secp256r1();
    final serverPublicKey = ECPublicKey(
      ecDomainParams.curve.createPoint(x, y),
      ecDomainParams,
    );

    // Derive shared secret via ECDH: multiply server's public point by our private scalar
    final sharedPoint = serverPublicKey.Q! * _keyPair!.privateKey.d;
    final sharedSecretBytes = _bigIntToBytes(sharedPoint!.x!.toBigInteger()!, 32);

    // Hash with SHA-256 to get consistent 32-byte key (matches server/web client)
    final sha256 = SHA256Digest();
    _sharedSecret = sha256.process(sharedSecretBytes);
  }

  /// Restore shared secret from stored bytes
  Future<void> restoreSharedSecret(Uint8List secretBytes) async {
    _sharedSecret = secretBytes;
  }

  /// Export shared secret for secure storage
  Future<Uint8List?> exportSharedSecret() async {
    return _sharedSecret;
  }

  /// Encrypt plaintext, returns {iv, ct, tag} matching server format
  Future<Map<String, String>> encrypt(String plaintext) async {
    if (_sharedSecret == null) {
      throw StateError('No shared secret - must pair first');
    }

    // Generate random 12-byte nonce
    final random = _secureRandom();
    final nonce = Uint8List(12);
    for (var i = 0; i < 12; i++) {
      nonce[i] = random.nextUint8();
    }

    final plaintextBytes = utf8.encode(plaintext);

    // AES-256-GCM encryption
    final cipher = GCMBlockCipher(AESEngine())
      ..init(true, AEADParameters(
        KeyParameter(_sharedSecret!),
        128, // tag length in bits
        nonce,
        Uint8List(0), // no additional data
      ));

    final cipherText = cipher.process(Uint8List.fromList(plaintextBytes));

    // GCM appends the 16-byte tag to ciphertext
    final ct = cipherText.sublist(0, cipherText.length - 16);
    final tag = cipherText.sublist(cipherText.length - 16);

    return {
      'iv': base64Encode(nonce),
      'ct': base64Encode(ct),
      'tag': base64Encode(tag),
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

    // GCM expects ciphertext + tag concatenated
    final cipherTextWithTag = Uint8List.fromList([...ct, ...tag]);

    final cipher = GCMBlockCipher(AESEngine())
      ..init(false, AEADParameters(
        KeyParameter(_sharedSecret!),
        128, // tag length in bits
        iv,
        Uint8List(0), // no additional data
      ));

    final decryptedBytes = cipher.process(cipherTextWithTag);
    return utf8.decode(decryptedBytes);
  }

  /// Convert BigInt to fixed-length bytes (big-endian, zero-padded)
  Uint8List _bigIntToBytes(BigInt value, int length) {
    final bytes = Uint8List(length);
    var temp = value;
    for (var i = length - 1; i >= 0; i--) {
      bytes[i] = (temp & BigInt.from(0xff)).toInt();
      temp = temp >> 8;
    }
    return bytes;
  }

  /// Convert bytes to BigInt (big-endian)
  BigInt _bytesToBigInt(List<int> bytes) {
    var result = BigInt.zero;
    for (var byte in bytes) {
      result = (result << 8) | BigInt.from(byte);
    }
    return result;
  }

  /// Create a secure random generator
  SecureRandom _secureRandom() {
    final random = FortunaRandom();
    final seed = Uint8List(32);
    final dartRandom = Random.secure();
    for (var i = 0; i < 32; i++) {
      seed[i] = dartRandom.nextInt(256);
    }
    random.seed(KeyParameter(seed));
    return random;
  }
}
