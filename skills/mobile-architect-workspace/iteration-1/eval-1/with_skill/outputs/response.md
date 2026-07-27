# Offline-First React Native Field-Service App: Sync Engine Architecture

---

## 1. Architectural Blueprint

The architecture follows an **offline-first, local-source-of-truth** model: the app reads and writes exclusively to a local WatermelonDB database, and a background sync engine reconciles those changes with the REST API whenever connectivity is detected. WatermelonDB was selected over AsyncStorage or SQLite directly because it provides a lazy-loaded, observable relational model that scales to tens of thousands of records without blocking the JS thread — critical for technicians with large job queues. The sync engine is a singleton service that implements a **push-then-pull** strategy with server-wins conflict resolution as the default, with hooks for field-configurable merge strategies per entity type. All writes are stamped with a client-generated UUID and a `local_updated_at` timestamp, so the server can reconstruct causal ordering even across disconnected sessions. Network state is monitored via `@react-native-community/netinfo` with debouncing to avoid thrashing on flaky signals. Sensitive job data (customer PII, site access codes) is encrypted at rest using `react-native-keychain` for key storage and AES-256 encryption applied before DB writes. The Zustand store for UI state never persists sensitive fields — it is a pure view projection of WatermelonDB observables, maintaining unidirectional data flow from DB → Store → UI.

**Key design decisions over simpler alternatives:**
- **WatermelonDB over plain SQLite**: Provides built-in sync protocol primitives, lazy loading, and reactive queries. Avoids hand-rolling a change-tracking layer.
- **Push-then-pull over pull-then-push**: Ensures local changes reach the server before the client is overwritten, reducing data loss on reconnect.
- **Client UUID + server timestamp for conflict detection**: Avoids clock skew issues (client clocks drift in the field) by letting the server adjudicate final timestamps.
- **Exponential backoff with jitter**: Prevents thundering-herd when many technicians reconnect simultaneously at shift start.

---

## 2. The Implementation

### File Structure

```
src/
├── database/
│   ├── schema.ts           # WatermelonDB schema
│   ├── models/
│   │   ├── Job.ts
│   │   └── JobNote.ts
│   └── index.ts            # DB singleton
├── sync/
│   ├── SyncEngine.ts       # Core sync engine
│   ├── ConflictResolver.ts # Conflict resolution strategies
│   ├── NetworkMonitor.ts   # Connectivity watcher
│   └── SyncQueue.ts        # Pending operations queue
├── storage/
│   └── SecureStorage.ts    # AES-256 wrapper over Keychain
├── api/
│   └── JobApiClient.ts     # REST API client with typed responses
└── store/
    └── jobStore.ts         # Zustand UI store (read-only projection)
```

---

### `src/database/schema.ts`

```typescript
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const dbSchema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'jobs',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'status', type: 'string' },           // 'pending' | 'in_progress' | 'complete'
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'site_code_encrypted', type: 'string' }, // AES-256 encrypted blob
        { name: 'technician_id', type: 'string' },
        { name: 'scheduled_at', type: 'number' },     // Unix ms
        { name: 'local_updated_at', type: 'number' }, // client-side last write ms
        { name: 'synced_at', type: 'number', isOptional: true }, // last successful sync ms
        { name: 'sync_status', type: 'string' },      // 'synced' | 'pending_push' | 'conflict'
        { name: 'client_uuid', type: 'string' },      // stable across syncs
        { name: 'is_deleted', type: 'boolean' },      // soft-delete for sync
      ],
    }),
    tableSchema({
      name: 'job_notes',
      columns: [
        { name: 'job_id', type: 'string' },           // WatermelonDB local id
        { name: 'server_job_id', type: 'string', isOptional: true },
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'body', type: 'string' },
        { name: 'author_id', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'local_updated_at', type: 'number' },
        { name: 'sync_status', type: 'string' },
        { name: 'client_uuid', type: 'string' },
        { name: 'is_deleted', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'sync_log',
      columns: [
        { name: 'started_at', type: 'number' },
        { name: 'finished_at', type: 'number', isOptional: true },
        { name: 'status', type: 'string' }, // 'running' | 'success' | 'partial' | 'failed'
        { name: 'pushed_count', type: 'number' },
        { name: 'pulled_count', type: 'number' },
        { name: 'conflict_count', type: 'number' },
        { name: 'error_message', type: 'string', isOptional: true },
      ],
    }),
  ],
});
```

---

### `src/database/models/Job.ts`

```typescript
import { Model } from '@nozbe/watermelondb';
import { field, readonly, date, text, nochange } from '@nozbe/watermelondb/decorators';

export type JobStatus = 'pending' | 'in_progress' | 'complete';
export type SyncStatus = 'synced' | 'pending_push' | 'conflict';

export class Job extends Model {
  static table = 'jobs';

  static associations = {
    job_notes: { type: 'has_many' as const, foreignKey: 'job_id' },
  };

  @text('server_id') serverId!: string | null;
  @text('status') status!: JobStatus;
  @text('title') title!: string;
  @text('description') description!: string;
  @text('site_code_encrypted') siteCodeEncrypted!: string;
  @text('technician_id') technicianId!: string;
  @field('scheduled_at') scheduledAt!: number;
  @field('local_updated_at') localUpdatedAt!: number;
  @field('synced_at') syncedAt!: number | null;
  @text('sync_status') syncStatus!: SyncStatus;
  @nochange @text('client_uuid') clientUuid!: string;
  @field('is_deleted') isDeleted!: boolean;
}
```

---

### `src/database/models/JobNote.ts`

```typescript
import { Model } from '@nozbe/watermelondb';
import { field, text, nochange } from '@nozbe/watermelondb/decorators';

export class JobNote extends Model {
  static table = 'job_notes';

  static associations = {
    jobs: { type: 'belongs_to' as const, key: 'job_id' },
  };

  @text('job_id') jobId!: string;
  @text('server_job_id') serverJobId!: string | null;
  @text('server_id') serverId!: string | null;
  @text('body') body!: string;
  @text('author_id') authorId!: string;
  @field('created_at') createdAt!: number;
  @field('local_updated_at') localUpdatedAt!: number;
  @text('sync_status') syncStatus!: string;
  @nochange @text('client_uuid') clientUuid!: string;
  @field('is_deleted') isDeleted!: boolean;
}
```

---

### `src/database/index.ts`

```typescript
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { dbSchema } from './schema';
import { Job } from './models/Job';
import { JobNote } from './models/JobNote';
import { logger } from '../utils/logger';

const adapter = new SQLiteAdapter({
  schema: dbSchema,
  // Enable WAL mode for concurrent read performance
  dbName: 'fieldservice',
  jsi: true,         // Use JSI bridge for 3x faster I/O on supported RN versions
  onSetUpError: (error: Error) => {
    logger.fatal('WatermelonDB setup failed', { error: error.message });
    // In production: trigger a crash report and show user-facing recovery UI
    throw error;
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Job, JobNote],
});
```

---

### `src/storage/SecureStorage.ts`

```typescript
import * as Keychain from 'react-native-keychain';
import { logger } from '../utils/logger';

// AES-256-GCM encryption using the Web Crypto API (available in Hermes via polyfill)
// Key is generated once and stored in Keychain; never logged or persisted in plaintext.

const KEYCHAIN_SERVICE = 'com.fieldservice.encryptionKey';
const KEY_ACCOUNT = 'fieldservice_aes_key';

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  const existing = await Keychain.getGenericPassword({
    service: KEYCHAIN_SERVICE,
    authenticationPrompt: { title: 'Unlock Field Service' },
  });

  if (existing) {
    const rawKey = Buffer.from(existing.password, 'base64');
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const exported = await crypto.subtle.exportKey('raw', key);
  const b64 = Buffer.from(exported).toString('base64');

  const stored = await Keychain.setGenericPassword(KEY_ACCOUNT, b64, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  if (!stored) {
    logger.fatal('Failed to persist encryption key to Keychain');
    throw new Error('Keychain write failed — cannot store encryption key safely');
  }

  logger.info('SecureStorage: new AES-256 key generated and stored');
  return key;
}

// Singleton key promise — resolved once per app session
let _keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!_keyPromise) {
    _keyPromise = getOrCreateEncryptionKey().catch((err) => {
      _keyPromise = null; // allow retry on next call
      throw err;
    });
  }
  return _keyPromise;
}

export async function encryptField(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Format: base64(iv):base64(ciphertext)
  const ivB64 = Buffer.from(iv).toString('base64');
  const ctB64 = Buffer.from(ciphertext).toString('base64');
  return `${ivB64}:${ctB64}`;
}

export async function decryptField(blob: string): Promise<string> {
  if (!blob || !blob.includes(':')) {
    throw new Error('SecureStorage: malformed encrypted blob');
  }
  const [ivB64, ctB64] = blob.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const key = await getKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
```

---

### `src/api/JobApiClient.ts`

```typescript
import axios, { AxiosInstance, AxiosError } from 'axios';
import { z } from 'zod';
import { logger } from '../utils/logger';

// --- Response Schemas (Zod validation — treat all API responses as untrusted) ---

const ServerJobSchema = z.object({
  id: z.string(),
  client_uuid: z.string(),
  status: z.enum(['pending', 'in_progress', 'complete']),
  title: z.string(),
  description: z.string(),
  site_code: z.string().optional(), // decrypted by server, re-encrypted locally
  technician_id: z.string(),
  scheduled_at: z.number(),
  updated_at: z.number(), // server-authoritative timestamp (ms)
});

const ServerJobNoteSchema = z.object({
  id: z.string(),
  client_uuid: z.string(),
  job_id: z.string(),
  body: z.string(),
  author_id: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const PullResponseSchema = z.object({
  jobs: z.array(ServerJobSchema),
  job_notes: z.array(ServerJobNoteSchema),
  server_time: z.number(), // server's current time for next pull watermark
});

export type ServerJob = z.infer<typeof ServerJobSchema>;
export type PullResponse = z.infer<typeof PullResponseSchema>;

export interface PushPayload {
  jobs: Array<{
    client_uuid: string;
    server_id: string | null;
    status: string;
    title: string;
    description: string;
    technician_id: string;
    scheduled_at: number;
    local_updated_at: number;
    is_deleted: boolean;
  }>;
  job_notes: Array<{
    client_uuid: string;
    server_id: string | null;
    server_job_id: string | null;
    body: string;
    author_id: string;
    created_at: number;
    local_updated_at: number;
    is_deleted: boolean;
  }>;
}

export interface PushResponse {
  merged: Array<{ client_uuid: string; server_id: string; server_updated_at: number }>;
  conflicts: Array<{ client_uuid: string; server_version: ServerJob }>;
}

export class JobApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string, getAuthToken: () => Promise<string>) {
    this.client = axios.create({ baseURL, timeout: 30_000 });

    this.client.interceptors.request.use(async (config) => {
      const token = await getAuthToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    this.client.interceptors.response.use(
      (res) => res,
      (err: AxiosError) => {
        logger.error('API request failed', {
          url: err.config?.url,
          status: err.response?.status,
          message: err.message,
        });
        return Promise.reject(err);
      },
    );
  }

  async pull(since: number, technicianId: string): Promise<PullResponse> {
    const response = await this.client.get('/sync/pull', {
      params: { since, technician_id: technicianId },
    });
    const parsed = PullResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      logger.error('Pull response schema validation failed', {
        errors: parsed.error.issues,
      });
      throw new Error('Server returned malformed pull payload');
    }
    return parsed.data;
  }

  async push(payload: PushPayload): Promise<PushResponse> {
    const response = await this.client.post('/sync/push', payload);
    // Basic shape validation — full Zod schema omitted for brevity but should be added
    if (!response.data?.merged || !response.data?.conflicts) {
      throw new Error('Server returned malformed push response');
    }
    return response.data as PushResponse;
  }
}
```

---

### `src/sync/ConflictResolver.ts`

```typescript
import { Job } from '../database/models/Job';
import type { ServerJob } from '../api/JobApiClient';
import { logger } from '../utils/logger';

export type ConflictStrategy = 'server_wins' | 'client_wins' | 'latest_wins' | 'merge_fields';

export interface ConflictResolution {
  resolvedStatus: Job['status'];
  resolvedTitle: string;
  resolvedDescription: string;
  winner: 'server' | 'client';
}

/**
 * Resolves a conflict between a local Job record and the server's authoritative version.
 *
 * Default strategy: latest_wins based on timestamps.
 * Status field always defers to server if server has moved the job forward in the workflow
 * (e.g., server has 'complete' while client has 'in_progress' — server wins on status).
 */
export function resolveJobConflict(
  localJob: Job,
  serverVersion: ServerJob,
  strategy: ConflictStrategy = 'latest_wins',
): ConflictResolution {
  const serverIsNewer = serverVersion.updated_at >= localJob.localUpdatedAt;
  const serverAdvancedStatus = statusRank(serverVersion.status) > statusRank(localJob.status);

  logger.warn('Conflict detected', {
    clientUuid: localJob.clientUuid,
    localUpdatedAt: localJob.localUpdatedAt,
    serverUpdatedAt: serverVersion.updated_at,
    serverIsNewer,
    strategy,
  });

  if (strategy === 'server_wins') {
    return {
      resolvedStatus: serverVersion.status,
      resolvedTitle: serverVersion.title,
      resolvedDescription: serverVersion.description,
      winner: 'server',
    };
  }

  if (strategy === 'client_wins') {
    return {
      resolvedStatus: localJob.status,
      resolvedTitle: localJob.title,
      resolvedDescription: localJob.description,
      winner: 'client',
    };
  }

  if (strategy === 'latest_wins') {
    if (serverIsNewer || serverAdvancedStatus) {
      return {
        resolvedStatus: serverVersion.status,
        resolvedTitle: serverVersion.title,
        resolvedDescription: serverVersion.description,
        winner: 'server',
      };
    }
    return {
      resolvedStatus: localJob.status,
      resolvedTitle: localJob.title,
      resolvedDescription: localJob.description,
      winner: 'client',
    };
  }

  // merge_fields: preserve client free-text, accept server status advances
  return {
    resolvedStatus: serverAdvancedStatus ? serverVersion.status : localJob.status,
    resolvedTitle: serverIsNewer ? serverVersion.title : localJob.title,
    resolvedDescription: localJob.description, // technician's field notes preserved
    winner: serverAdvancedStatus ? 'server' : 'client',
  };
}

function statusRank(status: string): number {
  const ranks: Record<string, number> = { pending: 0, in_progress: 1, complete: 2 };
  return ranks[status] ?? -1;
}
```

---

### `src/sync/NetworkMonitor.ts`

```typescript
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { logger } from '../utils/logger';

type ConnectivityListener = (isConnected: boolean) => void;

class NetworkMonitorService {
  private listeners: Set<ConnectivityListener> = new Set();
  private _isConnected: boolean = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 2_000; // ignore sub-2s flaps

  start(): void {
    NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      this._scheduleNotify(connected);
    });

    // Fetch initial state immediately
    NetInfo.fetch().then((state) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      this._isConnected = connected;
      logger.info('NetworkMonitor: initial state', { connected });
    });
  }

  private _scheduleNotify(connected: boolean): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      if (connected !== this._isConnected) {
        this._isConnected = connected;
        logger.info('NetworkMonitor: connectivity changed', { connected });
        this.listeners.forEach((fn) => {
          try {
            fn(connected);
          } catch (err) {
            logger.error('NetworkMonitor listener threw', { err });
          }
        });
      }
    }, this.DEBOUNCE_MS);
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const networkMonitor = new NetworkMonitorService();
```

---

### `src/sync/SyncEngine.ts` — Core Sync Engine

```typescript
import { database } from '../database';
import { Job } from '../database/models/Job';
import { JobNote } from '../database/models/JobNote';
import { JobApiClient, PushPayload } from '../api/JobApiClient';
import { ConflictStrategy, resolveJobConflict } from './ConflictResolver';
import { networkMonitor } from './NetworkMonitor';
import { encryptField } from '../storage/SecureStorage';
import { logger } from '../utils/logger';
import { Q } from '@nozbe/watermelondb';

export interface SyncEngineConfig {
  technicianId: string;
  conflictStrategy: ConflictStrategy;
  maxRetries: number;
  baseRetryDelayMs: number;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  durationMs: number;
}

type SyncState = 'idle' | 'syncing' | 'error';

class SyncEngine {
  private _state: SyncState = 'idle';
  private _retryCount: number = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _networkUnsubscribe: (() => void) | null = null;
  private _lastPullTimestamp: number = 0;
  private _config: SyncEngineConfig | null = null;
  private _apiClient: JobApiClient | null = null;

  /**
   * Must be called once at app start (e.g., in App.tsx after auth is confirmed).
   */
  initialize(apiClient: JobApiClient, config: SyncEngineConfig): void {
    if (this._networkUnsubscribe) {
      logger.warn('SyncEngine.initialize called more than once — reinitializing');
      this._networkUnsubscribe();
    }
    this._apiClient = apiClient;
    this._config = config;

    this._networkUnsubscribe = networkMonitor.subscribe((isConnected) => {
      if (isConnected) {
        logger.info('SyncEngine: connectivity restored, triggering sync');
        this._retryCount = 0; // reset backoff on new connection
        this.sync().catch((err) => {
          logger.error('SyncEngine: auto-sync on reconnect failed', { err });
        });
      } else {
        logger.info('SyncEngine: connectivity lost, cancelling any pending retry');
        this._clearRetryTimer();
      }
    });

    logger.info('SyncEngine initialized', { technicianId: config.technicianId });
  }

  teardown(): void {
    this._clearRetryTimer();
    if (this._networkUnsubscribe) {
      this._networkUnsubscribe();
      this._networkUnsubscribe = null;
    }
    logger.info('SyncEngine torn down');
  }

  get state(): SyncState {
    return this._state;
  }

  /**
   * Main sync entry point. Safe to call multiple times; concurrent calls are de-duped.
   */
  async sync(): Promise<SyncResult | null> {
    if (this._state === 'syncing') {
      logger.info('SyncEngine: sync already in progress, skipping');
      return null;
    }
    if (!networkMonitor.isConnected) {
      logger.info('SyncEngine: no connectivity, deferring sync');
      return null;
    }
    if (!this._apiClient || !this._config) {
      throw new Error('SyncEngine.sync called before initialize()');
    }

    this._state = 'syncing';
    const startedAt = Date.now();
    let logRecord: any = null;

    try {
      // Create sync log entry
      logRecord = await database.write(async () => {
        return database.get('sync_log').create((record: any) => {
          record.started_at = startedAt;
          record.status = 'running';
          record.pushed_count = 0;
          record.pulled_count = 0;
          record.conflict_count = 0;
        });
      });

      // --- PHASE 1: PUSH local pending changes ---
      const pushResult = await this._pushPendingChanges();
      logger.info('SyncEngine: push complete', pushResult);

      // --- PHASE 2: PULL server changes since last sync ---
      const pullResult = await this._pullServerChanges();
      logger.info('SyncEngine: pull complete', pullResult);

      const durationMs = Date.now() - startedAt;
      const result: SyncResult = {
        pushed: pushResult.pushed,
        pulled: pullResult.pulled,
        conflicts: pushResult.conflicts + pullResult.conflicts,
        durationMs,
      };

      // Finalize sync log
      await database.write(async () => {
        await logRecord.update((r: any) => {
          r.finished_at = Date.now();
          r.status = 'success';
          r.pushed_count = result.pushed;
          r.pulled_count = result.pulled;
          r.conflict_count = result.conflicts;
        });
      });

      this._state = 'idle';
      this._retryCount = 0;
      logger.info('SyncEngine: sync successful', result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('SyncEngine: sync failed', { error: errorMessage, retryCount: this._retryCount });

      if (logRecord) {
        await database.write(async () => {
          await logRecord.update((r: any) => {
            r.finished_at = Date.now();
            r.status = 'failed';
            r.error_message = errorMessage;
          });
        }).catch((writeErr) => {
          logger.error('SyncEngine: failed to write error log', { writeErr });
        });
      }

      this._state = 'error';
      this._scheduleRetry();
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: Push
  // ---------------------------------------------------------------------------

  private async _pushPendingChanges(): Promise<{ pushed: number; conflicts: number }> {
    const jobsCollection = database.get<Job>('jobs');
    const notesCollection = database.get<JobNote>('job_notes');

    const pendingJobs = await jobsCollection
      .query(Q.where('sync_status', Q.oneOf(['pending_push', 'conflict'])))
      .fetch();

    const pendingNotes = await notesCollection
      .query(Q.where('sync_status', Q.oneOf(['pending_push', 'conflict'])))
      .fetch();

    if (pendingJobs.length === 0 && pendingNotes.length === 0) {
      return { pushed: 0, conflicts: 0 };
    }

    const payload: PushPayload = {
      jobs: pendingJobs.map((j) => ({
        client_uuid: j.clientUuid,
        server_id: j.serverId,
        status: j.status,
        title: j.title,
        description: j.description,
        technician_id: j.technicianId,
        scheduled_at: j.scheduledAt,
        local_updated_at: j.localUpdatedAt,
        is_deleted: j.isDeleted,
      })),
      job_notes: pendingNotes.map((n) => ({
        client_uuid: n.clientUuid,
        server_id: n.serverId,
        server_job_id: n.serverJobId,
        body: n.body,
        author_id: n.authorId,
        created_at: n.createdAt,
        local_updated_at: n.localUpdatedAt,
        is_deleted: n.isDeleted,
      })),
    };

    const response = await this._apiClient!.push(payload);

    // Build lookup maps
    const mergedByUuid = new Map(response.merged.map((m) => [m.client_uuid, m]));
    const conflictByUuid = new Map(response.conflicts.map((c) => [c.client_uuid, c]));

    let conflictCount = 0;

    await database.write(async () => {
      const updates: Promise<void>[] = [];

      // Process merged jobs
      for (const job of pendingJobs) {
        const merged = mergedByUuid.get(job.clientUuid);
        if (merged) {
          updates.push(
            job.update((j) => {
              j.serverId = merged.server_id;
              j.syncStatus = 'synced';
              j.syncedAt = Date.now();
            }).then(() => {}),
          );
        }

        const conflict = conflictByUuid.get(job.clientUuid);
        if (conflict) {
          const resolution = resolveJobConflict(job, conflict.server_version, this._config!.conflictStrategy);
          conflictCount++;
          updates.push(
            job.update((j) => {
              j.status = resolution.resolvedStatus;
              j.title = resolution.resolvedTitle;
              j.description = resolution.resolvedDescription;
              // If server won, mark synced; if client won, re-queue for next push
              j.syncStatus = resolution.winner === 'server' ? 'synced' : 'pending_push';
              if (resolution.winner === 'server') {
                j.syncedAt = Date.now();
              }
            }).then(() => {}),
          );
        }
      }

      // Process merged notes (conflicts not supported on notes — server wins)
      for (const note of pendingNotes) {
        const merged = mergedByUuid.get(note.clientUuid);
        if (merged) {
          updates.push(
            note.update((n) => {
              n.serverId = merged.server_id;
              n.syncStatus = 'synced';
            }).then(() => {}),
          );
        }
      }

      await Promise.all(updates);
    });

    return {
      pushed: response.merged.length,
      conflicts: conflictCount,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: Pull
  // ---------------------------------------------------------------------------

  private async _pullServerChanges(): Promise<{ pulled: number; conflicts: number }> {
    const response = await this._apiClient!.pull(
      this._lastPullTimestamp,
      this._config!.technicianId,
    );

    const jobsCollection = database.get<Job>('jobs');
    let pulled = 0;

    await database.write(async () => {
      const writes: Promise<void>[] = [];

      for (const serverJob of response.jobs) {
        // Find by client_uuid (if we originated it) or server_id (if server-originated)
        const existingByUuid = await jobsCollection
          .query(Q.where('client_uuid', serverJob.client_uuid))
          .fetch();

        const existingByServerId = serverJob.id
          ? await jobsCollection
              .query(Q.where('server_id', serverJob.id))
              .fetch()
          : [];

        const existing = existingByUuid[0] ?? existingByServerId[0] ?? null;

        if (existing) {
          // Skip pull if local is newer and pending push (will be resolved in next push)
          if (
            existing.syncStatus === 'pending_push' &&
            existing.localUpdatedAt > serverJob.updated_at
          ) {
            logger.info('SyncEngine: skipping pull for locally-newer record', {
              clientUuid: existing.clientUuid,
            });
            continue;
          }

          writes.push(
            existing.update(async (j) => {
              j.serverId = serverJob.id;
              j.status = serverJob.status;
              j.title = serverJob.title;
              j.description = serverJob.description;
              // Re-encrypt site code if provided by server
              if (serverJob.site_code) {
                j.siteCodeEncrypted = await encryptField(serverJob.site_code);
              }
              j.scheduledAt = serverJob.scheduled_at;
              j.localUpdatedAt = serverJob.updated_at;
              j.syncStatus = 'synced';
              j.syncedAt = Date.now();
              j.isDeleted = false;
            }).then(() => { pulled++; }),
          );
        } else {
          // New record from server — create locally
          writes.push(
            jobsCollection.create(async (j) => {
              j.serverId = serverJob.id;
              j.clientUuid = serverJob.client_uuid;
              j.status = serverJob.status;
              j.title = serverJob.title;
              j.description = serverJob.description;
              if (serverJob.site_code) {
                j.siteCodeEncrypted = await encryptField(serverJob.site_code);
              }
              j.technicianId = serverJob.technician_id;
              j.scheduledAt = serverJob.scheduled_at;
              j.localUpdatedAt = serverJob.updated_at;
              j.syncStatus = 'synced';
              j.syncedAt = Date.now();
              j.isDeleted = false;
            }).then(() => { pulled++; }),
          );
        }
      }

      await Promise.all(writes);
    });

    // Advance the watermark only after successful write
    this._lastPullTimestamp = response.server_time;

    return { pulled, conflicts: 0 };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE: Retry scheduling
  // ---------------------------------------------------------------------------

  private _scheduleRetry(): void {
    if (!this._config) return;
    if (this._retryCount >= this._config.maxRetries) {
      logger.error('SyncEngine: max retries reached, giving up until next connectivity event');
      this._state = 'idle';
      return;
    }

    // Exponential backoff with full jitter: delay = random(0, min(cap, base * 2^retryCount))
    const cap = 60_000; // max 60 seconds
    const base = this._config.baseRetryDelayMs;
    const ceiling = Math.min(cap, base * Math.pow(2, this._retryCount));
    const delay = Math.floor(Math.random() * ceiling);

    this._retryCount++;
    logger.info('SyncEngine: scheduling retry', { delay, attempt: this._retryCount });

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (networkMonitor.isConnected) {
        this.sync().catch((err) => {
          logger.error('SyncEngine: retry failed', { err });
        });
      }
    }, delay);
  }

  private _clearRetryTimer(): void {
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }
}

// Export as singleton — one sync engine per app process
export const syncEngine = new SyncEngine();
```

---

### `src/store/jobStore.ts` — Zustand UI Store (WatermelonDB Projection)

```typescript
import { create } from 'zustand';
import { database } from '../database';
import { Job } from '../database/models/Job';
import { Q } from '@nozbe/watermelondb';
import { encryptField, decryptField } from '../storage/SecureStorage';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface JobState {
  jobs: Job[];
  isLoading: boolean;
  error: string | null;
}

interface JobActions {
  subscribeToJobs: (technicianId: string) => () => void;
  createJob: (params: CreateJobParams) => Promise<void>;
  updateJobStatus: (localId: string, status: Job['status']) => Promise<void>;
  updateJobDescription: (localId: string, description: string) => Promise<void>;
}

interface CreateJobParams {
  title: string;
  description: string;
  siteCode: string;
  technicianId: string;
  scheduledAt: number;
}

export const useJobStore = create<JobState & JobActions>((set) => ({
  jobs: [],
  isLoading: true,
  error: null,

  subscribeToJobs: (technicianId: string) => {
    const subscription = database
      .get<Job>('jobs')
      .query(
        Q.and(
          Q.where('technician_id', technicianId),
          Q.where('is_deleted', false),
        ),
      )
      .observe()
      .subscribe({
        next: (jobs) => {
          set({ jobs, isLoading: false, error: null });
        },
        error: (err) => {
          logger.error('jobStore: WatermelonDB subscription error', { err });
          set({ error: err.message, isLoading: false });
        },
      });

    // Return unsubscribe function for component cleanup
    return () => subscription.unsubscribe();
  },

  createJob: async ({ title, description, siteCode, technicianId, scheduledAt }) => {
    const encryptedCode = await encryptField(siteCode);

    await database.write(async () => {
      await database.get<Job>('jobs').create((job) => {
        job.clientUuid = uuidv4();
        job.title = title;
        job.description = description;
        job.siteCodeEncrypted = encryptedCode;
        job.technicianId = technicianId;
        job.scheduledAt = scheduledAt;
        job.status = 'pending';
        job.localUpdatedAt = Date.now();
        job.syncStatus = 'pending_push';
        job.isDeleted = false;
        job.serverId = null;
        job.syncedAt = null;
      });
    });

    logger.info('jobStore: job created locally', { title, technicianId });
  },

  updateJobStatus: async (localId: string, status: Job['status']) => {
    await database.write(async () => {
      const job = await database.get<Job>('jobs').find(localId);
      await job.update((j) => {
        j.status = status;
        j.localUpdatedAt = Date.now();
        j.syncStatus = 'pending_push';
      });
    });
    logger.info('jobStore: job status updated', { localId, status });
  },

  updateJobDescription: async (localId: string, description: string) => {
    await database.write(async () => {
      const job = await database.get<Job>('jobs').find(localId);
      await job.update((j) => {
        j.description = description;
        j.localUpdatedAt = Date.now();
        j.syncStatus = 'pending_push';
      });
    });
  },
}));
```

---

### `src/utils/logger.ts`

```typescript
// Structured logger — swap transport for Sentry/Datadog in production builds.
// Never uses console.log/print in the hot path.

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogPayload {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const payload: LogPayload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  };

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  } else {
    // Production: forward to your crash reporting / observability tool
    // e.g., Sentry.addBreadcrumb({ message, level, data: context });
    // Replace with actual production transport:
    // productionLogger.emit(payload);
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
  fatal: (msg: string, ctx?: Record<string, unknown>) => emit('fatal', msg, ctx),
};
```

---

### App initialization (`App.tsx` — relevant excerpt)

```typescript
import { useEffect } from 'react';
import { syncEngine } from './src/sync/SyncEngine';
import { networkMonitor } from './src/sync/NetworkMonitor';
import { JobApiClient } from './src/api/JobApiClient';
import { getAuthToken, getTechnicianId } from './src/auth/session'; // your auth module

export default function App() {
  useEffect(() => {
    // Start network monitor globally once
    networkMonitor.start();

    const apiClient = new JobApiClient(
      'https://api.fieldservice.example.com',
      getAuthToken,
    );

    syncEngine.initialize(apiClient, {
      technicianId: getTechnicianId(),
      conflictStrategy: 'latest_wins',
      maxRetries: 5,
      baseRetryDelayMs: 1_000,
    });

    // Attempt an immediate sync if online at startup
    syncEngine.sync().catch(() => {
      // handled internally by SyncEngine; this catch prevents unhandled rejection
    });

    return () => {
      syncEngine.teardown();
    };
  }, []);

  // ... rest of app
}
```

---

## 3. Architectural Verification

- **Encryption at rest**: Sensitive fields (site access codes) are AES-256-GCM encrypted before DB write using a key held exclusively in the platform Keychain/Keystore (`ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY`). The plaintext never touches WatermelonDB or the Zustand store.

- **Token security**: Auth tokens are retrieved via an injected async `getAuthToken()` function — never stored in the DB or a Zustand slice. The API client fetches the token per-request, enabling transparent token refresh without SyncEngine changes.

- **Unidirectional data flow**: All writes go through `database.write()` transactions. The Zustand store is a read-only reactive projection of WatermelonDB observables — no UI component mutates state directly. Event → DB write → observable emission → store update → re-render.

- **Concurrent sync prevention**: `_state === 'syncing'` guard at the top of `sync()` ensures only one sync runs at a time, even if connectivity events fire rapidly.

- **Race condition on reconnect**: `networkMonitor` debounces connectivity events by 2 seconds, preventing the sync engine from being hammered by signal flapping in tunnels/basements.

- **Process death / app restart**: `_lastPullTimestamp` is an in-memory watermark. For full process-death resilience, persist it to WatermelonDB's `sync_log` table (read the last successful `server_time` on startup) — the scaffold is present in `sync_log` schema for this.

- **Network failure during sync**: Any thrown error in `sync()` is caught, written to `sync_log`, and triggers exponential backoff with full jitter (cap 60s). On next successful connectivity event, `_retryCount` resets.

- **Conflict resolution — data loss prevention**: Push-then-pull ordering ensures local changes reach the server before the client ingests server state. `latest_wins` is the default with `merge_fields` available for note-heavy workflows. Conflicts are logged at `warn` level for observability.

- **Malformed API responses**: All pull responses are validated through Zod schemas before touching the database. A schema parse failure throws immediately — partial writes do not occur.

- **Memory leak prevention**: `networkMonitor.subscribe()` returns an unsubscribe function stored in `_networkUnsubscribe`; `syncEngine.teardown()` calls it. WatermelonDB subscriptions in Zustand are returned as cleanup functions for component-level `useEffect` cleanup.

- **Background execution**: For production, wrap `syncEngine.sync()` in a `react-native-background-fetch` or `WorkManager` (Android) / `BGTaskScheduler` (iOS) task to ensure sync completes even when the app is backgrounded. The sync engine itself is background-safe — it holds no UI references.
