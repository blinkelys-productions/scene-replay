import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config/config.js";
import { NullLogger } from "../src/logging/logger.js";
import { OutputEngine } from "../src/lighting/output-engine.js";
import { OscCommandHandler } from "../src/osc/handlers.js";
import { decodeOscPacket, encodeOscMessage, type OscValue } from "../src/osc/codec.js";
import type { SceneDocument, ScenePersistence } from "../src/persistence/scenes.js";

const config = parseConfig({
  sacn: { inputUniverse: 1, outputUniverses: [1, 2], bindAddress: "0.0.0.0", refreshRateMs: 100 },
  osc: { listenAddress: "127.0.0.1", listenPort: 9000, companionAddress: "127.0.0.1", feedbackPort: 9001 },
  zones: [1, 2, 3, 4].map((id) => ({ id, universe: 2, channel: id })),
  color: {
    universe: 2,
    channels: [5, 6, 7],
    wrap: true,
    sequence: [{ name: "Red", values: [255, 0, 0] }],
  },
});

function blankScenes(): SceneDocument {
  return {
    scene1: new Uint8Array(512),
    scene2: new Uint8Array(512),
    scene3: new Uint8Array(512),
  };
}

describe("OSC API", () => {
  it("round-trips integer, float and string messages", () => {
    const message = decodeOscPacket(encodeOscMessage("/zone/1", [50.5]))[0]!;
    expect(message).toEqual({ address: "/zone/1", args: [50.5] });
    expect(decodeOscPacket(encodeOscMessage("/status/scene", ["off"]))[0]!.args).toEqual(["off"]);
  });

  it("runs commands and emits feedback for state changes and sync requests", async () => {
    const persistence: ScenePersistence = {
      load: async () => blankScenes(),
      save: async () => undefined,
    };
    const engine = await OutputEngine.create(config, persistence, () => undefined, new NullLogger());
    const send = vi.fn<(address: string, ...args: OscValue[]) => void>();
    const feedback = { send };
    const handler = new OscCommandHandler(config, engine, feedback, new NullLogger());
    engine.onChange((event) => {
      if (event.type === "scene") send("/status/scene", event.scene === 0 ? "off" : event.scene);
      if (event.type === "zone") send(`/status/zone/${event.id}`, event.percent);
      if (event.type === "color") send("/status/color", event.name);
    });

    engine.receiveUniverse1(new Uint8Array(512).fill(12));
    await handler.handle({ address: "/scene/capture", args: [1] });
    await handler.handle({ address: "/scene/recall", args: [1] });
    await handler.handle({ address: "/zone/1", args: [50] });
    await handler.handle({ address: "/color/go", args: [] });
    await handler.handle({ address: "/off", args: [] });

    expect(engine.getSnapshot().universe1).toEqual(new Uint8Array(512));
    expect(engine.getSnapshot().universe2[0]).toBe(128);
    expect(send).toHaveBeenCalledWith("/status/scene", 1);
    expect(send).toHaveBeenCalledWith("/status/zone/1", 50);
    expect(send).toHaveBeenCalledWith("/status/color", "Red");
    expect(send).toHaveBeenCalledWith("/status/scene", "off");

    send.mockClear();
    await handler.handle({ address: "/status/request", args: [] });
    expect(send).toHaveBeenCalledWith("/status/scene", "off");
    expect(send).toHaveBeenCalledWith("/status/zone/1", 50);
    expect(send).toHaveBeenCalledWith("/status/color", "Red");
    expect(send).toHaveBeenCalledWith("/status/application", "ok");
    expect(send).toHaveBeenCalledTimes(7);
  });
});
