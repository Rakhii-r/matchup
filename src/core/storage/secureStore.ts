import * as SecureStore from 'expo-secure-store';

/**
 * Keychain/Keystore-backed key/value storage.
 *
 * SecureStore values are size-limited (~2KB on Android). Supabase sessions can exceed
 * that, so this adapter transparently chunks large values across multiple secured keys
 * and reassembles them on read. Used as the Supabase auth storage backend.
 */
const CHUNK_SIZE = 1800;
const COUNT_SUFFIX = '__chunks';

function chunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

async function getChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${key}${COUNT_SUFFIX}`);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await getChunkCount(key);
    if (count === 0) {
      // Either unset, or stored as a single small value under the bare key.
      return SecureStore.getItemAsync(key);
    }
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null; // corrupt/partial — treat as absent
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const chunks = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < chunks; i += 1) {
      const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await SecureStore.setItemAsync(chunkKey(key, i), slice);
    }
    await SecureStore.setItemAsync(`${key}${COUNT_SUFFIX}`, String(chunks));
  },

  async removeItem(key: string): Promise<void> {
    const count = await getChunkCount(key);
    await SecureStore.deleteItemAsync(key);
    await SecureStore.deleteItemAsync(`${key}${COUNT_SUFFIX}`);
    for (let i = 0; i < count; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  },
};
