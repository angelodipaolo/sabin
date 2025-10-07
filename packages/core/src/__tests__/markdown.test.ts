import fs from 'fs/promises';
import path from 'path';
import * as os from 'os';
import { parseTask, writeTask, getNextTaskNumber } from '../markdown';
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
plan: /path/to/plan.md
---

This is the task content`;

      mockFs.readFile.mockResolvedValue(mockContent);

      const task = await parseTask('/path/to/task.md');

      expect(task).toEqual({
        status: 'open',
        title: 'Test Task',
        plan: '/path/to/plan.md',
        content: '\nThis is the task content',
        path: '/path/to/task.md'
      });
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

      expect(task.title).toBeUndefined(); // No title provided
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
        status: 'ready',
        title: 'Test Task',
        plan: '/plan.md',
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
        status: 'ready',
        title: 'Fix: "auth" bug [critical] - User can\'t login',
        plan: '/path/with spaces/plan.md',
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
        expect.stringContaining('/path/with spaces/plan.md')
      );
    });

    it('should handle multiline content correctly', async () => {
      const task: Task = {
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

  describe('getNextTaskNumber', () => {
    it('should return next task number', async () => {
      mockFs.readdir.mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('open')) {
          return Promise.resolve(['TASK-0001.md', 'TASK-0003.md'] as any);
        } else {
          return Promise.resolve(['TASK-0002.md'] as any);
        }
      });

      const nextNumber = await getNextTaskNumber('/tasks');

      expect(nextNumber).toBe('0004');
    });

    it('should return 0001 when no tasks exist', async () => {
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

      const nextNumber = await getNextTaskNumber('/tasks');

      expect(nextNumber).toBe('0001');
    });

    // Phase 2: Edge cases
    it('should handle mixed prefixes in directory', async () => {
      mockFs.readdir.mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('open')) {
          return Promise.resolve(['TASK-0001.md', 'JIRA-123.md', 'TASK-0005.md', 'CUSTOM-999.md'] as any);
        } else {
          return Promise.resolve(['TASK-0003.md'] as any);
        }
      });

      const nextNumber = await getNextTaskNumber('/tasks', { projectPrefix: 'TASK', taskNumberPadding: 4 });

      // Should only consider TASK prefix and ignore others
      expect(nextNumber).toBe('0006');
    });

    it('should handle gaps in numbering', async () => {
      mockFs.readdir.mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('open')) {
          return Promise.resolve(['TASK-0001.md', 'TASK-0005.md', 'TASK-0010.md'] as any);
        } else {
          return Promise.resolve([] as any);
        }
      });

      const nextNumber = await getNextTaskNumber('/tasks');

      // Should return next number after highest (0011), not fill gaps
      expect(nextNumber).toBe('0011');
    });

    it('should handle very large task numbers', async () => {
      mockFs.readdir.mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('open')) {
          return Promise.resolve(['TASK-9998.md', 'TASK-9999.md'] as any);
        } else {
          return Promise.resolve([] as any);
        }
      });

      const nextNumber = await getNextTaskNumber('/tasks');

      expect(nextNumber).toBe('10000');
    });
  });
});
