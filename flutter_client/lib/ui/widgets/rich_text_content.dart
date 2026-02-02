import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/colors.dart';

/// A widget that renders text with markdown-like formatting
/// Supports: **bold**, *italic*, `code`, [links](url), and bare URLs
class RichTextContent extends StatefulWidget {
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
  State<RichTextContent> createState() => _RichTextContentState();
}

class _RichTextContentState extends State<RichTextContent> {
  // Keep recognizers alive for the widget lifecycle
  final List<GestureRecognizer> _recognizers = [];

  @override
  void dispose() {
    for (final r in _recognizers) {
      r.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Clear old recognizers on rebuild
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();

    final defaultStyle = widget.style ??
        const TextStyle(
          fontSize: 14,
          height: 1.6,
          color: AppColors.textPrimary,
        );

    final spans = _parseMarkdown(widget.text, defaultStyle);

    // Use SelectableText.rich for iOS/Android compatibility
    if (widget.selectable) {
      return SelectableText.rich(
        TextSpan(children: spans),
        style: defaultStyle,
      );
    }

    return Text.rich(
      TextSpan(children: spans),
      style: defaultStyle,
    );
  }

  List<InlineSpan> _parseMarkdown(String text, TextStyle baseStyle) {
    final List<InlineSpan> spans = [];

    // Process line by line to handle block elements
    final lines = text.split('\n');
    for (int i = 0; i < lines.length; i++) {
      if (i > 0) {
        spans.add(const TextSpan(text: '\n'));
      }
      spans.addAll(_parseInline(lines[i], baseStyle));
    }

    return spans;
  }

  List<InlineSpan> _parseInline(String text, TextStyle baseStyle) {
    final List<InlineSpan> spans = [];

    // Combined regex for all inline elements
    // Order matters: longer patterns first
    final pattern = RegExp(
      r'(\*\*|__)(.+?)\1|'           // Bold: **text** or __text__
      r'(\*|_)([^*_]+?)\3|'          // Italic: *text* or _text_
      r'`([^`]+)`|'                   // Inline code: `code`
      r'\[([^\]]+)\]\(([^)]+)\)|'    // Markdown link: [text](url)
      r'(https?://[^\s<>\[\]()]+)',  // Bare URL
    );

    int lastEnd = 0;

    for (final match in pattern.allMatches(text)) {
      // Add text before this match
      if (match.start > lastEnd) {
        spans.add(TextSpan(
          text: text.substring(lastEnd, match.start),
          style: baseStyle,
        ));
      }

      // Determine which group matched
      if (match.group(2) != null) {
        // Bold
        spans.add(TextSpan(
          text: match.group(2),
          style: baseStyle.copyWith(fontWeight: FontWeight.bold),
        ));
      } else if (match.group(4) != null) {
        // Italic
        spans.add(TextSpan(
          text: match.group(4),
          style: baseStyle.copyWith(fontStyle: FontStyle.italic),
        ));
      } else if (match.group(5) != null) {
        // Inline code
        spans.add(TextSpan(
          text: match.group(5),
          style: baseStyle.copyWith(
            fontFamily: 'monospace',
            backgroundColor: AppColors.surfaceVariant,
            color: AppColors.info,
          ),
        ));
      } else if (match.group(6) != null && match.group(7) != null) {
        // Markdown link
        spans.add(_buildLinkSpan(match.group(6)!, match.group(7)!, baseStyle));
      } else if (match.group(8) != null) {
        // Bare URL
        final url = match.group(8)!;
        // Clean trailing punctuation
        final cleanUrl = url.replaceAll(RegExp(r'[.,;:!?)]+$'), '');
        final trailing = url.substring(cleanUrl.length);

        final displayUrl = cleanUrl.length > 40
            ? '${cleanUrl.substring(0, 37)}...'
            : cleanUrl;
        spans.add(_buildLinkSpan(displayUrl, cleanUrl, baseStyle));

        if (trailing.isNotEmpty) {
          spans.add(TextSpan(text: trailing, style: baseStyle));
        }
      }

      lastEnd = match.end;
    }

    // Add remaining text
    if (lastEnd < text.length) {
      spans.add(TextSpan(
        text: text.substring(lastEnd),
        style: baseStyle,
      ));
    }

    // If no spans, return the original text
    if (spans.isEmpty) {
      spans.add(TextSpan(text: text, style: baseStyle));
    }

    return spans;
  }

  TextSpan _buildLinkSpan(String text, String url, TextStyle baseStyle) {
    final recognizer = TapGestureRecognizer()
      ..onTap = () async {
        final uri = Uri.parse(url);
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      };
    _recognizers.add(recognizer);

    return TextSpan(
      text: '$text ↗',
      style: baseStyle.copyWith(
        color: AppColors.link,
        decoration: TextDecoration.underline,
        decorationColor: AppColors.link.withOpacity(0.5),
      ),
      recognizer: recognizer,
    );
  }
}
