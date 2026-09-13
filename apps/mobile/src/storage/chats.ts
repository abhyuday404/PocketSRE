import { File, Paths } from 'expo-file-system';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import type { AgentTask } from '@pocketsre/contracts';
export type ChatSnapshot = { conversation: AgentTask['history']; request: string; paths: string[] };
export type SavedChat = ChatSnapshot & { id: string; title: string; updatedAt: string };
const hash = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}
function validChat(value: unknown): value is SavedChat {
  if (!value || typeof value !== 'object') return false;
  const c = value as SavedChat;
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.updatedAt === 'string' &&
    Number.isFinite(Date.parse(c.updatedAt)) &&
    typeof c.request === 'string' &&
    Array.isArray(c.paths) &&
    c.paths.every((p) => typeof p === 'string') &&
    Array.isArray(c.conversation) &&
    c.conversation.every(
      (t) => t && ['user', 'assistant'].includes(t.role) && typeof t.content === 'string',
    )
  );
}
async function load(scope: string) {
  const key = await hash(scope);
  const files = [0, 1].map(
    (slot) => new File(Paths.document, `pocketsre-chats-${key}-${slot}.json`),
  );
  const candidates: { revision: number; chats: SavedChat[]; slot: number }[] = [];
  let exists = false;
  for (const [slot, file] of files.entries()) {
    if (!file.exists) continue;
    exists = true;
    try {
      const envelope = JSON.parse(await file.text());
      if (
        typeof envelope.payload !== 'string' ||
        (await hash(envelope.payload)) !== envelope.checksum
      )
        continue;
      const data = JSON.parse(envelope.payload);
      if (
        data.scope !== scope ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 0 ||
        !Array.isArray(data.chats) ||
        !data.chats.every(validChat)
      )
        continue;
      candidates.push({ revision: data.revision, chats: data.chats, slot });
    } catch {
      /* Try the other verified copy. */
    }
  }
  const latest = candidates.sort((a, b) => b.revision - a.revision)[0];
  if (!latest && exists)
    throw new Error('Saved chats could not be read. Existing history has been kept intact.');
  return {
    files,
    revision: latest?.revision ?? 0,
    chats: latest?.chats ?? [],
    slot: latest?.slot ?? 1,
  };
}
async function update(scope: string, change: (chats: SavedChat[]) => SavedChat[]) {
  const store = await load(scope);
  const chats = change(store.chats).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const payload = JSON.stringify({ scope, revision: store.revision + 1, chats });
  const content = JSON.stringify({ payload, checksum: await hash(payload) });
  const file = store.files[1 - store.slot]!;
  file.write(content);
  if ((await file.text()) !== content) throw new Error('Could not verify saved chats. Try again.');
  return chats;
}
export function readChats(scope: string) {
  return serial(async () => (await load(scope)).chats);
}
export function saveChat(scope: string, chat: SavedChat) {
  return serial(() => update(scope, (chats) => [chat, ...chats.filter((c) => c.id !== chat.id)]));
}
