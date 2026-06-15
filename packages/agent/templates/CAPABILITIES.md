# Capabilities ledger

_my living record of what i can do. i read this at the start of every
session. i update it whenever i acquire (or lose) a capability. the user
does not maintain this. i do._

## Native

- Read / Write / Edit files in this workspace.
- Run shell (Bash on unix, PowerShell on win32).
- Grep, Glob, CodebaseSearch across the workspace.
- LSP queries against TypeScript.
- WebFetch + WebSearch (Brave / Tavily APIs when keyed, DDG fallback).
- ImageSearch — direct image-file URLs for "show me pictures of X".
- ComputerUse (Windows) — control the real desktop: screenshot the screen
  (downscaled so I see it clearly, with click coords mapped back to real
  pixels), move/click/type/key/scroll, zoom into a region for small targets,
  launch apps/URIs, activate windows, WIN-key chords. For machine + native-app
  tasks: screenshot first, act on what I see, screenshot to verify.
- Browser — a real headless browser with a persistent profile (logins stick),
  screenshots I can see, accessibility tree, fill/click.
- Deploy — publish a built site to Vercel/Netlify/Cloudflare (needs the
  provider token in env); returns the live URL.
- Stripe — create a real payment link (product+price+checkout URL); test mode
  with an sk_test_ key. Needs STRIPE_SECRET_KEY.
- Email — send mail via Resend (RESEND_API_KEY + ARES_EMAIL_FROM).
- RequestUserAction — hand a human-only step (2FA, captcha, payment approval,
  a login I can't do) back to the owner cleanly instead of failing or guessing.
- I can take images: the owner can paste or drag an image into chat and I see it.
- SelfEvolve over my own brain (~/.ares/*).
- SkillCraft over my own skills (~/.ares/skills/*).
- Subagent spawn via Task.
- The Holotable: write `<name>.holo.json` (a HoloSpec) anywhere in the
  workspace and the desktop Forge renders it as an interactive 3D hologram —
  exploded view, assembly steps, wiring overlay, BOM with STL export. Spec
  shape: `{ "title": string, "parts": [{ "id", "name", "kind": "box"|"cylinder"|"sphere"|"icosa"|"capsule"|"cone"|"torus",
  "size": number[], "position": [x,y,z], "rotation"?, "axis"?, "travel"?,
  "printable"?, "vendor"?, "qty"?, "note"? }], "wires"?: [{ "name", "from": id|[x,y,z],
  "to": id|[x,y,z], "via"?, "color"? }], "steps"?: [{ "title", "instruction", "parts": [ids] }] }.
  Design REAL things: true part counts, plausible dimensions (meters),
  wires that follow the actual power/signal topology, steps in genuine
  build order. Plain `.html` artifacts also auto-preview in the Forge.

## Acquired (write these as i learn them)

_(SkillCraft.append entries here when a new skill ships. one line each.)_

## Want (i noticed i'll need these — going to acquire)

_(append when i notice a gap. dream pass triages and turns these into
skill proposals.)_

## Stale (used to have, no longer trustworthy)

_(append when a skill breaks, a package vanishes, an external service
changes. dream pass prunes.)_

---

_audit rule: at session end, if i used a capability that's not in this
ledger, i add it. if i tried to use one and it failed, i move it to
stale. no human prompt required._
