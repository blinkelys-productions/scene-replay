import { describe, expect, it } from "vitest";
import { createDataPacket, parseDataPacket } from "../src/sacn/packet.js";
import { createChaseLevels } from "../src/sacn/phase-test.js";
import { sacnMulticastAddress } from "../src/sacn/universe.js";

describe("sACN E1.31 packet handling", () => {
  it("encodes and parses a 512-channel data packet", () => {
    const levels = new Uint8Array(512);
    levels.set([0, 255, 100]);
    const packet = createDataPacket(new Uint8Array(16).fill(1), "Unit Test", 100, 9, 1, levels);
    const decoded = parseDataPacket(packet);
    expect(decoded).not.toBeNull();
    expect(decoded).toMatchObject({
      sourceName: "Unit Test",
      priority: 100,
      sequence: 9,
      universe: 1,
    });
    expect(decoded?.levels).toEqual(levels);
  });

  it("builds the correct sACN multicast address", () => {
    expect(sacnMulticastAddress(1)).toBe("239.255.0.1");
    expect(sacnMulticastAddress(513)).toBe("239.255.2.1");
  });

  it("chases a single channel at full and wraps at the channel count", () => {
    const first = createChaseLevels(0);
    expect(first).toHaveLength(512);
    expect(first[0]).toBe(255);
    expect(first.reduce((sum, level) => sum + level, 0)).toBe(255);

    expect(createChaseLevels(4)[4]).toBe(255);
    expect(createChaseLevels(512)[0]).toBe(255);
    expect(createChaseLevels(8, 8)[0]).toBe(255);
  });
});
