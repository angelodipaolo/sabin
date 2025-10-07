import {
  SabinError,
  TaskNotFoundError,
  InvalidTaskStatusError,
  TodoItemNotFoundError,
  SabinDirectoryNotFoundError,
  isValidStatus,
  handleError
} from '../errors';

describe('error utilities', () => {
  describe('SabinError', () => {
    it('should create error with message and code', () => {
      const error = new SabinError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('SabinError');
    });

    it('should be instance of Error', () => {
      const error = new SabinError('Test', 'CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SabinError);
    });
  });

  describe('TaskNotFoundError', () => {
    it('should format message with task ID', () => {
      const error = new TaskNotFoundError('TASK-0001');

      expect(error.message).toBe('Task not found: TASK-0001');
      expect(error.code).toBe('TASK_NOT_FOUND');
    });

    it('should work with custom task IDs', () => {
      const error = new TaskNotFoundError('JIRA-123');

      expect(error.message).toBe('Task not found: JIRA-123');
    });
  });

  describe('InvalidTaskStatusError', () => {
    it('should format message with invalid status', () => {
      const error = new InvalidTaskStatusError('invalid');

      expect(error.message).toBe('Invalid task status: invalid. Must be one of: open, ready, in_progress, review, completed, resolved');
      expect(error.code).toBe('INVALID_STATUS');
    });

    it('should show valid statuses in error message', () => {
      const error = new InvalidTaskStatusError('bad_status');

      expect(error.message).toContain('open, ready, in_progress, review, completed, resolved');
    });
  });

  describe('TodoItemNotFoundError', () => {
    it('should format message with index', () => {
      const error = new TodoItemNotFoundError(5);

      expect(error.message).toBe('TODO item not found at index: 5');
      expect(error.code).toBe('TODO_ITEM_NOT_FOUND');
    });
  });

  describe('SabinDirectoryNotFoundError', () => {
    it('should format message with path and hint', () => {
      const error = new SabinDirectoryNotFoundError('/path/to/project');

      expect(error.message).toBe("Sabin directory not found: /path/to/project. Run 'sabin init' to initialize.");
      expect(error.code).toBe('SABIN_DIR_NOT_FOUND');
    });
  });

  describe('isValidStatus', () => {
    it('should return true for valid status "open"', () => {
      expect(isValidStatus('open')).toBe(true);
    });

    it('should return true for valid status "ready"', () => {
      expect(isValidStatus('ready')).toBe(true);
    });

    it('should return true for valid status "review"', () => {
      expect(isValidStatus('review')).toBe(true);
    });

    it('should return true for valid status "resolved"', () => {
      expect(isValidStatus('resolved')).toBe(true);
    });

    it('should return true for valid status "in_progress"', () => {
      expect(isValidStatus('in_progress')).toBe(true);
    });

    it('should return true for valid status "completed"', () => {
      expect(isValidStatus('completed')).toBe(true);
    });

    it('should return false for invalid status', () => {
      expect(isValidStatus('invalid')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidStatus('')).toBe(false);
    });

    it('should return false for partial match', () => {
      expect(isValidStatus('ope')).toBe(false);
    });
  });

  describe('handleError', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let processExitSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit called');
      });
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('should format SabinError with code', () => {
      const error = new SabinError('Test error', 'TEST_CODE');

      expect(() => handleError(error)).toThrow('Process exit called');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TEST_CODE]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test error')
      );
    });

    it('should handle regular Error instances', () => {
      const error = new Error('Regular error');

      expect(() => handleError(error)).toThrow('Process exit called');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected error:'),
        'Regular error'
      );
    });

    it('should handle non-Error values', () => {
      const error = 'string error';

      expect(() => handleError(error)).toThrow('Process exit called');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected error:'),
        'string error'
      );
    });

    it('should show stack trace in DEBUG mode', () => {
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = '1';

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at Test.fn';

      expect(() => handleError(error)).toThrow('Process exit called');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Test error'));

      process.env.DEBUG = originalDebug;
    });

    it('should exit with code 1', () => {
      const error = new SabinError('Test', 'CODE');

      expect(() => handleError(error)).toThrow('Process exit called');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
