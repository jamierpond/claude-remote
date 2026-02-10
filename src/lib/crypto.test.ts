import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPair,
  deriveSharedSecret,
  encrypt,
  decrypt,
} from "./crypto.js";

describe("generateKeyPair", () => {
  it("returns base64-encoded public and private keys", () => {
    const kp = generateKeyPair();
    assert.ok(kp.publicKey.length > 0);
    assert.ok(kp.privateKey.length > 0);
    // Should be valid base64
    assert.doesNotThrow(() => Buffer.from(kp.publicKey, "base64"));
    assert.doesNotThrow(() => Buffer.from(kp.privateKey, "base64"));
  });

  it("generates unique keypairs each time", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    assert.notEqual(a.publicKey, b.publicKey);
    assert.notEqual(a.privateKey, b.privateKey);
  });
});

describe("deriveSharedSecret", () => {
  it("derives the same secret from both sides of the exchange", () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    assert.equal(secretA, secretB);
  });

  it("derives a 32-byte (256-bit) key", () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const buf = Buffer.from(secret, "base64");
    assert.equal(buf.length, 32);
  });

  it("produces different secrets for different keypairs", () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const charlie = generateKeyPair();
    const secretAB = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const secretAC = deriveSharedSecret(alice.privateKey, charlie.publicKey);
    assert.notEqual(secretAB, secretAC);
  });
});

describe("encrypt / decrypt", () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

  it("round-trips plaintext through encrypt then decrypt", () => {
    const plaintext = "hello, world";
    const encrypted = encrypt(plaintext, sharedSecret);
    const decrypted = decrypt(encrypted, sharedSecret);
    assert.equal(decrypted, plaintext);
  });

  it("handles empty string", () => {
    const encrypted = encrypt("", sharedSecret);
    const decrypted = decrypt(encrypted, sharedSecret);
    assert.equal(decrypted, "");
  });

  it("handles unicode and emoji", () => {
    const plaintext = "Hello \u00e9\u00e8\u00ea \u4e16\u754c \ud83d\ude80";
    const encrypted = encrypt(plaintext, sharedSecret);
    const decrypted = decrypt(encrypted, sharedSecret);
    assert.equal(decrypted, plaintext);
  });

  it("handles large payloads", () => {
    const plaintext = "x".repeat(100_000);
    const encrypted = encrypt(plaintext, sharedSecret);
    const decrypted = decrypt(encrypted, sharedSecret);
    assert.equal(decrypted, plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plaintext = "same message";
    const a = encrypt(plaintext, sharedSecret);
    const b = encrypt(plaintext, sharedSecret);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
  });

  it("returns base64-encoded iv, ct, and tag", () => {
    const encrypted = encrypt("test", sharedSecret);
    assert.ok(typeof encrypted.iv === "string");
    assert.ok(typeof encrypted.ct === "string");
    assert.ok(typeof encrypted.tag === "string");
    // IV should be 12 bytes = 16 base64 chars
    assert.equal(Buffer.from(encrypted.iv, "base64").length, 12);
    // Tag should be 16 bytes
    assert.equal(Buffer.from(encrypted.tag, "base64").length, 16);
  });

  it("fails to decrypt with wrong secret", () => {
    const otherSecret = deriveSharedSecret(
      generateKeyPair().privateKey,
      generateKeyPair().publicKey,
    );
    const encrypted = encrypt("secret message", sharedSecret);
    assert.throws(() => decrypt(encrypted, otherSecret));
  });

  it("fails to decrypt with tampered ciphertext", () => {
    const encrypted = encrypt("secret message", sharedSecret);
    // Flip bits in the ciphertext to corrupt it
    const ctBuf = Buffer.from(encrypted.ct, "base64");
    ctBuf[0] ^= 0xff;
    const tampered = { ...encrypted, ct: ctBuf.toString("base64") };
    assert.throws(() => decrypt(tampered, sharedSecret));
  });

  it("fails to decrypt with tampered tag", () => {
    const encrypted = encrypt("secret message", sharedSecret);
    // Flip a byte in the tag
    const tagBuf = Buffer.from(encrypted.tag, "base64");
    tagBuf[0] ^= 0xff;
    const tampered = { ...encrypted, tag: tagBuf.toString("base64") };
    assert.throws(() => decrypt(tampered, sharedSecret));
  });

  it("fails to decrypt with tampered IV", () => {
    const encrypted = encrypt("secret message", sharedSecret);
    const ivBuf = Buffer.from(encrypted.iv, "base64");
    ivBuf[0] ^= 0xff;
    const tampered = { ...encrypted, iv: ivBuf.toString("base64") };
    assert.throws(() => decrypt(tampered, sharedSecret));
  });
});
