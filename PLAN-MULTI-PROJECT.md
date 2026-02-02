# Multi-Project Support with Tabs - Implementation Plan

## Overview

Add the ability to work on multiple projects from `~/projects/` via tabs in the mobile app, with each tab having its own Claude Code session running in that project's directory.

## Current Architecture

```
Client (one chat view) → Server → Claude CLI (no cwd set)
                                    ↓
                         ~/.config/claude-remote/conversation.json (global)
```

## Target Architecture

```
Client (tabbed interface)
  ├─ Tab 1: remote-claude-real → Session A (cwd: ~/projects/remote-claude-real)
  ├─ Tab 2: openclaw           → Session B (cwd: ~/projects/openclaw)
  └─ Tab 3: pond.audio         → Session C (cwd: ~/projects/pond.audio)
                                    ↓
                         ~/.config/claude-remote/projects/{projectId}/
                           ├─ conversation.json
                           └─ session metadata
```

---

## Phase 1: Server-Side Multi-Project Support

### 1.1 Update Storage Layer (`src/lib/store.ts`)

```typescript
// New interfaces
export interface Project {
  id: string;           // folder name e.g. "remote-claude-real"
  path: string;         // full path e.g. "/home/jamie/projects/remote-claude-real"
  name: string;         // display name (from package.json or folder)
  lastAccessed: string;
}

export interface ProjectConversation {
  projectId: string;
  messages: Message[];
  claudeSessionId: string | null;
  updatedAt: string;
}

// New functions
export function listProjects(basePath: string): Project[]
export function loadProjectConversation(projectId: string): ProjectConversation
export function saveProjectConversation(projectId: string, conversation: ProjectConversation): void
export function getProjectSessionId(projectId: string): string | null
export function saveProjectSessionId(projectId: string, sessionId: string): void
```

**Storage structure:**
```
~/.config/claude-remote/
  ├─ devices.json          (unchanged)
  ├─ server.json           (unchanged)
  ├─ config.json           (unchanged)
  └─ projects/
      ├─ remote-claude-real/
      │   └─ conversation.json
      ├─ openclaw/
      │   └─ conversation.json
      └─ ...
```

### 1.2 Update Claude Spawning (`src/lib/claude.ts`)

Add `cwd` parameter:

```typescript
export function spawnClaude(
  message: string,
  onEvent: (event: ClaudeEvent) => void,
  signal?: AbortSignal,
  sessionId?: string | null,
  workingDirectory?: string  // NEW
): ChildProcess {
  // ...
  const proc = spawn('claude', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: workingDirectory || process.cwd(),  // NEW
  });
}
```

### 1.3 Update Server WebSocket Protocol (`server.ts`)

**New message types:**

```typescript
// Client → Server
{ type: 'list_projects' }
{ type: 'message', text: string, projectId: string }
{ type: 'get_history', projectId: string }
{ type: 'clear_history', projectId: string }
{ type: 'cancel', projectId: string }

// Server → Client
{ type: 'projects_list', projects: Project[] }
{ type: 'project_history', projectId: string, messages: Message[] }
// (existing event types now include projectId)
{ type: 'thinking', text: string, projectId: string }
{ type: 'text', text: string, projectId: string }
{ type: 'tool_use', toolUse: {...}, projectId: string }
{ type: 'done', projectId: string }
```

**Track active jobs per project:**

```typescript
// Change from:
const activeJobs: Map<string, AbortController> = new Map(); // deviceId → controller

// To:
const activeJobs: Map<string, Map<string, AbortController>> = new Map(); // deviceId → (projectId → controller)
```

### 1.4 New API Endpoints

```typescript
// GET /api/projects - List available projects
// GET /api/projects/:projectId/conversation - Get project history
// DELETE /api/projects/:projectId/conversation - Clear project history
```

---

## Phase 2: Client-Side Tab Support

### 2.1 New Components

**`client/src/components/ProjectTabs.tsx`**
```typescript
interface ProjectTabsProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCloseProject: (projectId: string) => void;
}
```

**`client/src/components/ProjectPicker.tsx`**
```typescript
// Modal/drawer to select a project from ~/projects
interface ProjectPickerProps {
  projects: Project[];
  onSelect: (project: Project) => void;
}
```

### 2.2 Update Chat.tsx State

```typescript
// Current (global):
const [messages, setMessages] = useState<Message[]>([]);

// New (per-project):
const [openProjects, setOpenProjects] = useState<Project[]>([]);
const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
const [projectMessages, setProjectMessages] = useState<Map<string, Message[]>>(new Map());
const [projectStreaming, setProjectStreaming] = useState<Map<string, boolean>>(new Map());
```

### 2.3 Updated UI Layout

```
┌─────────────────────────────────────────────────┐
│ [+] │ remote-claude │ openclaw │ pond.audio  [x]│  ← Tabs
├─────────────────────────────────────────────────┤
│                                                 │
│  Activity Panel (collapsible)                   │
│  ┌─────────────────────────────────────────┐   │
│  │ 📄 Read  🔧 Edit ×2  💻 Bash            │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [User message bubble]                          │
│                                                 │
│  [Assistant message bubble]                     │
│                                                 │
├─────────────────────────────────────────────────┤
│ [Message input...               ] [Send]        │
└─────────────────────────────────────────────────┘
```

### 2.4 Mobile Considerations

- Tabs as horizontal scrollable pills on mobile
- Swipe left/right between projects
- Long-press to close a tab
- `[+]` button opens project picker (bottom sheet on mobile)

---

## Phase 3: Session Management

### 3.1 Session Per Project

Each project gets its own Claude session:
- Session ID stored in `projects/{projectId}/conversation.json`
- `--resume` uses project-specific session
- Allows context continuity within each project

### 3.2 Concurrent Sessions

- Multiple Claude processes can run simultaneously (one per active project)
- Server tracks which project each job belongs to
- Cancel button cancels only the current tab's job
- Activity indicator per tab

### 3.3 Resource Limits

Consider adding:
- Max concurrent Claude processes (e.g., 3)
- Auto-pause inactive sessions after timeout
- Memory monitoring

---

## Phase 4: Project Discovery

### 4.1 Auto-Detection

Scan `~/projects/` for valid projects:

```typescript
function discoverProjects(basePath: string): Project[] {
  const dirs = fs.readdirSync(basePath);
  return dirs
    .filter(dir => {
      const fullPath = path.join(basePath, dir);
      return fs.statSync(fullPath).isDirectory() &&
             !dir.startsWith('.') &&
             hasProjectMarkers(fullPath);
    })
    .map(dir => ({
      id: dir,
      path: path.join(basePath, dir),
      name: getProjectName(path.join(basePath, dir)),
      lastAccessed: getLastAccessed(dir),
    }));
}

function hasProjectMarkers(dir: string): boolean {
  // Check for common project files
  return [
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    '.git',
    'Makefile',
  ].some(marker => fs.existsSync(path.join(dir, marker)));
}
```

### 4.2 Project Metadata

Extract project info for display:
- Name from `package.json`, `Cargo.toml`, or folder name
- Description if available
- Language/framework detection for icons

---

## Implementation Order

1. **Storage layer** - Add per-project conversation storage
2. **Claude spawning** - Add cwd parameter
3. **Server protocol** - Add projectId to messages
4. **API endpoints** - List projects, per-project history
5. **Client state** - Per-project message management
6. **Tab UI** - Basic tab bar and switching
7. **Project picker** - Browse and open projects
8. **Polish** - Mobile UX, animations, error handling

---

## Open Questions

1. **Claude invoking Claude?**
   - Not needed! Each tab is a separate Claude CLI process
   - Server orchestrates multiple processes
   - No nested invocation required

2. **Session sharing between tabs?**
   - Recommend: Independent sessions per project
   - Claude's `--resume` handles context within a project
   - Cross-project context would be confusing

3. **Default project?**
   - Option A: Last used project
   - Option B: Always start with project picker
   - Option C: Configurable default

4. **Project base path?**
   - Hardcode `~/projects/`?
   - Or make configurable in settings?

---

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 (Server) | Medium | None |
| Phase 2 (Client Tabs) | Medium | Phase 1 |
| Phase 3 (Sessions) | Low | Phase 1 |
| Phase 4 (Discovery) | Low | None |

Total: ~2-3 focused sessions of work

---

## Files to Modify

**Server:**
- `src/lib/store.ts` - Add project storage functions
- `src/lib/claude.ts` - Add cwd parameter
- `server.ts` - Update protocol, add endpoints

**Client:**
- `client/src/pages/Chat.tsx` - Tab state, per-project messages
- `client/src/components/ProjectTabs.tsx` (new)
- `client/src/components/ProjectPicker.tsx` (new)

**Config:**
- Consider adding `~/.config/claude-remote/settings.json` for:
  - Projects base path
  - Max concurrent sessions
  - Default project
