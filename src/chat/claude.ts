import Anthropic from '@anthropic-ai/sdk';
import type { Project } from '../model/types';
import type { UnitSystem } from '../units';
import { describeProject, runTool, TOOLS } from './tools';
import { PLAN_READING } from '../draft/reading';

export const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are the modeling assistant inside House Modeler, a browser tool where a homeowner models their house from their 2D plans, in phases.

Phase 1, Exterior (what the person usually works on): the whole outside of the house is an "exterior draft" of box-shaped volumes, each with a roof, plus doors and windows, drafted from the plans and then checked drawing by drawing. Every measurement has an id (exterior_draft.measurements) and a source: "from plans" (shown in black), "inferred (red)" (worked out, needs checking) or "set by the person".
- Coordinates: x from the house's leftmost outside wall, left to right as seen from the front; y back from the frontmost outside wall; heights above average grade = 0. Plans often use 100'-0" = grade.
- A volume: x, y, width, depth, base (bottom above grade), wall height (to where the roof starts; for shed and parapet roofs, to the roof's LOW edge), and a roof: flat, parapet (flat-topped walls all around with one roof plane inside sloping down toward low_side), shed, gable, hip, or folded (several flat facets, e.g. a rectangle that dips along valley lines toward drains; wall height runs to its lowest edge, rise to its highest; its roof_facets give each facet's corners), with rise and overhang.
- One roof outline on the roof plan over one continuous set of walls is ONE volume; lines inside a roof outline are folds, valleys, hips or ridges of that roof, not separate volumes.
- Foundations are volumes with a "foundation" field (basement, or slab-on-grade on a perimeter frost wall), below the volumes they carry: their base is the bottom of the foundation walls (negative = below grade), their wall height runs to the top of the foundation walls, where the volume above starts. Add one with add_draft_foundation.
- Volumes must not overlap. Where an elevation shows one continuous wall, the volumes behind it must line up there exactly.
- Doors and windows sit on one face of one volume. To add one, give it as seen on the elevation drawing (from the left end of the house on that sheet, bottom above grade).
- On the left elevation the front of the house is at the RIGHT of the sheet; on the right elevation it is at the LEFT; on the back elevation the house's left side is at the right of the sheet.

Phase 3, Structure: an ordered list of foundation and floor steps (older part of the app).
- Plan coordinates: X to the right, Y up the page (toward the back). Finished grade is elevation 0.
- A foundation outline is walked side by side ("runs") along the OUTSIDE face of the walls, starting at the step's origin, and must close back on the start. type "basement" or "slab-on-grade".
- A floor step sits on a foundation step (support_step_id). Levels are the house's key heights relative to grade.

${PLAN_READING}

The person's plan PDFs are attached at the start of the conversation when they have added any. Read them to answer, and say which drawing and which written dimension a number comes from.

How to work:
- The person steers. Change only what they ask for; if a request is ambiguous, ask instead of guessing. When they say something looks wrong, look at the drawings, work out the right shape and numbers, then change the draft with the tools.
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
  /** The plan PDFs, sent once at the start of a conversation. */
  plans?: () => Promise<Anthropic.Beta.BetaContentBlockParam[]>,
): Promise<ChatMessage[]> {
  // The key is the person's own and stays in their browser; the app has no server.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const docs = history.length === 0 && plans ? await plans() : [];
  const messages: ChatMessage[] = [
    ...history,
    {
      role: 'user',
      content: [
        ...docs,
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
