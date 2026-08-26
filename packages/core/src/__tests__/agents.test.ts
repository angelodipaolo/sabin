import {
  resolveAgent,
  availableAgents,
  agentArgv,
  buildTaskPrompt,
  BUILT_IN_AGENTS
} from '../agents';
import { UnknownAgentError } from '../errors';
import { SabinConfig } from '../types';

const baseConfig: SabinConfig = { projectPrefix: 'TASK', taskNumberPadding: 4 };

describe('resolveAgent', () => {
  it('falls back to Claude Code when nothing is configured', () => {
    expect(resolveAgent(undefined, baseConfig)).toEqual({
      name: 'claude',
      definition: BUILT_IN_AGENTS.claude
    });
  });

  it('uses the configured default when no name is given', () => {
    const config = { ...baseConfig, agents: { default: 'codex' } };

    expect(resolveAgent(undefined, config).name).toBe('codex');
  });

  it('prefers an explicit name over the configured default', () => {
    const config = { ...baseConfig, agents: { default: 'codex' } };

    expect(resolveAgent('claude', config).name).toBe('claude');
  });

  it('lets config override a built-in without redeclaring the rest', () => {
    const config = {
      ...baseConfig,
      agents: { definitions: { codex: { command: 'codex', args: ['--full-auto', '{prompt}'] } } }
    };

    expect(resolveAgent('codex', config).definition.args).toEqual(['--full-auto', '{prompt}']);
    expect(resolveAgent('claude', config).definition).toEqual(BUILT_IN_AGENTS.claude);
  });

  it('resolves an agent that exists only in config', () => {
    const config = {
      ...baseConfig,
      agents: { definitions: { aider: { command: 'aider' } } }
    };

    expect(resolveAgent('aider', config).definition.command).toBe('aider');
  });

  it('throws with the known agents listed when the name is unknown', () => {
    expect(() => resolveAgent('nope', baseConfig)).toThrow(UnknownAgentError);

    try {
      resolveAgent('nope', baseConfig);
    } catch (error) {
      expect((error as Error).message).toContain('claude, codex');
    }
  });
});

describe('availableAgents', () => {
  it('merges configured definitions over the built-ins', () => {
    const config = {
      ...baseConfig,
      agents: { definitions: { aider: { command: 'aider' } } }
    };

    expect(Object.keys(availableAgents(config)).sort()).toEqual(['aider', 'claude', 'codex']);
  });
});

describe('agentArgv', () => {
  const values = {
    prompt: 'do the thing',
    ticket: 'JIRA-12345',
    notesDir: '/notes/JIRA-12345',
    worktree: '/work/JIRA-12345',
    taskFile: '/tasks/JIRA-12345.md'
  };

  it('substitutes the prompt in place', () => {
    expect(agentArgv({ command: 'codex', args: ['--full-auto', '{prompt}'] }, values))
      .toEqual(['--full-auto', 'do the thing']);
  });

  it('substitutes the other workspace placeholders', () => {
    expect(agentArgv({ command: 'x', args: ['--cd', '{worktree}', '{ticket}', '{prompt}'] }, values))
      .toEqual(['--cd', '/work/JIRA-12345', 'JIRA-12345', 'do the thing']);
  });

  it('appends the prompt when the template never mentions it', () => {
    expect(agentArgv({ command: 'aider', args: ['--message'] }, values))
      .toEqual(['--message', 'do the thing']);
  });

  it('passes the prompt alone when there is no template', () => {
    expect(agentArgv({ command: 'aider' }, values)).toEqual(['do the thing']);
  });

  it('leaves unknown placeholders untouched', () => {
    expect(agentArgv({ command: 'x', args: ['{nope}', '{prompt}'] }, values))
      .toEqual(['{nope}', 'do the thing']);
  });
});

describe('buildTaskPrompt', () => {
  const prompt = buildTaskPrompt({
    ticket: 'JIRA-12345',
    title: 'Update telemetry',
    notesDir: '/notes/JIRA-12345',
    body: '\n\nSwap the exporter.\n\n'
  });

  it('names the ticket and its title', () => {
    expect(prompt).toContain('You are working on JIRA-12345: Update telemetry');
  });

  it('points at the notes directory so the agent knows where work product goes', () => {
    expect(prompt).toContain('/notes/JIRA-12345');
  });

  it('carries the task body, trimmed of surrounding blank lines', () => {
    expect(prompt.endsWith('Swap the exporter.\n')).toBe(true);
  });
});
