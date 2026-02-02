import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'crypto.dart';

// Conditional import for web reload
import 'web_reload_stub.dart' if (dart.library.html) 'web_reload.dart' as web_reload;

enum ConnectionState { disconnected, connecting, connected, authenticated }

class WebSocketMessage {
  final String type;
  final String? text;
  final String? thinking;
  final String? error;
  final String? projectId;
  final List<String>? activeProjectIds;
  final Map<String, dynamic>? toolUse;
  final Map<String, dynamic>? toolResult;
  final List<dynamic>? activity;
  final bool? hasActiveJob;
  final Map<String, dynamic>? activeJob;
  final String? sessionId;

  WebSocketMessage({
    required this.type,
    this.text,
    this.thinking,
    this.error,
    this.projectId,
    this.activeProjectIds,
    this.toolUse,
    this.toolResult,
    this.activity,
    this.hasActiveJob,
    this.activeJob,
    this.sessionId,
  });

  factory WebSocketMessage.fromJson(Map<String, dynamic> json) {
    return WebSocketMessage(
      type: json['type'] as String,
      text: json['text'] as String?,
      thinking: json['thinking'] as String?,
      error: json['error'] as String?,
      projectId: json['projectId'] as String?,
      activeProjectIds: (json['activeProjectIds'] as List<dynamic>?)?.cast<String>(),
      toolUse: json['toolUse'] as Map<String, dynamic>?,
      toolResult: json['toolResult'] as Map<String, dynamic>?,
      activity: json['activity'] as List<dynamic>?,
      hasActiveJob: json['hasActiveJob'] as bool?,
      activeJob: json['activeJob'] as Map<String, dynamic>?,
      sessionId: json['sessionId'] as String?,
    );
  }
}

class WebSocketManager {
  final CryptoService _crypto;
  final String serverUrl;
  
  WebSocketChannel? _channel;
  ConnectionState _state = ConnectionState.disconnected;
  final _stateController = StreamController<ConnectionState>.broadcast();
  final _messageController = StreamController<WebSocketMessage>.broadcast();
  
  WebSocketManager({
    required this.serverUrl,
    required CryptoService crypto,
  }) : _crypto = crypto;
  
  ConnectionState get state => _state;
  Stream<ConnectionState> get stateStream => _stateController.stream;
  Stream<WebSocketMessage> get messageStream => _messageController.stream;
  
  Future<void> connect() async {
    if (_state != ConnectionState.disconnected) return;
    
    _setState(ConnectionState.connecting);
    
    try {
      final wsUrl = serverUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
      _channel = WebSocketChannel.connect(Uri.parse('$wsUrl/ws'));
      
      await _channel!.ready;
      _setState(ConnectionState.connected);
      
      _channel!.stream.listen(
        _handleMessage,
        onError: (error) {
          print('WebSocket error: $error');
          _disconnect();
        },
        onDone: () {
          print('WebSocket closed');
          _disconnect();
        },
      );
    } catch (e) {
      print('WebSocket connection failed: $e');
      _disconnect();
      rethrow;
    }
  }
  
  Future<void> authenticate(String pin) async {
    await _sendEncrypted({'type': 'auth', 'pin': pin});
  }
  
  Future<void> sendMessage(String text, {String? projectId}) async {
    await _sendEncrypted({
      'type': 'message',
      'text': text,
      if (projectId != null) 'projectId': projectId,
    });
  }

  Future<void> cancel({String? projectId}) async {
    await _sendEncrypted({
      'type': 'cancel',
      if (projectId != null) 'projectId': projectId,
    });
  }
  
  Future<void> _sendEncrypted(Map<String, dynamic> data) async {
    if (_channel == null || !_crypto.hasSharedSecret) {
      throw StateError('Not connected or not paired');
    }
    
    final encrypted = await _crypto.encrypt(jsonEncode(data));
    _channel!.sink.add(jsonEncode(encrypted));
  }
  
  Future<void> _handleMessage(dynamic raw) async {
    try {
      final encrypted = jsonDecode(raw as String) as Map<String, dynamic>;
      final decrypted = await _crypto.decrypt(encrypted);
      final message = WebSocketMessage.fromJson(
        jsonDecode(decrypted) as Map<String, dynamic>,
      );
      
      // Handle auth_ok specially
      if (message.type == 'auth_ok') {
        _setState(ConnectionState.authenticated);
      }

      // Handle dev reload - refresh the page on web
      if (message.type == 'reload') {
        print('[WS] Received reload signal - refreshing page');
        web_reload.reloadPage();
        return;
      }

      _messageController.add(message);
    } catch (e) {
      print('Failed to handle message: $e');
      _messageController.addError(e);
    }
  }
  
  void _setState(ConnectionState newState) {
    _state = newState;
    _stateController.add(newState);
  }
  
  void _disconnect() {
    _channel?.sink.close();
    _channel = null;
    _setState(ConnectionState.disconnected);
  }
  
  void dispose() {
    _disconnect();
    _stateController.close();
    _messageController.close();
  }
}
