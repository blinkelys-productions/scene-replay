import type { AppConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { OutputEngine } from "../lighting/output-engine.js";
import type { SceneId } from "../persistence/scenes.js";
import type { OscMessage, OscValue } from "./codec.js";

export interface OscFeedback {
  send(address: string, ...args: OscValue[]): void;
}

export class OscCommandHandler {
  constructor(
    private readonly config: AppConfig,
    private readonly engine: OutputEngine,
    private readonly feedback: OscFeedback,
    private readonly logger: Logger,
  ) {}

  async handle(message: OscMessage): Promise<void> {
    switch (message.address) {
      case "/scene/recall": {
        const scene = this.sceneId(message.args);
        this.engine.recallScene(scene);
        return;
      }
      case "/scene/capture": {
        const scene = this.sceneId(message.args);
        await this.engine.captureScene(scene);
        return;
      }
      case "/off":
        this.requireNoArgs(message);
        this.engine.off();
        return;
      case "/color/go":
        this.requireNoArgs(message);
        this.engine.colorGo();
        return;
      case "/status/request":
        this.requireNoArgs(message);
        this.sendState();
        return;
      default: {
        const match = /^\/zone\/([1-4])$/.exec(message.address);
        if (match) {
          if (message.args.length !== 1 || typeof message.args[0] !== "number") {
            throw new Error(`${message.address} requires exactly one numeric percentage`);
          }
          this.engine.setZone(Number(match[1]), message.args[0]);
          return;
        }
        this.logger.warn("Unknown OSC address", { address: message.address });
      }
    }
  }

  sendState(): void {
    const state = this.engine.getSnapshot();
    this.feedback.send("/status/scene", state.activeScene === 0 ? "off" : state.activeScene);
    for (const zone of this.config.zones) {
      this.feedback.send(`/status/zone/${zone.id}`, this.engine.getZonePercent(zone.id));
    }
    this.feedback.send("/status/color", state.colorName ?? "none");
    this.feedback.send("/status/application", "ok");
  }

  private sceneId(args: OscValue[]): SceneId {
    if (args.length !== 1 || typeof args[0] !== "number" || !Number.isInteger(args[0])) {
      throw new Error("Scene command requires one integer argument from 1 to 3");
    }
    if (args[0] < 1 || args[0] > 3) {
      throw new Error("Scene command requires one integer argument from 1 to 3");
    }
    return args[0] as SceneId;
  }

  private requireNoArgs(message: OscMessage): void {
    if (message.args.length !== 0) {
      throw new Error(`${message.address} does not accept arguments`);
    }
  }
}
