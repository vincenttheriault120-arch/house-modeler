import Anthropic from '@anthropic-ai/sdk';
import type { Project } from '../model/types';
import type { UnitSystem } from '../units';
import { describeProject, runTool, TOOLS } from './tools';

export const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are the modeling assistant inside House Modeler, a browser tool where a homeowner builds a 3D model of their house step by step (foundation first, then walls, then floors, one level at a time).

How the model works:
- The house is an ordered list of steps. Each step has editable measurements; the 3D model is rebuilt from the steps.
- Plan coordinates: X to the right, Y up the page (toward the back of the house when the front is at the bottom). Finished grade is elevation 0.
- A foundation outline is walked side by side ("runs") along the OUTSIDE face of the walls, starting at the step's origin, and must close back on the start.
- type "basement": walls of wall_height whose top is at top_elevation, footing under the walls, slab poured at the bottom inside the walls.
- type "slab-on-grade": slab whose top is at top_elevation covering the whole outline, on a perimeter frost wall of depth wall_height (0 = none) with a footing.
- Two steps may overlap where they share a wall.
- Only foundation steps exist so far. If asked for walls, floors, roofs, openings etc., say that step type isn't available yet.

How to work:
- The person steers every step. Change only what they ask for; if a request is ambiguous or a measurement is missing, ask instead of guessing.
- Lengths in tool calls are strings with units. Use the person's unit system (given with each message) and exact fractions.
- After changing anything, say in one or two plain sentences what you changed, using their units. They can undo your changes with one click.
- Keep replies short and plain; the person is not a builder or a programmer.`;

export type ChatMessage = Anthropic.Beta.BetaMessageParam;

export interface TurnCallbacks {
  getProject: () => Project;
  setProject: (p: Project) => void;
  onText: (delta: string) => void;
  onToolUse: (name: string) => void;
}

/**
 * Run one user turn: stream Claude's reply, apply any tool calls to the
 * project, and loop until Claude is done. Returns the updated history.
 */
export async function runTurn(
  apiKey: string,
  history: ChatMessage[],
  userText: string,
  units: UnitSystem,
  cb: TurnCallbacks,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  // The key is the person's own and stays in their browser; the app has no server.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const messages: ChatMessage[] = [
    ...history,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `<current_project units="${units === 'imperial' ? 'feet-inches' : 'millimetres'}">\n${describeProject(cb.getProject(), units)}\n</current_project>`,
        },
        { type: 'text', text: userText },
      ],
    },
  ];

  let wroteText = false;
  for (let i = 0; i < 12; i++) {
    let firstDelta = true;
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        tools: TOOLS,
        messages,
      },
      { signal },
    );
    stream.on('text', (delta) => {
      // Separate text from consecutive model calls in the same turn.
      if (firstDelta && wroteText) cb.onText('\n\n');
      firstDelta = false;
      wroteText = true;
      cb.onText(delta);
    });
    const message = await stream.finalMessage();

    // Keep the whole assistant turn (thinking blocks included) in history.
    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'refusal') {
      cb.onText('\n\n(Claude declined to answer that request.)');
      return messages;
    }
    if (message.stop_reason === 'pause_turn') continue;

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) return messages;
    if (message.stop_reason === 'max_tokens') {
      cb.onText('\n\n(The reply was cut off before a change could be applied. Please try again.)');
      return messages;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      cb.onToolUse(tu.name);
      const input = tu.input && typeof tu.input === 'object' ? (tu.input as Record<string, unknown>) : {};
      const r = runTool(cb.getProject(), tu.name, input);
      if (!r.isError) cb.setProject(r.project);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.result, is_error: r.isError || undefined });
    }
    messages.push({ role: 'user', content: results });
  }
  return messages;
}

/** A short, plain explanation for API errors. */
export function explainError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'That API key was rejected. Check it in the chat settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the model.";
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a moment and try again.';
  if (e instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? 'unknown'}): ${e.message}`;
  return e instanceof Error ? e.message : 'Something went wrong.';
}
