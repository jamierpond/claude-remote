import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'ui/screens/pair_screen.dart';
import 'ui/screens/pin_screen.dart';
import 'ui/screens/task_screen.dart';
import 'ui/theme/theme.dart';
import 'providers/auth_provider.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);
  
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final isPaired = authState.isPaired;
      final isAuthenticated = authState.isAuthenticated;
      final path = state.uri.path;
      
      // Not paired -> pair screen
      if (!isPaired && path != '/pair') {
        return '/pair';
      }
      
      // Paired but not authenticated -> pin screen
      if (isPaired && !isAuthenticated && path != '/pin') {
        return '/pin';
      }
      
      // Authenticated -> task screen
      if (isAuthenticated && (path == '/pair' || path == '/pin' || path == '/')) {
        return '/task';
      }
      
      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const PinScreen(),
      ),
      GoRoute(
        path: '/pair',
        builder: (context, state) {
          final token = state.uri.queryParameters['token'];
          return PairScreen(token: token);
        },
      ),
      GoRoute(
        path: '/pin',
        builder: (context, state) => const PinScreen(),
      ),
      GoRoute(
        path: '/task',
        builder: (context, state) => const TaskScreen(),
      ),
    ],
  );
});

class ClaudeRemoteApp extends ConsumerWidget {
  const ClaudeRemoteApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    
    return MaterialApp.router(
      title: 'Claude Remote',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      routerConfig: router,
    );
  }
}
