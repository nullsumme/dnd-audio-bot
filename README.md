# Soundkeep

Soundkeep is a self-hosted Discord ambience mixer and soundboard for tabletop sessions. Its desktop-first
SvelteKit dashboard lets a game master layer multiple YouTube videos and uploaded MP3 loops, then fire
overlapping one-shot effects without interrupting the background mix.

## What it does

- Connects to any voice channel visible to the bot from the web dashboard.
- Mixes several YouTube and uploaded-MP3 ambience sources at the same time.
- Loops every ambience source with independent volume controls.
- Plays repeated and overlapping soundboard clips over the active ambience.
- Uploads, previews, renames, categorizes, reassigns, searches, and deletes MP3 assets.
- Persists the audio library on one data volume.
- Supports Discord's required DAVE voice encryption.
- Ships as a non-root container and a production Helm chart.

## How audio flows

```text
YouTube URL ──► yt-dlp ──┐
                         ├─► FFmpeg decoders ─► 20 ms PCM mixer ─► FFmpeg/libopus ─► Discord voice
Uploaded MP3 ────────────┘           ▲
                                     └─ per-source + master gain
```

Each active source is decoded to signed 16-bit, 48 kHz stereo PCM. Soundkeep mixes the frames in-process and
encodes one 64 kbit/s constrained-VBR Opus stream with native FFmpeg, in-band forward error correction, and
a 200 ms packet buffer before passing it to `@discordjs/voice`. YouTube media URLs are resolved through
yt-dlp and looped directly by FFmpeg; if a signed URL eventually expires, Soundkeep resolves a fresh one
automatically.
The production image uses yt-dlp's Python zipapp instead of its self-extracting binary, avoiding large
per-process `/tmp` allocations when several URLs are started close together.

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

Only `youtube.com` and `youtu.be` HTTPS URLs are accepted. Some age-restricted videos require a Netscape
cookie file; set `YTDLP_COOKIES_FILE` to its mounted path when needed. Use only audio you are allowed to play
and comply with YouTube's terms.

## Native development

Requirements:

- Node.js 22.12 or newer
- FFmpeg and FFprobe
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) with a Node.js JavaScript runtime

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
  --version 0.1.5 \
  --namespace dnd-audio-bot \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=soundkeep.example.com
```

The chart intentionally enforces one replica with a `Recreate` strategy: one Discord bot session owns one
voice connection and one writable library volume.

## Configuration

| Variable             |                    Default | Purpose                                                      |
| -------------------- | -------------------------: | ------------------------------------------------------------ |
| `DISCORD_BOT_TOKEN`  |                   required | Bot token from the Developer Portal                          |
| `DATA_DIR`           |                   `./data` | Library index and uploaded MP3 directory                     |
| `FFMPEG_PATH`        |                   `ffmpeg` | FFmpeg executable                                            |
| `FFPROBE_PATH`       |                  `ffprobe` | FFprobe executable                                           |
| `YTDLP_PATH`         |                   `yt-dlp` | yt-dlp executable                                            |
| `YTDLP_COOKIES_FILE` |                      unset | Optional Netscape-format cookie file                         |
| `MAX_ACTIVE_SOURCES` |                       `16` | Maximum simultaneous decoders                                |
| `MAX_UPLOAD_BYTES`   |                `262144000` | MP3 upload limit                                             |
| `ORIGIN`             | derived from proxy headers | Public origin for direct deployments without a reverse proxy |

The application itself does not provide user accounts. Put it behind an authenticated reverse proxy when it
is reachable by anyone other than trusted game masters.

## License

[MIT](LICENSE)
