import { useState, useEffect } from 'react';
import type { Project } from './ProjectTabs';

interface ProjectPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (project: Project) => void;
  openProjectIds: Set<string>;
}

export default function ProjectPicker({
  isOpen,
  onClose,
  onSelect,
  openProjectIds,
}: ProjectPickerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchProjects();
    }
  }, [isOpen]);

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full sm:max-w-md bg-[var(--color-bg-secondary)] rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Open Project</h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[var(--color-border-default)]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full px-4 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400">
              <p>{error}</p>
              <button
                onClick={fetchProjects}
                className="mt-2 text-sm text-[var(--color-accent)] hover:text-[#d97a5a]"
              >
                Retry
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-tertiary)]">
              {search ? 'No matching projects' : 'No projects found in ~/projects'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredProjects.map((project) => {
                const isOpen = openProjectIds.has(project.id);
                return (
                  <button
                    key={project.id}
                    onClick={() => {
                      onSelect(project);
                      onClose();
                    }}
                    className={`
                      w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors
                      ${isOpen
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                        : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                      }
                    `}
                  >
                    {/* Folder icon */}
                    <div className={`p-2 rounded-lg ${isOpen ? 'bg-[var(--color-accent-muted)]' : 'bg-[var(--color-bg-hover)]'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{project.name}</span>
                        {isOpen && (
                          <span className="text-xs bg-[var(--color-accent)] px-1.5 py-0.5 rounded">Open</span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                        {project.path}
                      </div>
                      {project.lastAccessed && (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          Last used: {new Date(project.lastAccessed).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[var(--color-text-tertiary)]" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="p-3 border-t border-[var(--color-border-default)] text-center text-xs text-[var(--color-text-tertiary)]">
          Projects from ~/projects
        </div>
      </div>
    </div>
  );
}
