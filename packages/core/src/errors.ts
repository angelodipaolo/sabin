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

export class InvalidTaskStatusError extends SabinError {
  constructor(status: string) {
    super(`Invalid task status: ${status}. Must be one of: open, ready, in_progress, review, completed, resolved`, 'INVALID_STATUS');
  }
}

export class TodoItemNotFoundError extends SabinError {
  constructor(index: number) {
    super(`TODO item not found at index: ${index}`, 'TODO_ITEM_NOT_FOUND');
  }
}

export class SabinDirectoryNotFoundError extends SabinError {
  constructor(path: string) {
    super(`Sabin directory not found: ${path}. Run 'sabin init' to initialize.`, 'SABIN_DIR_NOT_FOUND');
  }
}

export function handleError(error: unknown): void {
  if (error instanceof SabinError) {
    console.error(`\x1b[31m[${error.code}]\x1b[0m ${error.message}`);
  } else if (error instanceof Error) {
    console.error('\x1b[31mUnexpected error:\x1b[0m', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
  } else {
    console.error('\x1b[31mUnexpected error:\x1b[0m', error);
  }
  process.exit(1);
}

export function isValidStatus(status: string): boolean {
  return ['open', 'ready', 'in_progress', 'review', 'completed', 'resolved'].includes(status);
}