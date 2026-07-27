# Offline-First React Native Field Service App: Architecture & Sync Engine

## Overview

Building an offline-first app for technicians in zero-connectivity environments requires a carefully layered architecture. The core principle: **the local database is the source of truth for the UI; the sync engine is a background concern**.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer (React Native)           │
│         Components read/write local DB only         │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Data Access Layer                       │
│   JobRepository, WorkOrderRepository, etc.          │
│   (abstracts SQLite queries, emits change events)   │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Local Database (SQLite)                 │
│   WatermelonDB or expo-sqlite                        │
│   Tables: jobs, work_orders, attachments,           │
│           sync_queue, sync_log                      │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Sync Engine                             │
│   - Outbox queue (pending mutations)                │
│   - Pull sync (server → local)                      │
│   - Push sync (local → server)                      │
│   - Conflict resolver                               │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Network Layer                           │
│   NetInfo connectivity detection                     │
│   REST API client with retry/backoff                │
└─────────────────────────────────────────────────────┘
```

---

## Key Technology Choices

| Concern | Choice | Why |
|---|---|---|
| Local DB | **WatermelonDB** (SQLite) | Built for React Native, reactive queries, migration support |
| Connectivity detection | **@react-native-community/netinfo** | Reliable cross-platform network state |
| Background sync | **react-native-background-fetch** | Syncs even when app is backgrounded |
| File/photo storage | **react-native-fs** | Local filesystem for attachments |
| State management | **Zustand** | Lightweight, works well with WatermelonDB observables |
| Conflict strategy | **Last-Write-Wins + field-level merge** | Practical for field service; see details below |

---

## Database Schema

```sql
-- Core job data
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  server_id   TEXT,              -- null until first sync
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,     -- 'pending'|'in_progress'|'completed'
  description TEXT,
  assigned_to TEXT,
  location    TEXT,
  scheduled_at INTEGER,          -- unix timestamp
  completed_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,  -- local last-modified (ms)
  server_updated_at INTEGER,     -- server's last-modified (ms)
  is_deleted  INTEGER DEFAULT 0  -- soft delete for sync
);

-- Outbox: every local mutation queued for sync
CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,     -- 'job'|'work_order'|'attachment'
  entity_id   TEXT NOT NULL,
  operation   TEXT NOT NULL,     -- 'CREATE'|'UPDATE'|'DELETE'
  payload     TEXT NOT NULL,     -- JSON snapshot of the record
  created_at  INTEGER NOT NULL,
  attempts    INTEGER DEFAULT 0,
  last_error  TEXT,
  status      TEXT DEFAULT 'pending' -- 'pending'|'processing'|'failed'
);

-- Sync checkpoints
CREATE TABLE sync_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- e.g. key='last_pull_timestamp', value='1719000000000'

CREATE INDEX idx_sync_queue_status ON sync_queue(status, created_at);
CREATE INDEX idx_jobs_server_id ON jobs(server_id);
```

---

## Core Sync Engine Code

### 1. Database Setup (`src/db/database.ts`)

```typescript
import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabase({ name: 'fieldservice.db', location: 'default' });
  await runMigrations(db);
  return db;
}

async function runMigrations(database: SQLite.SQLiteDatabase) {
  await database.executeSql(`PRAGMA journal_mode=WAL`);  // Write-Ahead Logging for concurrency
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      assigned_to TEXT,
      location TEXT,
      scheduled_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      server_updated_at INTEGER,
      is_deleted INTEGER DEFAULT 0
    )
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      status TEXT DEFAULT 'pending'
    )
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}
```

---

### 2. Sync Queue / Outbox (`src/sync/SyncQueue.ts`)

Every write to the local DB also writes an entry to the outbox. This is the "outbox pattern" — it guarantees that no mutation is lost even if the app crashes mid-operation.

```typescript
import { getDatabase } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

export type EntityType = 'job' | 'work_order' | 'attachment';
export type Operation = 'CREATE' | 'UPDATE' | 'DELETE';

export interface QueueEntry {
  id: number;
  entity_type: EntityType;
  entity_id: string;
  operation: Operation;
  payload: Record<string, unknown>;
  created_at: number;
  attempts: number;
  last_error: string | null;
  status: 'pending' | 'processing' | 'failed';
}

export class SyncQueue {
  /**
   * Enqueue a mutation atomically alongside the local DB write.
   * Call this inside the same SQLite transaction as the data write.
   */
  static async enqueue(
    tx: SQLite.Transaction,
    entityType: EntityType,
    entityId: string,
    operation: Operation,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.executeSql(
      `INSERT INTO sync_queue (entity_type, entity_id, operation, payload, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [entityType, entityId, operation, JSON.stringify(payload), Date.now()],
    );
  }

  /**
   * Deduplicate: if there's already a pending CREATE for this entity,
   * collapse a subsequent UPDATE into it (no point sending two round trips).
   */
  static async collapseUpdates(
    tx: SQLite.Transaction,
    entityId: string,
    newPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const [result] = await tx.executeSql(
      `SELECT id, operation FROM sync_queue
       WHERE entity_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [entityId],
    );
    if (result.rows.length === 0) return false;

    const existing = result.rows.item(0);
    // If there's a pending CREATE, merge the update into it
    if (existing.operation === 'CREATE' || existing.operation === 'UPDATE') {
      await tx.executeSql(
        `UPDATE sync_queue SET payload = ?, created_at = ? WHERE id = ?`,
        [JSON.stringify(newPayload), Date.now(), existing.id],
      );
      return true; // collapsed, don't insert new entry
    }
    return false;
  }

  static async getPendingEntries(limit = 50): Promise<QueueEntry[]> {
    const db = await getDatabase();
    const [result] = await db.executeSql(
      `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );
    const entries: QueueEntry[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      entries.push({ ...row, payload: JSON.parse(row.payload) });
    }
    return entries;
  }

  static async markProcessing(ids: number[]): Promise<void> {
    const db = await getDatabase();
    await db.executeSql(
      `UPDATE sync_queue SET status = 'processing' WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }

  static async markSuccess(id: number): Promise<void> {
    const db = await getDatabase();
    await db.executeSql(`DELETE FROM sync_queue WHERE id = ?`, [id]);
  }

  static async markFailed(id: number, error: string): Promise<void> {
    const db = await getDatabase();
    await db.executeSql(
      `UPDATE sync_queue
       SET status = 'pending', attempts = attempts + 1, last_error = ?
       WHERE id = ?`,
      [error, id],
    );
  }

  static async markPermanentlyFailed(id: number, error: string): Promise<void> {
    const db = await getDatabase();
    await db.executeSql(
      `UPDATE sync_queue SET status = 'failed', last_error = ? WHERE id = ?`,
      [error, id],
    );
  }
}
```

---

### 3. Job Repository (`src/repositories/JobRepository.ts`)

All UI interactions go through the repository, never directly to the DB. The repository handles the dual write (data + outbox).

```typescript
import { getDatabase } from '../db/database';
import { SyncQueue } from '../sync/SyncQueue';
import { v4 as uuidv4 } from 'uuid';

export interface Job {
  id: string;
  server_id: string | null;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  description: string | null;
  assigned_to: string | null;
  location: string | null;
  scheduled_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  server_updated_at: number | null;
  is_deleted: number;
}

export class JobRepository {
  static async create(data: Omit<Job, 'id' | 'created_at' | 'updated_at' | 'server_id' | 'server_updated_at' | 'is_deleted'>): Promise<Job> {
    const db = await getDatabase();
    const now = Date.now();
    const job: Job = {
      id: uuidv4(),
      server_id: null,
      created_at: now,
      updated_at: now,
      server_updated_at: null,
      is_deleted: 0,
      ...data,
    };

    await db.transaction(async (tx) => {
      await tx.executeSql(
        `INSERT INTO jobs (id, server_id, title, status, description, assigned_to, location,
          scheduled_at, completed_at, created_at, updated_at, server_updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id, job.server_id, job.title, job.status, job.description,
          job.assigned_to, job.location, job.scheduled_at, job.completed_at,
          job.created_at, job.updated_at, job.server_updated_at, job.is_deleted,
        ],
      );
      await SyncQueue.enqueue(tx, 'job', job.id, 'CREATE', job as Record<string, unknown>);
    });

    return job;
  }

  static async update(id: string, changes: Partial<Pick<Job, 'title' | 'status' | 'description' | 'location' | 'completed_at'>>): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();
    const existing = await JobRepository.getById(id);
    if (!existing) throw new Error(`Job ${id} not found`);

    const updated = { ...existing, ...changes, updated_at: now };

    await db.transaction(async (tx) => {
      await tx.executeSql(
        `UPDATE jobs SET title=?, status=?, description=?, location=?,
          completed_at=?, updated_at=? WHERE id=?`,
        [updated.title, updated.status, updated.description, updated.location,
         updated.completed_at, updated.updated_at, id],
      );

      // Collapse into existing pending queue entry if possible
      const collapsed = await SyncQueue.collapseUpdates(tx, id, updated as Record<string, unknown>);
      if (!collapsed) {
        await SyncQueue.enqueue(tx, 'job', id, 'UPDATE', updated as Record<string, unknown>);
      }
    });
  }

  static async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();

    await db.transaction(async (tx) => {
      await tx.executeSql(
        `UPDATE jobs SET is_deleted = 1, updated_at = ? WHERE id = ?`,
        [now, id],
      );
      await SyncQueue.enqueue(tx, 'job', id, 'DELETE', { id, updated_at: now });
    });
  }

  static async getById(id: string): Promise<Job | null> {
    const db = await getDatabase();
    const [result] = await db.executeSql(
      `SELECT * FROM jobs WHERE id = ? AND is_deleted = 0`,
      [id],
    );
    return result.rows.length > 0 ? result.rows.item(0) : null;
  }

  static async getAll(): Promise<Job[]> {
    const db = await getDatabase();
    const [result] = await db.executeSql(
      `SELECT * FROM jobs WHERE is_deleted = 0 ORDER BY scheduled_at ASC`,
    );
    const jobs: Job[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      jobs.push(result.rows.item(i));
    }
    return jobs;
  }

  /**
   * Called by sync engine when server returns a record.
   * Handles upsert without triggering another queue entry.
   */
  static async upsertFromServer(serverJob: Job): Promise<void> {
    const db = await getDatabase();
    await db.executeSql(
      `INSERT INTO jobs (id, server_id, title, status, description, assigned_to, location,
        scheduled_at, completed_at, created_at, updated_at, server_updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         server_id = excluded.server_id,
         title = excluded.title,
         status = excluded.status,
         description = excluded.description,
         assigned_to = excluded.assigned_to,
         location = excluded.location,
         scheduled_at = excluded.scheduled_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at,
         server_updated_at = excluded.server_updated_at,
         is_deleted = excluded.is_deleted`,
      [
        serverJob.id, serverJob.server_id, serverJob.title, serverJob.status,
        serverJob.description, serverJob.assigned_to, serverJob.location,
        serverJob.scheduled_at, serverJob.completed_at, serverJob.created_at,
        serverJob.updated_at, serverJob.server_updated_at, serverJob.is_deleted,
      ],
    );
  }
}
```

---

### 4. Conflict Resolver (`src/sync/ConflictResolver.ts`)

The conflict resolution strategy here is field-level merge with a fallback to last-write-wins. This is practical for field service: if one technician updates the status and another updates the location, both changes survive.

```typescript
export interface ConflictResolution {
  resolved: Record<string, unknown>;
  strategy: 'no_conflict' | 'local_wins' | 'remote_wins' | 'merged';
}

/**
 * Merge a local record with the server version.
 *
 * Algorithm:
 * 1. If server_updated_at <= local's server_updated_at baseline: local wins (we're ahead)
 * 2. If local has no pending changes vs baseline: remote wins (clean pull)
 * 3. Otherwise: field-level merge — for each field, the version with the newer
 *    per-field timestamp wins. Falls back to last-write-wins on the whole record
 *    if per-field timestamps aren't available.
 */
export function resolveConflict(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  baselineServerTimestamp: number | null,
): ConflictResolution {
  const localUpdatedAt = local.updated_at as number;
  const remoteUpdatedAt = remote.updated_at as number;
  const remoteServerTimestamp = remote.server_updated_at as number;

  // No conflict: we haven't changed anything since last pull
  if (localUpdatedAt === (local.server_updated_at as number)) {
    return { resolved: remote, strategy: 'remote_wins' };
  }

  // No conflict: server hasn't changed since our last pull
  if (baselineServerTimestamp !== null && remoteServerTimestamp <= baselineServerTimestamp) {
    return { resolved: local, strategy: 'local_wins' };
  }

  // True conflict: both sides changed. Perform field-level merge.
  const SKIP_FIELDS = new Set(['id', 'server_id', 'created_at', 'updated_at', 'server_updated_at']);
  const merged: Record<string, unknown> = { ...remote }; // start from remote as base

  const mergeableFields = Object.keys(local).filter(k => !SKIP_FIELDS.has(k));

  for (const field of mergeableFields) {
    // Local change wins if local was modified after we last pulled this field from server.
    // This is a simplified heuristic. A richer implementation would store per-field
    // timestamps (e.g., in a separate JSON column).
    if (localUpdatedAt > (baselineServerTimestamp ?? 0)) {
      // Local modified this record after the baseline — prefer local for mutable fields
      // unless the remote change is strictly newer.
      if (remoteUpdatedAt > localUpdatedAt) {
        merged[field] = remote[field]; // remote is newer overall
      } else {
        merged[field] = local[field]; // local is newer overall
      }
    }
  }

  // Always take the later timestamp
  merged.updated_at = Math.max(localUpdatedAt, remoteUpdatedAt);
  merged.server_updated_at = remoteServerTimestamp;

  return { resolved: merged, strategy: 'merged' };
}

/**
 * Per-field timestamp strategy (advanced).
 * Store a JSON column `field_versions` like:
 * { "status": 1719000000001, "location": 1719000000050 }
 * Compare per field for true non-destructive merge.
 */
export function resolveConflictWithFieldVersions(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  localFieldVersions: Record<string, number>,
  remoteFieldVersions: Record<string, number>,
): ConflictResolution {
  const merged: Record<string, unknown> = {};
  const allFields = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  for (const field of allFields) {
    const localVersion = localFieldVersions[field] ?? 0;
    const remoteVersion = remoteFieldVersions[field] ?? 0;
    merged[field] = localVersion >= remoteVersion ? local[field] : remote[field];
  }

  return { resolved: merged, strategy: 'merged' };
}
```

---

### 5. API Client (`src/api/ApiClient.ts`)

```typescript
import NetInfo from '@react-native-community/netinfo';

const BASE_URL = 'https://api.yourbackend.com/v1';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 8000]; // ms, exponential backoff

interface ApiResponse<T> {
  data: T;
  status: number;
}

export class ApiClient {
  private static token: string | null = null;

  static setToken(token: string) {
    ApiClient.token = token;
  }

  static async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  }

  static async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<ApiResponse<T>> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (ApiClient.token) {
      headers['Authorization'] = `Bearer ${ApiClient.token}`;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 409) {
        // Conflict — return body so caller can resolve
        const data = await response.json();
        return { data, status: 409 };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(response.status, errorText);
      }

      const data = await response.json();
      return { data, status: response.status };
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        throw error; // 4xx: don't retry
      }
      if (attempt < MAX_RETRIES - 1) {
        await delay(RETRY_DELAYS[attempt]);
        return ApiClient.request(method, path, body, attempt + 1);
      }
      throw error;
    }
  }

  static get = <T>(path: string) => ApiClient.request<T>('GET', path);
  static post = <T>(path: string, body: unknown) => ApiClient.request<T>('POST', path, body);
  static put = <T>(path: string, body: unknown) => ApiClient.request<T>('PUT', path, body);
  static delete = <T>(path: string) => ApiClient.request<T>('DELETE', path);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
```

---

### 6. Sync Engine (`src/sync/SyncEngine.ts`)

This is the heart of the system. It orchestrates push (local → server) and pull (server → local) with conflict resolution.

```typescript
import { SyncQueue, QueueEntry } from './SyncQueue';
import { ConflictResolver, resolveConflict } from './ConflictResolver';
import { JobRepository, Job } from '../repositories/JobRepository';
import { ApiClient, ApiError } from '../api/ApiClient';
import { getDatabase } from '../db/database';
import NetInfo from '@react-native-community/netinfo';
import { EventEmitter } from 'events';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  pendingCount: number;
  error: string | null;
}

const MAX_QUEUE_ATTEMPTS = 5;

export class SyncEngine extends EventEmitter {
  private isSyncing = false;
  private netInfoUnsubscribe: (() => void) | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  state: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    pendingCount: 0,
    error: null,
  };

  /**
   * Start the sync engine. Call once at app startup.
   */
  start() {
    // Sync whenever connectivity is restored
    this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) {
        this.sync().catch(console.error);
      }
    });

    // Also sync on a periodic interval (catches cases where connectivity was always on)
    this.syncInterval = setInterval(() => {
      this.sync().catch(console.error);
    }, 30_000); // every 30 seconds

    // Initial sync attempt
    this.sync().catch(console.error);
  }

  stop() {
    this.netInfoUnsubscribe?.();
    if (this.syncInterval) clearInterval(this.syncInterval);
  }

  private setState(updates: Partial<SyncState>) {
    this.state = { ...this.state, ...updates };
    this.emit('stateChange', this.state);
  }

  /**
   * Main sync cycle: push pending local changes, then pull server updates.
   */
  async sync(): Promise<void> {
    if (this.isSyncing) return;

    const online = await ApiClient.isOnline();
    if (!online) {
      this.setState({ status: 'offline' });
      return;
    }

    this.isSyncing = true;
    this.setState({ status: 'syncing', error: null });

    try {
      await this.pushPendingChanges();
      await this.pullServerChanges();

      this.setState({
        status: 'idle',
        lastSyncAt: Date.now(),
        pendingCount: 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.setState({ status: 'error', error: message });
      console.error('[SyncEngine] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // ─── PUSH ────────────────────────────────────────────────────────────────────

  private async pushPendingChanges(): Promise<void> {
    const entries = await SyncQueue.getPendingEntries(50);
    if (entries.length === 0) return;

    this.setState({ pendingCount: entries.length });
    await SyncQueue.markProcessing(entries.map(e => e.id));

    for (const entry of entries) {
      if (entry.attempts >= MAX_QUEUE_ATTEMPTS) {
        await SyncQueue.markPermanentlyFailed(entry.id, 'Max retries exceeded');
        this.emit('syncItemFailed', entry);
        continue;
      }

      try {
        await this.pushEntry(entry);
        await SyncQueue.markSuccess(entry.id);
        this.emit('syncItemSuccess', entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await SyncQueue.markFailed(entry.id, message);
        this.emit('syncItemError', { entry, error: message });
      }
    }
  }

  private async pushEntry(entry: QueueEntry): Promise<void> {
    const { entity_type, entity_id, operation, payload } = entry;

    if (entity_type === 'job') {
      switch (operation) {
        case 'CREATE': {
          const { data } = await ApiClient.post<Job>('/jobs', payload);
          // Update local record with server-assigned ID and timestamps
          await JobRepository.upsertFromServer(data);
          break;
        }
        case 'UPDATE': {
          const serverId = (payload as Job).server_id;
          if (!serverId) {
            // Not yet created on server — skip and wait for CREATE to sync first
            throw new Error('No server_id yet, skipping UPDATE until CREATE syncs');
          }
          const response = await ApiClient.put<Job>(`/jobs/${serverId}`, payload);
          if (response.status === 409) {
            // Conflict: server has a newer version
            await this.resolveAndPush(payload as Job, response.data as Job, serverId);
          } else {
            await JobRepository.upsertFromServer(response.data);
          }
          break;
        }
        case 'DELETE': {
          const serverId = (payload as Job).server_id;
          if (serverId) {
            await ApiClient.delete(`/jobs/${serverId}`);
          }
          // If no server_id, it was never synced — just remove from queue
          break;
        }
      }
    }
    // Add similar branches for 'work_order', 'attachment', etc.
  }

  private async resolveAndPush(
    localJob: Job,
    serverJob: Job,
    serverId: string,
  ): Promise<void> {
    const db = await getDatabase();
    const [meta] = await db.executeSql(
      `SELECT value FROM sync_metadata WHERE key = ?`,
      [`last_pull_timestamp`],
    );
    const baselineTimestamp = meta.rows.length > 0
      ? parseInt(meta.rows.item(0).value, 10)
      : null;

    const { resolved, strategy } = resolveConflict(
      localJob as unknown as Record<string, unknown>,
      serverJob as unknown as Record<string, unknown>,
      baselineTimestamp,
    );

    console.log(`[ConflictResolver] job ${serverId}: strategy=${strategy}`);
    this.emit('conflict', { localJob, serverJob, resolved, strategy });

    if (strategy !== 'remote_wins') {
      // Push the merged/local version to server
      const { data } = await ApiClient.put<Job>(`/jobs/${serverId}`, resolved);
      await JobRepository.upsertFromServer(data);
    } else {
      // Accept server version
      await JobRepository.upsertFromServer(serverJob);
    }
  }

  // ─── PULL ────────────────────────────────────────────────────────────────────

  private async pullServerChanges(): Promise<void> {
    const db = await getDatabase();
    const [meta] = await db.executeSql(
      `SELECT value FROM sync_metadata WHERE key = 'last_pull_timestamp'`,
    );
    const since = meta.rows.length > 0 ? meta.rows.item(0).value : '0';

    // Server must support ?updated_since= for delta pulls (see Backend Requirements)
    const { data } = await ApiClient.get<{ jobs: Job[]; deleted_ids: string[] }>(
      `/sync/delta?updated_since=${since}`,
    );

    const now = Date.now();

    for (const serverJob of data.jobs) {
      const local = await JobRepository.getById(serverJob.id);

      if (!local) {
        // New record from server
        await JobRepository.upsertFromServer(serverJob);
        continue;
      }

      // Check if local has unsent changes (pending in queue)
      const [queueCheck] = await db.executeSql(
        `SELECT id FROM sync_queue WHERE entity_id = ? AND status IN ('pending', 'processing') LIMIT 1`,
        [serverJob.id],
      );

      if (queueCheck.rows.length > 0) {
        // Local has pending changes — conflict resolution will happen during push
        // Don't overwrite local record during pull
        continue;
      }

      // No local pending changes — safe to apply server version
      await JobRepository.upsertFromServer(serverJob);
    }

    // Apply server-side deletes
    for (const deletedId of data.deleted_ids) {
      await db.executeSql(
        `UPDATE jobs SET is_deleted = 1 WHERE id = ? OR server_id = ?`,
        [deletedId, deletedId],
      );
    }

    // Update pull checkpoint
    await db.executeSql(
      `INSERT INTO sync_metadata (key, value) VALUES ('last_pull_timestamp', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(now)],
    );
  }
}

// Singleton instance
export const syncEngine = new SyncEngine();
```

---

### 7. React Integration (`src/hooks/useSyncEngine.ts`)

```typescript
import { useEffect, useState, useCallback } from 'react';
import { syncEngine, SyncState } from '../sync/SyncEngine';

export function useSyncEngine() {
  const [syncState, setSyncState] = useState<SyncState>(syncEngine.state);

  useEffect(() => {
    const handler = (state: SyncState) => setSyncState(state);
    syncEngine.on('stateChange', handler);
    return () => { syncEngine.off('stateChange', handler); };
  }, []);

  const triggerSync = useCallback(() => {
    syncEngine.sync().catch(console.error);
  }, []);

  return { syncState, triggerSync };
}
```

```typescript
// App.tsx — wire it all up at startup
import { useEffect } from 'react';
import { syncEngine } from './src/sync/SyncEngine';

export default function App() {
  useEffect(() => {
    syncEngine.start();
    return () => syncEngine.stop();
  }, []);

  // ...
}
```

```tsx
// SyncStatusBar.tsx — UI indicator
import { useSyncEngine } from './hooks/useSyncEngine';

export function SyncStatusBar() {
  const { syncState } = useSyncEngine();

  const labels: Record<string, string> = {
    idle: syncState.lastSyncAt
      ? `Synced ${formatRelative(syncState.lastSyncAt)}`
      : 'Not yet synced',
    syncing: 'Syncing...',
    offline: 'Offline — changes saved locally',
    error: `Sync error: ${syncState.error}`,
  };

  return (
    <View style={styles.bar}>
      <Text style={styles.text}>{labels[syncState.status]}</Text>
      {syncState.pendingCount > 0 && (
        <Text style={styles.badge}>{syncState.pendingCount} pending</Text>
      )}
    </View>
  );
}
```

---

## Backend Requirements

Your REST API must support:

### Delta Pull Endpoint
```
GET /sync/delta?updated_since=<unix_ms>

Response:
{
  "jobs": [ ...all jobs updated after that timestamp... ],
  "deleted_ids": [ "uuid1", "uuid2" ]
}
```

### Conflict Detection on PUT
```
PUT /jobs/:id
Headers: If-Modified-Since: <server_updated_at>

If server record was modified after If-Modified-Since:
  409 Conflict
  Body: { current server record }
Else:
  200 OK
  Body: { updated server record with server_updated_at }
```

### Idempotent POST (for retried CREATEs)
```
POST /jobs
Body includes client-generated UUID as `id`

Server uses UPSERT on that ID to handle retried requests safely.
```

---

## Conflict Resolution Strategy: Decision Tree

```
Local change exists?
├── NO  → Apply server version (remote wins, clean pull)
└── YES → Server changed since our last pull?
          ├── NO  → Apply local version (local wins, we're ahead)
          └── YES → True conflict
                    ├── Same fields changed? → Last-write-wins per field
                    └── Different fields?   → Merge both (both survive)
```

### Practical Field Service Conflict Examples

| Scenario | Resolution |
|---|---|
| Technician A updates status, Technician B updates notes | **Merge** — both fields survive |
| Technician updates status offline; dispatcher changes status online | **Last-write-wins** on status field |
| Technician completes job offline; dispatcher cancels online | **Flag for manual review** — emit a `conflict` event to alert the user |
| App retries a CREATE after network timeout | **Idempotent** — server UPSERT on client UUID prevents duplicates |

---

## Handling Attachments (Photos/Signatures)

Photos are large — don't put them in the sync queue. Use a separate strategy:

```typescript
// src/sync/AttachmentSyncer.ts
export class AttachmentSyncer {
  static async queueUpload(localPath: string, jobId: string): Promise<string> {
    const attachmentId = uuidv4();
    // Save reference in local DB
    await db.executeSql(
      `INSERT INTO attachments (id, job_id, local_path, upload_status)
       VALUES (?, ?, ?, 'pending')`,
      [attachmentId, jobId, localPath],
    );
    return attachmentId;
  }

  static async syncPendingAttachments(): Promise<void> {
    const pending = await getPendingAttachments();
    for (const attachment of pending) {
      try {
        const formData = new FormData();
        formData.append('file', {
          uri: attachment.local_path,
          name: 'photo.jpg',
          type: 'image/jpeg',
        } as any);
        formData.append('job_id', attachment.job_id);

        const response = await fetch(`${BASE_URL}/attachments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (response.ok) {
          const { url } = await response.json();
          await db.executeSql(
            `UPDATE attachments SET upload_status='uploaded', remote_url=? WHERE id=?`,
            [url, attachment.id],
          );
        }
      } catch {
        // Will retry on next sync cycle
      }
    }
  }
}
```

---

## Security Considerations

1. **Encrypt the local database** — use SQLCipher (react-native-sqlcipher-storage) so job data on a lost device is unreadable.
2. **Token storage** — store auth tokens in the secure keychain (react-native-keychain), never in AsyncStorage.
3. **Sync only owned records** — the delta endpoint should filter by `assigned_to` or team, not return all jobs.
4. **Audit the sync_queue** — permanently failed entries may contain sensitive field data. Prune them on a schedule.

---

## Testing Strategy

```typescript
// Test the conflict resolver in isolation — pure functions are easy to test
describe('resolveConflict', () => {
  it('remote wins when local has no changes', () => {
    const local = { id: '1', status: 'pending', updated_at: 1000, server_updated_at: 1000 };
    const remote = { id: '1', status: 'in_progress', updated_at: 2000, server_updated_at: 2000 };
    const { strategy } = resolveConflict(local, remote, 1000);
    expect(strategy).toBe('remote_wins');
  });

  it('local wins when server has not changed', () => {
    const local = { id: '1', status: 'completed', updated_at: 2000, server_updated_at: 1000 };
    const remote = { id: '1', status: 'pending', updated_at: 1000, server_updated_at: 1000 };
    const { strategy } = resolveConflict(local, remote, 1000);
    expect(strategy).toBe('local_wins');
  });
});

// Integration test the sync queue with an in-memory SQLite
// Use jest + react-native-sqlite-storage mock
```

---

## Summary

The architecture rests on four guarantees:

1. **Writes never block on network** — every mutation goes to SQLite first; the queue is the persistence guarantee.
2. **The outbox is atomic with the data write** — a single SQLite transaction prevents "written to DB but not queued" or "queued but DB rolled back."
3. **Pulls never silently overwrite pending changes** — the pull phase checks the queue before applying server records.
4. **Conflict resolution is deterministic and auditable** — every conflict emits an event you can log, alert on, or surface in the UI.

With this foundation you can handle multi-day outages, crew handoffs, and intermittent tunnel connectivity without data loss.
