import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config/config.js";
import { FileLogger, type LogLevel } from "./logging/logger.js";
import { OutputEngine } from "./lighting/output-engine.js";
import { OscCommandHandler } from "./osc/handlers.js";
import { OscServer } from "./osc/server.js";
import { JsonScenePersistence } from "./persistence/scenes.js";
import { SacnReceiver } from "./sacn/receiver.js";
import { SacnSender } from "./sacn/sender.js";

interface RunningController {
  stop(): Promise<void>;
}

async function startController(): Promise<RunningController> {
  const home = path.resolve(process.env.SCENE_REPLAY_HOME ?? process.cwd());
  const configPath = path.resolve(
    home,
    process.env.SCENE_REPLAY_CONFIG ?? "config/config.json",
  );
  const dataDirectory = path.resolve(home, process.env.SCENE_REPLAY_DATA_DIR ?? "data");
  const logDirectory = path.resolve(home, process.env.SCENE_REPLAY_LOG_DIR ?? "logs");
  const logger = await FileLogger.create(logDirectory, logLevelFromEnvironment());
  let sender: SacnSender | undefined;
  let receiver: SacnReceiver | undefined;
  let osc: OscServer | undefined;
  let healthTimer: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (healthTimer) clearInterval(healthTimer);
      const cleanup = async (name: string, action: () => Promise<void>): Promise<void> => {
        try {
          await action();
        } catch (error) {
          logger.error(`${name} shutdown failed`, error);
        }
      };
      const oscServer = osc;
      const sacnReceiver = receiver;
      const sacnSender = sender;
      if (oscServer) await cleanup("OSC server", () => oscServer.stop());
      if (sacnReceiver) await cleanup("sACN receiver", () => sacnReceiver.stop());
      if (sacnSender) await cleanup("sACN sender", () => sacnSender.stop());
      logger.info("Application stopped");
      await logger.close();
    })();
    return stopping;
  };

  try {
    let config;
    try {
      config = await loadConfig(configPath);
    } catch (error) {
      logger.error("Configuration error", error);
      throw error;
    }
    logger.info("Configuration loaded", { path: configPath });
    const persistence = new JsonScenePersistence(path.join(dataDirectory, "scenes.json"));
    const sacnSender = new SacnSender(
      config.sacn.outputUniverses,
      config.sacn.refreshRateMs,
      logger,
      config.sacn.bindAddress,
    );
    sender = sacnSender;
    const engine = await OutputEngine.create(
      config,
      persistence,
      (universe, levels) => sacnSender.publish(universe, levels),
      logger,
    );
    await sacnSender.start();

    receiver = new SacnReceiver(
      config.sacn.inputUniverse,
      config.sacn.bindAddress,
      (levels) => engine.receiveUniverse1(levels),
      logger,
    );
    await receiver.start();

    osc = new OscServer(
      config.osc.listenAddress,
      config.osc.listenPort,
      config.osc.companionAddress,
      config.osc.feedbackPort,
      logger,
    );
    const commandHandler = new OscCommandHandler(config, engine, osc, logger);
    engine.onChange((event) => {
      switch (event.type) {
        case "scene":
          osc?.send("/status/scene", event.scene === 0 ? "off" : event.scene);
          if (event.scene === 0) osc?.send("/off");
          break;
        case "zone":
          osc?.send(`/status/zone/${event.id}`, event.percent);
          break;
        case "color":
          osc?.send("/status/color", event.name);
          break;
      }
    });
    await osc.start((message) => commandHandler.handle(message));
    commandHandler.sendState();
    healthTimer = setInterval(() => {
      const state = engine.getSnapshot();
      logger.info("Application health", {
        uptimeSeconds: Math.floor(process.uptime()),
        activeScene: state.activeScene,
        color: state.colorName,
        memoryBytes: process.memoryUsage().rss,
      });
    }, 60_000);
    healthTimer.unref();
    logger.info("Application started", { home });
  } catch (error) {
    logger.error("Application startup failed", error);
    await stop();
    throw error;
  }

  return { stop };
}

function logLevelFromEnvironment(): LogLevel {
  const value = process.env.SCENE_REPLAY_LOG_LEVEL ?? "INFO";
  if (value === "DEBUG" || value === "INFO" || value === "WARN" || value === "ERROR") {
    return value;
  }
  throw new Error("SCENE_REPLAY_LOG_LEVEL must be DEBUG, INFO, WARN, or ERROR");
}

async function main(): Promise<void> {
  const controller = await startController();
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.info(`Received ${signal}; shutting down`);
    void controller.stop().catch((error: unknown) => {
      console.error("Shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error("Unable to start Scene Replay", error);
    process.exitCode = 1;
  });
}
