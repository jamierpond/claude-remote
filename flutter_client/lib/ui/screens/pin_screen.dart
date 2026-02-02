import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import '../../providers/auth_provider.dart';
import '../theme/colors.dart';
import '../theme/spacing.dart';
import '../widgets/server_switcher.dart';

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

      // Auto-trigger biometrics if available AND we have a stored PIN
      if (_canUseBiometrics) {
        final storage = ref.read(storageProvider);
        final hasStoredPin = await storage.getPin() != null;
        if (hasStoredPin) {
          _authenticateWithBiometrics();
        }
      }
    } catch (e) {
      // Biometrics not available
    }
  }

  Future<void> _authenticateWithBiometrics() async {
    // Check if we have a stored PIN first
    final storage = ref.read(storageProvider);
    final storedPin = await storage.getPin();

    if (storedPin == null) {
      setState(() {
        _error = 'Enter PIN first to enable biometric unlock';
      });
      return;
    }

    setState(() {
      _isAuthenticating = true;
      _error = null;
    });

    try {
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Unlock Claude Remote',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );

      if (authenticated) {
        // Biometrics verified - use stored PIN to authenticate with server
        await ref.read(authStateProvider.notifier).authenticate(storedPin);
      }
    } on PlatformException catch (e) {
      setState(() {
        _error = 'Biometric auth failed: ${e.message}';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isAuthenticating = false;
        });
      }
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
      // Save PIN for future biometric unlock
      await ref.read(storageProvider).savePin(pin);
      // Navigation is handled by router redirect
    } catch (e) {
      setState(() {
        _error = e.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _isAuthenticating = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final activeServer = authState.activeServer;

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
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight - AppSpacing.xl * 2),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Server chip (tappable to switch servers)
                  if (activeServer != null)
                    GestureDetector(
                      onTap: () => showServerSwitcher(context),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md,
                          vertical: AppSpacing.sm,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(AppRadius.xl),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: AppColors.success,
                              ),
                            ),
                            AppSpacing.gapHorizontalSm,
                            Text(
                              activeServer.name,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            AppSpacing.gapHorizontalSm,
                            Icon(
                              Icons.unfold_more,
                              size: 16,
                              color: AppColors.textMuted,
                            ),
                          ],
                        ),
                      ),
                    ),

                  AppSpacing.gapVerticalXl,

                  const Icon(
                    Icons.lock_outline,
                    size: 64,
                    color: AppColors.primary,
                  ),
                  AppSpacing.gapVerticalXl,
                  const Text(
                    'Enter PIN',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  AppSpacing.gapVerticalXl,

                  if (_error != null)
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      margin: const EdgeInsets.only(bottom: AppSpacing.lg),
                      decoration: BoxDecoration(
                        color: AppColors.error.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        border: Border.all(color: AppColors.error),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: AppColors.error),
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
                      color: AppColors.textPrimary,
                    ),
                    decoration: InputDecoration(
                      hintText: '    ',
                      hintStyle: const TextStyle(color: AppColors.textMuted),
                      filled: true,
                      fillColor: AppColors.surface,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        borderSide: BorderSide.none,
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.xl,
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

                  AppSpacing.gapVerticalXl,

                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _isAuthenticating ? null : _authenticateWithPin,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.textOnPrimary,
                        disabledBackgroundColor: AppColors.surfaceVariant,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                      ),
                      child: _isAuthenticating
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textOnPrimary),
                            )
                          : const Text(
                              'Unlock',
                              style: TextStyle(fontSize: 16),
                            ),
                    ),
                  ),

                  if (_canUseBiometrics) ...[
                    AppSpacing.gapVerticalLg,
                    TextButton.icon(
                      onPressed: _isAuthenticating ? null : _authenticateWithBiometrics,
                      icon: const Icon(Icons.fingerprint),
                      label: const Text('Use Biometrics'),
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.primary,
                      ),
                    ),
                  ],

                  AppSpacing.gapVerticalXl,

                  // Show server count if multiple servers
                  if (authState.servers.length > 1)
                    TextButton(
                      onPressed: () => showServerSwitcher(context),
                      child: Text(
                        '${authState.servers.length} servers paired',
                        style: const TextStyle(color: AppColors.textMuted),
                      ),
                    ),

                  TextButton(
                    onPressed: () async {
                      if (authState.servers.length == 1) {
                        // Only one server - unpair all (legacy behavior)
                        await ref.read(authStateProvider.notifier).unpair();
                        if (mounted) {
                          context.go('/pair');
                        }
                      } else {
                        // Multiple servers - show server switcher
                        showServerSwitcher(context);
                      }
                    },
                    child: Text(
                      authState.servers.length > 1 ? 'Manage Servers' : 'Unpair Device',
                      style: const TextStyle(color: AppColors.textMuted),
                    ),
                  ),
                ],
              ),
            ),
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
