import 'dart:convert';
import 'dart:typed_data';

/// Represents a paired Claude server
class Server {
  final String id;
  final String name;
  final String serverUrl;
  final String deviceId;
  final Uint8List sharedSecret;
  final DateTime pairedAt;

  Server({
    required this.id,
    required this.name,
    required this.serverUrl,
    required this.deviceId,
    required this.sharedSecret,
    required this.pairedAt,
  });

  /// Create a copy with updated fields
  Server copyWith({
    String? name,
  }) {
    return Server(
      id: id,
      name: name ?? this.name,
      serverUrl: serverUrl,
      deviceId: deviceId,
      sharedSecret: sharedSecret,
      pairedAt: pairedAt,
    );
  }

  /// Serialize to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'serverUrl': serverUrl,
      'deviceId': deviceId,
      'sharedSecret': base64Encode(sharedSecret),
      'pairedAt': pairedAt.toIso8601String(),
    };
  }

  /// Deserialize from JSON
  factory Server.fromJson(Map<String, dynamic> json) {
    return Server(
      id: json['id'] as String,
      name: json['name'] as String,
      serverUrl: json['serverUrl'] as String,
      deviceId: json['deviceId'] as String,
      sharedSecret: base64Decode(json['sharedSecret'] as String),
      pairedAt: DateTime.parse(json['pairedAt'] as String),
    );
  }

  /// Generate a user-friendly name from hostname
  /// e.g., "jamies-laptop.local" -> "Jamie's Laptop"
  /// e.g., "ai-server.pond.audio" -> "AI Server"
  static String nameFromHostname(String hostname) {
    // Extract just the hostname part (before first dot)
    var name = hostname.split('.').first;

    // Replace common separators with spaces
    name = name.replaceAll(RegExp(r'[-_]'), ' ');

    // Handle special prefixes
    if (name.toLowerCase().startsWith('ai ')) {
      name = 'AI ${name.substring(3)}';
    }

    // Title case each word
    name = name.split(' ').map((word) {
      if (word.isEmpty) return word;
      // Special case for common abbreviations
      if (word.toLowerCase() == 'ai') return 'AI';
      return '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}';
    }).join(' ');

    // Handle possessive 's if preceded by a name-like pattern (e.g., "jamies" -> "Jamie's")
    name = name.replaceAllMapped(
      RegExp(r"(\w+)s\b(?='s|\s|$)", caseSensitive: false),
      (match) {
        final base = match.group(1)!;
        // Check if it looks like a name ending in 's' that should be possessive
        // Simple heuristic: if removing 's' gives a common name pattern
        if (RegExp(r'^[A-Z][a-z]+$').hasMatch(base)) {
          return "$base's";
        }
        return match.group(0)!;
      },
    );

    return name.isEmpty ? 'Server' : name;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Server && runtimeType == other.runtimeType && id == other.id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'Server(id: $id, name: $name, serverUrl: $serverUrl)';
}
