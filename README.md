# Scene Replay

Scene Replay is a headless TypeScript/Node.js lighting controller for a permanent installation. MA3 provides sACN Universe 1 during programming; the application captures three full-universe scenes and then plays them back independently from its generated Universe 2. Companion controls playback and the four front-truss zones over OSC.

## Requirements and commands

- Node.js 20 or newer
- An IPv4 network interface that can receive and transmit sACN multicast

```sh
npm install
npm test
npm run build
npm start
```

`npm run dev` runs the TypeScript entry point with automatic reload. The production command runs the compiled `dist/src/index.js`.

## Operation

The application starts with Universe 1 OFF and Universe 2 black. It does not recall a previously active scene after restart. MA3 may continue to provide Universe 1 for captures, but its input is never sent directly to the output. A captured scene is copied into durable JSON storage before the capture command completes.

Universe 1 has Scene 1, Scene 2, Scene 3, and OFF. Scene recall has no fade. OFF zeros only Universe 1. Universe 2 is built from the four zone percentages and current color step; scene and OFF commands never change it. Channel mappings and color values live in `config/config.json`.

The defaults map `/zone/1`–`/zone/4` to Universe 2 channels 1–4. The color sequence writes RGB values to channels 5–7; all other Universe 2 channels remain zero. The sequence has twelve independently configurable steps and wraps at the end. Zone and color mappings are validated at startup, including range and overlap checks.

## OSC API

OSC listens on UDP `0.0.0.0:9000` by default. Companion feedback is sent to `127.0.0.1:9001`; change those values to match the Companion host and feedback listener.

| Address | Note |
| --- | --- |
| `/scene/recall` | Recall scene `1`, `2`, or `3`. |
| `/scene/capture` | Save the current input as scene `1`, `2`, or `3`. |
| `/off` | Turn off Universe 1. |
| `/zone/1` | Set zone 1 to a percentage from `0` to `100`. |
| `/zone/2` | Set zone 2 to a percentage from `0` to `100`. |
| `/zone/3` | Set zone 3 to a percentage from `0` to `100`. |
| `/zone/4` | Set zone 4 to a percentage from `0` to `100`. |
| `/color/go` | Advance to the next color. |
| `/status/request` | Request feedback for the current state. |
| `/status/scene` | Scene feedback: `1`–`3` or `"off"`. |
| `/status/zone/1` | Current percentage for zone 1. |
| `/status/zone/2` | Current percentage for zone 2. |
| `/status/zone/3` | Current percentage for zone 3. |
| `/status/zone/4` | Current percentage for zone 4. |
| `/status/color` | Current color name, or `"none"`. |
| `/status/application` | Application feedback: `"ok"`. |

## Configuration and persistent data

Edit `config/config.json` to change OSC endpoints, zone channels, color channel assignments, raw DMX color values, and wrap behavior. sACN input is Universe 1 and output is Universes 1 and 2. Set `sacn.bindAddress` to a local IPv4 address to select the lighting network interface for input and multicast output; `0.0.0.0` uses the operating system's default interface. The application intentionally rejects other universe layouts so scenes and front-truss output cannot be routed accidentally.

Three 512-byte scenes are stored as integer arrays in `data/scenes.json`. A missing scene file means all scenes are black. Writes go to a temporary file, are flushed with `fsync`, and are atomically renamed into place. Configuration or existing scene data that is invalid causes startup to fail with a logged error rather than being silently replaced.

Paths can be relocated with environment variables:

| Variable | Default |
| --- | --- |
| `SCENE_REPLAY_HOME` | Current working directory |
| `SCENE_REPLAY_CONFIG` | `config/config.json` under the home directory |
| `SCENE_REPLAY_DATA_DIR` | `data` under the home directory |
| `SCENE_REPLAY_LOG_DIR` | `logs` under the home directory |
| `SCENE_REPLAY_LOG_LEVEL` | `INFO` (`DEBUG`, `INFO`, `WARN`, or `ERROR`) |

Logs are written to `logs/scene-replay.log` and the console. Routine sACN frames are not logged. The process records startup/configuration/network events, state changes, errors, and a one-minute health summary.

## Windows unattended startup

For a straightforward deployment without a GUI, install Node.js on the permanent PC and place the built application, configuration, data directory, and logs in a writable stable location (for example, under `C:\ProgramData\SceneReplay`). Build with `npm ci && npm run build`, then configure Windows Task Scheduler:

1. Create a task triggered **At startup**.
2. Run it whether or not the service account is logged on.
3. Set **Program/script** to the full path to `node.exe`; set arguments to the full path to `dist\src\index.js`.
4. Set **Start in** to the installation directory and define `SCENE_REPLAY_HOME` (and optional data/config/log paths) in the task's environment or a small wrapper script.
5. In task settings, enable restart on failure and set the restart interval and retry count.
6. Grant the task account write access to the data and log directories and access to the lighting network.

Using a dedicated service account and Task Scheduler's restart policy avoids requiring an interactive desktop session. Verify multicast routing, Windows Firewall rules for UDP 5568 and the configured OSC ports, and the correct network adapter before connecting fixtures. Restrict OSC access to the trusted control network.

## Docker deployment

The provided Docker Compose setup uses Linux host networking because sACN depends on UDP multicast and OSC should share the lighting network directly. It persists captured scenes and logs in Docker-managed volumes and mounts the host JSON configuration read-only.

```sh
cp .env.example .env
docker compose up --build -d
docker compose logs -f scene-replay
```

Set `sacn.bindAddress` in `config/config.json` to the host's lighting-network IPv4 address when the machine has multiple network interfaces; that address selects the multicast input/output interface. Set `osc.companionAddress` and `osc.feedbackPort` to the Companion machine and its feedback listener. OSC listen and sACN use the existing configured ports. To use another config file, set `SCENE_REPLAY_CONFIG_FILE` in `.env`. `SCENE_REPLAY_LOG_LEVEL` can be set there to `DEBUG`, `INFO`, `WARN`, or `ERROR`.

The Compose service restarts unless stopped and handles SIGTERM for a graceful shutdown. Data and logs remain in named volumes across container replacement; inspect them with `docker compose exec scene-replay ...` or back them up with standard Docker volume backup procedures. `docker compose down` preserves these volumes; `docker compose down -v` deletes them, including all captured scenes.

Host networking is supported by the Linux Docker Engine. Docker Desktop on Windows/macOS has different host-network and multicast behavior; verify sACN multicast reception and output on the target before using it for permanent control. If multicast is not available to the container, run the Node application directly on the Windows host or use a Linux host with host networking. Docker does not replace the need to validate the correct NIC, multicast routing, firewall rules, and Companion feedback address.

## Development notes

The code keeps MA3 input, scene storage, and output buffers separate. The sACN receiver accepts Universe 1, merges equal-priority sources with HTP, and expires inactive sources. The sender publishes Universes 1 and 2 continuously and sends updated values immediately. There is no Art-Net, fixture patch, GUI, database, or fade engine.
