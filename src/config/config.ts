import { readFile } from "node:fs/promises";
import type { AppConfig, ColorStepConfig, ZoneConfig } from "./types.js";

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function parseConfig(input: unknown): AppConfig {
  const root = object(input, "Configuration");
  const sacn = object(root.sacn, "sacn");
  const osc = object(root.osc, "osc");
  const color = object(root.color, "color");

  if (sacn.inputUniverse !== 1) {
    throw new Error("sacn.inputUniverse must be 1");
  }
  if (
    !Array.isArray(sacn.outputUniverses) ||
    sacn.outputUniverses.length !== 2 ||
    sacn.outputUniverses[0] !== 1 ||
    sacn.outputUniverses[1] !== 2
  ) {
    throw new Error("sacn.outputUniverses must be [1, 2]");
  }

  const refreshRateMs = integer(sacn.refreshRateMs, "sacn.refreshRateMs", 25, 10000);
  const zonesRaw = root.zones;
  if (!Array.isArray(zonesRaw) || zonesRaw.length !== 4) {
    throw new Error("zones must contain exactly four zone mappings");
  }
  const zones: ZoneConfig[] = zonesRaw.map((raw, index) => {
    const zone = object(raw, `zones[${index}]`);
    const id = integer(zone.id, `zones[${index}].id`, 1, 4);
    const universe = integer(zone.universe, `zones[${index}].universe`, 1, 63999);
    const channel = integer(zone.channel, `zones[${index}].channel`, 1, 512);
    if (universe !== 2) {
      throw new Error(`zones[${index}].universe must be 2`);
    }
    return { id, universe, channel };
  });
  if (new Set(zones.map((zone) => zone.id)).size !== 4) {
    throw new Error("zone ids must be unique and cover 1 through 4");
  }
  if (new Set(zones.map((zone) => zone.channel)).size !== 4) {
    throw new Error("zone channels must be unique");
  }

  const colorUniverse = integer(color.universe, "color.universe", 1, 63999);
  if (colorUniverse !== 2) {
    throw new Error("color.universe must be 2");
  }
  if (!Array.isArray(color.channels) || color.channels.length === 0) {
    throw new Error("color.channels must be a non-empty array");
  }
  const colorChannels = color.channels.map((channel, index) =>
    integer(channel, `color.channels[${index}]`, 1, 512),
  );
  if (new Set(colorChannels).size !== colorChannels.length) {
    throw new Error("color.channels must be unique");
  }
  const zoneChannels = new Set(zones.map((zone) => zone.channel));
  if (colorChannels.some((channel) => zoneChannels.has(channel))) {
    throw new Error("color channels must not overlap zone channels");
  }

  if (typeof color.wrap !== "boolean") {
    throw new Error("color.wrap must be a boolean");
  }
  if (!Array.isArray(color.sequence) || color.sequence.length === 0) {
    throw new Error("color.sequence must contain at least one step");
  }
  const sequence: ColorStepConfig[] = color.sequence.map((raw, index) => {
    const step = object(raw, `color.sequence[${index}]`);
    const name = string(step.name, `color.sequence[${index}].name`);
    if (!Array.isArray(step.values) || step.values.length !== colorChannels.length) {
      throw new Error(
        `color.sequence[${index}].values must contain ${colorChannels.length} DMX values`,
      );
    }
    return {
      name,
      values: step.values.map((value, valueIndex) =>
        integer(value, `color.sequence[${index}].values[${valueIndex}]`, 0, 255),
      ),
    };
  });

  return {
    sacn: {
      inputUniverse: 1,
      outputUniverses: [1, 2],
      bindAddress: string(sacn.bindAddress, "sacn.bindAddress"),
      refreshRateMs,
    },
    osc: {
      listenAddress: string(osc.listenAddress, "osc.listenAddress"),
      listenPort: integer(osc.listenPort, "osc.listenPort", 1, 65535),
      companionAddress: string(osc.companionAddress, "osc.companionAddress"),
      feedbackPort: integer(osc.feedbackPort, "osc.feedbackPort", 1, 65535),
    },
    zones,
    color: {
      universe: 2,
      channels: colorChannels,
      wrap: color.wrap,
      sequence,
    },
  };
}

export async function loadConfig(filePath: string): Promise<AppConfig> {
  const text = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in configuration file ${filePath}`, { cause: error });
  }
  return parseConfig(parsed);
}
