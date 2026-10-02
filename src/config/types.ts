export interface ZoneConfig {
  id: number;
  universe: number;
  channel: number;
}

export interface ColorStepConfig {
  name: string;
  values: number[];
}

export interface AppConfig {
  sacn: {
    inputUniverse: number;
    outputUniverses: [number, number];
    bindAddress: string;
    refreshRateMs: number;
  };
  osc: {
    listenAddress: string;
    listenPort: number;
    companionAddress: string;
    feedbackPort: number;
  };
  zones: ZoneConfig[];
  color: {
    universe: number;
    channels: number[];
    wrap: boolean;
    sequence: ColorStepConfig[];
  };
}

export const UNIVERSE_SIZE = 512;
export const DEFAULT_ZONE_IDS = [1, 2, 3, 4] as const;
