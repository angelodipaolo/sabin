import { AgentDefinition, SabinConfig } from './types';
import { UnknownAgentError } from './errors';

/**
 * Agents Sabin knows how to launch without any configuration.
 *
 * Both CLIs take an initial prompt as a positional argument and stay
 * interactive afterwards, which is exactly the kickoff behaviour we want:
 * the agent starts already knowing what the task is, and the terminal is
 * still yours to steer.
 */
export const BUILT_IN_AGENTS: Record<string, AgentDefinition> = {
  claude: {
    command: 'claude',
    args: ['{prompt}'],
    autonomousArgs: ['--dangerously-skip-permissions']
  },
  codex: {
    command: 'codex',
    args: ['{prompt}'],
    autonomousArgs: ['--dangerously-bypass-approvals-and-sandbox']
  }
};

export const DEFAULT_AGENT = 'claude';

export interface ResolvedAgent {
  name: string;
  definition: AgentDefinition;
}

/**
 * Every agent this project can launch: the built-ins, with configured
 * definitions layered over them so a project can retune `codex` without
 * having to redeclare it from scratch.
 */
export function availableAgents(config: SabinConfig): Record<string, AgentDefinition> {
  return { ...BUILT_IN_AGENTS, ...(config.agents?.definitions ?? {}) };
}

/**
 * Pick the agent to launch: an explicit name, then the configured default,
 * then Claude Code.
 */
export function resolveAgent(name: string | undefined, config: SabinConfig): ResolvedAgent {
  const agents = availableAgents(config);
  const wanted = name ?? config.agents?.default ?? DEFAULT_AGENT;
  const definition = agents[wanted];

  if (!definition) {
    throw new UnknownAgentError(wanted, Object.keys(agents).sort());
  }

  return { name: wanted, definition };
}

export interface AgentPlaceholders {
  prompt: string;
  ticket?: string;
  notesDir?: string;
  worktree?: string;
  taskFile?: string;
}

/**
 * Build the argv for an agent, substituting placeholders in each argument.
 *
 * A definition that never mentions {prompt} still gets one - the prompt is
 * appended as the final argument - so the minimal `{"command": "aider"}`
 * does the obvious thing rather than silently launching an unprompted agent.
 *
 * Autonomy flags go in front: both built-in agents take the prompt as a
 * positional, so anything appended after it would be read as more prompt.
 */
export function agentArgv(
  definition: AgentDefinition,
  values: AgentPlaceholders,
  autonomous = false
): string[] {
  const template = definition.args ?? ['{prompt}'];
  const args = template.map(arg => substitute(arg, values));
  const prompted = template.some(arg => arg.includes('{prompt}')) ? args : [...args, values.prompt];

  const flags = autonomous ? definition.autonomousArgs ?? [] : [];
  return [...flags, ...prompted];
}

function substitute(arg: string, values: AgentPlaceholders): string {
  return arg.replace(/\{(prompt|ticket|notesDir|worktree|taskFile)\}/g, (match, key) => {
    const value = values[key as keyof AgentPlaceholders];
    return value ?? match;
  });
}

/** The three ways an agent is put on a ticket, and the three skill references */
export const WORKFLOW_STEPS = ['plan', 'implement', 'review'] as const;

export type WorkflowStep = typeof WORKFLOW_STEPS[number];

export function isWorkflowStep(value: string): value is WorkflowStep {
  return (WORKFLOW_STEPS as readonly string[]).includes(value);
}

export interface TaskPrompt {
  step: WorkflowStep;
  ticket: string;
  taskFile: string;
}

/**
 * Compose what the agent is prompted with: an address, not a procedure.
 *
 * Which step, which ticket, where the file is - and nothing else. How to do
 * the step lives in `skills/sabin/references/<step>.md`, which loads on
 * demand and can be edited without a release; repeating any of it here would
 * be a second copy free to drift from the first. Everything else the agent
 * needs comes from one `sabin context --json`, which resolves without
 * arguments because the agent's cwd is the ticket's worktree.
 *
 * The task path rather than the task body: the file is the source of truth,
 * it can change mid-session, and the agent reads it once either way.
 */
export function buildTaskPrompt({ step, ticket, taskFile }: TaskPrompt): string {
  return [
    `Follow the sabin skill: ${step} ${ticket}`,
    '',
    `Task: ${taskFile}`,
    ''
  ].join('\n');
}
