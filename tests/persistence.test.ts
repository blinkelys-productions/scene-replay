import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonScenePersistence } from "../src/persistence/scenes.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("JsonScenePersistence", () => {
  it("initializes black scenes and persists captures across reloads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scene-replay-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "data", "scenes.json");
    const persistence = new JsonScenePersistence(file);
    const scenes = await persistence.load();
    expect(scenes.scene1).toEqual(new Uint8Array(512));

    scenes.scene2[11] = 255;
    await persistence.save(scenes);
    const loaded = await new JsonScenePersistence(file).load();
    expect(loaded.scene2[11]).toBe(255);
    expect(JSON.parse(await readFile(file, "utf8")).scene2).toHaveLength(512);
  });
});
