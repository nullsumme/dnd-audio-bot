# Soundkeep

Soundkeep is a self-hosted Discord background-music controller and soundboard for tabletop sessions. Its
desktop-first SvelteKit dashboard gives the game master two clear audio lines: one transport-controlled
background queue and one low-latency soundboard clip that plays without interrupting it.

## What it does

- Connects to any voice channel visible to the bot from the web dashboard.
- Builds persistent scenes from ordered background tracks and sound effects.
- Provides real pause, resume, seek, previous, next, shuffle, repeat-one, repeat-all, and automatic
  background queue advancement.
- Plays configured soundboard buttons over the uninterrupted background; a new button replaces the current
  soundboard clip.
- Streams uploaded MP3s into one managed local library, validates them with FFprobe and a full FFmpeg
  decode, then commits the file and index atomically.
- Supports drag-and-drop batch MP3 uploads, previews, names, categories, subtitles, moods, custom icons,
  PNG/JPEG artwork, placement changes, search, and deletion.
- Adds and removes soundboard buttons without deleting their library assets.
- Shows the current Discord bitrate, real human listener count, authoritative playback position, and recent
  server activity.
- Persists the audio library, artwork, scenes, and settings on one data volume.
- Supports Discord's required DAVE voice encryption.
- Ships as a non-root container and a production Helm chart.

## How audio flows

```text
Background MP3 ─► FFmpeg decoder ─┐
                                  ├─► 20 ms PCM mixer ─► FFmpeg/libopus ─► Discord voice
Soundboard MP3 ─► bounded PCM cache┘          ▲
                                              └─ per-line + master gain
```

Each line is decoded to signed 16-bit, 48 kHz stereo PCM. Soundkeep mixes the frames in-process and
encodes one dynamically selected constrained-VBR Opus stream with native FFmpeg, in-band forward error
correction, and a single-frame 20 ms Ogg page that is flushed immediately before passing it to
`@discordjs/voice`. Auto mode follows the connected channel up to 128 kbit/s; 64, 96, and 128 kbit/s
presets are available in Settings and remain capped by Discord's channel bitrate.
The two mixer lines receive fixed bus headroom, preventing hard-clipped peaks without changing the
background gain when a sound effect starts or ends and without adding lookahead latency.
Per-line PCM queues use low-latency high/low-watermark backpressure, pausing their FFmpeg decoder without
ever consuming a partial PCM frame. End-of-file tails are drained exactly once. Playback position is counted
from PCM frames actually consumed by the mixer, so pause and seek remain aligned with the Discord output.
The mixer primes a bounded three-frame (60 ms) output lead and catches up at most three ordered frames after
a delayed event-loop timer, protecting Discord from starvation without deleting PCM or allowing an
unbounded latency queue. Short soundboard effects can start from the decoded PCM cache without an FFmpeg
startup round trip.

## Discord setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Open **Bot**, create the bot, and copy its token. Treat the token like a password.
3. Open **OAuth2 → URL Generator**, select the `bot` scope, and grant:
   - View Channels
   - Connect
   - Speak
4. Open the generated URL and add the bot to your D&D server.

Soundkeep does not read messages and needs no privileged intents. All controls live in the web interface.

## Run with Docker Compose

```bash
cp .env.example .env
# Put DISCORD_BOT_TOKEN in .env
docker compose up --build -d
```

Open <http://localhost:3000>. MP3s, artwork, scenes, and settings live in the `soundkeep-data` volume.

## Native development

Requirements:

- Node.js 22.12 or newer
- FFmpeg and FFprobe

```bash
cp .env.example .env
npm install
npm run dev
```

Validation:

```bash
npm run lint
npm run check
npm run test:run
npm run build
npm run helm:lint
```

## Helm

Create a Secret before installing:

```bash
kubectl create namespace dnd-audio-bot
kubectl -n dnd-audio-bot create secret generic dnd-audio-bot \
  --from-literal=DISCORD_BOT_TOKEN='<token>'
```

Then install the OCI chart:

```bash
helm install soundkeep oci://ghcr.io/nullsumme/charts/dnd-audio-bot \
  --version 0.5.0 \
  --namespace dnd-audio-bot \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=soundkeep.example.com
```

The chart intentionally enforces one replica with a `Recreate` strategy: one Discord bot session owns one
voice connection and one writable library volume.

## Configuration

| Variable                    |                    Default | Purpose                                                      |
| --------------------------- | -------------------------: | ------------------------------------------------------------ |
| `DISCORD_BOT_TOKEN`         |                   required | Bot token from the Developer Portal                          |
| `DISCORD_OPUS_BITRATE_MODE` |                     `auto` | Initial Opus mode: `auto`, `64000`, `96000`, or `128000`     |
| `DATA_DIR`                  |                   `./data` | Library index and uploaded MP3 directory                     |
| `FFMPEG_PATH`               |                   `ffmpeg` | FFmpeg executable                                            |
| `FFPROBE_PATH`              |                  `ffprobe` | FFprobe executable                                           |
| `MAX_UPLOAD_BYTES`          |                `262144000` | Per-file MP3 upload limit                                    |
| `MAX_ARTWORK_BYTES`         |                  `5242880` | Per-file PNG/JPEG artwork upload limit                       |
| `MAX_LIBRARY_BYTES`         |               `8589934592` | Total managed-library quota                                  |
| `MIN_FREE_BYTES`            |                `268435456` | Free-space reserve maintained on the data volume             |
| `MAX_CONCURRENT_UPLOADS`    |                        `1` | Concurrent streamed upload/validation jobs                   |
| `MAX_PCM_CACHE_BYTES`       |                 `67108864` | Aggregate in-memory cache for low-latency soundboard effects |
| `MAX_PCM_CACHE_ENTRY_BYTES` |                 `33554432` | Per-effect decoded PCM cache limit                           |
| `ACTIVITY_LOG_CAPACITY`     |                      `100` | In-memory recent server events retained for the dashboard    |
| `ORIGIN`                    | derived from proxy headers | Public origin for direct deployments without a reverse proxy |

Changing the bitrate in the dashboard persists the selected mode in `settings.json` on the data volume and
overrides the initial environment/Helm default on subsequent starts.

The application itself does not provide user accounts. Put it behind an authenticated reverse proxy when it
is reachable by anyone other than trusted game masters.

## License

[MIT](LICENSE)
