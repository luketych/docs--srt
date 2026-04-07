/**
 * PostgreSQL State Store Implementation
 * 
 * This implementation provides durable state management with:
 * 1. ACID transactions for state consistency
 * 2. Optimistic locking for concurrent access
 * 3. Comprehensive audit trails for compliance
 * 4. Efficient checkpointing for disaster recovery
 * 5. Connection pooling and performance optimization
 */

import { Pool, PoolClient } from 'pg'
import { StateStore, AgentState, Checkpoint, StateChange, SystemError } from './01_core_interfaces'

// =============================================================================
// POSTGRESQL STATE STORE IMPLEMENTATION
// =============================================================================

export class PostgresStateStore implements StateStore {
  private pool: Pool
  private metrics: MetricsCollector
  private auditLogger: AuditLogger

  constructor(
    private config: PostgresConfig,
    metrics: MetricsCollector,
    auditLogger: AuditLogger
  ) {
    this.metrics = metrics
    this.auditLogger = auditLogger
    this.initializeConnectionPool()
  }

  /**
   * Initialize PostgreSQL connection pool with production settings
   * 
   * Connection Pool Strategy:
   * - Multiple connections for concurrent access
   * - Health monitoring and automatic recovery
   * - Query timeout protection
   * - SSL/TLS encryption for security
   */
  private initializeConnectionPool(): void {
    this.pool = new Pool({
      // Connection Settings
      connectionString: this.config.url,
      ssl: this.config.enableSSL ? { rejectUnauthorized: false } : false,
      
      // Pool Configuration
      max: this.config.maxConnections,           // Maximum connections
      min: this.config.minConnections || 2,     // Minimum connections
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
      
      // Query Configuration
      query_timeout: this.config.queryTimeoutMs,
      statement_timeout: this.config.queryTimeoutMs,
      
      // Health Monitoring
      allowExitOnIdle: false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    })

    // Connection Pool Event Handlers
    this.pool.on('connect', (client) => {
      console.log('New PostgreSQL client connected')
      this.metrics.incrementCounter('postgres_connections_created')
    })

    this.pool.on('error', (error, client) => {
      console.error('PostgreSQL pool error:', error)
      this.metrics.recordError('postgres_pool_error', error)
    })

    this.pool.on('remove', (client) => {
      console.log('PostgreSQL client removed from pool')
      this.metrics.incrementCounter('postgres_connections_removed')
    })
  }

  /**
   * Save agent state with full ACID guarantees
   * 
   * Transaction Flow:
   * 1. Begin transaction for atomicity
   * 2. Check version for optimistic locking
   * 3. Update agent state with new version
   * 4. Log state change for audit trail
   * 5. Commit transaction or rollback on error
   */
  async saveAgentState(agentId: string, state: AgentState): Promise<void> {
    const startTime = Date.now()
    const client = await this.pool.connect()
    
    try {
      // 1. Begin transaction for atomicity
      await client.query('BEGIN')
      
      // 2. Optimistic locking - check current version
      const currentVersionResult = await client.query(
        'SELECT version FROM agent_states WHERE agent_id = $1 FOR UPDATE',
        [agentId]
      )
      
      if (currentVersionResult.rows.length > 0) {
        const currentVersion = currentVersionResult.rows[0].version
        if (currentVersion !== state.version - 1) {
          throw new SystemError('Version conflict detected', {
            category: 'DATABASE_ERROR',
            severity: 'MEDIUM',
            context: {
              agentId,
              expectedVersion: state.version - 1,
              actualVersion: currentVersion,
              timestamp: Date.now()
            },
            retryable: true,
            retryDelayMs: 100
          })
        }
      }
      
      // 3. Upsert agent state with new version
      await client.query(`
        INSERT INTO agent_states (
          agent_id, symbol, position, indicators, 
          last_processed_tick, version, portfolio_value,
          risk_metrics, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (agent_id) 
        DO UPDATE SET 
          symbol = $2,
          position = $3,
          indicators = $4,
          last_processed_tick = $5,
          version = $6,
          portfolio_value = $7,
          risk_metrics = $8,
          updated_at = NOW()
      `, [
        agentId,
        state.symbol,
        state.position,
        JSON.stringify(state.indicators),
        state.lastProcessedTick,
        state.version,
        state.portfolioValue || null,
        state.riskMetrics ? JSON.stringify(state.riskMetrics) : null
      ])
      
      // 4. Log state change for audit trail
      await this.logStateChange(client, agentId, state, 'UPDATE')
      
      // 5. Commit transaction
      await client.query('COMMIT')
      
      // 6. Record success metrics
      const latency = Date.now() - startTime
      this.metrics.recordLatency('state_save', latency)
      this.metrics.incrementCounter('state_saves_successful', { agentId })
      
      console.log(`Saved state for agent ${agentId} (${latency}ms)`)
      
    } catch (error) {
      // 7. Rollback transaction on any error
      await client.query('ROLLBACK')
      
      const latency = Date.now() - startTime
      this.metrics.recordError('state_save_failed', error)
      this.metrics.recordLatency('state_save_failed', latency)
      
      // Re-throw with enhanced context
      throw this.wrapDatabaseError(error, 'saveAgentState', { agentId, state })
      
    } finally {
      // 8. Always release connection back to pool
      client.release()
    }
  }

  /**
   * Load agent state with performance optimization
   * 
   * Loading Strategy:
   * 1. Use prepared statements for performance
   * 2. Include connection pooling for concurrency
   * 3. Handle missing states gracefully
   * 4. Cache frequently accessed states (future enhancement)
   */
  async loadAgentState(agentId: string): Promise<AgentState | null> {
    const startTime = Date.now()
    
    try {
      // 1. Execute optimized query with prepared statement
      const result = await this.pool.query(`
        SELECT 
          agent_id, symbol, position, indicators,
          last_processed_tick, version, portfolio_value,
          risk_metrics, updated_at
        FROM agent_states 
        WHERE agent_id = $1
      `, [agentId])
      
      // 2. Handle missing state gracefully
      if (result.rows.length === 0) {
        this.metrics.incrementCounter('state_loads_not_found', { agentId })
        return null
      }
      
      // 3. Deserialize and construct state object
      const row = result.rows[0]
      const state: AgentState = {
        agentId: row.agent_id,
        symbol: row.symbol,
        position: parseFloat(row.position),
        indicators: JSON.parse(row.indicators || '{}'),
        lastProcessedTick: parseInt(row.last_processed_tick),
        version: row.version,
        portfolioValue: row.portfolio_value ? parseFloat(row.portfolio_value) : undefined,
        riskMetrics: row.risk_metrics ? JSON.parse(row.risk_metrics) : undefined
      }
      
      // 4. Record success metrics
      const latency = Date.now() - startTime
      this.metrics.recordLatency('state_load', latency)
      this.metrics.incrementCounter('state_loads_successful', { agentId })
      
      console.log(`Loaded state for agent ${agentId} (${latency}ms)`)
      return state
      
    } catch (error) {
      const latency = Date.now() - startTime
      this.metrics.recordError('state_load_failed', error)
      this.metrics.recordLatency('state_load_failed', latency)
      
      throw this.wrapDatabaseError(error, 'loadAgentState', { agentId })
    }
  }

  /**
   * Save checkpoint with integrity validation
   * 
   * Checkpoint Strategy:
   * 1. Calculate checksum for corruption detection
   * 2. Compress large checkpoints to save storage
   * 3. Maintain multiple checkpoint versions
   * 4. Clean up old checkpoints automatically
   */
  async saveCheckpoint(agentId: string, checkpoint: Checkpoint): Promise<void> {
    const startTime = Date.now()
    const client = await this.pool.connect()
    
    try {
      // 1. Calculate checksum for integrity validation
      const checkpointData = JSON.stringify(checkpoint.state)
      const checksum = this.calculateChecksum(checkpointData)
      
      // 2. Compress checkpoint if it's large
      const shouldCompress = checkpointData.length > this.config.compressionThreshold
      const finalData = shouldCompress ? 
        await this.compressData(checkpointData) : 
        checkpointData
      
      // 3. Begin transaction for atomic checkpoint creation
      await client.query('BEGIN')
      
      // 4. Insert new checkpoint
      await client.query(`
        INSERT INTO agent_checkpoints (
          agent_id, checkpoint_data, checksum, compressed,
          reason, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [
        agentId,
        finalData,
        checksum,
        shouldCompress,
        checkpoint.reason || 'scheduled',
        checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null
      ])
      
      // 5. Clean up old checkpoints (keep last N checkpoints)
      await client.query(`
        DELETE FROM agent_checkpoints 
        WHERE agent_id = $1 
        AND id NOT IN (
          SELECT id FROM agent_checkpoints 
          WHERE agent_id = $1 
          ORDER BY created_at DESC 
          LIMIT $2
        )
      `, [agentId, this.config.maxCheckpointsPerAgent])
      
      // 6. Commit transaction
      await client.query('COMMIT')
      
      // 7. Record success metrics
      const latency = Date.now() - startTime
      this.metrics.recordLatency('checkpoint_save', latency)
      this.metrics.incrementCounter('checkpoints_saved', { 
        agentId, 
        reason: checkpoint.reason || 'scheduled',
        compressed: shouldCompress.toString()
      })
      
      console.log(`Saved checkpoint for agent ${agentId} (${latency}ms, compressed: ${shouldCompress})`)
      
    } catch (error) {
      await client.query('ROLLBACK')
      
      const latency = Date.now() - startTime
      this.metrics.recordError('checkpoint_save_failed', error)
      this.metrics.recordLatency('checkpoint_save_failed', latency)
      
      throw this.wrapDatabaseError(error, 'saveCheckpoint', { agentId, checkpoint })
      
    } finally {
      client.release()
    }
  }

  /**
   * Load checkpoint with integrity validation
   * 
   * Loading Strategy:
   * 1. Load most recent valid checkpoint
   * 2. Validate checksum for corruption detection
   * 3. Decompress if necessary
   * 4. Fall back to older checkpoints if corruption detected
   */
  async loadCheckpoint(agentId: string): Promise<Checkpoint | null> {
    const startTime = Date.now()
    
    try {
      // 1. Load most recent checkpoints (try multiple in case of corruption)
      const result = await this.pool.query(`
        SELECT 
          id, checkpoint_data, checksum, compressed,
          reason, metadata, created_at
        FROM agent_checkpoints 
        WHERE agent_id = $1 
        ORDER BY created_at DESC 
        LIMIT 3
      `, [agentId])
      
      if (result.rows.length === 0) {
        this.metrics.incrementCounter('checkpoint_loads_not_found', { agentId })
        return null
      }
      
      // 2. Try each checkpoint until we find a valid one
      for (const row of result.rows) {
        try {
          // 3. Decompress if necessary
          const checkpointData = row.compressed ? 
            await this.decompressData(row.checkpoint_data) : 
            row.checkpoint_data
          
          // 4. Validate checksum
          const calculatedChecksum = this.calculateChecksum(checkpointData)
          if (calculatedChecksum !== row.checksum) {
            console.warn(`Checksum mismatch for checkpoint ${row.id}, trying next...`)
            this.metrics.incrementCounter('checkpoint_corruption_detected', { agentId })
            continue
          }
          
          // 5. Parse and construct checkpoint object
          const state = JSON.parse(checkpointData) as AgentState
          const checkpoint: Checkpoint = {
            agentId,
            state,
            timestamp: new Date(row.created_at).getTime(),
            checksum: row.checksum,
            reason: row.reason,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined
          }
          
          // 6. Record success metrics
          const latency = Date.now() - startTime
          this.metrics.recordLatency('checkpoint_load', latency)
          this.metrics.incrementCounter('checkpoint_loads_successful', { 
            agentId,
            compressed: row.compressed.toString()
          })
          
          console.log(`Loaded checkpoint for agent ${agentId} (${latency}ms)`)
          return checkpoint
          
        } catch (parseError) {
          console.warn(`Failed to parse checkpoint ${row.id}:`, parseError)
          this.metrics.incrementCounter('checkpoint_parse_failed', { agentId })
          continue
        }
      }
      
      // 7. All checkpoints were corrupted
      throw new SystemError('All checkpoints corrupted', {
        category: 'DATABASE_ERROR',
        severity: 'CRITICAL',
        context: { agentId, checkpointCount: result.rows.length, timestamp: Date.now() },
        retryable: false
      })
      
    } catch (error) {
      const latency = Date.now() - startTime
      this.metrics.recordError('checkpoint_load_failed', error)
      this.metrics.recordLatency('checkpoint_load_failed', latency)
      
      throw this.wrapDatabaseError(error, 'loadCheckpoint', { agentId })
    }
  }

  /**
   * Query historical state changes for analytics and debugging
   * 
   * Query Strategy:
   * 1. Use efficient time-range queries with indexes
   * 2. Limit result size to prevent memory issues
   * 3. Include performance metrics for each change
   * 4. Support pagination for large result sets
   */
  async getStateHistory(
    agentId: string, 
    fromTime: Date, 
    toTime: Date,
    limit: number = 1000
  ): Promise<StateChange[]> {
    const startTime = Date.now()
    
    try {
      // 1. Execute time-range query with limit
      const result = await this.pool.query(`
        SELECT 
          agent_id, previous_state, new_state, trigger_type,
          trigger_data, timestamp, processing_time_ms, memory_usage_mb
        FROM state_audit_log 
        WHERE agent_id = $1 
        AND timestamp BETWEEN $2 AND $3
        ORDER BY timestamp ASC
        LIMIT $4
      `, [agentId, fromTime, toTime, limit])
      
      // 2. Transform database rows to StateChange objects
      const stateChanges: StateChange[] = result.rows.map(row => ({
        agentId: row.agent_id,
        previousState: JSON.parse(row.previous_state || '{}'),
        newState: JSON.parse(row.new_state),
        trigger: {
          type: row.trigger_type,
          data: JSON.parse(row.trigger_data || '{}')
        },
        timestamp: new Date(row.timestamp).getTime(),
        metrics: {
          processingTimeMs: row.processing_time_ms,
          memoryUsageMB: row.memory_usage_mb
        }
      }))
      
      // 3. Record query metrics
      const latency = Date.now() - startTime
      this.metrics.recordLatency('state_history_query', latency)
      this.metrics.incrementCounter('state_history_queries', { 
        agentId,
        resultCount: stateChanges.length.toString()
      })
      
      console.log(`Retrieved ${stateChanges.length} state changes for agent ${agentId} (${latency}ms)`)
      return stateChanges
      
    } catch (error) {
      const latency = Date.now() - startTime
      this.metrics.recordError('state_history_query_failed', error)
      this.metrics.recordLatency('state_history_query_failed', latency)
      
      throw this.wrapDatabaseError(error, 'getStateHistory', { agentId, fromTime, toTime })
    }
  }

  /**
   * Log state changes for comprehensive audit trail
   * 
   * Audit Strategy:
   * 1. Record both previous and new state
   * 2. Include trigger information for debugging
   * 3. Capture performance metrics
   * 4. Ensure audit log integrity
   */
  private async logStateChange(
    client: PoolClient,
    agentId: string,
    newState: AgentState,
    operation: string,
    previousState?: AgentState,
    triggerData?: any
  ): Promise<void> {
    try {
      await client.query(`
        INSERT INTO state_audit_log (
          agent_id, previous_state, new_state, operation,
          trigger_type, trigger_data, timestamp,
          processing_time_ms, memory_usage_mb
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
      `, [
        agentId,
        previousState ? JSON.stringify(previousState) : null,
        JSON.stringify(newState),
        operation,
        'state_update',
        triggerData ? JSON.stringify(triggerData) : null,
        0, // Processing time will be updated by caller
        process.memoryUsage().heapUsed / 1024 / 1024 // Memory usage in MB
      ])
      
      // Also log to external audit system if configured
      if (this.config.enableExternalAudit) {
        await this.auditLogger.logStateChange({
          agentId,
          operation,
          previousState,
          newState,
          timestamp: Date.now()
        })
      }
      
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.error('Failed to log state change:', error)
      this.metrics.recordError('audit_log_failed', error)
    }
  }

  /**
   * Calculate SHA-256 checksum for data integrity
   */
  private calculateChecksum(data: string): string {
    const crypto = require('crypto')
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
  }

  /**
   * Compress data using gzip for storage efficiency
   */
  private async compressData(data: string): Promise<Buffer> {
    const zlib = require('zlib')
    return new Promise((resolve, reject) => {
      zlib.gzip(data, (error, compressed) => {
        if (error) reject(error)
        else resolve(compressed)
      })
    })
  }

  /**
   * Decompress gzipped data
   */
  private async decompressData(compressedData: Buffer): Promise<string> {
    const zlib = require('zlib')
    return new Promise((resolve, reject) => {
      zlib.gunzip(compressedData, (error, decompressed) => {
        if (error) reject(error)
        else resolve(decompressed.toString('utf8'))
      })
    })
  }

  /**
   * Wrap database errors in standardized format
   */
  private wrapDatabaseError(error: any, operation: string, context: any): SystemError {
    // Determine if error is retryable based on PostgreSQL error codes
    const retryableErrorCodes = [
      '08000', // Connection exception
      '08003', // Connection does not exist
      '08006', // Connection failure
      '40001', // Serialization failure
      '40P01', // Deadlock detected
      '53300', // Too many connections
      '57P03'  // Cannot connect now
    ]
    
    const isRetryable = retryableErrorCodes.includes(error.code)
    const severity = this.getDatabaseErrorSeverity(error)
    
    return new SystemError(`Database ${operation} failed: ${error.message}`, {
      category: 'DATABASE_ERROR',
      severity,
      context: {
        operation,
        errorCode: error.code,
        sqlState: error.code,
        ...context,
        timestamp: Date.now()
      },
      retryable: isRetryable,
      retryDelayMs: isRetryable ? this.calculateDatabaseRetryDelay(error) : undefined
    })
  }

  /**
   * Determine database error severity for alerting
   */
  private getDatabaseErrorSeverity(error: any): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (error.code === '53300') return 'CRITICAL' // Too many connections
    if (error.code?.startsWith('08')) return 'HIGH' // Connection errors
    if (error.code === '40001' || error.code === '40P01') return 'MEDIUM' // Concurrency errors
    return 'MEDIUM' // Default severity
  }

  /**
   * Calculate retry delay based on database error type
   */
  private calculateDatabaseRetryDelay(error: any): number {
    if (error.code === '53300') return 5000  // Too many connections - wait longer
    if (error.code === '40001') return 100   // Serialization failure - retry quickly
    if (error.code === '40P01') return 200   // Deadlock - short delay
    return 1000 // Default retry delay
  }

  /**
   * Graceful shutdown with connection cleanup
   */
  async shutdown(): Promise<void> {
    try {
      console.log('Shutting down PostgreSQL connection pool...')
      await this.pool.end()
      console.log('PostgreSQL connection pool closed')
      this.metrics.recordEvent('postgres_graceful_shutdown')
      
    } catch (error) {
      console.error('Error during PostgreSQL shutdown:', error)
      this.metrics.recordError('postgres_shutdown_error', error)
    }
  }
}

// =============================================================================
// SUPPORTING TYPES AND INTERFACES
// =============================================================================

interface PostgresConfig {
  url: string
  maxConnections: number
  minConnections?: number
  idleTimeoutMs: number
  connectionTimeoutMs: number
  queryTimeoutMs: number
  enableSSL: boolean
  compressionThreshold: number
  maxCheckpointsPerAgent: number
  enableExternalAudit: boolean
}

/**
 * Audit Logger for External Compliance Systems
 */
interface AuditLogger {
  logStateChange(change: {
    agentId: string
    operation: string
    previousState?: AgentState
    newState: AgentState
    timestamp: number
  }): Promise<void>
}

/**
 * Metrics Collector Interface (same as in Redis implementation)
 */
interface MetricsCollector {
  recordLatency(operation: string, latencyMs: number): void
  incrementCounter(metric: string, labels?: Record<string, string>): void
  recordError(operation: string, error: Error): void
  recordEvent(event: string): void
}

// =============================================================================
// DATABASE SCHEMA REFERENCE
// =============================================================================

/**
 * Required PostgreSQL Schema:
 * 
 * CREATE TABLE agent_states (
 *   agent_id VARCHAR(255) PRIMARY KEY,
 *   symbol VARCHAR(10) NOT NULL,
 *   position DECIMAL(18,8) NOT NULL DEFAULT 0,
 *   indicators JSONB NOT NULL DEFAULT '{}',
 *   last_processed_tick BIGINT NOT NULL DEFAULT 0,
 *   version INTEGER NOT NULL DEFAULT 1,
 *   portfolio_value DECIMAL(18,8),
 *   risk_metrics JSONB,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   updated_at TIMESTAMP DEFAULT NOW()
 * );
 * 
 * CREATE TABLE agent_checkpoints (
 *   id SERIAL PRIMARY KEY,
 *   agent_id VARCHAR(255) NOT NULL,
 *   checkpoint_data TEXT NOT NULL,  -- Can store compressed data
 *   checksum VARCHAR(64) NOT NULL,
 *   compressed BOOLEAN DEFAULT FALSE,
 *   reason VARCHAR(50),
 *   metadata JSONB,
 *   created_at TIMESTAMP DEFAULT NOW()
 * );
 * 
 * CREATE TABLE state_audit_log (
 *   id SERIAL PRIMARY KEY,
 *   agent_id VARCHAR(255) NOT NULL,
 *   previous_state JSONB,
 *   new_state JSONB NOT NULL,
 *   operation VARCHAR(50) NOT NULL,
 *   trigger_type VARCHAR(50),
 *   trigger_data JSONB,
 *   timestamp TIMESTAMP DEFAULT NOW(),
 *   processing_time_ms INTEGER,
 *   memory_usage_mb DECIMAL(8,2)
 * );
 * 
 * -- Performance Indexes
 * CREATE INDEX idx_agent_states_symbol ON agent_states(symbol);
 * CREATE INDEX idx_agent_checkpoints_agent_id_created ON agent_checkpoints(agent_id, created_at DESC);
 * CREATE INDEX idx_state_audit_log_agent_timestamp ON state_audit_log(agent_id, timestamp);
 * CREATE INDEX idx_state_audit_log_timestamp ON state_audit_log(timestamp);
 */