---
status: completed
title: share sabin across repos and work trees
plan: .sabin/plans/SABIN-0003-shared-sabin-directories.md
---

I want to update sabin to support sharing a single `.sabin` directory across multiple directories.

Directory structure for example:
- projects/.sabin
- projects/project-1
- projects/project-2

The same sabin data would be shared for both project 1 and project 2, instead of each of those project directories having a `.sabin` sub directory.

# Requirements

- Add a `.sabinconfig` file that a project directory can have that points to the shared `.sabin` directory
- When a task is updated to in_progress, record the working directory in frontmatter of the task so we can track which project directory is working on the task

