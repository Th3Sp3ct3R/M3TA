# Ares Voice Service

Local WebSocket sidecar for low-latency spoken replies in the Ares desktop app.

The engine is **Kokoro-82M** — a small, fast, high-quality local TTS that runs
comfortably faster than real time (RTF ~0.03 on GPU, ~real-time on CPU), which is
what makes streamed spoken replies feel instant. First-audio latency is ~250ms.

## Setup

Use a clean Python 3.12 environment.

```powershell
cd D:\Ares
python -m venv .ares\voice-venv
.\.ares\voice-venv\Scripts\Activate.ps1
pip install -r voice_service\requirements.txt
```

## Run

```powershell
pnpm voice:tts -- --voice af_heart
```

Kokoro is tiny, so it runs comfortably on any modern CUDA GPU (`--device cuda:0`,
the default) or on CPU (`--device cpu`). If you have multiple GPUs, pass the
`cuda:N` index that matches the card you want to use.

The desktop app connects to:

```text
ws://127.0.0.1:8765/tts
```

### Voices

Kokoro voices are passed via `--voice` (e.g. `af_heart`, `af_bella`, `am_michael`,
`am_adam`, `bf_emma`, `bm_george`). `--lang a` is American English; `b` is British.
See the Kokoro-82M model card for the full voice list.

### Plumbing test

```powershell
# No model load — emits a synthetic tone so you can verify the WS wiring.
pnpm voice:tts -- --engine mock
```

## Configuration

All flags have `ARES_TTS_*` environment-variable equivalents (legacy `ARES_TTS_*` still honored):

- `--engine` / `ARES_TTS_ENGINE` (`kokoro` | `mock`, default `kokoro`)
- `--voice` / `ARES_TTS_VOICE` (default `af_heart`)
- `--lang` / `ARES_TTS_LANG` (default `a`)
- `--speed` / `ARES_TTS_SPEED` (speaking rate, default `1.15`; 1.0 = normal)
- `--device` / `ARES_TTS_DEVICE` (default `cuda:0`)
- `--port` / `ARES_TTS_PORT` (default `8765`)
