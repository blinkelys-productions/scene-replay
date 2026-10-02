import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { Logger } from "../logging/logger.js";
import { parseDataPacket } from "./packet.js";
import { sacnMulticastAddress } from "./universe.js";

interface SourceState {
  priority: number;
  sequence: number;
  levels: Uint8Array;
  lastSeen: number;
}

export class SacnReceiver {
  private socket: Socket | undefined;
  private expiryTimer: NodeJS.Timeout | undefined;
  private readonly sources = new Map<string, SourceState>();

  constructor(
    private readonly universe: number,
    private readonly bindAddress: string,
    private readonly onLevels: (levels: Uint8Array) => void,
    private readonly logger: Logger,
    private readonly port = 5568,
  ) {}

  async start(): Promise<void> {
    if (this.socket) throw new Error("sACN receiver is already started");
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("error", (error) => this.logger.error("sACN receiver error", error));
    socket.on("message", (packet, remote) => this.handlePacket(packet, remote));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        socket.off("error", onError);
        try {
          if (this.bindAddress === "0.0.0.0") {
            socket.addMembership(sacnMulticastAddress(this.universe));
          } else {
            socket.addMembership(sacnMulticastAddress(this.universe), this.bindAddress);
          }
          socket.setMulticastLoopback(true);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(this.port, this.bindAddress);
    });
    this.expiryTimer = setInterval(() => this.expireSources(), 1000);
    this.expiryTimer.unref();
    this.logger.info("sACN receiver started", {
      universe: this.universe,
      address: sacnMulticastAddress(this.universe),
      port: this.port,
    });
  }

  async stop(): Promise<void> {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    await closeSocket(socket);
  }

  private handlePacket(packet: Buffer, _remote: RemoteInfo): void {
    const data = parseDataPacket(packet);
    if (!data || data.universe !== this.universe) return;

    const current = this.sources.get(data.cid);
    if (data.terminated) {
      if (this.sources.delete(data.cid)) this.publishMergedLevels();
      return;
    }
    if (
      current &&
      ((data.sequence - current.sequence + 256) % 256 === 0 ||
        (data.sequence - current.sequence + 256) % 256 > 127)
    ) {
      return;
    }
    this.sources.set(data.cid, {
      priority: data.priority,
      sequence: data.sequence,
      levels: data.levels,
      lastSeen: Date.now(),
    });
    this.publishMergedLevels();
  }

  private expireSources(): void {
    const cutoff = Date.now() - 2500;
    let changed = false;
    for (const [cid, source] of this.sources) {
      if (source.lastSeen < cutoff) {
        this.sources.delete(cid);
        changed = true;
      }
    }
    if (changed) this.publishMergedLevels();
  }

  private publishMergedLevels(): void {
    if (this.sources.size === 0) {
      this.onLevels(new Uint8Array(512));
      return;
    }
    const highestPriority = Math.max(...[...this.sources.values()].map((source) => source.priority));
    const active = [...this.sources.values()].filter((source) => source.priority === highestPriority);
    const merged = new Uint8Array(512);
    for (const source of active) {
      for (let index = 0; index < merged.length; index += 1) {
        merged[index] = Math.max(merged[index]!, source.levels[index]!);
      }
    }

    this.onLevels(merged);
  }
}

function closeSocket(socket: Socket): Promise<void> {
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
