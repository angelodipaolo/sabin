import { TASK_STATUSES } from './types';

export class SabinError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SabinError';
  }
}

export class TaskNotFoundError extends SabinError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, 'TASK_NOT_FOUND');
  }
}

export class TaskExistsError extends SabinError {
  constructor(taskId: string) {
    super(`Task already exists: ${taskId}`, 'TASK_EXISTS');
  }
}

export class InvalidTaskStatusError extends SabinError {
  constructor(status: string) {
    super(`Invalid task status: ${status}. Must be one of: ${TASK_STATUSES.join(', ')}`, 'INVALID_STATUS');
  }
}

export class UnknownAgentError extends SabinError {
  constructor(name: string, known: string[]) {
    super(
      `Unknown agent: ${name}. Known agents: ${known.join(', ')}.\n` +
      `Add one under "agents.definitions" in config.json.`,
      'UNKNOWN_AGENT'
    );
  }
}
