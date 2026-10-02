export type OscValue = number | string | boolean | null;

export interface OscMessage {
  address: string;
  args: OscValue[];
}

export function decodeOscPacket(packet: Buffer): OscMessage[] {
  if (packet.length >= 8 && packet.subarray(0, 8).toString("ascii") === "#bundle\0") {
    if (packet.length < 16) throw new Error("OSC bundle is missing its time tag");
    const messages: OscMessage[] = [];
    let offset = 16;
    while (offset < packet.length) {
      if (offset + 4 > packet.length) throw new Error("Truncated OSC bundle element size");
      const elementLength = packet.readInt32BE(offset);
      offset += 4;
      if (elementLength <= 0 || offset + elementLength > packet.length) {
        throw new Error("Invalid OSC bundle element length");
      }
      messages.push(...decodeOscPacket(packet.subarray(offset, offset + elementLength)));
      offset += elementLength;
    }
    return messages;
  }

  let offset = 0;
  const addressResult = readOscString(packet, offset);
  const address = addressResult.value;
  offset = addressResult.next;
  if (!address.startsWith("/")) throw new Error("OSC address must start with '/'");
  const typeResult = readOscString(packet, offset);
  offset = typeResult.next;
  if (!typeResult.value.startsWith(",")) throw new Error("OSC typetag is missing its comma");

  const args: OscValue[] = [];
  for (const type of typeResult.value.slice(1)) {
    switch (type) {
      case "i":
        requireBytes(packet, offset, 4);
        args.push(packet.readInt32BE(offset));
        offset += 4;
        break;
      case "f":
        requireBytes(packet, offset, 4);
        args.push(packet.readFloatBE(offset));
        offset += 4;
        break;
      case "d":
        requireBytes(packet, offset, 8);
        args.push(packet.readDoubleBE(offset));
        offset += 8;
        break;
      case "s": {
        const value = readOscString(packet, offset);
        args.push(value.value);
        offset = value.next;
        break;
      }
      case "T":
        args.push(true);
        break;
      case "F":
        args.push(false);
        break;
      case "N":
        args.push(null);
        break;
      default:
        throw new Error(`Unsupported OSC argument type '${type}'`);
    }
  }
  if (offset !== packet.length) throw new Error("OSC message contains trailing data");
  return [{ address, args }];
}

export function encodeOscMessage(address: string, args: OscValue[] = []): Buffer {
  if (!address.startsWith("/")) throw new Error("OSC address must start with '/'");
  const types: string[] = [];
  const values: Buffer[] = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      types.push("s");
      values.push(encodeOscString(arg));
    } else if (typeof arg === "boolean") {
      types.push(arg ? "T" : "F");
    } else if (arg === null) {
      types.push("N");
    } else if (Number.isInteger(arg) && arg >= -2147483648 && arg <= 2147483647) {
      types.push("i");
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(arg);
      values.push(buffer);
    } else {
      if (!Number.isFinite(arg)) throw new Error("OSC numeric arguments must be finite");
      types.push("f");
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(arg);
      values.push(buffer);
    }
  }
  return Buffer.concat([
    encodeOscString(address),
    encodeOscString(`,${types.join("")}`),
    ...values,
  ]);
}

function readOscString(
  packet: Buffer,
  offset: number,
): { value: string; next: number } {
  const end = packet.indexOf(0, offset);
  if (end < 0) throw new Error("OSC string is not null-terminated");
  const next = (end + 4) & ~3;
  if (next > packet.length) throw new Error("OSC string padding exceeds packet length");
  return { value: packet.toString("utf8", offset, end), next };
}

function encodeOscString(value: string): Buffer {
  const content = Buffer.from(`${value}\0`, "utf8");
  const paddedLength = (content.length + 3) & ~3;
  const output = Buffer.alloc(paddedLength);
  content.copy(output);
  return output;
}

function requireBytes(packet: Buffer, offset: number, count: number): void {
  if (offset + count > packet.length) throw new Error("Truncated OSC argument");
}
