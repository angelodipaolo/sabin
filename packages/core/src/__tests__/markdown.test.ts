import fs from 'fs/promises';
import { parseTask, writeTask } from '../markdown';
import { Task } from '../types';

jest.mock('fs/promises');

describe('markdown utilities', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseTask', () => {
    it('should parse a task file with frontmatter', async () => {
      const mockContent = `---
status: open
title: Test Task
---

This is the task content`;

      mockFs.readFile.mockResolvedValue(mockContent);

      const task = await parseTask('/path/to/task.md');

      expect(task).toMatchObject({
        id: 'task',
        status: 'open',
        title: 'Test Task',
        content: '\nThis is the task content',
        path: '/path/to/task.md'
      });
    });

    it('should ignore a legacy plan key', async () => {
      // Tasks written before plans moved to notesDir/plan.md still carry it
      const mockContent = `---
status: open
title: Test Task
plan: .sabin/plans/TASK-0001.md
---

Content`;

      mockFs.readFile.mockResolvedValue(mockContent);

      const task = await parseTask('/path/to/task.md');

      expect(task).not.toHaveProperty('plan');
    });

    it('should default status to open if not provided', async () => {
      const mockContent = `---
title: Test Task
---

Content`;

      mockFs.readFile.mockResolvedValue(mockContent);

      const task = await parseTask('/path/to/task.md');

      expect(task.status).toBe('open');
    });

    // Phase 2: Edge cases
    it('should throw on malformed YAML frontmatter', async () => {
      const mockContent = `---
status: open
title: Test Task
invalid yaml: [unclosed bracket
---

Content`;

      mockFs.readFile.mockResolvedValue(mockContent);

      // gray-matter throws on invalid YAML
      await expect(parseTask('/path/to/task.md')).rejects.toThrow();
    });

    it('should handle missing title field', async () => {
      const mockContent = `---
status: open
---

Content`;

      mockFs.readFile.mockResolvedValue(mockContent);

      const task = await parseTask('/path/to/task.md');

      expect(task.title).toBe('task'); // Falls back to the ID
      expect(task.status).toBe('open');
    });

    it('should handle completely missing frontmatter', async () => {
      const mockContent = `Just content without frontmatter`;

      mockFs.readFile.mockResolvedValue(mockContent);

      const task = await parseTask('/path/to/task.md');

      expect(task.status).toBe('open'); // Default status
      expect(task.content).toContain('Just content');
    });
  });

  describe('writeTask', () => {
    it('should write a task file with frontmatter', async () => {
      const task: Task = {
        id: 'TASK-0001',
        status: 'ready',
        title: 'Test Task',
        content: 'Task content',
        path: '/path/to/task.md'
      };

      await writeTask(task);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/path/to/task.md',
        expect.stringContaining('status: ready')
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/path/to/task.md',
        expect.stringContaining('title: Test Task')
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/path/to/task.md',
        expect.stringContaining('Task content')
      );
    });

    // Phase 2: Edge cases
    it('should handle special characters in frontmatter values', async () => {
      const task: Task = {
        id: 'TASK-0001',
        status: 'ready',
        title: 'Fix: "auth" bug [critical] - User can\'t login',
        worktree: '/path/with spaces/worktree',
        content: 'Content with special chars: @#$%',
        path: '/path/to/task.md'
      };

      await writeTask(task);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/path/to/task.md',
        expect.stringContaining('Fix: "auth" bug [critical]')
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/path/to/task.md',
        expect.stringContaining('/path/with spaces/worktree')
      );
    });

    it('should handle multiline content correctly', async () => {
      const task: Task = {
        id: 'TASK-0001',
        status: 'open',
        title: 'Multiline Task',
        content: 'Line 1\nLine 2\nLine 3',
        path: '/path/to/task.md'
      };

      await writeTask(task);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/path/to/task.md',
        expect.stringContaining('Line 1\nLine 2\nLine 3')
      );
    });
  });
});
