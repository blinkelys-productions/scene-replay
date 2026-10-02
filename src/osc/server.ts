import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { Logger } from "../logging/logger.js";
import { decodeOscPacket, encodeOscMessage, type OscMessage, type OscValue } from "./codec.js";

export type OscMessageHandler = (message: OscMessage) => Promise<void>;

export class OscServer {
  private socket: Socket | undefined;
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly listenAddress: string,
    private readonly listenPort: number,
    private readonly feedbackAddress: string,
    private readonly feedbackPort: number,
    private readonly logger: Logger,
  ) {}

  async start(handler: OscMessageHandler): Promise<void> {
    if (this.socket) throw new Error("OSC server is already started");
    const socket = createSocket("udp4");
    this.socket = socket;
    socket.on("error", (error) => this.logger.error("OSC socket error", error));
    socket.on("message", (packet, _remote: RemoteInfo) => {
      this.messageQueue = this.messageQueue.then(() => this.handlePacket(packet, handler));
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(this.listenPort, this.listenAddress);
    });
    this.logger.info("OSC server started", {
      address: this.listenAddress,
      port: this.listenPort,
      feedbackAddress: this.feedbackAddress,
      feedbackPort: this.feedbackPort,
    });
  }

  send(address: string, ...args: OscValue[]): void {
    const socket = this.socket;
    if (!socket) throw new Error("Cannot send OSC feedback before the server starts");
    const packet = encodeOscMessage(address, args);
    socket.send(packet, this.feedbackPort, this.feedbackAddress, (error) => {
      if (error) this.logger.error("OSC feedback send failed", { address, error });
    });
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    await closeSocket(socket);
  }

  private async handlePacket(packet: Buffer, handler: OscMessageHandler): Promise<void> {
    try {
      for (const message of decodeOscPacket(packet)) await handler(message);
    } catch (error) {
      this.logger.warn("Invalid OSC packet or command", error);
    }
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
