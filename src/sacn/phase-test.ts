import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/config.js";
import { FileLogger, type LogLevel } from "../logging/logger.js";
import { SacnSender } from "./sender.js";

const STEP_MS = 250;
const CHANNEL_COUNT = 512;

export function createChaseLevels(step: number, channelCount = CHANNEL_COUNT): Uint8Array {
  if (!Number.isInteger(step) || step < 0) {
    throw new Error("Chase step must be a non-negative integer");
  }
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > CHANNEL_COUNT) {
    throw new Error(`Chase channel count must be an integer from 1 to ${CHANNEL_COUNT}`);
  }

  const levels = new Uint8Array(CHANNEL_COUNT);
  levels[step % channelCount] = 255;
  return levels;
}

async function runPhaseTest(): Promise<void> {
  const home = path.resolve(process.env.SCENE_REPLAY_HOME ?? process.cwd());
  const configPath = path.resolve(
    home,
    process.env.SCENE_REPLAY_CONFIG ?? "config/config.json",
  );
  const logDirectory = path.resolve(home, process.env.SCENE_REPLAY_LOG_DIR ?? "logs");
  const config = await loadConfig(configPath);
  const channelCount = channelCountFromArguments(process.argv[2]);
  const logger = await FileLogger.create(logDirectory, logLevelFromEnvironment());
  const sender = new SacnSender(
    [2],
    config.sacn.refreshRateMs,
    logger,
    config.sacn.bindAddress,
    "Scene Replay Chase Test",
  );

  let animation: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (animation) clearInterval(animation);
      sender.publish(2, new Uint8Array(CHANNEL_COUNT));
      await new Promise((resolve) => setTimeout(resolve, config.sacn.refreshRateMs));
      await sender.stop();
      logger.info("sACN chase test stopped");
      await logger.close();
    })();
    return stopping;
  };

  try {
    await sender.start();
    let step = 0;
    const publishStep = (): void => {
      const channel = (step % channelCount) + 1;
      sender.publish(2, createChaseLevels(step, channelCount));
      console.info(`Channel ${channel}`);
      step += 1;
    };
    publishStep();
    animation = setInterval(publishStep, STEP_MS);

    console.info(
      `Chasing channels 1-${channelCount} on sACN Universe 2, one at a time at full (${STEP_MS}ms per step). Press Ctrl+C to stop.`,
    );

    const shutdown = (signal: NodeJS.Signals): void => {
      console.info(`Received ${signal}; sending Universe 2 to black`);
      void stop().catch((error: unknown) => {
        logger.error("sACN chase test shutdown failed", error);
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    await sender.stop();
    await logger.close();
    throw error;
  }
}

function channelCountFromArguments(value: string | undefined): number {
  if (value === undefined) return CHANNEL_COUNT;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > CHANNEL_COUNT) {
    throw new Error(`Channel count must be an integer from 1 to ${CHANNEL_COUNT}`);
  }
  return count;
}

function logLevelFromEnvironment(): LogLevel {
  const value = process.env.SCENE_REPLAY_LOG_LEVEL ?? "INFO";
  if (value === "DEBUG" || value === "INFO" || value === "WARN" || value === "ERROR") {
    return value;
  }
  throw new Error("SCENE_REPLAY_LOG_LEVEL must be DEBUG, INFO, WARN, or ERROR");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runPhaseTest().catch((error: unknown) => {
    console.error("Unable to run sACN chase test", error);
    process.exitCode = 1;
  });
}
