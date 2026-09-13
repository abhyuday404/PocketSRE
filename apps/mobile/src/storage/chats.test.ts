import { beforeEach, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-file-system', () => ({
  Paths: { document: 'documents' },
  File: class {
    name: string;
    constructor(_root: string, name: string) {
      this.name = name;
    }
    get exists() {
      return disk.has(this.name);
    }
    async text() {
      return disk.get(this.name)!;
    }
    write(value: string) {
      disk.set(this.name, value);
    }
  },
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_algorithm: string, value: string) => `test-digest:${value}`,
}));
import { readChats, saveChat, type SavedChat } from './chats';
const chat = (id: string): SavedChat => ({
  id,
  title: id,
  updatedAt: '2026-09-13T01:00:00.000Z',
  conversation: [{ role: 'user', content: 'Explain source' }],
  request: 'Follow up',
  paths: ['src/main.ts'],
});
beforeEach(() => disk.clear());
it('isolates projects and retains separate conversations through concurrent saves', async () => {
  await Promise.all([
    saveChat('project-A', chat('one')),
    saveChat('project-A', chat('two')),
    saveChat('project-B', chat('private')),
  ]);
  expect((await readChats('project-A')).map((c) => c.id).sort()).toEqual(['one', 'two']);
  expect((await readChats('project-B')).map((c) => c.id)).toEqual(['private']);
  await saveChat('project-A', { ...chat('one'), request: 'Updated' });
  expect((await readChats('project-A')).find((c) => c.id === 'one')?.request).toBe('Updated');
});
it('recovers the previous verified copy when a write is damaged and refuses to overwrite fully damaged history', async () => {
  await saveChat('A', chat('one'));
  await saveChat('A', chat('two'));
  const newest = [...disk.keys()].find((key) => key.endsWith('-1.json'))!;
  disk.set(newest, 'interrupted write');
  expect((await readChats('A')).map((c) => c.id)).toEqual(['one']);
  for (const key of disk.keys()) disk.set(key, 'broken');
  await expect(saveChat('A', chat('three'))).rejects.toThrow('kept intact');
  expect([...disk.values()]).toEqual(['broken', 'broken']);
});
it('keeps the full transcript instead of the old twelve-message window', async () => {
  const value = {
    ...chat('long'),
    conversation: Array.from({ length: 40 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i}`,
    })),
  };
  await saveChat('A', value);
  expect((await readChats('A'))[0]?.conversation).toHaveLength(40);
});
