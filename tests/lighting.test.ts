import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config/config.js";
import type { AppConfig } from "../src/config/types.js";
import { NullLogger } from "../src/logging/logger.js";
import { OutputEngine } from "../src/lighting/output-engine.js";
import type { SceneDocument, ScenePersistence } from "../src/persistence/scenes.js";

const config = parseConfig(JSON.parse(
  JSON.stringify({
    sacn: {
      inputUniverse: 1,
      outputUniverses: [1, 2],
      bindAddress: "0.0.0.0",
      refreshRateMs: 100,
    },
    osc: {
      listenAddress: "127.0.0.1",
      listenPort: 9000,
      companionAddress: "127.0.0.1",
      feedbackPort: 9001,
    },
    zones: [1, 2, 3, 4].map((id) => ({ id, universe: 2, channel: id })),
    color: {
      universe: 2,
      channels: [5, 6, 7],
      wrap: true,
      sequence: [
        { name: "Red", values: [255, 0, 0] },
        { name: "Orange", values: [255, 128, 0] },
      ],
    },
  }),
)) as AppConfig;

function emptyScenes(): SceneDocument {
  return {
    scene1: new Uint8Array(512),
    scene2: new Uint8Array(512),
    scene3: new Uint8Array(512),
  };
}

async function makeEngine() {
  let saved = emptyScenes();
  const persistence: ScenePersistence = {
    load: async () => saved,
    save: async (scenes) => {
      saved = {
        scene1: Uint8Array.from(scenes.scene1),
        scene2: Uint8Array.from(scenes.scene2),
        scene3: Uint8Array.from(scenes.scene3),
      };
    },
  };
  const publish = vi.fn<(universe: 1 | 2, levels: Uint8Array) => void>();
  const engine = await OutputEngine.create(config, persistence, publish, new NullLogger());
  return { engine, publish, getSaved: () => saved };
}

describe("OutputEngine", () => {
  it("captures an independent copy and recalls all 512 channel values", async () => {
    const { engine, publish, getSaved } = await makeEngine();
    const input = new Uint8Array(512);
    input.set([0, 255, 100]);
    engine.receiveUniverse1(input);
    await engine.captureScene(1);

    input[1] = 0;
    expect(getSaved().scene1.slice(0, 3)).toEqual(new Uint8Array([0, 255, 100]));
    const savedBeforeRecall = getSaved().scene1;
    engine.off();
    engine.recallScene(1);
    expect(engine.getSnapshot().universe1).toEqual(savedBeforeRecall);
    expect(publish).toHaveBeenLastCalledWith(1, savedBeforeRecall);
    expect(engine.getSnapshot().universe1).toHaveLength(512);
  });

  it("sets OFF to black on Universe 1 without changing Universe 2", async () => {
    const { engine } = await makeEngine();
    engine.setZone(1, 50);
    const universe2 = engine.getSnapshot().universe2;
    engine.receiveUniverse1(new Uint8Array(512).fill(255));
    await engine.captureScene(1);
    engine.recallScene(1);
    engine.off();
    expect(engine.getSnapshot().universe1).toEqual(new Uint8Array(512));
    expect(engine.getSnapshot().universe2).toEqual(universe2);
  });

  it("clamps zones, rounds percentages to DMX and keeps zones independent", async () => {
    const { engine } = await makeEngine();
    engine.setZone(1, 0);
    expect(engine.getSnapshot().universe2[0]).toBe(0);
    engine.setZone(1, 50);
    expect(engine.getSnapshot().universe2[0]).toBe(128);
    engine.setZone(1, 100);
    expect(engine.getSnapshot().universe2[0]).toBe(255);
    expect([...engine.getSnapshot().universe2.slice(1, 4)]).toEqual([0, 0, 0]);
    engine.setZone(1, -20);
    expect(engine.getSnapshot().universe2[0]).toBe(0);
    engine.setZone(1, 120);
    expect(engine.getSnapshot().universe2[0]).toBe(255);
  });

  it("serializes simultaneous captures without losing updates to other scene slots", async () => {
    const { engine } = await makeEngine();
    const firstInput = new Uint8Array(512).fill(31);
    engine.receiveUniverse1(firstInput);
    const first = engine.captureScene(1);
    const secondInput = new Uint8Array(512).fill(92);
    engine.receiveUniverse1(secondInput);
    const second = engine.captureScene(2);
    await Promise.all([first, second]);
    engine.recallScene(1);
    expect(engine.getSnapshot().universe1[0]).toBe(31);
    engine.recallScene(2);
    expect(engine.getSnapshot().universe1[0]).toBe(92);
  });

  it("advances through the color sequence and wraps", async () => {
    const { engine } = await makeEngine();
    engine.colorGo();
    expect(engine.getSnapshot().colorName).toBe("Red");
    expect([...engine.getSnapshot().universe2.slice(4, 7)]).toEqual([255, 0, 0]);
    engine.colorGo();
    expect(engine.getSnapshot().colorName).toBe("Orange");
    engine.colorGo();
    expect(engine.getSnapshot().colorName).toBe("Red");
  });

  it("does not let scene changes alter zones or color output", async () => {
    const { engine } = await makeEngine();
    engine.setZone(1, 50);
    engine.colorGo();
    const before = engine.getSnapshot().universe2;
    engine.receiveUniverse1(new Uint8Array(512).fill(42));
    await engine.captureScene(2);
    engine.recallScene(2);
    expect(engine.getSnapshot().universe2).toEqual(before);
  });
});
