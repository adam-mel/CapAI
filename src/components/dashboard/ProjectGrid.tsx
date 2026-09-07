"use client";

import type { Project } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";

interface ProjectGridProps {
  projects: Project[];
  onDelete: (id: string) => Promise<void> | void;
  onRename: (id: string, newName: string) => Promise<void> | void;
}

export function ProjectGrid({ projects, onDelete, onRename }: ProjectGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </div>
  );
}
