import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { UNIVERSE_SIZE } from "../config/types.js";

export type SceneId = 1 | 2 | 3;
export type SceneDocument = Record<`scene${SceneId}`, Uint8Array>;

export interface ScenePersistence {
  load(): Promise<SceneDocument>;
  save(scenes: SceneDocument): Promise<void>;
}

function emptyScenes(): SceneDocument {
  return {
    scene1: new Uint8Array(UNIVERSE_SIZE),
    scene2: new Uint8Array(UNIVERSE_SIZE),
    scene3: new Uint8Array(UNIVERSE_SIZE),
  };
}

function validateScenes(value: unknown, filePath: string): SceneDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Scene file ${filePath} must contain an object`);
  }
  const input = value as Record<string, unknown>;
  const result = emptyScenes();
  for (const id of [1, 2, 3] as const) {
    const key = `scene${id}` as const;
    const raw = input[key];
    if (!Array.isArray(raw) || raw.length !== UNIVERSE_SIZE) {
      throw new Error(`${key} in ${filePath} must contain exactly 512 DMX values`);
    }
    const values = raw.map((value: unknown, index: number) => {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) {
        throw new Error(`${key}[${index}] in ${filePath} must be an integer from 0 to 255`);
      }
      return value as number;
    });
    result[key] = Uint8Array.from(values);
  }
  return result;
}

export class JsonScenePersistence implements ScenePersistence {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<SceneDocument> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return emptyScenes();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(`Invalid JSON in scene file ${this.filePath}`, { cause: error });
    }
    return validateScenes(parsed, this.filePath);
  }

  save(scenes: SceneDocument): Promise<void> {
    const snapshot = {
      scene1: Uint8Array.from(scenes.scene1),
      scene2: Uint8Array.from(scenes.scene2),
      scene3: Uint8Array.from(scenes.scene3),
    };
    const write = this.writeQueue.then(() => this.atomicWrite(snapshot));
    this.writeQueue = write.catch(() => undefined);
    return write;
  }

  private async atomicWrite(scenes: SceneDocument): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const handle = await open(temporaryPath, "w");
    try {
      const contents = JSON.stringify({
        scene1: Array.from(scenes.scene1),
        scene2: Array.from(scenes.scene2),
        scene3: Array.from(scenes.scene3),
      });
      await handle.writeFile(`${contents}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, this.filePath);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
