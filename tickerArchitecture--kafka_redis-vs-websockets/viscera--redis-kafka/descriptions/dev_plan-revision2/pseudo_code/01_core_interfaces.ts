/**
 * Core Interfaces for Redis + PostgreSQL Trading System
 * 
 * These interfaces define the foundational contracts that enable:
 * 1. Clean separation between business logic and infrastructure
 * 2. Easy migration from Redis to Kafka later
 * 3. Testability through dependency injection
 * 4. Type safety across the entire system
 */

// =============================================================================
// MESSAGE BROKER ABSTRACTION
// =============================================================================

/**
 * MessageBroker Interface
 * 
 * This abstraction allows us to start with Redis pub/sub and later migrate
 * to Kafka without changing any business logic code. The interface is designed
 * to work with both Redis and Kafka semantics.
 */
export interface MessageBroker {
  /**
   * Publish a message to a topic
   * 
   * @param topic - The topic/channel name (e.g., "ticks:AAPL")
   * @param message - The message payload (will be JSON serialized)
   * 
   * Redis Implementation: Uses PUBLISH command
   * Kafka Implementation: Uses producer.send()
   */
  publish(topic: string, message: any): Promise<void>

  /**
   * Subscribe to messages from a topic
   * 
   * @param topic - The topic/channel to subscribe to
   * @param handler - Function to process each received message
   * 
   * Redis Implementation: Uses SUBSCRIBE command
   * Kafka Implementation: Uses consumer groups
   */
  subscribe(topic: string, handler: MessageHandler): Promise<void>

  /**
   * Create a consumer group for load balancing
   * 
   * @param groupId - Unique identifier for the consumer group
   * @param topics - Array of topics this group should consume
   * 
   * Redis Implementation: Simulated with Redis Streams (future migration)
   * Kafka Implementation: Native consumer group support
   */
  createConsumerGroup?(groupId: string, topics: string[]): Promise<void>

  /**
   * Gracefully disconnect from the message broker
   * Essential for clean shutdown and resource cleanup
   */
  disconnect(): Promise<void>
}

/**
 * Message Handler Function Type
 * 
 * All message processing functions must conform to this signature.
 * This ensures consistent error handling and async processing patterns.
 */
export type MessageHandler = (message: any) => Promise<void>

// =============================================================================
// STATE MANAGEMENT ABSTRACTION
// =============================================================================

/**
 * StateStore Interface
 * 
 * Abstracts persistent state storage to enable:
 * 1. ACID transactions for state consistency
 * 2. Audit trails for compliance and debugging
 * 3. Backup and recovery capabilities
 * 4. Complex queries for analytics
 */
export interface StateStore {
  /**
   * Save agent state with full ACID guarantees
   * 
   * @param agentId - Unique identifier for the agent
   * @param state - Complete agent state object
   * 
   * Implementation Notes:
   * - Must be atomic (all-or-nothing)
   * - Should include audit logging
   * - Must handle concurrent access safely
   */
  saveAgentState(agentId: string, state: AgentState): Promise<void>

  /**
   * Load the current state for an agent
   * 
   * @param agentId - Unique identifier for the agent
   * @returns The agent's current state, or null if not found
   * 
   * Implementation Notes:
   * - Should be fast (< 10ms for Redis, < 50ms for PostgreSQL)
   * - Must handle missing state gracefully
   */
  loadAgentState(agentId: string): Promise<AgentState | null>

  /**
   * Create a checkpoint for disaster recovery
   * 
   * @param agentId - Unique identifier for the agent
   * @param checkpoint - Snapshot of agent state at a point in time
   * 
   * Implementation Notes:
   * - Include checksum for corruption detection
   * - Retain multiple checkpoints for rollback options
   * - Compress large checkpoints to save storage
   */
  saveCheckpoint(agentId: string, checkpoint: Checkpoint): Promise<void>

  /**
   * Load the most recent valid checkpoint
   * 
   * @param agentId - Unique identifier for the agent
   * @returns The most recent checkpoint, or null if none exists
   * 
   * Implementation Notes:
   * - Validate checksum before returning
   * - Fall back to older checkpoints if corruption detected
   */
  loadCheckpoint(agentId: string): Promise<Checkpoint | null>

  /**
   * Query historical state changes for analytics
   * 
   * @param agentId - Agent to query
   * @param fromTime - Start of time range
   * @param toTime - End of time range
   * @returns Array of state changes in chronological order
   * 
   * Use Cases:
   * - Performance analysis
   * - Debugging state transitions
   * - Compliance reporting
   */
  getStateHistory?(agentId: string, fromTime: Date, toTime: Date): Promise<StateChange[]>
}

// =============================================================================
// CORE DATA STRUCTURES
// =============================================================================

/**
 * TickData - Represents a single market data point
 * 
 * This is the fundamental unit of data flowing through our system.
 * Every tick represents a market event that agents must process.
 */
export interface TickData {
  /** Stock symbol (e.g., "AAPL", "GOOGL") */
  symbol: string
  
  /** Current price in dollars */
  price: number
  
  /** Number of shares traded */
  volume: number
  
  /** Unix timestamp in milliseconds */
  timestamp: number
  
  /** Optional: Bid price */
  bid?: number
  
  /** Optional: Ask price */
  ask?: number
  
  /** Optional: Market maker identifier */
  source?: string
}

/**
 * AgentState - Complete state of a trading agent
 * 
 * This represents everything an agent needs to know to make trading decisions.
 * State must be serializable for checkpointing and recovery.
 */
export interface AgentState {
  /** Unique identifier for this agent */
  agentId: string
  
  /** Stock symbol this agent is trading */
  symbol: string
  
  /** Current position (positive = long, negative = short, 0 = flat) */
  position: number
  
  /** Technical indicators and their current values */
  indicators: Record<string, number>
  
  /** Timestamp of the last processed tick (for deduplication) */
  lastProcessedTick: number
  
  /** Version number for optimistic locking */
  version: number
  
  /** Optional: Portfolio value in dollars */
  portfolioValue?: number
  
  /** Optional: Risk metrics */
  riskMetrics?: {
    maxDrawdown: number
    sharpeRatio: number
    volatility: number
  }
}

/**
 * Checkpoint - Point-in-time snapshot for disaster recovery
 * 
 * Checkpoints enable agents to recover from failures without losing
 * significant processing progress.
 */
export interface Checkpoint {
  /** Agent this checkpoint belongs to */
  agentId: string
  
  /** Complete agent state at checkpoint time */
  state: AgentState
  
  /** When this checkpoint was created */
  timestamp: number
  
  /** SHA-256 hash for corruption detection */
  checksum: string
  
  /** Optional: Reason for creating this checkpoint */
  reason?: 'scheduled' | 'manual' | 'pre_shutdown' | 'error_recovery'
  
  /** Optional: Additional metadata */
  metadata?: Record<string, any>
}

/**
 * StateChange - Record of a state transition for audit trails
 * 
 * Every state change is logged for compliance, debugging, and analytics.
 */
export interface StateChange {
  /** Agent that changed state */
  agentId: string
  
  /** State before the change */
  previousState: AgentState
  
  /** State after the change */
  newState: AgentState
  
  /** What caused this state change */
  trigger: {
    type: 'tick_processed' | 'manual_adjustment' | 'recovery' | 'initialization'
    data: any
  }
  
  /** When the change occurred */
  timestamp: number
  
  /** Optional: Performance metrics for this change */
  metrics?: {
    processingTimeMs: number
    memoryUsageMB: number
  }
}

// =============================================================================
// AUTHENTICATION AND SECURITY
// =============================================================================

/**
 * AuthenticatedMessage - Wrapper for all inter-service messages
 * 
 * Every message must include authentication information to prevent
 * unauthorized access and ensure audit trails.
 */
export interface AuthenticatedMessage {
  /** Unique identifier for the sending agent */
  agentId: string
  
  /** Cryptographic signature of the message */
  signature: string
  
  /** When this message was created (prevents replay attacks) */
  timestamp: number
  
  /** The actual message payload */
  payload: any
  
  /** Message format version for backward compatibility */
  version: string
}

/**
 * AuthenticationResult - Result of message authentication
 */
export interface AuthenticationResult {
  /** Whether authentication succeeded */
  valid: boolean
  
  /** Agent context if authentication succeeded */
  agentContext?: {
    agentId: string
    permissions: string[]
    rateLimit: number
  }
  
  /** Error details if authentication failed */
  error?: {
    code: 'INVALID_SIGNATURE' | 'EXPIRED_MESSAGE' | 'UNKNOWN_AGENT' | 'RATE_LIMITED'
    message: string
  }
}

// =============================================================================
// ERROR HANDLING AND MONITORING
// =============================================================================

/**
 * SystemError - Standardized error format for the entire system
 * 
 * Consistent error handling enables better monitoring and debugging.
 */
export interface SystemError extends Error {
  /** Error category for monitoring and alerting */
  category: 'REDIS_ERROR' | 'DATABASE_ERROR' | 'NETWORK_ERROR' | 'BUSINESS_LOGIC_ERROR' | 'AUTHENTICATION_ERROR'
  
  /** Severity level for prioritizing responses */
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  
  /** Context information for debugging */
  context: {
    agentId?: string
    symbol?: string
    operation?: string
    timestamp: number
    [key: string]: any
  }
  
  /** Whether this error is retryable */
  retryable: boolean
  
  /** Suggested retry delay in milliseconds */
  retryDelayMs?: number
}

/**
 * HealthCheck - System health monitoring interface
 */
export interface HealthCheck {
  /** Component being checked */
  component: 'redis' | 'database' | 'agent' | 'system'
  
  /** Health status */
  status: 'healthy' | 'degraded' | 'unhealthy'
  
  /** Response time in milliseconds */
  responseTimeMs: number
  
  /** Additional details about the health check */
  details: {
    message: string
    metrics?: Record<string, number>
    lastError?: string
  }
  
  /** When this health check was performed */
  timestamp: number
}

// =============================================================================
// CONFIGURATION AND ENVIRONMENT
// =============================================================================

/**
 * SystemConfiguration - Complete system configuration
 * 
 * All configuration should be externalized and environment-specific.
 */
export interface SystemConfiguration {
  /** Redis connection and behavior settings */
  redis: {
    url: string
    maxRetries: number
    connectTimeoutMs: number
    commandTimeoutMs: number
    enableOfflineQueue: boolean
  }
  
  /** Database connection and performance settings */
  database: {
    url: string
    maxConnections: number
    idleTimeoutMs: number
    queryTimeoutMs: number
    enableSSL: boolean
  }
  
  /** Agent behavior and business logic settings */
  agents: {
    symbols: string[]
    checkpointFrequency: number
    maxPositionSize: number
    riskLimits: {
      maxDrawdown: number
      maxLeverage: number
    }
  }
  
  /** Monitoring and alerting configuration */
  monitoring: {
    metricsIntervalMs: number
    healthCheckIntervalMs: number
    alertThresholds: {
      errorRate: number
      latencyMs: number
      memoryUsagePercent: number
    }
  }
}

// =============================================================================
// USAGE EXAMPLES AND PATTERNS
// =============================================================================

/**
 * Example: How to implement a message handler with proper error handling
 */
/*
const tickHandler: MessageHandler = async (message: any) => {
  try {
    // 1. Validate message format
    if (!isValidTickData(message)) {
      throw new SystemError('Invalid tick data format', {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'MEDIUM',
        context: { message, timestamp: Date.now() },
        retryable: false
      })
    }
    
    // 2. Process business logic
    const tick = message as TickData
    const newState = await processTickData(tick)
    
    // 3. Save state atomically
    await stateStore.saveAgentState(agentId, newState)
    
    // 4. Log success metrics
    metrics.recordSuccess('tick_processed', Date.now() - tick.timestamp)
    
  } catch (error) {
    // 5. Handle errors gracefully
    metrics.recordError('tick_processing_failed', error)
    
    if (error.retryable) {
      // Schedule retry with exponential backoff
      await scheduleRetry(message, error.retryDelayMs || 1000)
    } else {
      // Log and alert for manual intervention
      logger.error('Non-retryable tick processing error', { error, message })
      await alerting.sendAlert('CRITICAL', 'Tick processing failed', error)
    }
  }
}
*/

/**
 * Example: How to implement atomic state updates with optimistic locking
 */
/*
async function updateAgentStateWithRetry(
  agentId: string,
  updateFn: (state: AgentState) => AgentState,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 1. Load current state
      const currentState = await stateStore.loadAgentState(agentId)
      if (!currentState) {
        throw new Error(`Agent ${agentId} not found`)
      }
      
      // 2. Apply business logic
      const newState = updateFn(currentState)
      newState.version = currentState.version + 1
      
      // 3. Save with version check (optimistic locking)
      await stateStore.saveAgentState(agentId, newState)
      
      // Success - exit retry loop
      return
      
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT' && attempt < maxRetries - 1) {
        // Retry with fresh state
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)))
        continue
      }
      
      // Max retries exceeded or non-retryable error
      throw error
    }
  }
}
*/