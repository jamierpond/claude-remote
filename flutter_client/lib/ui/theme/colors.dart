import 'package:flutter/material.dart';

/// App color palette - warm dark theme matching the app icon aesthetic
class AppColors {
  AppColors._();

  // === Base Palette ===
  static const Color terracotta = Color(0xFFD97757);
  static const Color terracottaLight = Color(0xFFE8886A);
  static const Color terracottaDark = Color(0xFFC4644A);
  static const Color warmBlack = Color(0xFF1A1816);
  static const Color warmDark = Color(0xFF252220);
  static const Color warmGrey = Color(0xFF3D3632);
  static const Color warmBeige = Color(0xFFE8DDD4);

  // === Semantic Colors ===
  static const Color background = warmBlack;
  static const Color surface = warmDark;
  static const Color surfaceVariant = warmGrey;

  static const Color primary = terracotta;
  static const Color primaryHover = terracottaLight;
  static const Color primaryMuted = Color(0xFF8B5A47);

  static const Color textPrimary = Color(0xFFF5F0EB);
  static const Color textSecondary = Color(0xFFA89F97);
  static const Color textMuted = Color(0xFF6B635C);
  static const Color textOnPrimary = Color(0xFFFFFAF7);

  static const Color border = warmGrey;
  static const Color borderLight = Color(0xFF4A433D);
  static const Color divider = Color(0xFF2D2926);

  // === Status Colors ===
  static const Color error = Color(0xFFE85A5A);
  static const Color errorMuted = Color(0xFF5A2D2D);
  static const Color success = Color(0xFF5AAD6A);
  static const Color successMuted = Color(0xFF2D4A32);
  static const Color warning = Color(0xFFE8A54A);
  static const Color warningMuted = Color(0xFF4A3D2D);
  static const Color info = Color(0xFF5A9AAD);
  static const Color infoMuted = Color(0xFF2D3D4A);

  // === Tool Colors (for activity feed) ===
  static Color getToolColor(String toolName) {
    return switch (toolName.toLowerCase()) {
      'read' => const Color(0xFF5AADAD),
      'write' => const Color(0xFF5AAD6A),
      'edit' => const Color(0xFFE8A54A),
      'bash' => terracotta,
      'grep' || 'glob' => const Color(0xFFAD7A5A),
      'webfetch' || 'websearch' => const Color(0xFF5A7AAD),
      'task' => const Color(0xFFAD5AAD),
      _ => textSecondary,
    };
  }

  static Color getToolBackgroundColor(String toolName) {
    return getToolColor(toolName).withOpacity(0.15);
  }

  // === Task Status Colors ===
  static Color getTaskStatusColor(String status) {
    return switch (status.toLowerCase()) {
      'running' || 'in_progress' => primary,
      'completed' || 'done' => success,
      'error' || 'failed' => error,
      'cancelled' => textMuted,
      _ => textSecondary,
    };
  }

  // === Git Status Colors ===
  static const Color gitClean = success;
  static const Color gitDirty = warning;
  static const Color gitAhead = info;
  static const Color gitBehind = error;
}
