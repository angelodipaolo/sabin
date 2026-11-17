import { recordAgentEvent, resolveHome } from '@sabin/core';

/** All of stdin as text; empty when stdin is a terminal or unreadable */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  if ((stream as NodeJS.ReadStream).isTTY) return '';
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  } catch {
    // A broken pipe is just no payload
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * What the activity hooks run. Reads the hook's JSON payload from stdin and
 * records it against the agent's session.
 *
 * Prints nothing and always succeeds: Codex rejects plain text on stdout from
 * a `Stop` hook, and a hook that fails interrupts the agent it watches.
 * Arguments are ignored, so the `sabin agent-state busy` hooks an older
 * `sabin init --hooks` wrote still work.
 */
export async function agentState(stream?: NodeJS.ReadableStream): Promise<void> {
  try {
    const payload = await readStdin(stream);
    if (payload.trim()) await recordAgentEvent(resolveHome(), payload, process.env);
  } catch {
    // Deliberately silent - see above
  }
}
