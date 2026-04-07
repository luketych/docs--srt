/**
 * Redis Message Broker Implementation
 * 
 * This implementation provides Redis pub/sub messaging with:
 * 1. Versioned message format for future Kafka migration
 * 2. Connection pooling and circuit breaker patterns
 * 3. Comprehensive error handling and retry logic
 * 4. Authentication integration for secure messaging
 * 5. Monitoring and metrics collection
 */

import Redis from 'ioredis'
import { MessageBroker, MessageHandler, AuthenticatedMessage, SystemError } from './01_core_interfaces'

// =============================================================================
// REDIS MESSAGE BROKER IMPLEMENTATION
// =============================================================================

export class RedisMessageBroker implements MessageBroker {
  private redis: Redis
  private subscribers: Map<string, MessageHandler> = new Map()
  private circuitBreaker: CircuitBreaker
  private metrics: MetricsCollector
  private isConnected: boolean = false

  constructor(
    private config: RedisConfig,
    private authenticator: MessageAuthenticator,
    metrics: MetricsCollector
  ) {
    this.metrics = metrics
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeoutMs: 30000,
      monitoringPeriodMs: 60000
    })
    
    this.initializeRedisConnection()
  }

  /**
   * Initialize Redis connection with production-ready configuration
   * 
   * Key features:
   * - Connection pooling for performance
   * - Automatic reconnection with exponential backoff
   * - Health monitoring and circuit breaker integration
   * - Comprehensive error handling
   */
  private initializeRedisConnection(): void {
    this.redis = new Redis(this.config.url, {
      // Connection Management
      maxRetriesPerRequest: this.config.maxRetries,
      lazyConnect: true,
      connectTimeout: this.config.connectTimeoutMs,
      commandTimeout: this.config.commandTimeoutMs,
      
      // Performance Optimization
      enableOfflineQueue: false, // Fail fast instead of queuing
      maxMemoryPolicy: 'allkeys-lru',
      
      // Reconnection Strategy
      retryDelayOnFailover: 100,
      retryDelayOnClusterDown: 300,
      
      // Health Monitoring
      keepAlive: 30000,
      
      // Error Handling
      lazyConnect: true,
      enableReadyCheck: true
    })

    // Connection Event Handlers
    this.redis.on('connect', () => {
      console.log('Redis connection established')
      this.isConnected = true
      this.metrics.recordEvent('redis_connected')
      this.circuitBreaker.onSuccess()
    })

    this.redis.on('error', (error) => {
      console.error('Redis connection error:', error)
      this.isConnected = false
      this.metrics.recordError('redis_connection_error', error)
      this.circuitBreaker.onFailure()
    })

    this.redis.on('close', () => {
      console.log('Redis connection closed')
      this.isConnected = false
      this.metrics.recordEvent('redis_disconnected')
    })

    this.redis.on('reconnecting', () => {
      console.log('Redis reconnecting...')
      this.metrics.recordEvent('redis_reconnecting')
    })
  }

  /**
   * Publish a message with authentication and versioning
   * 
   * Message Flow:
   * 1. Validate and authenticate the message
   * 2. Wrap in versioned envelope for future compatibility
   * 3. Publish through circuit breaker for reliability
   * 4. Record metrics for monitoring
   */
  async publish(topic: string, message: any): Promise<void> {
    const startTime = Date.now()
    
    try {
      // 1. Circuit breaker check
      if (this.circuitBreaker.isOpen()) {
        throw new SystemError('Redis circuit breaker is open', {
          category: 'REDIS_ERROR',
          severity: 'HIGH',
          context: { topic, timestamp: Date.now() },
          retryable: true,
          retryDelayMs: 5000
        })
      }

      // 2. Create versioned message envelope
      const versionedMessage = this.createVersionedMessage(message)
      
      // 3. Serialize message with error handling
      const serializedMessage = this.serializeMessage(versionedMessage)
      
      // 4. Publish to Redis with timeout
      await this.executeWithTimeout(
        () => this.redis.publish(topic, serializedMessage),
        this.config.commandTimeoutMs,
        `Publish to topic ${topic}`
      )
      
      // 5. Record success metrics
      const latency = Date.now() - startTime
      this.metrics.recordLatency('message_publish', latency)
      this.metrics.incrementCounter('messages_published', { topic })
      
      console.log(`Published message to ${topic} (${latency}ms)`)
      
    } catch (error) {
      // 6. Handle and categorize errors
      const latency = Date.now() - startTime
      this.metrics.recordError('message_publish_failed', error)
      this.metrics.recordLatency('message_publish_failed', latency)
      
      // Wrap in standardized error format
      throw this.wrapRedisError(error, 'publish', { topic, message })
    }
  }

  /**
   * Subscribe to messages with authentication and error handling
   * 
   * Subscription Flow:
   * 1. Register message handler with error boundaries
   * 2. Subscribe to Redis channel with reconnection handling
   * 3. Process incoming messages with authentication
   * 4. Handle errors gracefully without crashing
   */
  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    try {
      // 1. Store handler for reconnection scenarios
      this.subscribers.set(topic, handler)
      
      // 2. Subscribe to Redis channel
      await this.redis.subscribe(topic)
      console.log(`Subscribed to topic: ${topic}`)
      
      // 3. Set up message processing with error boundaries
      this.redis.on('message', async (channel, message) => {
        if (channel === topic) {
          await this.processIncomingMessage(topic, message, handler)
        }
      })
      
      // 4. Record subscription metrics
      this.metrics.incrementCounter('subscriptions_active', { topic })
      
    } catch (error) {
      this.metrics.recordError('subscription_failed', error)
      throw this.wrapRedisError(error, 'subscribe', { topic })
    }
  }

  /**
   * Process incoming messages with comprehensive error handling
   * 
   * Processing Pipeline:
   * 1. Deserialize and validate message format
   * 2. Authenticate message sender
   * 3. Extract payload from versioned envelope
   * 4. Execute business logic handler
   * 5. Handle errors without affecting other messages
   */
  private async processIncomingMessage(
    topic: string,
    rawMessage: string,
    handler: MessageHandler
  ): Promise<void> {
    const startTime = Date.now()
    let messageId: string | undefined
    
    try {
      // 1. Deserialize message with validation
      const versionedMessage = this.deserializeMessage(rawMessage)
      messageId = versionedMessage.messageId
      
      // 2. Authenticate message (if authentication is enabled)
      if (this.config.enableAuthentication) {
        const authResult = await this.authenticator.validateMessage(versionedMessage)
        if (!authResult.valid) {
          throw new SystemError('Message authentication failed', {
            category: 'AUTHENTICATION_ERROR',
            severity: 'HIGH',
            context: { topic, messageId, error: authResult.error },
            retryable: false
          })
        }
      }
      
      // 3. Extract payload based on message version
      const payload = this.extractPayload(versionedMessage)
      
      // 4. Execute business logic handler
      await handler(payload)
      
      // 5. Record success metrics
      const processingTime = Date.now() - startTime
      this.metrics.recordLatency('message_processing', processingTime)
      this.metrics.incrementCounter('messages_processed', { topic, status: 'success' })
      
      console.log(`Processed message from ${topic} (${processingTime}ms)`)
      
    } catch (error) {
      // 6. Handle processing errors gracefully
      const processingTime = Date.now() - startTime
      
      this.metrics.recordError('message_processing_failed', error)
      this.metrics.recordLatency('message_processing_failed', processingTime)
      this.metrics.incrementCounter('messages_processed', { topic, status: 'error' })
      
      // Log error with context but don't crash the subscriber
      console.error(`Failed to process message from ${topic}:`, {
        error: error.message,
        messageId,
        processingTime,
        stack: error.stack
      })
      
      // Optionally send to dead letter queue for manual investigation
      if (this.config.enableDeadLetterQueue) {
        await this.sendToDeadLetterQueue(topic, rawMessage, error)
      }
    }
  }

  /**
   * Create versioned message envelope for future compatibility
   * 
   * Message Format Evolution Strategy:
   * - Version 1.0: Basic message with timestamp
   * - Version 1.1: Add authentication fields
   * - Version 2.0: Add compression and encryption
   * - Future: Kafka-compatible format
   */
  private createVersionedMessage(payload: any): VersionedMessage {
    return {
      // Message Metadata
      version: '1.1',
      messageId: this.generateMessageId(),
      timestamp: Date.now(),
      
      // Message Content
      type: this.inferMessageType(payload),
      payload: payload,
      
      // Authentication (if enabled)
      authentication: this.config.enableAuthentication ? {
        agentId: this.config.agentId,
        signature: this.authenticator.signMessage(payload)
      } : undefined,
      
      // Optional: Compression flag for large messages
      compressed: this.shouldCompressMessage(payload),
      
      // Optional: Schema version for payload validation
      schemaVersion: this.getSchemaVersion(payload)
    }
  }

  /**
   * Serialize message with compression and error handling
   */
  private serializeMessage(message: VersionedMessage): string {
    try {
      // Apply compression if enabled and beneficial
      if (message.compressed) {
        message.payload = this.compressPayload(message.payload)
      }
      
      return JSON.stringify(message)
      
    } catch (error) {
      throw new SystemError('Message serialization failed', {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'MEDIUM',
        context: { message, timestamp: Date.now() },
        retryable: false
      })
    }
  }

  /**
   * Deserialize message with validation and version handling
   */
  private deserializeMessage(rawMessage: string): VersionedMessage {
    try {
      const message = JSON.parse(rawMessage) as VersionedMessage
      
      // Validate required fields
      if (!message.version || !message.timestamp || !message.payload) {
        throw new Error('Invalid message format: missing required fields')
      }
      
      // Handle version compatibility
      if (!this.isSupportedVersion(message.version)) {
        throw new Error(`Unsupported message version: ${message.version}`)
      }
      
      // Decompress if necessary
      if (message.compressed) {
        message.payload = this.decompressPayload(message.payload)
      }
      
      return message
      
    } catch (error) {
      throw new SystemError('Message deserialization failed', {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'MEDIUM',
        context: { rawMessage: rawMessage.substring(0, 200), timestamp: Date.now() },
        retryable: false
      })
    }
  }

  /**
   * Extract payload based on message version for backward compatibility
   */
  private extractPayload(message: VersionedMessage): any {
    switch (message.version) {
      case '1.0':
        // Legacy format - payload is direct
        return message.payload
        
      case '1.1':
        // Current format - payload with authentication
        return message.payload
        
      case '2.0':
        // Future format - payload with encryption
        return this.decryptPayload(message.payload)
        
      default:
        throw new SystemError(`Unsupported message version: ${message.version}`, {
          category: 'BUSINESS_LOGIC_ERROR',
          severity: 'HIGH',
          context: { version: message.version, timestamp: Date.now() },
          retryable: false
        })
    }
  }

  /**
   * Execute Redis command with timeout and circuit breaker
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new SystemError(`Redis operation timeout: ${operationName}`, {
          category: 'REDIS_ERROR',
          severity: 'HIGH',
          context: { operation: operationName, timeoutMs, timestamp: Date.now() },
          retryable: true,
          retryDelayMs: 1000
        }))
      }, timeoutMs)

      operation()
        .then(result => {
          clearTimeout(timeout)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timeout)
          reject(error)
        })
    })
  }

  /**
   * Wrap Redis errors in standardized format
   */
  private wrapRedisError(error: any, operation: string, context: any): SystemError {
    return new SystemError(`Redis ${operation} failed: ${error.message}`, {
      category: 'REDIS_ERROR',
      severity: this.getErrorSeverity(error),
      context: { operation, ...context, timestamp: Date.now() },
      retryable: this.isRetryableError(error),
      retryDelayMs: this.calculateRetryDelay(error)
    })
  }

  /**
   * Determine if a Redis error is retryable
   */
  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EPIPE',
      'ECONNRESET'
    ]
    
    return retryableErrors.some(code => error.code === code || error.message.includes(code))
  }

  /**
   * Calculate retry delay based on error type
   */
  private calculateRetryDelay(error: any): number {
    if (error.code === 'ECONNREFUSED') return 5000  // Connection refused - wait longer
    if (error.code === 'ETIMEDOUT') return 1000     // Timeout - retry quickly
    return 2000 // Default retry delay
  }

  /**
   * Determine error severity for alerting
   */
  private getErrorSeverity(error: any): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (error.code === 'ECONNREFUSED') return 'CRITICAL' // Redis is down
    if (error.code === 'ETIMEDOUT') return 'HIGH'        // Performance issue
    if (error.message.includes('AUTH')) return 'HIGH'    // Security issue
    return 'MEDIUM' // Default severity
  }

  /**
   * Send failed messages to dead letter queue for investigation
   */
  private async sendToDeadLetterQueue(
    originalTopic: string,
    message: string,
    error: Error
  ): Promise<void> {
    try {
      const deadLetterMessage = {
        originalTopic,
        message,
        error: {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now()
        },
        retryCount: 0,
        maxRetries: 3
      }
      
      await this.redis.lpush(
        `dlq:${originalTopic}`,
        JSON.stringify(deadLetterMessage)
      )
      
      console.log(`Sent message to dead letter queue: dlq:${originalTopic}`)
      
    } catch (dlqError) {
      console.error('Failed to send message to dead letter queue:', dlqError)
      // Don't throw - we don't want DLQ failures to crash the system
    }
  }

  /**
   * Graceful shutdown with connection cleanup
   */
  async disconnect(): Promise<void> {
    try {
      console.log('Disconnecting from Redis...')
      
      // Unsubscribe from all topics
      if (this.subscribers.size > 0) {
        const topics = Array.from(this.subscribers.keys())
        await this.redis.unsubscribe(...topics)
        this.subscribers.clear()
      }
      
      // Close Redis connection
      await this.redis.disconnect()
      
      console.log('Redis disconnection completed')
      this.metrics.recordEvent('redis_graceful_shutdown')
      
    } catch (error) {
      console.error('Error during Redis disconnection:', error)
      this.metrics.recordError('redis_shutdown_error', error)
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private inferMessageType(payload: any): string {
    if (payload.symbol && payload.price) return 'tick_data'
    if (payload.agentId && payload.state) return 'agent_state'
    return 'generic'
  }

  private shouldCompressMessage(payload: any): boolean {
    const serialized = JSON.stringify(payload)
    return serialized.length > 1024 // Compress messages > 1KB
  }

  private getSchemaVersion(payload: any): string {
    // Determine schema version based on payload structure
    if (payload.symbol && payload.price && payload.volume) return 'tick_v1'
    if (payload.agentId && payload.position) return 'agent_state_v1'
    return 'unknown'
  }

  private isSupportedVersion(version: string): boolean {
    const supportedVersions = ['1.0', '1.1', '2.0']
    return supportedVersions.includes(version)
  }

  private compressPayload(payload: any): string {
    // Implement compression (e.g., using zlib)
    // For now, just return JSON string
    return JSON.stringify(payload)
  }

  private decompressPayload(compressedPayload: string): any {
    // Implement decompression
    // For now, just parse JSON
    return JSON.parse(compressedPayload)
  }

  private decryptPayload(encryptedPayload: any): any {
    // Future: implement decryption for version 2.0
    return encryptedPayload
  }
}

// =============================================================================
// SUPPORTING TYPES AND CLASSES
// =============================================================================

interface RedisConfig {
  url: string
  maxRetries: number
  connectTimeoutMs: number
  commandTimeoutMs: number
  enableAuthentication: boolean
  enableDeadLetterQueue: boolean
  agentId?: string
}

interface VersionedMessage {
  version: string
  messageId: string
  timestamp: number
  type: string
  payload: any
  authentication?: {
    agentId: string
    signature: string
  }
  compressed?: boolean
  schemaVersion?: string
}

/**
 * Circuit Breaker Implementation for Redis Operations
 * 
 * Prevents cascade failures by failing fast when Redis is unhealthy
 */
class CircuitBreaker {
  private failureCount = 0
  private lastFailureTime = 0
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(private config: {
    failureThreshold: number
    recoveryTimeoutMs: number
    monitoringPeriodMs: number
  }) {}

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.config.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN'
        return false
      }
      return true
    }
    return false
  }

  onSuccess(): void {
    this.failureCount = 0
    this.state = 'CLOSED'
  }

  onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN'
    }
  }
}

/**
 * Message Authentication for Secure Communication
 */
interface MessageAuthenticator {
  signMessage(payload: any): string
  validateMessage(message: VersionedMessage): Promise<{ valid: boolean; error?: any }>
}

/**
 * Metrics Collection for Monitoring and Alerting
 */
interface MetricsCollector {
  recordLatency(operation: string, latencyMs: number): void
  incrementCounter(metric: string, labels?: Record<string, string>): void
  recordError(operation: string, error: Error): void
  recordEvent(event: string): void
}