import { useRef, useEffect } from "react";

export interface Project {
  id: string;
  path: string;
  name: string;
  lastAccessed?: string;
}

interface ProjectTabsProps {
  projects: Project[];
  activeProjectId: string | null;
  streamingProjectIds: Set<string>;
  onSelectProject: (projectId: string) => void;
  onCloseProject: (projectId: string) => void;
  onAddProject: () => void;
}

export default function ProjectTabs({
  projects,
  activeProjectId,
  streamingProjectIds,
  onSelectProject,
  onCloseProject,
  onAddProject,
}: ProjectTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (activeTabRef.current && scrollRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeProjectId]);

  return (
    <div className="flex items-center border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]">
      {/* Add project button */}
      <button
        onClick={onAddProject}
        className="flex-shrink-0 p-2 px-3 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors border-r border-[var(--color-border-default)]"
        title="Open project"
        aria-label="Open project"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Scrollable tabs container */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="flex">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isStreaming = streamingProjectIds.has(project.id);

            return (
              <button
                key={project.id}
                ref={isActive ? activeTabRef : undefined}
                onClick={() => onSelectProject(project.id)}
                className={`
                  group flex items-center gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap
                  border-r border-[var(--color-border-default)] transition-colors min-w-0
                  ${
                    isActive
                      ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] border-b-2 border-b-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                  }
                `}
              >
                {/* Streaming indicator */}
                {isStreaming && (
                  <span className="w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse flex-shrink-0" />
                )}

                {/* Project name */}
                <span className="truncate max-w-[120px]">{project.name}</span>

                {/* Close button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseProject(project.id);
                  }}
                  className={`
                    flex-shrink-0 p-0.5 rounded hover:bg-[var(--color-border-emphasis)] transition-colors
                    ${isActive ? "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100"}
                  `}
                  title="Close project"
                  aria-label={`Close ${project.name}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
