import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export interface Logger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  close(): Promise<void>;
}

export class FileLogger implements Logger {
  private readonly stream: WriteStream;

  private constructor(
    logFile: string,
    private readonly minimumLevel: LogLevel,
  ) {
    this.stream = createWriteStream(logFile, { flags: "a" });
    this.stream.on("error", (error) => {
      console.error(`ERROR Logger stream failed: ${error.message}`);
    });
  }

  static async create(directory: string, minimumLevel: LogLevel = "INFO"): Promise<FileLogger> {
    await mkdir(directory, { recursive: true });
    return new FileLogger(path.join(directory, "scene-replay.log"), minimumLevel);
  }

  debug(message: string, details?: unknown): void {
    this.write("DEBUG", message, details);
  }

  info(message: string, details?: unknown): void {
    this.write("INFO", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write("WARN", message, details);
  }

  error(message: string, details?: unknown): void {
    this.write("ERROR", message, details);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private write(level: LogLevel, message: string, details?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minimumLevel]) return;
    const suffix = details === undefined ? "" : ` ${formatDetails(details)}`;
    const line = `${new Date().toISOString()} ${level} ${message}${suffix}`;
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
    this.stream.write(`${line}\n`);
  }
}

export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  async close(): Promise<void> {}
}

function formatDetails(details: unknown): string {
  if (details instanceof Error) {
    return JSON.stringify({ message: details.message, stack: details.stack });
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
