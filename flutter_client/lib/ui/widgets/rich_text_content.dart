import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/colors.dart';

/// A widget that renders markdown content with proper styling
class RichTextContent extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final bool selectable;

  const RichTextContent({
    super.key,
    required this.text,
    this.style,
    this.selectable = true,
  });

  @override
  Widget build(BuildContext context) {
    final baseStyle = style ??
        const TextStyle(
          fontSize: 14,
          height: 1.6,
          color: AppColors.textPrimary,
        );

    final styleSheet = MarkdownStyleSheet(
      p: baseStyle,
      strong: baseStyle.copyWith(fontWeight: FontWeight.bold),
      em: baseStyle.copyWith(fontStyle: FontStyle.italic),
      code: baseStyle.copyWith(
        fontFamily: 'monospace',
        backgroundColor: AppColors.surfaceVariant,
        color: AppColors.info,
      ),
      codeblockDecoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(8),
      ),
      codeblockPadding: const EdgeInsets.all(12),
      blockquote: baseStyle.copyWith(
        color: AppColors.textSecondary,
        fontStyle: FontStyle.italic,
      ),
      blockquoteDecoration: const BoxDecoration(
        border: Border(
          left: BorderSide(
            color: AppColors.border,
            width: 3,
          ),
        ),
      ),
      blockquotePadding: const EdgeInsets.only(left: 12),
      a: baseStyle.copyWith(
        color: AppColors.link,
        decoration: TextDecoration.underline,
      ),
      listBullet: baseStyle.copyWith(color: AppColors.textSecondary),
      h1: baseStyle.copyWith(fontSize: 24, fontWeight: FontWeight.bold),
      h2: baseStyle.copyWith(fontSize: 20, fontWeight: FontWeight.bold),
      h3: baseStyle.copyWith(fontSize: 18, fontWeight: FontWeight.w600),
      h4: baseStyle.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
      horizontalRuleDecoration: const BoxDecoration(
        border: Border(
          top: BorderSide(color: AppColors.border, width: 1),
        ),
      ),
    );

    if (selectable) {
      return MarkdownBody(
        data: text,
        styleSheet: styleSheet,
        selectable: true,
        onTapLink: (text, href, title) => _launchUrl(href),
      );
    }

    return MarkdownBody(
      data: text,
      styleSheet: styleSheet,
      onTapLink: (text, href, title) => _launchUrl(href),
    );
  }

  Future<void> _launchUrl(String? href) async {
    if (href == null) return;
    final uri = Uri.parse(href);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
