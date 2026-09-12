import { vi } from 'vitest';

const storage = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failWrite: null as 'truncate' | 'throw' | null,
  failRead: new Set<string>(),
  failDelete: new Set<string>(),
}));
export const disk = storage;

vi.mock('expo-file-system', () => ({
  Paths: { document: '/private', cache: '/cache' },
  File: class {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    get exists() {
      return disk.files.has(this.uri);
    }
    get size() {
      return disk.files.get(this.uri)?.length ?? 0;
    }
    async text() {
      if (disk.failRead.has(this.uri)) throw new Error('Storage unavailable');
      return disk.files.get(this.uri) ?? '';
    }
    create() {
      disk.files.set(this.uri, '');
    }
    write(value: string) {
      const failure = disk.failWrite;
      disk.failWrite = null;
      if (failure === 'truncate') disk.files.set(this.uri, value.slice(0, value.length / 2));
      if (failure) throw new Error('Disk full');
      disk.files.set(this.uri, value);
    }
    delete() {
      if (disk.failDelete.has(this.uri)) throw new Error('Delete unavailable');
      disk.files.delete(this.uri);
    }
  },
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, input: string) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  },
  randomUUID: () => crypto.randomUUID(),
}));

export function resetDisk() {
  disk.files.clear();
  disk.failWrite = null;
  disk.failRead.clear();
  disk.failDelete.clear();
}
