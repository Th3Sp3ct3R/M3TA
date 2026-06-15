// RequestUserAction — the graceful "I'm blocked, you take it from here" handoff.
//
// The single biggest reason autonomous flows feel like trash: they hit a wall a
// machine genuinely can't pass (a 2FA code on the owner's phone, a captcha, a
// real payment that should be the owner's call, a login that needs a human) and
// then either fail silently or guess. This tool turns that into a clean pause:
// the agent states exactly what it got done, exactly what the owner must do, and
// how to resume — then ends its turn and waits. It does NOT try to defeat the
// wall; that's the point.

import { z } from "zod";
import { buildTool } from "./_shared.js";

const inputSchema = z
  .object({
    blocker: z
      .string()
      .min(1)
      .describe("What is blocking you, specifically — e.g. '2FA code sent to your phone', 'captcha on signup', 'payment confirmation'."),
    action_needed: z
      .string()
      .min(1)
      .describe("Exactly what the owner must do, in one or two plain steps."),
    progress: z.string().optional().describe("What you completed up to this point, so the owner has context."),
    resume_hint: z
      .string()
      .optional()
      .describe("How to tell you to continue once they're done, e.g. 'say continue and paste the code'."),
  })
  .strict();

export interface RequestUserActionOutput {
  handoff: true;
  blocker: string;
  action_needed: string;
  progress?: string;
  resume_hint: string;
}

export const RequestUserActionTool = buildTool({
  name: "RequestUserAction",
  description:
    "Hand a blocked step back to the owner instead of failing or guessing. Call this the moment you hit something only a human can do: a 2FA/OTP code, a captcha, confirming a real payment, a login you can't complete, or any approval gate. State what you finished, what they must do, and how to resume — then STOP and deliver that as your reply. Do NOT keep retrying the wall.",
  safety: "read-only",
  concurrency: "exclusive",
  inputZod: inputSchema,
  activityDescription: (i) => `Handoff: ${i.blocker}`,

  async call(i): Promise<{ output: RequestUserActionOutput; display: string }> {
    const resume = i.resume_hint ?? "tell me to continue when it's done";
    return {
      output: {
        handoff: true,
        blocker: i.blocker,
        action_needed: i.action_needed,
        progress: i.progress,
        resume_hint: resume,
      },
      display: `⏸ Needs you — ${i.action_needed}`,
    };
  },
});
