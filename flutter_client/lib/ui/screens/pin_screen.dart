import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import '../../providers/auth_provider.dart';

class PinScreen extends ConsumerStatefulWidget {
  const PinScreen({super.key});
  
  @override
  ConsumerState<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends ConsumerState<PinScreen> {
  final _pinController = TextEditingController();
  final _localAuth = LocalAuthentication();
  bool _isAuthenticating = false;
  bool _canUseBiometrics = false;
  String? _error;
  
  @override
  void initState() {
    super.initState();
    _checkBiometrics();
  }
  
  Future<void> _checkBiometrics() async {
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isSupported = await _localAuth.isDeviceSupported();
      setState(() {
        _canUseBiometrics = canCheck && isSupported;
      });
      
      // Auto-trigger biometrics if available
      if (_canUseBiometrics) {
        _authenticateWithBiometrics();
      }
    } catch (e) {
      // Biometrics not available
    }
  }
  
  Future<void> _authenticateWithBiometrics() async {
    setState(() {
      _isAuthenticating = true;
      _error = null;
    });
    
    try {
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Authenticate to access Claude Remote',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );
      
      if (authenticated) {
        // Use stored PIN or a special biometric token
        // For now, we still need the actual PIN for server auth
        // This would require server-side changes to support biometric tokens
        setState(() {
          _error = 'Biometric auth verified, please enter PIN for server';
        });
      }
    } on PlatformException catch (e) {
      setState(() {
        _error = 'Biometric auth failed: ${e.message}';
      });
    } finally {
      setState(() {
        _isAuthenticating = false;
      });
    }
  }
  
  Future<void> _authenticateWithPin() async {
    final pin = _pinController.text.trim();
    if (pin.length < 4) {
      setState(() => _error = 'PIN must be at least 4 digits');
      return;
    }
    
    setState(() {
      _isAuthenticating = true;
      _error = null;
    });
    
    try {
      await ref.read(authStateProvider.notifier).authenticate(pin);
      // Navigation is handled by router redirect
    } catch (e) {
      setState(() {
        _error = e.toString();
      });
    } finally {
      setState(() {
        _isAuthenticating = false;
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    
    // Handle auth state error
    if (authState.error != null && _error == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        setState(() => _error = authState.error);
      });
    }
    
    // Navigate on success
    if (authState.isAuthenticated) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        context.go('/task');
      });
    }
    
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.lock_outline,
                size: 64,
                color: Colors.blue,
              ),
              const SizedBox(height: 24),
              const Text(
                'Enter PIN',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 32),
              
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.red),
                    textAlign: TextAlign.center,
                  ),
                ),
              
              TextField(
                controller: _pinController,
                keyboardType: TextInputType.number,
                obscureText: true,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 24,
                  letterSpacing: 8,
                ),
                decoration: InputDecoration(
                  hintText: '• • • •',
                  filled: true,
                  fillColor: Colors.grey[900],
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 20,
                  ),
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(8),
                ],
                onSubmitted: (_) => _authenticateWithPin(),
                enabled: !_isAuthenticating,
                autofocus: true,
              ),
              
              const SizedBox(height: 24),
              
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isAuthenticating ? null : _authenticateWithPin,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: _isAuthenticating
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text(
                          'Unlock',
                          style: TextStyle(fontSize: 16),
                        ),
                ),
              ),
              
              if (_canUseBiometrics) ...[
                const SizedBox(height: 16),
                TextButton.icon(
                  onPressed: _isAuthenticating ? null : _authenticateWithBiometrics,
                  icon: const Icon(Icons.fingerprint),
                  label: const Text('Use Biometrics'),
                ),
              ],
              
              const SizedBox(height: 32),
              
              TextButton(
                onPressed: () async {
                  await ref.read(authStateProvider.notifier).unpair();
                  if (mounted) {
                    context.go('/pair');
                  }
                },
                child: const Text(
                  'Unpair Device',
                  style: TextStyle(color: Colors.grey),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }
}
