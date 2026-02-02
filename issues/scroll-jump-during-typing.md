# Text Entry Box Jumps to Bottom During Typing

## Status: FIXED (not yet committed)

## Problem
The text entry input box sometimes jumps/scrolls to the bottom for no apparent reason while the user is typing.

## Root Cause
In `client/src/pages/Chat.tsx`, the `scrollToBottom` function was being triggered too aggressively during streaming:

```javascript
// BEFORE (problematic)
useEffect(() => {
  scrollToBottom();
}, [messages, currentThinking, currentResponse, currentActivity, activeProjectId]);
```

This triggered `scrollIntoView({ behavior: 'smooth' })` every time streaming data changed (`currentThinking`, `currentResponse`, `currentActivity`). During active streaming, these values update rapidly (every few hundred milliseconds), causing constant scroll events that interfere with user input.

## Fix Applied
Two changes were made:

### 1. Smart scroll detection
`scrollToBottom` now checks if the user is near the bottom before scrolling:

```javascript
const scrollToBottom = useCallback((force = false) => {
  if (!messagesEndRef.current) return;

  // Only auto-scroll if user is near the bottom (within 150px) or forced
  const container = messagesEndRef.current.parentElement;
  if (container && !force) {
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    if (distanceFromBottom > 150) return; // User scrolled up, don't interrupt
  }

  messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
}, []);
```

### 2. Separate scroll behaviors for different events

```javascript
// Force scroll when new messages arrive or project changes
const messagesLength = messages.length;
useEffect(() => {
  scrollToBottom(true);
}, [messagesLength, activeProjectId, scrollToBottom]);

// Soft scroll during streaming (only if user is near bottom)
useEffect(() => {
  if (isStreaming) {
    scrollToBottom(false);
  }
}, [currentThinking, currentResponse, currentActivity, isStreaming, scrollToBottom]);
```

## Files Changed
- `client/src/pages/Chat.tsx` (lines ~654-777)

## Testing
1. Start a streaming response
2. Try typing in the input box while streaming
3. Scroll up during streaming - it should NOT auto-scroll back down
4. Stay at bottom during streaming - it SHOULD continue auto-scrolling

## Notes
- This was initially suspected to be HMR-related but is not
- The fix is currently applied but not committed (part of the multi-project feature branch)
