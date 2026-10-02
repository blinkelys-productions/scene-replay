import { UNIVERSE_SIZE } from "../config/types.js";

const ACN_PACKET_IDENTIFIER = Buffer.from([
  0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00,
]);
const PACKET_LENGTH = 638;

export interface SacnDataPacket {
  cid: string;
  sourceName: string;
  priority: number;
  sequence: number;
  universe: number;
  levels: Uint8Array;
  terminated: boolean;
}

export function createDataPacket(
  cid: Uint8Array,
  sourceName: string,
  priority: number,
  sequence: number,
  universe: number,
  levels: Uint8Array,
): Buffer {
  if (cid.length !== 16) throw new Error("sACN CID must be 16 bytes");
  if (!Number.isInteger(priority) || priority < 0 || priority > 200) {
    throw new Error("sACN priority must be an integer from 0 to 200");
  }
  if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
    throw new Error("sACN universe must be an integer from 1 to 63999");
  }
  if (levels.length !== UNIVERSE_SIZE) {
    throw new Error(`sACN output must contain exactly ${UNIVERSE_SIZE} channel levels`);
  }

  const packet = Buffer.alloc(PACKET_LENGTH);
  packet.writeUInt16BE(0x0010, 0);
  packet.writeUInt16BE(0, 2);
  ACN_PACKET_IDENTIFIER.copy(packet, 4);

  writeFlagsLength(packet, 16, PACKET_LENGTH - 16);
  packet.writeUInt32BE(0x00000004, 18);
  Buffer.from(cid).copy(packet, 22);

  writeFlagsLength(packet, 38, PACKET_LENGTH - 38);
  packet.writeUInt32BE(0x00000002, 40);
  Buffer.from(sourceName, "utf8").subarray(0, 64).copy(packet, 44);
  packet[108] = priority;
  packet.writeUInt16BE(0, 109);
  packet[111] = sequence & 0xff;
  packet[112] = 0;
  packet.writeUInt16BE(universe, 113);

  writeFlagsLength(packet, 115, PACKET_LENGTH - 115);
  packet[117] = 0x02;
  packet[118] = 0xa1;
  packet.writeUInt16BE(0, 119);
  packet.writeUInt16BE(1, 121);
  packet.writeUInt16BE(UNIVERSE_SIZE + 1, 123);
  packet[125] = 0;
  Buffer.from(levels).copy(packet, 126);
  return packet;
}

export function parseDataPacket(packet: Buffer): SacnDataPacket | null {
  if (packet.length < 126 || packet.readUInt16BE(0) !== 0x0010) return null;
  if (!packet.subarray(4, 16).equals(ACN_PACKET_IDENTIFIER)) return null;
  if (packet.readUInt32BE(18) !== 0x00000004) return null;
  if (packet.readUInt32BE(40) !== 0x00000002) return null;
  if (packet[117] !== 0x02 || packet[118] !== 0xa1) return null;

  const propertyCount = packet.readUInt16BE(123);
  if (propertyCount < 1 || propertyCount > UNIVERSE_SIZE + 1) return null;
  if (packet.length < 125 + propertyCount) return null;
  if (packet[125] !== 0) return null;

  const universe = packet.readUInt16BE(113);
  if (universe < 1 || universe > 63999) return null;
  const levels = new Uint8Array(UNIVERSE_SIZE);
  levels.set(packet.subarray(126, 125 + propertyCount));
  return {
    cid: packet.subarray(22, 38).toString("hex"),
    sourceName: packet.subarray(44, 108).toString("utf8").replace(/\0.*$/s, ""),
    priority: packet[108]!,
    sequence: packet[111]!,
    universe,
    levels,
    terminated: (packet[112]! & 0x40) !== 0,
  };
}

function writeFlagsLength(packet: Buffer, offset: number, length: number): void {
  packet.writeUInt16BE(0x7000 | length, offset);
}
