# Codex Life Phone Bridge

This note connects Ares/M3TA to the owner's phone workflows without hiding the real state behind generic setup text.

## Current local facts

Verified on 2026-07-01:

- `adb` is installed at `/opt/homebrew/Caskroom/android-platform-tools/36.0.2/platform-tools/adb`.
- `adb` is not on the shell PATH by default.
- The ADB server was listening on `127.0.0.1:5037`, but `adb devices -l` returned no attached devices.
- DuoPlus desktop was running.
- The DuoPlus refresh Chrome profile exists at `~/.duoplus-refresh-chrome`.
- CDP on `9223` can be restored with `apps/api/scripts/duoplus-chrome.sh`.
- The stored DuoPlus session can be recaptured, but the captured browser profile may still return `401 Login information has expired` until the owner logs into DuoPlus again in that Chrome profile.

## Ares phone-facing path

The first-class phone bridge in this repo is Telegram over Garrison:

1. Build the CLI.
2. Start Garrison.
3. Enable Telegram bridge credentials in the local environment or UI settings.
4. Talk to Ares from the phone through the bot.

Commands:

```bash
cd /Users/growthgod/M3TA
pnpm install
pnpm build
pnpm ares login
ARES_TELEGRAM=1 pnpm ares garrison serve --provider openai
```

Relevant local env names:

```bash
ARES_TELEGRAM=1
ARES_TELEGRAM_BOT_TOKEN=...
ARES_TELEGRAM_ALLOWED_CHATS=...
ARES_TELEGRAM_CHAT_ID=...
ARES_GARRISON_PORT=7421
ARES_HOME=$HOME/.ares
```

Do not write these values into markdown or tracked config.

## Local status check

Run:

```bash
cd /Users/growthgod/M3TA
pnpm codex-life:check
```

The checker reports:

- Garrison health on `127.0.0.1:7421` or `ARES_GARRISON_PORT`.
- Whether `~/.ares` exists.
- Whether the known ADB binary is available and what devices it sees.
- Whether DuoPlus CDP is reachable on `9223`.
- Whether PM2 is running `duoplus-chrome`.
- Whether the DuoPlus session file exists and whether its token validates without printing it.

## DuoPlus cloud-phone path

The currently working DuoPlus tooling lives here:

```bash
/Users/growthgod/VAN/mattclone-duo/mattclone_duo
```

Read-only frame check for already-running phones:

```bash
cd /Users/growthgod/VAN/mattclone-duo/mattclone_duo
DUOPLUS_SESSION_FILE=/Users/growthgod/VAN/mattclone-duo/mattclone_duo/duoplus-session.json \
  yarn workspace @julio/api frames:duoplus
```

Refresh the persistent Chrome helper:

```bash
pm2 start /Users/growthgod/VAN/mattclone-duo/mattclone_duo/apps/api/scripts/duoplus-chrome.sh --name duoplus-chrome
curl -fsS http://127.0.0.1:9223/json/version
```

If the session is expired, launch the persistent profile visibly, log into DuoPlus, then capture:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9223 \
  --user-data-dir="$HOME/.duoplus-refresh-chrome" \
  https://my.duoplus.cn/images

cd /Users/growthgod/VAN/mattclone-duo/mattclone_duo
yarn workspace @julio/api capture:session --preset duoplus --port 9223 \
  --out /Users/growthgod/VAN/mattclone-duo/mattclone_duo/duoplus-session.json
```

Then rerun the frame check.

## Safety boundary

Allowed without another approval:

- Checking daemon health.
- Listing ADB devices.
- Starting local PM2/Chrome helper processes.
- Recapturing a DuoPlus session from an already logged-in persistent browser profile.
- Capturing screenshots for already-running phones.

Requires explicit approval:

- Powering on or starting cloud phones.
- Leasing paid control time.
- Installing apps, changing proxies, posting content, sending DMs, likes, follows, comments, or account actions.
- Reading or moving raw cookies/tokens outside their existing local auth stores.
