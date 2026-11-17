import { TASK_STATUSES } from './types';

/** Base class for every error core throws on purpose. `code` is stable; the message is for people. */
export class SabinError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SabinError';
  }
}

export class InvalidTaskIdError extends SabinError {
  constructor(public input: string) {
    super(`Invalid task ID: "${input}". Expected something like ABC-123.`, 'INVALID_TASK_ID');
  }
}

export class TaskNotFoundError extends SabinError {
  constructor(public taskId: string) {
    super(`Task not found: ${taskId}`, 'TASK_NOT_FOUND');
  }
}

export class TaskExistsError extends SabinError {
  constructor(public taskId: string) {
    super(`Task already exists: ${taskId}`, 'TASK_EXISTS');
  }
}

export class InvalidTaskStatusError extends SabinError {
  constructor(status: string) {
    super(`Invalid task status: ${status}. Must be one of: ${TASK_STATUSES.join(', ')}`, 'INVALID_STATUS');
  }
}

export class InvalidProjectError extends SabinError {
  constructor(input: string) {
    super(`Invalid project: "${input}". Use letters, digits and hyphens.`, 'INVALID_PROJECT');
  }
}

export class ProjectExistsError extends SabinError {
  constructor(public slug: string) {
    super(`Project already exists: ${slug}`, 'PROJECT_EXISTS');
  }
}

export class NotAGitRepoError extends SabinError {
  constructor(public dir: string) {
    super(`Not inside a git repository: ${dir}`, 'NOT_A_GIT_REPO');
  }
}

export class RepoNotFoundError extends SabinError {
  constructor(public repo: string) {
    super(`No registered repo named "${repo}". See \`sabin repo ls\`.`, 'REPO_NOT_FOUND');
  }
}

export class WorkspacePathTakenError extends SabinError {
  constructor(public target: string) {
    super(`Cannot create a worktree at ${target}: something is already there.`, 'WORKSPACE_PATH_TAKEN');
  }
}

/** A JSON file we were asked to merge into could not be parsed, so it was left alone */
export class UnparsableFileError extends SabinError {
  constructor(public file: string, detail: string) {
    super(`Could not parse ${file}: ${detail}. Left it unchanged.`, 'UNPARSABLE_FILE');
  }
}
