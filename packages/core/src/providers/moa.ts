// MoA — Mixture-of-Agents as a first-class, pickable "model".
//
// The user selects an ensemble (e.g. "moa-council") in the model picker exactly
// like any other model. Under the hood this synthetic Provider fans the prompt
// out to N reference models (they reason independently, NO tools), then feeds
// their drafts to an aggregator model which is tool-capable and produces the
// single answer that streams back as the assistant turn. A frontier committee
// deliberating on the hard questions, one selection away.
//
// It is ADDITIVELY ISOLATED: it only runs when someone picks a `moa` model, and
// it composes existing Providers — a bug here can never touch the normal ones.
// Reference errors degrade gracefully (that draft is skipped); if every
// reference is empty, the aggregator still answers, so worst case is a single
// strong model instead of an ensemble.

import type { StreamEvent } from "@ares/protocol";
import type { Provider, ProviderRequest } from "../queryEngine.js";

export interface MoaMember {
  /** A concrete, already-resolved provider for this member. */
  provider: Provider;
  /** The model id to send as ProviderRequest.model for this member. */
  model: string;
  /** Human label shown in the composed drafts ("Claude Opus", "GPT-5.5"). */
  label: string;
}

export interface MoaProviderOptions {
  ensembleName: string;
  /** Reference models — each drafts an answer independently (no tools). */
  references: MoaMember[];
  /** The tool-capable model that synthesizes the final, streamed answer. */
  aggregator: MoaMember;
  /** Cap on how much of each draft is fed to the aggregator (chars). */
  maxDraftChars?: number;
}

/** Drain a member's stream to plain text (references don't emit tools). */
async function draftFrom(member: MoaMember, req: ProviderRequest, cap: number): Promise<string> {
  let text = "";
  try {
    for await (const ev of member.provider.stream({ ...req, model: member.model, tools: [] })) {
      if (ev.type === "text_delta") {
        text += ev.text;
      } else if (ev.type === "message_done") {
        // Fallback: some providers only surface text on the final message.
        if (!text) {
          for (const block of ev.message.content) {
            if (block.type === "text") text += block.text;
          }
        }
      } else if (ev.type === "error") {
        // A reference that errors contributes nothing; the ensemble proceeds.
        break;
      }
      if (text.length > cap) break;
    }
  } catch {
    /* a dead reference is simply absent from the committee */
  }
  return text.trim().slice(0, cap);
}

export class MoaProvider implements Provider {
  readonly name: string;
  constructor(private readonly opts: MoaProviderOptions) {
    this.name = `moa:${opts.ensembleName}`;
  }

  async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const cap = this.opts.maxDraftChars ?? 8000;

    // 1. Fan out — every reference drafts the prompt in parallel, tool-free.
    const drafts = (
      await Promise.all(
        this.opts.references.map(async (m) => ({ label: m.label, text: await draftFrom(m, req, cap) })),
      )
    ).filter((d) => d.text.length > 0);

    // 2. Compose the aggregator's brief. It keeps the FULL original request
    //    (system + messages + tools) and gets the drafts as extra guidance, so
    //    it can both synthesize AND act (tool calls) as the real answer.
    const draftBlock = drafts.length
      ? `\n\n# Mixture-of-Agents — you are the AGGREGATOR\n${drafts.length} expert model(s) independently drafted a response to the user's latest request. Read them, take the strongest reasoning from each, discard anything wrong, and produce ONE superior answer (or take the right action). Do not mention that drafts exist or that you are aggregating.\n\n${drafts
          .map((d, i) => `## Draft ${i + 1} — ${d.label}\n${d.text}`)
          .join("\n\n")}`
      : "";

    // 3. Stream the aggregator AS the assistant turn — its events pass straight
    //    through (text, tool_use, message_done), so tools and usage work normally.
    yield* this.opts.aggregator.provider.stream({
      ...req,
      model: this.opts.aggregator.model,
      system: `${req.system}${draftBlock}`,
    });
  }
}
