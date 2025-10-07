import { TaskService } from '../services/taskService';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('vscode');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('TaskService', () => {
  const workspaceRoot = '/test/workspace';
  let taskService: TaskService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instance
    (TaskService as any).instance = undefined;
    taskService = TaskService.getInstance(workspaceRoot);
  });

  describe('getInstance', () => {
    it('should create singleton instance', () => {
      const instance1 = TaskService.getInstance(workspaceRoot);
      const instance2 = TaskService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should throw error if called without workspace root before initialization', () => {
      (TaskService as any).instance = undefined;

      expect(() => TaskService.getInstance()).toThrow('TaskService must be initialized with a workspace root');
    });
  });

  describe('createTask', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{"projectPrefix":"TASK","taskNumberPadding":4}');
      mockFs.readdirSync.mockReturnValue([]);
    });

    it('should create task with auto-generated ID', async () => {
      const vscode = require('vscode');
      vscode.workspace.fs.writeFile.mockResolvedValue(undefined);
      vscode.workspace.fs.createDirectory.mockResolvedValue(undefined);
      vscode.workspace.fs.readDirectory.mockResolvedValue([]);

      const filePath = await taskService.createTask('Test Task', 'Test description');

      expect(filePath).toContain('TASK-0001.md');
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining('TASK-0001.md') }),
        expect.any(Buffer)
      );
    });

    it('should create task with custom ID', async () => {
      const vscode = require('vscode');
      vscode.workspace.fs.writeFile.mockResolvedValue(undefined);
      vscode.workspace.fs.createDirectory.mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(false);

      const filePath = await taskService.createTask('Custom Task', 'Description', 'CUSTOM-123');

      expect(filePath).toContain('CUSTOM-123.md');
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining('CUSTOM-123.md') }),
        expect.any(Buffer)
      );
    });

    it('should detect duplicate in open directory', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        return String(path).includes('TASK-0001.md') && String(path).includes('open');
      });

      await expect(taskService.createTask('Duplicate', '', 'TASK-0001')).rejects.toThrow('Task TASK-0001 already exists in open/');
    });

    it('should detect duplicate in completed directory', async () => {
      mockFs.existsSync.mockImplementation((path) => {
        return String(path).includes('TASK-0001.md') && String(path).includes('completed');
      });

      await expect(taskService.createTask('Duplicate', '', 'TASK-0001')).rejects.toThrow('Task TASK-0001 already exists in completed/');
    });

    it('should reject empty task ID', async () => {
      await expect(taskService.createTask('Test', '', '   ')).rejects.toThrow('Task ID cannot be empty');
    });
  });

  describe('updateTaskStatus', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(`---
status: open
title: Test Task
---
Content`);
      mockFs.writeFileSync.mockReturnValue(undefined);
    });

    it('should update frontmatter correctly', async () => {
      const vscode = require('vscode');
      mockFs.existsSync.mockImplementation((p) => String(p).includes('open'));

      await taskService.updateTaskStatus('TASK-0001', 'ready');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('TASK-0001.md'),
        expect.stringContaining('status: ready')
      );
    });

    it('should move file from open to completed when status is completed', async () => {
      const vscode = require('vscode');
      mockFs.existsSync.mockImplementation((p) => String(p).includes('open'));
      vscode.workspace.fs.rename.mockResolvedValue(undefined);
      vscode.workspace.fs.createDirectory.mockResolvedValue(undefined);

      await taskService.updateTaskStatus('TASK-0001', 'completed');

      // Wait for the move to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(vscode.workspace.fs.rename).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining('open') }),
        expect.objectContaining({ path: expect.stringContaining('completed') })
      );
    });

    it('should move file from completed to open when status changes from completed', async () => {
      const vscode = require('vscode');
      mockFs.existsSync.mockImplementation((p) => String(p).includes('completed'));
      mockFs.readFileSync.mockReturnValue(`---
status: completed
title: Test Task
---
Content`);
      vscode.workspace.fs.rename.mockResolvedValue(undefined);
      vscode.workspace.fs.createDirectory.mockResolvedValue(undefined);

      await taskService.updateTaskStatus('TASK-0001', 'open');

      // Wait for the move to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(vscode.workspace.fs.rename).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining('completed') }),
        expect.objectContaining({ path: expect.stringContaining('open') })
      );
    });

    it('should throw error for non-existent task', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(taskService.updateTaskStatus('TASK-9999', 'ready')).rejects.toThrow('Task TASK-9999 not found');
    });
  });

  describe('getTasks', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr.includes('open')) {
          return ['TASK-0001.md', 'TASK-0002.md'] as any;
        } else if (dirStr.includes('completed')) {
          return ['TASK-0003.md'] as any;
        }
        return [] as any;
      });
      mockFs.readFileSync.mockImplementation((file) => {
        const fileStr = String(file);
        if (fileStr.includes('TASK-0001')) {
          return `---
status: open
title: Task 1
---
Content 1`;
        } else if (fileStr.includes('TASK-0002')) {
          return `---
status: ready
title: Task 2
---
Content 2`;
        } else if (fileStr.includes('TASK-0003')) {
          return `---
status: completed
title: Task 3
---
Content 3`;
        }
        return '';
      });
    });

    it('should return all tasks', async () => {
      const tasks = await taskService.getTasks();

      expect(tasks).toHaveLength(3);
      expect(tasks.map(t => t.id)).toEqual(['TASK-0001', 'TASK-0002', 'TASK-0003']);
    });

    it('should filter by status', async () => {
      const tasks = await taskService.getTasks('open');

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('TASK-0001');
      expect(tasks[0].status).toBe('open');
    });
  });

  describe('deleteTask', () => {
    it('should delete task file', async () => {
      const vscode = require('vscode');
      mockFs.existsSync.mockReturnValue(true);
      vscode.workspace.fs.delete.mockResolvedValue(undefined);

      await taskService.deleteTask('/path/to/TASK-0001.md');

      expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/path/to/TASK-0001.md' })
      );
    });

    it('should throw error for non-existent task', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(taskService.deleteTask('/path/to/TASK-9999.md')).rejects.toThrow('Task file not found');
    });
  });

  describe('getNextTaskNumber', () => {
    it('should increment correctly', async () => {
      const vscode = require('vscode');
      mockFs.readFileSync.mockReturnValue('{"projectPrefix":"TASK","taskNumberPadding":4}');
      mockFs.existsSync.mockReturnValue(true);
      vscode.workspace.fs.readDirectory.mockResolvedValue([
        ['TASK-0001.md', 1],
        ['TASK-0003.md', 1]
      ]);

      const nextNumber = await taskService.getNextTaskNumber();

      expect(nextNumber).toBe('0004');
    });

    it('should respect custom prefix', async () => {
      const vscode = require('vscode');
      mockFs.readFileSync.mockReturnValue('{"projectPrefix":"CUSTOM","taskNumberPadding":4}');
      mockFs.existsSync.mockReturnValue(true);
      vscode.workspace.fs.readDirectory.mockResolvedValue([
        ['CUSTOM-0005.md', 1],
        ['TASK-0010.md', 1] // Should ignore different prefix
      ]);

      const nextNumber = await taskService.getNextTaskNumber();

      expect(nextNumber).toBe('0006');
    });
  });

  describe('getProjectPrefix', () => {
    it('should return configured prefix', async () => {
      mockFs.readFileSync.mockReturnValue('{"projectPrefix":"MYPROJECT","taskNumberPadding":4}');
      mockFs.existsSync.mockReturnValue(true);

      const prefix = await taskService.getProjectPrefix();

      expect(prefix).toBe('MYPROJECT');
    });

    it('should return default prefix when config missing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const prefix = await taskService.getProjectPrefix();

      expect(prefix).toBe('TASK');
    });
  });
});
