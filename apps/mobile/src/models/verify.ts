import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export function isGgufHeader(header: Uint8Array): boolean {
  return (
    header.length >= 8 &&
    header[0] === 71 &&
    header[1] === 71 &&
    header[2] === 85 &&
    header[3] === 70 &&
    (header[4] === 2 || header[4] === 3) &&
    header[5] === 0 &&
    header[6] === 0 &&
    header[7] === 0
  );
}

// Bounded memory, with a yield between chunks so large models don't freeze the
// UI or prevent cancellation. Never materialize a complete GGUF in JS memory.
export async function verifyModelBytes(
  reader: { readBytes(length: number): Uint8Array },
  expected: { bytes: number; sha256: string },
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  const hash = sha256.create();
  let read = 0;
  try {
    while (read < expected.bytes) {
      if (signal.aborted) throw new Error('Verification cancelled.');
      const chunk = reader.readBytes(Math.min(256 * 1024, expected.bytes - read));
      if (!chunk.length) throw new Error('The model download is incomplete. Please retry.');
      if (read === 0 && !isGgufHeader(chunk))
        throw new Error('The download is not a supported GGUF model. Please retry.');
      hash.update(chunk);
      read += chunk.length;
      progress(read);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (signal.aborted) throw new Error('Verification cancelled.');
    if (bytesToHex(hash.digest()) !== expected.sha256)
      throw new Error('The model checksum does not match. Please download it again.');
  } finally {
    hash.destroy();
  }
}
