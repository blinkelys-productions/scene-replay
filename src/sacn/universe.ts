import { UNIVERSE_SIZE } from "../config/types.js";

export function sacnMulticastAddress(universe: number): string {
  if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
    throw new Error("sACN universe must be an integer from 1 to 63999");
  }
  return `239.255.${universe >> 8}.${universe & 0xff}`;
}

export function validateLevels(levels: Uint8Array): void {
  if (levels.length !== UNIVERSE_SIZE) {
    throw new Error(`DMX output must contain exactly ${UNIVERSE_SIZE} channel levels`);
  }
}
