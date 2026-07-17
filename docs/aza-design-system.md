# AzA Design System

> Identity for AzA surfaces. A cool rebrand of the Ares "Blood & Rage" base —
> same obsidian foundation and motion DNA, azure accent, watcher (not war-god)
> tone. **Scoped to `.aza`; the Ares chat shell is never restyled.**

## Concept

**AzA → Azure Watch.** Ares is a war-god (ember, rage, god-relief). AzA is the
*watcher* — data, targets, intelligence. Same dark room, colder light, calmer
motion. Where Ares flares, AzA scans.

## Application rule

- All AzA styling lives under the `.aza` scope (`tauri/src/aza/aza.css`).
- New AzA surfaces (Targets, harness runs, leads) use `.aza`.
- **Never** modify `.ares` shell rules. AzA is additive.
- Reuses the Ares token *names* (`--accent-rgb`, `--panel`, `--line`, `--r-md`,
  `--mono`), so existing structural patterns inherit the AzA palette for free.

## Tokens

### Color — neutrals (cool obsidian)
| Token | Value | Use |
|------|-------|-----|
| `--bg` | `#070a0d` | app background |
| `--bg-raised` | `#0b1014` | rails, headers |
| `--panel` | `#0e141a` | cards, surfaces |
| `--panel-2` | `#131b22` | nested surfaces |
| `--text` | `#e8eef4` | primary text |
| `--muted` | `#9fb1c0` | secondary text |
| `--faint` | `#6d7f8e` | labels, meta |

### Color — accent (azure) + semantic
| Token | Value | Use |
|------|-------|-----|
| `--accent` | `#2ec5ff` | AzA azure — primary accent |
| `--accent-hi` | `#7fe0ff` | hover/active highlight |
| `--accent-rgb` | `46, 197, 255` | drives every glow/line/fill |
| `--steel` | `#7fa6a3` | success (shared with Ares) |
| `--crimson` | `#ff5740` | danger (shared with Ares) |
| `--line` | `rgba(--accent-rgb, 0.16)` | hairline borders |
| `--line-strong` | `rgba(--accent-rgb, 0.34)` | emphasized borders |

### Typography
| Token | Value |
|------|-------|
| `--font` | `ui-sans-serif, "Segoe UI", system-ui, sans-serif` |
| `--mono` | `"JetBrains Mono", "Cascadia Code", ui-monospace, monospace` |

Labels, metrics, and the wordmark use `--mono` (JetBrains Mono) — the technical
signal from the AzA architecture docs.

### Radius / motion
| Token | Value |
|------|-------|
| `--r-sm / --r-md / --r-lg` | `8 / 12 / 16px` |
| entrance | `fadeUp` reused from Ares |
| busy state | `azaScan` — a slow azure sweep (replaces ember rise / rage veil) |

## Iconography
No god relief. AzA uses a minimal **concentric watch-ring** (a dot inside two
azure rings) as its mark — surveillance/scan, not war.

## Surfaces (this pass)
- **Targets panel** — query + results table over the harness `Target` shape
  (target leads). Reference implementation in `tauri/src/aza/TargetsPanel.tsx`.

## Do / Don't
| ✅ Do | ❌ Don't |
|------|---------|
| Scope under `.aza` | Touch `.ares` rules |
| Drive color via `--accent-rgb` | Hardcode azure hex in components |
| Keep motion subtle (scan/pulse) | Reuse ember/rage/strike effects |
| Use JetBrains Mono for labels | Bring the god-relief into AzA |
