import {
  SabinError,
  TaskNotFoundError,
  TaskExistsError,
  InvalidTaskStatusError,
  UnknownAgentError
} from '../errors';

describe('errors', () => {
  it('SabinError carries a code', () => {
    const error = new SabinError('Test error', 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error).toBeInstanceOf(Error);
  });

  it('TaskNotFoundError names the task', () => {
    const error = new TaskNotFoundError('TASK-0001');
    expect(error.message).toBe('Task not found: TASK-0001');
    expect(error.code).toBe('TASK_NOT_FOUND');
    expect(error).toBeInstanceOf(SabinError);
  });

  it('TaskExistsError names the task', () => {
    const error = new TaskExistsError('JIRA-1');
    expect(error.message).toBe('Task already exists: JIRA-1');
    expect(error.code).toBe('TASK_EXISTS');
  });

  it('InvalidTaskStatusError lists the valid statuses', () => {
    const error = new InvalidTaskStatusError('bogus');
    expect(error.message).toBe(
      'Invalid task status: bogus. Must be one of: open, ready, in_progress, review, completed'
    );
    expect(error.code).toBe('INVALID_STATUS');
  });

  it('UnknownAgentError lists the known agents', () => {
    const error = new UnknownAgentError('aider', ['claude', 'codex']);
    expect(error.message).toContain('Known agents: claude, codex');
    expect(error.code).toBe('UNKNOWN_AGENT');
  });
});
