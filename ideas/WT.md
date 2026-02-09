# Plan: Git Worktree Support

## Context

The user wants to work on multiple branches/ideas simultaneously from their phone. Currently, each project maps to a single directory under `~/projects/`, so you can only have one branch checked out per repo. Git worktrees let you have multiple branches checked out in separate directories sharing the same `.git` repo — perfect for parallel work.

The existing multi-project tab system already supports independent conversations, Claude sessions, and working directories per project. Worktrees just need to appear as discoverable projects and the rest works automatically.

## Approach

**Worktrees live in `~/projects/` with naming convention `{repo}--{branch}`.**

Example: creating worktree for `feature/dark-mode` from `remote-claude-real` produces:

```
~/projects/remote-claude-real--feature-dark-mode/
```

This works because:

- `listProjects()` already scans `~/projects/` — worktrees have a `.git` file (pointing to parent) which counts as a project marker
- `validateProjectId()` accepts `--` in names (no forbidden chars)
- No changes needed to conversation storage, Claude spawning, or WebSocket routing
- Worktree detection uses git's own metadata (`.git` file vs `.git` directory), not the naming convention

## Files to Modify

### 1. `src/lib/store.ts` — Worktree detection + CRUD

**Extend `Project` interface** (line 68):

```typescript
export interface Project {
  id: string;
  path: string;
  name: string;
  lastAccessed?: string;
  worktree?: {
    isWorktree: boolean;
    parentRepoId: string; // e.g. "remote-claude-real"
    branch: string;
  };
}
```

**Add `detectWorktreeInfo(projectPath)`**: Check if `.git` is a file (= linked worktree) vs directory (= main repo). If worktree, run `git worktree list --porcelain` to find the main repo path. Extract branch via `git rev-parse --abbrev-ref HEAD`. Only runs `execSync` when `.git` is a file (fast `statSync` check first).

**Modify `listProjects()`**: After discovering each project, call `detectWorktreeInfo()` and populate the `worktree` field. Derive `parentRepoId` from the main worktree path's basename.

**Add `listWorktrees(projectId)`**: Run `git worktree list --porcelain` from the project dir. Parse and return `{path, branch, isCurrent}[]`.

**Add `createWorktree(projectId, branchName)`**: Sanitize branch name (`/` → `-`), compute `worktreeId = {projectId}--{safeBranch}`, path = `~/projects/{worktreeId}`. Try `git worktree add {path} {branch}`, fall back to `git worktree add -b {branch} {path}` if branch doesn't exist. Return `{id, path}`.

**Add `removeWorktree(worktreeProjectId)`**: Verify it's actually a worktree via `detectWorktreeInfo()`. Run `git worktree remove {path}` from the parent repo. Surfaces clear error if dirty (uncommitted changes).

### 2. `server.ts` — Three new API endpoints

Add alongside existing `/api/projects/:id/git` routes:

- **`GET /api/projects/:id/worktrees`** — List all worktrees for a repo. Returns `{worktrees: [{path, branch, isCurrent}]}`.
- **`POST /api/projects/:id/worktrees`** — Create worktree. Body: `{branch: string}`. Returns `{id, path, branch}`.
- **`DELETE /api/projects/:id/worktrees`** — Remove a worktree project. Returns `{success: true}`.

**Enhance existing `GET /api/projects/:id/git`** — Add `branches` list (from `git branch -a --format='%(refname:short)'`), `isWorktree` boolean, and `parentRepoId` to the response. The branches list is needed for the worktree creation UI.

Import new functions: `listWorktrees`, `createWorktree`, `removeWorktree` from store.

### 3. `client/src/components/ProjectTabs.tsx` — Update Project type + tab display

**Extend `Project` interface** (exported, used everywhere) with the `worktree?` field.

**Tab rendering**: For worktree projects, show `parentRepoId:branch` instead of project name. Compact format for phone screens.

### 4. `client/src/components/GitStatus.tsx` — Worktree creation + deletion UI

This is the primary entry point on mobile (the branch badge in the header).

**Add to the expanded dropdown:**

- "New worktree" button below the Refresh button
- Tapping it opens a small inline modal with:
  - Text input for branch name
  - List of existing branches (from enhanced `/git` endpoint) as tappable options
  - "Create" button → `POST /api/projects/:id/worktrees` → opens new project tab
- When the current project IS a worktree: show "Delete worktree" option that calls DELETE and closes the tab

**New props**: `onWorktreeCreated?: (project: Project) => void`, `onWorktreeDeleted?: (projectId: string) => void`

### 5. `client/src/components/ProjectPicker.tsx` — Grouped display

Group worktrees under their parent repo in the project list:

```
📁 remote-claude-real              main
   🔀 feature-dark-mode            worktree
   🔀 bugfix-auth                  worktree
📁 pond.audio                      main
```

Worktree entries rendered indented with branch icon. Parent repos show their branch name. Search still works across all entries.

### 6. `client/src/pages/Chat.tsx` — Wire callbacks

Pass `onWorktreeCreated` and `onWorktreeDeleted` from `GitStatus` through to existing `handleSelectProject` and `handleCloseProject`. No new logic needed — these handlers already work generically.

## Implementation Order

1. `src/lib/store.ts` — Core functions (detect, list, create, remove, extend Project)
2. `server.ts` — API endpoints + enhanced git endpoint
3. `client/src/components/ProjectTabs.tsx` — Type update + display
4. `client/src/components/GitStatus.tsx` — Creation/deletion UI
5. `client/src/components/ProjectPicker.tsx` — Grouped display
6. `client/src/pages/Chat.tsx` — Wire callbacks
7. Build + deploy + test

## Verification

1. `pnpm build` passes
2. `pnpm lint` passes
3. `make deploy`
4. Open a project on the phone → tap branch badge → see "New worktree" button
5. Create a worktree for a new branch → new tab opens with that branch
6. Send a message in the worktree project → Claude works in the correct directory
7. Open project picker → worktrees grouped under parent repo
8. Delete worktree → tab closes, directory removed
9. Verify main repo unaffected after worktree deletion
