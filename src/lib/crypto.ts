import { createECDH, createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export interface EncryptedData {
  iv: string;
  ct: string;
  tag: string;
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateKeyPair(): KeyPair {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey('base64'),
    publicKey: ecdh.getPublicKey('base64'),
  };
}

export function deriveSharedSecret(privateKey: string, peerPublicKey: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64'));
  const secret = ecdh.computeSecret(Buffer.from(peerPublicKey, 'base64'));
  // Hash with SHA-256 to ensure consistent 32-byte key across platforms
  const hashed = createHash('sha256').update(secret).digest();
  return hashed.toString('base64');
}

export function encrypt(plaintext: string, secret: string): EncryptedData {
  const key = Buffer.from(secret, 'base64'); // Already 32 bytes from SHA-256 hash
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    iv: iv.toString('base64'),
    ct: encrypted.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decrypt(data: EncryptedData, secret: string): string {
  const key = Buffer.from(secret, 'base64'); // Already 32 bytes from SHA-256 hash
  const iv = Buffer.from(data.iv, 'base64');
  const ct = Buffer.from(data.ct, 'base64');
  const tag = Buffer.from(data.tag, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ct),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
