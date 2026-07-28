# Soundkeep

Soundkeep is a self-hosted Discord background-music controller and soundboard for tabletop sessions. Its
desktop-first SvelteKit dashboard gives the game master two clear audio lines: one looping background and
one soundboard clip that plays without interrupting the background.

## What it does

- Connects to any voice channel visible to the bot from the web dashboard.
- Selects one looping background track from the library.
- Plays configured soundboard buttons over the uninterrupted background; a new button replaces the current
  soundboard clip.
- Stores uploaded MP3s in one managed local library.
- Uploads, previews, renames, categorizes, reassigns, searches, and deletes audio assets.
- Adds and removes soundboard buttons without deleting their library assets.
- Persists the audio library on one data volume.
- Supports Discord's required DAVE voice encryption.
- Ships as a non-root container and a production Helm chart.

## How audio flows

```text
Background MP3 ─┐
                ├─► 20 ms PCM mixer ─► FFmpeg/libopus ─► Discord voice
Soundboard MP3 ─┘          ▲
                            └─ per-line + master gain
```

Each line is decoded to signed 16-bit, 48 kHz stereo PCM. Soundkeep mixes the frames in-process and
encodes one 64 kbit/s constrained-VBR Opus stream with native FFmpeg, in-band forward error correction, and
a single-frame 20 ms Ogg page that is flushed immediately before passing it to `@discordjs/voice`.
Per-line PCM queues use high/low-watermark backpressure, pausing their FFmpeg decoder instead of dropping
old samples when its real-time clock runs slightly ahead of the mixer. A monotonic, deadline-based mixer
clock compensates for delayed JavaScript timers instead of accumulating gaps in the outgoing stream.

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

Open <http://localhost:3000>. Uploaded files and their metadata live in the `soundkeep-data` volume.

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
  --version 0.3.0 \
  --namespace dnd-audio-bot \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=soundkeep.example.com
```

The chart intentionally enforces one replica with a `Recreate` strategy: one Discord bot session owns one
voice connection and one writable library volume.

## Configuration

| Variable            |                    Default | Purpose                                                      |
| ------------------- | -------------------------: | ------------------------------------------------------------ |
| `DISCORD_BOT_TOKEN` |                   required | Bot token from the Developer Portal                          |
| `DATA_DIR`          |                   `./data` | Library index and uploaded MP3 directory                     |
| `FFMPEG_PATH`       |                   `ffmpeg` | FFmpeg executable                                            |
| `FFPROBE_PATH`      |                  `ffprobe` | FFprobe executable                                           |
| `MAX_UPLOAD_BYTES`  |                `262144000` | MP3 upload limit                                             |
| `ORIGIN`            | derived from proxy headers | Public origin for direct deployments without a reverse proxy |

The application itself does not provide user accounts. Put it behind an authenticated reverse proxy when it
is reachable by anyone other than trusted game masters.

## License

[MIT](LICENSE)
