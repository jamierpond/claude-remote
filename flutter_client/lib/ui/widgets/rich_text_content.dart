import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/colors.dart';

/// A widget that renders text with clickable links
/// Supports both markdown-style links [text](url) and bare URLs
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
    final defaultStyle = style ??
        const TextStyle(
          fontSize: 14,
          height: 1.6,
          color: AppColors.textPrimary,
        );

    final spans = _parseText(text, defaultStyle);

    final richText = Text.rich(
      TextSpan(children: spans),
    );

    if (selectable) {
      return SelectionArea(
        child: richText,
      );
    }

    return richText;
  }

  List<TextSpan> _parseText(String text, TextStyle defaultStyle) {
    final List<TextSpan> spans = [];
    String remaining = text;

    // Regex patterns
    final markdownLinkPattern = RegExp(r'\[([^\]]+)\]\(([^)]+)\)');
    final bareUrlPattern = RegExp(r'https?://[^\s<>\[\])"]+');

    while (remaining.isNotEmpty) {
      // Find the next markdown link
      final markdownMatch = markdownLinkPattern.firstMatch(remaining);
      // Find the next bare URL
      final urlMatch = bareUrlPattern.firstMatch(remaining);

      // Determine which comes first
      int? markdownStart = markdownMatch?.start;
      int? urlStart = urlMatch?.start;

      // If markdown link contains the URL match, ignore the URL match
      if (markdownMatch != null && urlMatch != null) {
        if (urlStart! >= markdownMatch.start && urlStart < markdownMatch.end) {
          urlStart = null;
        }
      }

      // No more links found
      if (markdownStart == null && urlStart == null) {
        spans.add(TextSpan(text: remaining, style: defaultStyle));
        break;
      }

      // Markdown link comes first
      if (markdownStart != null &&
          (urlStart == null || markdownStart < urlStart)) {
        // Add text before link
        if (markdownStart > 0) {
          spans.add(TextSpan(
            text: remaining.substring(0, markdownStart),
            style: defaultStyle,
          ));
        }

        // Add the link
        final linkText = markdownMatch!.group(1)!;
        final linkUrl = markdownMatch.group(2)!;
        spans.add(_buildLinkSpan(linkText, linkUrl, defaultStyle));

        remaining = remaining.substring(markdownMatch.end);
        continue;
      }

      // Bare URL comes first
      if (urlStart != null) {
        // Add text before URL
        if (urlStart > 0) {
          spans.add(TextSpan(
            text: remaining.substring(0, urlStart),
            style: defaultStyle,
          ));
        }

        // Clean trailing punctuation
        String url = urlMatch!.group(0)!;
        final trailingPunctPattern = RegExp(r'[.,;:!?)]+$');
        final cleanUrl = url.replaceAll(trailingPunctPattern, '');
        final trailingPunct = url.substring(cleanUrl.length);

        // Add the link
        final displayUrl =
            cleanUrl.length > 45 ? '${cleanUrl.substring(0, 42)}...' : cleanUrl;
        spans.add(_buildLinkSpan(displayUrl, cleanUrl, defaultStyle));

        // Add trailing punctuation as regular text
        if (trailingPunct.isNotEmpty) {
          spans.add(TextSpan(text: trailingPunct, style: defaultStyle));
        }

        remaining = remaining.substring(urlStart + url.length);
        continue;
      }
    }

    return spans;
  }

  TextSpan _buildLinkSpan(String text, String url, TextStyle defaultStyle) {
    return TextSpan(
      text: '$text ↗',
      style: defaultStyle.copyWith(
        color: AppColors.link,
        decoration: TextDecoration.underline,
        decorationColor: AppColors.link.withOpacity(0.5),
      ),
      recognizer: TapGestureRecognizer()
        ..onTap = () async {
          final uri = Uri.parse(url);
          if (await canLaunchUrl(uri)) {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
          }
        },
    );
  }
}
