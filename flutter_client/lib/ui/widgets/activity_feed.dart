import 'package:flutter/material.dart';
import '../../models/tool_activity.dart';

class ActivityFeed extends StatefulWidget {
  final List<ToolActivity> activities;
  final bool isLive;
  
  const ActivityFeed({
    super.key,
    required this.activities,
    this.isLive = false,
  });
  
  @override
  State<ActivityFeed> createState() => _ActivityFeedState();
}

class _ActivityFeedState extends State<ActivityFeed> {
  bool _expanded = true;
  
  IconData _getToolIcon(String tool) {
    switch (tool) {
      case 'Read':
        return Icons.description;
      case 'Write':
        return Icons.edit_document;
      case 'Edit':
        return Icons.build;
      case 'Bash':
        return Icons.terminal;
      case 'Glob':
      case 'Grep':
        return Icons.search;
      case 'Task':
        return Icons.smart_toy;
      case 'WebFetch':
      case 'WebSearch':
        return Icons.language;
      default:
        return Icons.extension;
    }
  }
  
  Color _getToolColor(String tool) {
    switch (tool) {
      case 'Read':
        return Colors.cyan;
      case 'Write':
        return Colors.green;
      case 'Edit':
        return Colors.orange;
      case 'Bash':
        return Colors.yellow;
      case 'Glob':
      case 'Grep':
        return Colors.purple;
      default:
        return Colors.grey;
    }
  }
  
  @override
  Widget build(BuildContext context) {
    final toolUseCount = widget.activities.where((a) => a.isToolUse).length;
    
    return Container(
      decoration: BoxDecoration(
        color: Colors.grey[850],
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey[800]!),
      ),
      child: Column(
        children: [
          // Header
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 20,
                    color: Colors.grey[500],
                  ),
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.build_circle,
                    size: 16,
                    color: Colors.blue,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Activity',
                    style: TextStyle(
                      color: Colors.grey[400],
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (widget.isLive) ...[
                    const SizedBox(width: 8),
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: Colors.blue,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                  const Spacer(),
                  Text(
                    '$toolUseCount tools',
                    style: TextStyle(
                      color: Colors.grey[600],
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          // Activity list
          if (_expanded)
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: widget.activities.length,
              itemBuilder: (context, index) {
                final activity = widget.activities[index];
                return _buildActivityItem(activity);
              },
            ),
        ],
      ),
    );
  }
  
  Widget _buildActivityItem(ToolActivity activity) {
    if (activity.isToolResult) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(48, 0, 12, 8),
        child: Row(
          children: [
            Icon(
              activity.hasError ? Icons.error_outline : Icons.check,
              size: 14,
              color: activity.hasError ? Colors.red : Colors.green,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                activity.hasError
                    ? 'Error: ${activity.error}'
                    : 'Done${activity.output != null ? ' (${activity.output!.length} chars)' : ''}',
                style: TextStyle(
                  color: activity.hasError ? Colors.red[300] : Colors.green[300],
                  fontSize: 11,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );
    }
    
    final color = _getToolColor(activity.tool);
    
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(
              _getToolIcon(activity.tool),
              size: 14,
              color: color,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            activity.tool,
            style: const TextStyle(
              fontWeight: FontWeight.w500,
              fontSize: 13,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              activity.shortDescription,
              style: TextStyle(
                color: Colors.grey[500],
                fontSize: 12,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
