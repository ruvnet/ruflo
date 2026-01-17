/**
 * Memory Entry Entity - Domain Layer
 *
 * Core domain entity representing a stored memory item.
 * Implements DDD principles with encapsulated business logic.
 *
 * @module v3/memory/domain/entities
 */

import { randomUUID } from 'crypto';

/**
 * Memory entry types
 */
export type MemoryType = 'semantic' | 'episodic' | 'procedural' | 'working';

/**
 * Memory entry status
 */
export type MemoryStatus = 'active' | 'archived' | 'deleted';

/**
 * Memory entry properties
 */
export interface MemoryEntryProps {
  id?: string;
  namespace: string;
  key: string;
  value: unknown;
  type: MemoryType;
  vector?: Float32Array;
  metadata?: Record<string, unknown>;
  accessCount?: number;
  lastAccessedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  status?: MemoryStatus;
  ttl?: number; // Time-to-live in milliseconds
}

/**
 * Memory Entry - Aggregate Root
 *
 * Represents a single memory entry with business logic
 * for access tracking, expiration, and state management.
 */
export class MemoryEntry {
  private _id: string;
  private _namespace: string;
  private _key: string;
  private _value: unknown;
  private _type: MemoryType;
  private _vector?: Float32Array;
  private _metadata: Record<string, unknown>;
  private _accessCount: number;
  private _lastAccessedAt: Date;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _status: MemoryStatus;
  private _ttl?: number;

  private constructor(props: MemoryEntryProps) {
    const now = new Date();
    this._id = props.id ?? randomUUID();
    this._namespace = props.namespace;
    this._key = props.key;
    this._value = props.value;
    this._type = props.type;
    this._vector = props.vector;
    this._metadata = props.metadata ?? {};
    this._accessCount = props.accessCount ?? 0;
    this._lastAccessedAt = props.lastAccessedAt ?? now;
    this._createdAt = props.createdAt ?? now;
    this._updatedAt = props.updatedAt ?? now;
    this._status = props.status ?? 'active';
    this._ttl = props.ttl;
  }

  /**
   * Factory method - Create new memory entry
   */
  static create(props: MemoryEntryProps): MemoryEntry {
    return new MemoryEntry(props);
  }

  /**
   * Factory method - Reconstruct from persistence
   */
  static fromPersistence(props: MemoryEntryProps): MemoryEntry {
    return new MemoryEntry(props);
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get namespace(): string {
    return this._namespace;
  }

  get key(): string {
    return this._key;
  }

  get value(): unknown {
    return this._value;
  }

  get type(): MemoryType {
    return this._type;
  }

  get vector(): Float32Array | undefined {
    return this._vector;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get accessCount(): number {
    return this._accessCount;
  }

  get lastAccessedAt(): Date {
    return new Date(this._lastAccessedAt);
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  get status(): MemoryStatus {
    return this._status;
  }

  get ttl(): number | undefined {
    return this._ttl;
  }

  get compositeKey(): string {
    return `${this._namespace}:${this._key}`;
  }

  // Business Logic Methods

  /**
   * Record an access to this memory entry
   */
  recordAccess(): void {
    this._accessCount++;
    this._lastAccessedAt = new Date();
  }

  /**
   * Update the value of this memory entry
   */
  updateValue(value: unknown): void {
    this._value = value;
    this._updatedAt = new Date();
  }

  /**
   * Update the vector embedding
   */
  updateVector(vector: Float32Array): void {
    this._vector = vector;
    this._updatedAt = new Date();
  }

  /**
   * Add or update metadata
   */
  setMetadata(key: string, value: unknown): void {
    this._metadata[key] = value;
    this._updatedAt = new Date();
  }

  /**
   * Remove metadata key
   */
  removeMetadata(key: string): void {
    delete this._metadata[key];
    this._updatedAt = new Date();
  }

  /**
   * Archive this memory entry
   */
  archive(): void {
    this._status = 'archived';
    this._updatedAt = new Date();
  }

  /**
   * Restore archived memory entry
   */
  restore(): void {
    if (this._status === 'archived') {
      this._status = 'active';
      this._updatedAt = new Date();
    }
  }

  /**
   * Mark as deleted (soft delete)
   */
  delete(): void {
    this._status = 'deleted';
    this._updatedAt = new Date();
  }

  /**
   * Check if memory has expired based on TTL
   */
  isExpired(): boolean {
    if (!this._ttl) return false;
    const expiresAt = this._createdAt.getTime() + this._ttl;
    return Date.now() > expiresAt;
  }

  /**
   * Check if memory is accessible (active and not expired)
   */
  isAccessible(): boolean {
    return this._status === 'active' && !this.isExpired();
  }

  /**
   * Calculate age in milliseconds
   */
  getAge(): number {
    return Date.now() - this._createdAt.getTime();
  }

  /**
   * Calculate time since last access in milliseconds
   */
  getTimeSinceLastAccess(): number {
    return Date.now() - this._lastAccessedAt.getTime();
  }

  /**
   * Check if memory is considered "hot" (frequently accessed)
   */
  isHot(threshold: number = 10): boolean {
    return this._accessCount >= threshold;
  }

  /**
   * Check if memory is considered "cold" (not accessed recently)
   */
  isCold(milliseconds: number = 3600000): boolean {
    return this.getTimeSinceLastAccess() > milliseconds;
  }

  /**
   * Convert to plain object for persistence
   */
  toPersistence(): Record<string, unknown> {
    return {
      id: this._id,
      namespace: this._namespace,
      key: this._key,
      value: this._value,
      type: this._type,
      vector: this._vector ? Array.from(this._vector) : undefined,
      metadata: this._metadata,
      accessCount: this._accessCount,
      lastAccessedAt: this._lastAccessedAt.toISOString(),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      status: this._status,
      ttl: this._ttl,
    };
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON(): Record<string, unknown> {
    return this.toPersistence();
  }
}
