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
  claude: { command: 'claude', args: ['{prompt}'] },
  codex: { command: 'codex', args: ['{prompt}'] }
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
 */
export function agentArgv(definition: AgentDefinition, values: AgentPlaceholders): string[] {
  const template = definition.args ?? ['{prompt}'];
  const args = template.map(arg => substitute(arg, values));

  return template.some(arg => arg.includes('{prompt}')) ? args : [...args, values.prompt];
}

function substitute(arg: string, values: AgentPlaceholders): string {
  return arg.replace(/\{(prompt|ticket|notesDir|worktree|taskFile)\}/g, (match, key) => {
    const value = values[key as keyof AgentPlaceholders];
    return value ?? match;
  });
}

export interface TaskPrompt {
  ticket: string;
  title: string;
  notesDir: string;
  body: string;
}

/**
 * Compose what the agent is prompted with.
 *
 * The task body verbatim, under a header naming the ticket and where durable
 * work product belongs. The header is the difference between an agent that
 * orients on its first turn and one that spends a turn guessing.
 */
export function buildTaskPrompt({ ticket, title, notesDir, body }: TaskPrompt): string {
  const header = [
    `You are working on ${ticket}: ${title}`,
    '',
    'Follow the sabin skill. Run `sabin context --json` to orient, then read the',
    `ticket's notes directory before starting - plans, research and any other`,
    'durable work product belong there:',
    `  ${notesDir}`,
    '',
    'When the work is done and committed, move the task to review with',
    `\`sabin task update ${ticket} review\` and hand back to the user.`,
    '',
    'The task follows.',
    '',
    '---',
    '',
    ''
  ].join('\n');

  return `${header}${body.trim()}\n`;
}
