import * as SecureStore from 'expo-secure-store';

import { logger } from '@core/logging/logger';

/**
 * Keychain/Keystore-backed key/value storage.
 *
 * SecureStore values are size-limited (~2KB on Android). Supabase sessions can exceed
 * that, so this adapter transparently chunks large values across multiple secured keys
 * and reassembles them on read. Used as the Supabase auth storage backend.
 *
 * WRITES ARE CRASH-SAFE. A value lives in one of two slots; a write fills the
 * slot that is NOT live and then flips a single pointer key to it. Until that
 * one write lands, a read still returns the previous value in full. The earlier
 * version deleted the old value first and wrote the new chunks after, so an app
 * killed in between — Android does this routinely while backgrounding, which is
 * exactly when the token refreshes — lost the session and signed the user out.
 */
const CHUNK_SIZE = 1800;
const POINTER_SUFFIX = '__ptr';
/** Layout used before the pointer existed. Read once, then replaced on the next write. */
const LEGACY_COUNT_SUFFIX = '__chunks';

type Slot = 'a' | 'b';

interface Pointer {
  slot: Slot;
  count: number;
}

function chunkKey(key: string, slot: Slot, index: number): string {
  return `${key}__${slot}${index}`;
}

function legacyChunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

async function readPointer(key: string): Promise<Pointer | null> {
  const raw = await SecureStore.getItemAsync(`${key}${POINTER_SUFFIX}`);
  if (!raw) return null;
  const [slot, countRaw] = raw.split(':');
  const count = Number.parseInt(countRaw ?? '', 10);
  if ((slot !== 'a' && slot !== 'b') || !Number.isFinite(count) || count < 1) return null;
  return { slot, count };
}

async function readLegacyCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${key}${LEGACY_COUNT_SUFFIX}`);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readChunks(keys: string[]): Promise<string | null> {
  const parts: string[] = [];
  for (const chunk of keys) {
    const part = await SecureStore.getItemAsync(chunk);
    if (part === null) return null; // corrupt/partial — treat as absent
    parts.push(part);
  }
  return parts.join('');
}

async function removeLegacy(key: string): Promise<void> {
  const count = await readLegacyCount(key);
  await SecureStore.deleteItemAsync(key);
  await SecureStore.deleteItemAsync(`${key}${LEGACY_COUNT_SUFFIX}`);
  for (let i = 0; i < count; i += 1) {
    await SecureStore.deleteItemAsync(legacyChunkKey(key, i));
  }
}

/** Deletes a slot's chunks from `from` upward, stopping at the first gap. */
async function removeSlotFrom(key: string, slot: Slot, from: number): Promise<void> {
  for (let i = from; (await SecureStore.getItemAsync(chunkKey(key, slot, i))) !== null; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, slot, i));
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const pointer = await readPointer(key);
      if (pointer) {
        const keys = Array.from({ length: pointer.count }, (_, i) => chunkKey(key, pointer.slot, i));
        return await readChunks(keys);
      }

      const legacyCount = await readLegacyCount(key);
      if (legacyCount === 0) {
        // Either unset, or stored as a single small value under the bare key.
        return await SecureStore.getItemAsync(key);
      }
      return await readChunks(
        Array.from({ length: legacyCount }, (_, i) => legacyChunkKey(key, i)),
      );
    } catch (cause) {
      // The Android Keystore can refuse to decrypt after a device restore or a
      // lock-screen change. Unreadable is the same as absent to the caller; a
      // throw here used to leave the app on its splash screen for good.
      logger.error('Secure storage read failed', { error: message(cause) });
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readPointer(key);
    const slot: Slot = previous?.slot === 'a' ? 'b' : 'a';
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));

    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, slot, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    // The commit point. Everything before it is invisible to a reader.
    await SecureStore.setItemAsync(`${key}${POINTER_SUFFIX}`, `${slot}:${count}`);

    // The value is safely stored; failing to tidy up must not fail the write.
    try {
      // Left behind if an earlier, longer write to this slot never committed.
      await removeSlotFrom(key, slot, count);
      if (previous) await removeSlotFrom(key, previous.slot, 0);
      await removeLegacy(key);
    } catch (cause) {
      logger.warn('Secure storage cleanup failed', { error: message(cause) });
    }
  },

  async removeItem(key: string): Promise<void> {
    // Pointer first: once it is gone the value is gone, whatever happens next.
    await SecureStore.deleteItemAsync(`${key}${POINTER_SUFFIX}`);
    await removeSlotFrom(key, 'a', 0);
    await removeSlotFrom(key, 'b', 0);
    await removeLegacy(key);
  },
};
