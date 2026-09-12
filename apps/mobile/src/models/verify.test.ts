import { expect, it, vi } from 'vitest';
import { verifyModelBytes, isGgufHeader } from './verify';

function fixture() {
  const bytes = new Uint8Array(600_000);
  bytes.set([71, 71, 85, 70, 3, 0, 0, 0]);
  // Independently computed with Node's crypto SHA-256 implementation.
  const expected = {
    bytes: bytes.length,
    sha256: 'a7459b63de5b514f2310d44150e7648cead4cb182ad6d0228bcadeb9ff57234f',
  };
  let offset = 0;
  const reader = {
    readBytes: vi.fn((length: number) => {
      const chunk = bytes.slice(offset, offset + length);
      offset += chunk.length;
      return chunk;
    }),
  };
  return { reader, expected };
}

it('verifies the publisher checksum with bounded reads and incremental progress', async () => {
  const { reader, expected } = fixture();
  const progress = vi.fn();
  await verifyModelBytes(reader, expected, new AbortController().signal, progress);
  expect(progress).toHaveBeenLastCalledWith(expected.bytes);
  expect(reader.readBytes).toHaveBeenCalledTimes(3);
  expect(Math.max(...reader.readBytes.mock.calls.map(([length]) => length))).toBe(256 * 1024);
});
it('rejects a same-size corrupted file', async () => {
  const { reader, expected } = fixture();
  expected.sha256 = '0'.repeat(64);
  await expect(
    verifyModelBytes(reader, expected, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/checksum/);
});
it('rejects HTML/error bodies and unsupported GGUF versions', () => {
  expect(isGgufHeader(new TextEncoder().encode('<html>error'))).toBe(false);
  expect(isGgufHeader(new Uint8Array([71, 71, 85, 70, 99, 0, 0, 0]))).toBe(false);
  expect(isGgufHeader(new Uint8Array([71, 71, 85, 70, 2, 0, 0, 0]))).toBe(true);
});
it('rejects a truncated reader', async () => {
  const { reader, expected } = fixture();
  expected.bytes += 1;
  await expect(
    verifyModelBytes(reader, expected, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/incomplete/);
});
it('allows cancellation between chunks before publishing a digest', async () => {
  const { reader, expected } = fixture();
  const controller = new AbortController();
  await expect(
    verifyModelBytes(reader, expected, controller.signal, () => controller.abort()),
  ).rejects.toThrow(/cancelled/);
  expect(reader.readBytes).toHaveBeenCalledTimes(1);
});
