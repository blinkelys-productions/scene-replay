import { createSocket, type Socket } from "node:dgram";
import { randomUUID } from "node:crypto";
import type { Logger } from "../logging/logger.js";
import { createDataPacket } from "./packet.js";
import { sacnMulticastAddress, validateLevels } from "./universe.js";

export class SacnSender {
  private socket: Socket | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly cid = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  private readonly levels = new Map<number, Uint8Array>();
  private readonly sequences = new Map<number, number>();

  constructor(
    private readonly universes: readonly number[],
    private readonly refreshRateMs: number,
    private readonly logger: Logger,
    private readonly interfaceAddress = "0.0.0.0",
    private readonly sourceName = "Scene Replay",
    private readonly priority = 100,
    private readonly port = 5568,
  ) {
    for (const universe of universes) {
      this.levels.set(universe, new Uint8Array(512));
      this.sequences.set(universe, 0);
    }
  }

  async start(): Promise<void> {
    if (this.socket) throw new Error("sACN sender is already started");
    const socket = createSocket("udp4");
    this.socket = socket;
    socket.on("error", (error) => this.logger.error("sACN sender error", error));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        socket.off("error", onError);
        try {
          socket.setMulticastTTL(1);
          socket.setMulticastLoopback(false);
          if (this.interfaceAddress !== "0.0.0.0") {
            try {
              socket.setMulticastInterface(this.interfaceAddress);
            } catch (error) {
              if (isAddressNotAvailable(error)) {
                throw new Error(
                  `sacn.bindAddress ${this.interfaceAddress} is not assigned to a local network interface; set it to this machine's IPv4 address or use 0.0.0.0 to let the operating system choose`,
                  { cause: error },
                );
              }
              throw error;
            }
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(0);
    });
    for (const universe of this.universes) this.send(universe);
    this.timer = setInterval(() => {
      for (const universe of this.universes) this.send(universe);
    }, this.refreshRateMs);
    this.timer.unref();
    this.logger.info("sACN output started", { universes: this.universes });
  }

  publish(universe: number, levels: Uint8Array): void {
    const target = this.levels.get(universe);
    if (!target) throw new Error(`Universe ${universe} is not configured for output`);
    validateLevels(levels);
    target.set(levels);
    if (this.socket) this.send(universe);
  }

  stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      try {
        socket.close(() => resolve());
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ERR_SOCKET_DGRAM_NOT_RUNNING"
        ) {
          resolve();
          return;
        }
        reject(error);
      }
    });
  }

  private send(universe: number): void {
    const socket = this.socket;
    const levels = this.levels.get(universe);
    if (!socket || !levels) return;
    const sequence = this.sequences.get(universe) ?? 0;
    this.sequences.set(universe, (sequence + 1) & 0xff);
    const packet = createDataPacket(
      this.cid,
      this.sourceName,
      this.priority,
      sequence,
      universe,
      levels,
    );
    socket.send(packet, this.port, sacnMulticastAddress(universe), (error) => {
      if (error) this.logger.error("sACN packet send failed", { universe, error });
    });
  }
}

function isAddressNotAvailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EADDRNOTAVAIL"
  );
}
