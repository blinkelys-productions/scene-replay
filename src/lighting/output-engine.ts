import type { AppConfig } from "../config/types.js";
import { UNIVERSE_SIZE } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { SceneDocument, SceneId, ScenePersistence } from "../persistence/scenes.js";

export interface LightingSnapshot {
  activeScene: 0 | SceneId;
  universe1: Uint8Array;
  universe2: Uint8Array;
  inputUniverse1: Uint8Array;
  zones: number[];
  colorIndex: number;
  colorName: string | null;
}

export type LightingEvent =
  | { type: "scene"; scene: 0 | SceneId }
  | { type: "zone"; id: number; percent: number }
  | { type: "color"; index: number; name: string };

export type UniversePublisher = (universe: 1 | 2, levels: Uint8Array) => void;
export type LightingListener = (event: LightingEvent) => void;

export class OutputEngine {
  private scenes: SceneDocument;
  private readonly inputUniverse1 = new Uint8Array(UNIVERSE_SIZE);
  private universe1 = new Uint8Array(UNIVERSE_SIZE);
  private universe2 = new Uint8Array(UNIVERSE_SIZE);
  private activeScene: 0 | SceneId = 0;
  private readonly zonePercentages = new Map<number, number>();
  private colorIndex = -1;
  private readonly listeners = new Set<LightingListener>();
  private captureQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly config: AppConfig,
    private readonly persistence: ScenePersistence,
    private readonly publish: UniversePublisher,
    private readonly logger: Logger,
    scenes: SceneDocument,
  ) {
    this.scenes = scenes;
    for (const zone of config.zones) this.zonePercentages.set(zone.id, 0);
    this.rebuildUniverse2();
  }

  static async create(
    config: AppConfig,
    persistence: ScenePersistence,
    publish: UniversePublisher,
    logger: Logger,
  ): Promise<OutputEngine> {
    let scenes: SceneDocument;
    try {
      scenes = await persistence.load();
    } catch (error) {
      logger.error("Scene storage error", error);
      throw error;
    }
    logger.info("Scenes loaded");
    return new OutputEngine(config, persistence, publish, logger, scenes);
  }

  onChange(listener: LightingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): LightingSnapshot {
    return {
      activeScene: this.activeScene,
      universe1: Uint8Array.from(this.universe1),
      universe2: Uint8Array.from(this.universe2),
      inputUniverse1: Uint8Array.from(this.inputUniverse1),
      zones: [...this.config.zones]
        .sort((left, right) => left.id - right.id)
        .map((zone) => this.zonePercentages.get(zone.id) ?? 0),
      colorIndex: this.colorIndex,
      colorName: this.colorIndex < 0 ? null : this.config.color.sequence[this.colorIndex]!.name,
    };
  }

  getZonePercent(id: number): number {
    const value = this.zonePercentages.get(id);
    if (value === undefined) throw new Error(`Unknown zone ${id}`);
    return value;
  }

  receiveUniverse1(levels: Uint8Array): void {
    if (levels.length !== UNIVERSE_SIZE) {
      throw new Error(`Universe 1 input must contain exactly ${UNIVERSE_SIZE} channels`);
    }
    this.inputUniverse1.set(levels);
  }

  captureScene(id: SceneId): Promise<void> {
    const inputSnapshot = Uint8Array.from(this.inputUniverse1);
    const capture = this.captureQueue.then(() => this.persistCapture(id, inputSnapshot));
    this.captureQueue = capture.catch(() => undefined);
    return capture;
  }

  private async persistCapture(id: SceneId, inputSnapshot: Uint8Array): Promise<void> {
    const scenes: SceneDocument = {
      scene1: Uint8Array.from(this.scenes.scene1),
      scene2: Uint8Array.from(this.scenes.scene2),
      scene3: Uint8Array.from(this.scenes.scene3),
    };
    scenes[`scene${id}`] = inputSnapshot;
    try {
      await this.persistence.save(scenes);
    } catch (error) {
      this.logger.error("Scene storage error", { scene: id, error });
      throw error;
    }
    this.scenes = scenes;
    this.logger.info("Scene captured", { scene: id });
  }

  recallScene(id: SceneId): void {
    this.activeScene = id;
    this.universe1 = Uint8Array.from(this.scenes[`scene${id}`]);
    this.publish(1, Uint8Array.from(this.universe1));
    this.emit({ type: "scene", scene: id });
    this.logger.info("Scene recalled", { scene: id });
  }

  off(): void {
    this.activeScene = 0;
    this.universe1 = new Uint8Array(UNIVERSE_SIZE);
    this.publish(1, Uint8Array.from(this.universe1));
    this.emit({ type: "scene", scene: 0 });
    this.logger.info("OFF activated");
  }

  setZone(id: number, requestedPercent: number): void {
    if (!Number.isFinite(requestedPercent)) {
      throw new Error("Zone percentage must be a finite number");
    }
    if (!this.zonePercentages.has(id)) throw new Error(`Unknown zone ${id}`);
    const percent = Math.min(100, Math.max(0, requestedPercent));
    this.zonePercentages.set(id, percent);
    this.rebuildUniverse2();
    this.publish(2, Uint8Array.from(this.universe2));
    this.emit({ type: "zone", id, percent });
    this.logger.info("Zone changed", { zone: id, percent });
  }

  colorGo(): void {
    const next = this.colorIndex + 1;
    if (next >= this.config.color.sequence.length && !this.config.color.wrap) return;
    this.colorIndex = next % this.config.color.sequence.length;
    this.rebuildUniverse2();
    this.publish(2, Uint8Array.from(this.universe2));
    const name = this.config.color.sequence[this.colorIndex]!.name;
    this.emit({ type: "color", index: this.colorIndex, name });
    this.logger.info("Color changed", { index: this.colorIndex, name });
  }

  private rebuildUniverse2(): void {
    this.universe2 = new Uint8Array(UNIVERSE_SIZE);
    for (const zone of this.config.zones) {
      const percentage = this.zonePercentages.get(zone.id) ?? 0;
      this.universe2[zone.channel - 1] = Math.round((percentage * 255) / 100);
    }
    if (this.colorIndex >= 0) {
      const step = this.config.color.sequence[this.colorIndex]!;
      this.config.color.channels.forEach((channel, index) => {
        this.universe2[channel - 1] = step.values[index]!;
      });
    }
  }

  private emit(event: LightingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
