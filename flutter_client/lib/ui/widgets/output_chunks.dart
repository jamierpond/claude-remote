import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/task.dart';

class OutputChunks extends StatelessWidget {
  final List<OutputChunk> chunks;
  
  const OutputChunks({super.key, required this.chunks});
  
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            children: [
              Icon(
                Icons.chat_bubble_outline,
                size: 16,
                color: Colors.grey[500],
              ),
              const SizedBox(width: 8),
              Text(
                'Response',
                style: TextStyle(
                  color: Colors.grey[400],
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const Spacer(),
              Text(
                '${chunks.length} chunks',
                style: TextStyle(
                  color: Colors.grey[600],
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
        
        // Chunks
        ...chunks.asMap().entries.map((entry) {
          final index = entry.key;
          final chunk = entry.value;
          final isFirst = index == 0;
          
          return _ChunkCard(
            chunk: chunk,
            showDivider: !isFirst,
          );
        }),
      ],
    );
  }
}

class _ChunkCard extends StatelessWidget {
  final OutputChunk chunk;
  final bool showDivider;
  
  const _ChunkCard({
    required this.chunk,
    this.showDivider = false,
  });
  
  @override
  Widget build(BuildContext context) {
    final timeFormat = DateFormat('HH:mm:ss');
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showDivider)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Divider(color: Colors.grey[800]),
                ),
                if (chunk.afterTool != null) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(
                      'after ${chunk.afterTool}',
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 10,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Divider(color: Colors.grey[800]),
                  ),
                ],
              ],
            ),
          ),
        
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.grey[850],
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Timestamp (subtle)
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    timeFormat.format(chunk.timestamp),
                    style: TextStyle(
                      color: Colors.grey[700],
                      fontSize: 10,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              
              // Content
              SelectableText(
                chunk.text,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.6,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
