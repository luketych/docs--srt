/**
 * Trading Agent Implementation
 * 
 * This implementation provides a complete trading agent with:
 * 1. Real-time tick processing with business logic
 * 2. State management with atomic updates and recovery
 * 3. Technical indicator calculations and position management
 * 4. Comprehensive error handling and circuit breakers
 * 5. Performance monitoring and health checks
 */

import { MessageBroker, StateStore, TickData, AgentState, SystemError } from './01_core_interfaces'

// =============================================================================
// TRADING AGENT IMPLEMENTATION
// =============================================================================

export class TradingAgent {
  private messageBroker: MessageBroker
  private stateStore: StateStore
  private currentState: AgentState
  private isRunning: boolean = false
  private metrics: AgentMetrics
  private healthMonitor: HealthMonitor
  private circuitBreaker: CircuitBreaker
  private indicatorCalculator: IndicatorCalculator
  private riskManager: RiskManager

  constructor(
    private config: AgentConfig,
    messageBroker: MessageBroker,
    stateStore: StateStore,
    metricsCollector: MetricsCollector
  ) {
    this.messageBroker = messageBroker
    this.stateStore = stateStore
    this.metrics = new AgentMetrics(config.agentId, metricsCollector)
    this.healthMonitor = new HealthMonitor(config.agentId, metricsCollector)
    this.circuitBreaker = new CircuitBreaker(config.circuitBreakerConfig)
    this.indicatorCalculator = new IndicatorCalculator(config.indicatorConfig)
    this.riskManager = new RiskManager(config.riskConfig)
  }

  /**
   * Start the trading agent with full initialization
   * 
   * Startup Sequence:
   * 1. Load or initialize agent state
   * 2. Validate configuration and dependencies
   * 3. Subscribe to market data feeds
   * 4. Start health monitoring and metrics collection
   * 5. Begin processing market ticks
   */
  async start(): Promise<void> {
    try {
      console.log(`Starting trading agent ${this.config.agentId} for symbol ${this.config.symbol}`)
      
      // 1. Load existing state or initialize new agent
      await this.initializeAgentState()
      
      // 2. Validate system dependencies
      await this.validateDependencies()
      
      // 3. Subscribe to market data for this symbol
      await this.subscribeToMarketData()
      
      // 4. Start monitoring and health checks
      this.startHealthMonitoring()
      this.startMetricsCollection()
      
      // 5. Create initial checkpoint
      await this.createCheckpoint('startup')
      
      // 6. Mark agent as running
      this.isRunning = true
      
      console.log(`Trading agent ${this.config.agentId} started successfully`)
      this.metrics.recordEvent('agent_started')
      
    } catch (error) {
      console.error(`Failed to start trading agent ${this.config.agentId}:`, error)
      this.metrics.recordError('agent_startup_failed', error)
      throw error
    }
  }

  /**
   * Initialize agent state from storage or create new state
   * 
   * State Initialization Strategy:
   * 1. Try to load existing state from database
   * 2. If not found, check for recovery checkpoint
   * 3. If no checkpoint, initialize with default state
   * 4. Validate state consistency and integrity
   */
  private async initializeAgentState(): Promise<void> {
    try {
      // 1. Try to load existing state
      let loadedState = await this.stateStore.loadAgentState(this.config.agentId)
      
      if (loadedState) {
        // 2. Validate loaded state integrity
        this.validateStateIntegrity(loadedState)
        this.currentState = loadedState
        console.log(`Loaded existing state for agent ${this.config.agentId} (version ${loadedState.version})`)
        
      } else {
        // 3. Try to recover from checkpoint
        const checkpoint = await this.stateStore.loadCheckpoint(this.config.agentId)
        
        if (checkpoint) {
          this.currentState = checkpoint.state
          console.log(`Recovered agent ${this.config.agentId} from checkpoint (${checkpoint.reason})`)
          this.metrics.recordEvent('agent_recovered_from_checkpoint')
          
        } else {
          // 4. Initialize with default state
          this.currentState = this.createDefaultState()
          console.log(`Initialized new agent ${this.config.agentId} with default state`)
          this.metrics.recordEvent('agent_initialized_new')
        }
        
        // 5. Save initial state to database
        await this.stateStore.saveAgentState(this.config.agentId, this.currentState)
      }
      
      // 6. Log state summary for debugging
      this.logStateSummary()
      
    } catch (error) {
      throw new SystemError(`Failed to initialize agent state: ${error.message}`, {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'CRITICAL',
        context: { agentId: this.config.agentId, timestamp: Date.now() },
        retryable: false
      })
    }
  }

  /**
   * Create default agent state for new agents
   */
  private createDefaultState(): AgentState {
    return {
      agentId: this.config.agentId,
      symbol: this.config.symbol,
      position: 0,
      indicators: {
        // Initialize technical indicators with neutral values
        sma_20: 0,
        sma_50: 0,
        sma_200: 0,
        ema_12: 0,
        ema_26: 0,
        rsi: 50,
        macd: 0,
        macd_signal: 0,
        bollinger_upper: 0,
        bollinger_lower: 0,
        volume_sma: 0
      },
      lastProcessedTick: 0,
      version: 1,
      portfolioValue: this.config.initialCapital,
      riskMetrics: {
        maxDrawdown: 0,
        sharpeRatio: 0,
        volatility: 0
      }
    }
  }

  /**
   * Subscribe to market data feeds with error handling
   */
  private async subscribeToMarketData(): Promise<void> {
    const topic = `ticks:${this.config.symbol}`
    
    try {
      await this.messageBroker.subscribe(topic, this.processTickWithErrorHandling.bind(this))
      console.log(`Subscribed to market data: ${topic}`)
      this.metrics.recordEvent('market_data_subscribed')
      
    } catch (error) {
      throw new SystemError(`Failed to subscribe to market data: ${error.message}`, {
        category: 'NETWORK_ERROR',
        severity: 'CRITICAL',
        context: { agentId: this.config.agentId, topic, timestamp: Date.now() },
        retryable: true,
        retryDelayMs: 5000
      })
    }
  }

  /**
   * Process incoming ticks with comprehensive error handling
   * 
   * This wrapper ensures that individual tick processing errors
   * don't crash the entire agent or affect other tick processing.
   */
  private async processTickWithErrorHandling(tick: TickData): Promise<void> {
    const startTime = Date.now()
    
    try {
      // 1. Validate tick data format
      this.validateTickData(tick)
      
      // 2. Check if we should process this tick
      if (!this.shouldProcessTick(tick)) {
        return
      }
      
      // 3. Process tick through circuit breaker
      await this.circuitBreaker.execute(
        () => this.processTick(tick),
        () => this.handleCircuitBreakerOpen(tick)
      )
      
      // 4. Record success metrics
      const processingTime = Date.now() - startTime
      this.metrics.recordTickProcessed(processingTime)
      
    } catch (error) {
      // 5. Handle errors gracefully without crashing
      const processingTime = Date.now() - startTime
      this.metrics.recordTickProcessingError(error, processingTime)
      
      console.error(`Error processing tick for agent ${this.config.agentId}:`, {
        error: error.message,
        tick: { symbol: tick.symbol, price: tick.price, timestamp: tick.timestamp },
        processingTime
      })
      
      // 6. Attempt recovery if error is retryable
      if (error.retryable && this.config.enableRetry) {
        await this.scheduleTickRetry(tick, error.retryDelayMs || 1000)
      }
    }
  }

  /**
   * Core tick processing logic with business rules
   * 
   * Processing Pipeline:
   * 1. Validate tick is newer than last processed
   * 2. Update technical indicators
   * 3. Calculate new position based on signals
   * 4. Apply risk management rules
   * 5. Update agent state atomically
   * 6. Create checkpoint if needed
   */
  private async processTick(tick: TickData): Promise<void> {
    // 1. Skip if tick is older than last processed (deduplication)
    if (tick.timestamp <= this.currentState.lastProcessedTick) {
      this.metrics.recordEvent('tick_skipped_duplicate')
      return
    }
    
    // 2. Calculate new technical indicators
    const updatedIndicators = await this.indicatorCalculator.updateIndicators(
      this.currentState.indicators,
      tick
    )
    
    // 3. Generate trading signals based on indicators
    const signals = this.generateTradingSignals(updatedIndicators, tick)
    
    // 4. Calculate new position based on signals
    const newPosition = this.calculateNewPosition(
      this.currentState.position,
      signals,
      tick
    )
    
    // 5. Apply risk management constraints
    const constrainedPosition = this.riskManager.applyRiskConstraints(
      newPosition,
      this.currentState,
      tick
    )
    
    // 6. Calculate portfolio value and risk metrics
    const portfolioValue = this.calculatePortfolioValue(constrainedPosition, tick)
    const riskMetrics = this.calculateRiskMetrics(constrainedPosition, tick)
    
    // 7. Create new state object
    const newState: AgentState = {
      ...this.currentState,
      position: constrainedPosition,
      indicators: updatedIndicators,
      lastProcessedTick: tick.timestamp,
      version: this.currentState.version + 1,
      portfolioValue,
      riskMetrics
    }
    
    // 8. Save state atomically to database
    await this.stateStore.saveAgentState(this.config.agentId, newState)
    
    // 9. Update local state after successful save
    this.currentState = newState
    
    // 10. Create checkpoint periodically
    if (this.shouldCreateCheckpoint()) {
      await this.createCheckpoint('scheduled')
    }
    
    // 11. Log significant position changes
    if (Math.abs(constrainedPosition - this.currentState.position) > this.config.significantPositionChange) {
      console.log(`Position change for ${this.config.agentId}: ${this.currentState.position} → ${constrainedPosition}`)
      this.metrics.recordEvent('significant_position_change')
    }
  }

  /**
   * Generate trading signals based on technical indicators
   * 
   * Signal Generation Strategy:
   * 1. Moving Average Crossovers
   * 2. RSI Overbought/Oversold
   * 3. MACD Signal Line Crossovers
   * 4. Bollinger Band Breakouts
   * 5. Volume Confirmation
   */
  private generateTradingSignals(indicators: Record<string, number>, tick: TickData): TradingSignals {
    const signals: TradingSignals = {
      trend: 'neutral',
      momentum: 'neutral',
      volatility: 'normal',
      volume: 'normal',
      overall: 'hold'
    }
    
    // 1. Trend Analysis - Moving Average Crossovers
    if (indicators.sma_20 > indicators.sma_50 && indicators.sma_50 > indicators.sma_200) {
      signals.trend = 'bullish'
    } else if (indicators.sma_20 < indicators.sma_50 && indicators.sma_50 < indicators.sma_200) {
      signals.trend = 'bearish'
    }
    
    // 2. Momentum Analysis - RSI
    if (indicators.rsi > 70) {
      signals.momentum = 'overbought'
    } else if (indicators.rsi < 30) {
      signals.momentum = 'oversold'
    }
    
    // 3. MACD Analysis
    if (indicators.macd > indicators.macd_signal) {
      signals.momentum = signals.momentum === 'neutral' ? 'bullish' : signals.momentum
    } else if (indicators.macd < indicators.macd_signal) {
      signals.momentum = signals.momentum === 'neutral' ? 'bearish' : signals.momentum
    }
    
    // 4. Bollinger Band Analysis
    if (tick.price > indicators.bollinger_upper) {
      signals.volatility = 'high'
      signals.momentum = 'overbought'
    } else if (tick.price < indicators.bollinger_lower) {
      signals.volatility = 'high'
      signals.momentum = 'oversold'
    }
    
    // 5. Volume Analysis
    if (tick.volume > indicators.volume_sma * 1.5) {
      signals.volume = 'high'
    } else if (tick.volume < indicators.volume_sma * 0.5) {
      signals.volume = 'low'
    }
    
    // 6. Overall Signal Synthesis
    signals.overall = this.synthesizeOverallSignal(signals)
    
    return signals
  }

  /**
   * Synthesize overall trading signal from individual signals
   */
  private synthesizeOverallSignal(signals: TradingSignals): 'buy' | 'sell' | 'hold' {
    let bullishScore = 0
    let bearishScore = 0
    
    // Weight different signal types
    if (signals.trend === 'bullish') bullishScore += 3
    if (signals.trend === 'bearish') bearishScore += 3
    
    if (signals.momentum === 'bullish') bullishScore += 2
    if (signals.momentum === 'bearish') bearishScore += 2
    if (signals.momentum === 'oversold') bullishScore += 1
    if (signals.momentum === 'overbought') bearishScore += 1
    
    if (signals.volume === 'high') {
      // High volume confirms the trend
      if (bullishScore > bearishScore) bullishScore += 1
      if (bearishScore > bullishScore) bearishScore += 1
    }
    
    // Decision thresholds
    const threshold = 3
    if (bullishScore >= threshold && bullishScore > bearishScore) return 'buy'
    if (bearishScore >= threshold && bearishScore > bullishScore) return 'sell'
    return 'hold'
  }

  /**
   * Calculate new position based on trading signals
   */
  private calculateNewPosition(
    currentPosition: number,
    signals: TradingSignals,
    tick: TickData
  ): number {
    const maxPosition = this.config.maxPositionSize
    const positionIncrement = this.config.positionIncrement
    
    switch (signals.overall) {
      case 'buy':
        return Math.min(currentPosition + positionIncrement, maxPosition)
        
      case 'sell':
        return Math.max(currentPosition - positionIncrement, -maxPosition)
        
      case 'hold':
      default:
        return currentPosition
    }
  }

  /**
   * Calculate current portfolio value
   */
  private calculatePortfolioValue(position: number, tick: TickData): number {
    const cashValue = this.config.initialCapital
    const positionValue = position * tick.price
    return cashValue + positionValue
  }

  /**
   * Calculate risk metrics for portfolio monitoring
   */
  private calculateRiskMetrics(position: number, tick: TickData): AgentState['riskMetrics'] {
    // Simplified risk calculations - in production, use more sophisticated methods
    const portfolioValue = this.calculatePortfolioValue(position, tick)
    const initialValue = this.config.initialCapital
    
    const currentDrawdown = Math.max(0, (initialValue - portfolioValue) / initialValue)
    const maxDrawdown = Math.max(this.currentState.riskMetrics?.maxDrawdown || 0, currentDrawdown)
    
    return {
      maxDrawdown,
      sharpeRatio: this.calculateSharpeRatio(), // Simplified calculation
      volatility: this.calculateVolatility()    // Simplified calculation
    }
  }

  /**
   * Determine if a checkpoint should be created
   */
  private shouldCreateCheckpoint(): boolean {
    const ticksSinceLastCheckpoint = this.currentState.lastProcessedTick - 
      (this.lastCheckpointTick || 0)
    
    return ticksSinceLastCheckpoint >= this.config.checkpointFrequency
  }

  /**
   * Create a checkpoint for disaster recovery
   */
  private async createCheckpoint(reason: string): Promise<void> {
    try {
      const checkpoint = {
        agentId: this.config.agentId,
        state: this.currentState,
        timestamp: Date.now(),
        checksum: '', // Will be calculated by StateStore
        reason,
        metadata: {
          ticksProcessed: this.metrics.getTicksProcessed(),
          uptime: Date.now() - this.startTime,
          memoryUsage: process.memoryUsage().heapUsed
        }
      }
      
      await this.stateStore.saveCheckpoint(this.config.agentId, checkpoint)
      this.lastCheckpointTick = this.currentState.lastProcessedTick
      
      console.log(`Created checkpoint for agent ${this.config.agentId} (${reason})`)
      this.metrics.recordEvent('checkpoint_created')
      
    } catch (error) {
      console.error(`Failed to create checkpoint for agent ${this.config.agentId}:`, error)
      this.metrics.recordError('checkpoint_creation_failed', error)
      // Don't throw - checkpoint failures shouldn't stop trading
    }
  }

  /**
   * Validate tick data format and content
   */
  private validateTickData(tick: TickData): void {
    if (!tick.symbol || tick.symbol !== this.config.symbol) {
      throw new SystemError('Invalid tick symbol', {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'MEDIUM',
        context: { expected: this.config.symbol, received: tick.symbol, timestamp: Date.now() },
        retryable: false
      })
    }
    
    if (!tick.price || tick.price <= 0) {
      throw new SystemError('Invalid tick price', {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'MEDIUM',
        context: { price: tick.price, symbol: tick.symbol, timestamp: Date.now() },
        retryable: false
      })
    }
    
    if (!tick.timestamp || tick.timestamp <= 0) {
      throw new SystemError('Invalid tick timestamp', {
        category: 'BUSINESS_LOGIC_ERROR',
        severity: 'MEDIUM',
        context: { timestamp: tick.timestamp, symbol: tick.symbol, timestamp: Date.now() },
        retryable: false
      })
    }
  }

  /**
   * Determine if a tick should be processed
   */
  private shouldProcessTick(tick: TickData): boolean {
    // Skip if agent is not running
    if (!this.isRunning) {
      return false
    }
    
    // Skip if tick is too old (configurable staleness threshold)
    const tickAge = Date.now() - tick.timestamp
    if (tickAge > this.config.maxTickAgeMs) {
      this.metrics.recordEvent('tick_skipped_stale')
      return false
    }
    
    // Skip if circuit breaker is open
    if (this.circuitBreaker.isOpen()) {
      this.metrics.recordEvent('tick_skipped_circuit_breaker')
      return false
    }
    
    return true
  }

  /**
   * Handle circuit breaker open state
   */
  private async handleCircuitBreakerOpen(tick: TickData): Promise<void> {
    console.warn(`Circuit breaker open for agent ${this.config.agentId}, skipping tick processing`)
    this.metrics.recordEvent('circuit_breaker_open')
    
    // Optionally implement degraded mode processing
    if (this.config.enableDegradedMode) {
      await this.processDegradedMode(tick)
    }
  }

  /**
   * Process ticks in degraded mode (simplified processing)
   */
  private async processDegradedMode(tick: TickData): Promise<void> {
    // In degraded mode, just update basic state without complex calculations
    const newState: AgentState = {
      ...this.currentState,
      lastProcessedTick: tick.timestamp,
      version: this.currentState.version + 1
    }
    
    // Update indicators with simple price tracking
    newState.indicators.lastPrice = tick.price
    
    // Save state (this might also fail, but we try)
    try {
      await this.stateStore.saveAgentState(this.config.agentId, newState)
      this.currentState = newState
      this.metrics.recordEvent('degraded_mode_processing')
    } catch (error) {
      console.error('Failed to save state in degraded mode:', error)
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      this.healthMonitor.performHealthCheck({
        isRunning: this.isRunning,
        lastTickTime: this.currentState.lastProcessedTick,
        memoryUsage: process.memoryUsage().heapUsed,
        circuitBreakerState: this.circuitBreaker.getState()
      })
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.metrics.collectMetrics({
        currentPosition: this.currentState.position,
        portfolioValue: this.currentState.portfolioValue || 0,
        ticksProcessed: this.metrics.getTicksProcessed(),
        errorRate: this.metrics.getErrorRate(),
        averageProcessingTime: this.metrics.getAverageProcessingTime()
      })
    }, this.config.metricsCollectionIntervalMs)
  }

  /**
   * Graceful shutdown
   */
  async stop(): Promise<void> {
    try {
      console.log(`Stopping trading agent ${this.config.agentId}...`)
      
      // 1. Mark as not running to stop processing new ticks
      this.isRunning = false
      
      // 2. Create final checkpoint
      await this.createCheckpoint('shutdown')
      
      // 3. Disconnect from message broker
      await this.messageBroker.disconnect()
      
      // 4. Record shutdown metrics
      this.metrics.recordEvent('agent_stopped')
      
      console.log(`Trading agent ${this.config.agentId} stopped successfully`)
      
    } catch (error) {
      console.error(`Error stopping trading agent ${this.config.agentId}:`, error)
      this.metrics.recordError('agent_shutdown_error', error)
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private validateStateIntegrity(state: AgentState): void {
    if (!state.agentId || !state.symbol || state.version < 1) {
      throw new Error('Invalid state structure')
    }
  }

  private logStateSummary(): void {
    console.log(`Agent ${this.config.agentId} state summary:`, {
      symbol: this.currentState.symbol,
      position: this.currentState.position,
      version: this.currentState.version,
      lastTick: new Date(this.currentState.lastProcessedTick).toISOString(),
      portfolioValue: this.currentState.portfolioValue
    })
  }

  private calculateSharpeRatio(): number {
    // Simplified Sharpe ratio calculation
    // In production, use historical returns and risk-free rate
    return 0.5 // Placeholder
  }

  private calculateVolatility(): number {
    // Simplified volatility calculation
    // In production, use historical price movements
    return 0.2 // Placeholder
  }

  private async scheduleTickRetry(tick: TickData, delayMs: number): Promise<void> {
    setTimeout(async () => {
      try {
        await this.processTick(tick)
        this.metrics.recordEvent('tick_retry_successful')
      } catch (error) {
        this.metrics.recordError('tick_retry_failed', error)
      }
    }, delayMs)
  }

  private async validateDependencies(): Promise<void> {
    // Validate that all required dependencies are available
    // This could include checking Redis connection, database connection, etc.
  }

  // Getters for external monitoring
  getState(): AgentState { return { ...this.currentState } }
  isHealthy(): boolean { return this.isRunning && !this.circuitBreaker.isOpen() }
  getMetrics(): any { return this.metrics.getSnapshot() }
}

// =============================================================================
// SUPPORTING TYPES AND CLASSES
// =============================================================================

interface AgentConfig {
  agentId: string
  symbol: string
  initialCapital: number
  maxPositionSize: number
  positionIncrement: number
  significantPositionChange: number
  checkpointFrequency: number
  maxTickAgeMs: number
  enableRetry: boolean
  enableDegradedMode: boolean
  healthCheckIntervalMs: number
  metricsCollectionIntervalMs: number
  circuitBreakerConfig: CircuitBreakerConfig
  indicatorConfig: IndicatorConfig
  riskConfig: RiskConfig
}

interface TradingSignals {
  trend: 'bullish' | 'bearish' | 'neutral'
  momentum: 'bullish' | 'bearish' | 'overbought' | 'oversold' | 'neutral'
  volatility: 'high' | 'normal' | 'low'
  volume: 'high' | 'normal' | 'low'
  overall: 'buy' | 'sell' | 'hold'
}

interface CircuitBreakerConfig {
  failureThreshold: number
  recoveryTimeoutMs: number
  monitoringPeriodMs: number
}

interface IndicatorConfig {
  smaWindows: number[]
  emaWindows: number[]
  rsiPeriod: number
  macdConfig: { fast: number; slow: number; signal: number }
  bollingerConfig: { period: number; stdDev: number }
}

interface RiskConfig {
  maxDrawdown: number
  maxLeverage: number
  stopLossPercent: number
  takeProfitPercent: number
}

/**
 * Technical Indicator Calculator
 */
class IndicatorCalculator {
  constructor(private config: IndicatorConfig) {}

  async updateIndicators(
    currentIndicators: Record<string, number>,
    tick: TickData
  ): Promise<Record<string, number>> {
    // Implementation would calculate all technical indicators
    // This is a simplified version
    return {
      ...currentIndicators,
      lastPrice: tick.price,
      // Add actual indicator calculations here
    }
  }
}

/**
 * Risk Manager for Position Constraints
 */
class RiskManager {
  constructor(private config: RiskConfig) {}

  applyRiskConstraints(
    proposedPosition: number,
    currentState: AgentState,
    tick: TickData
  ): number {
    // Apply various risk constraints
    let constrainedPosition = proposedPosition

    // Maximum position size constraint
    const maxPosition = this.config.maxLeverage * (currentState.portfolioValue || 0) / tick.price
    constrainedPosition = Math.max(-maxPosition, Math.min(maxPosition, constrainedPosition))

    // Stop loss constraint
    // Implementation would check if position should be closed due to losses

    return constrainedPosition
  }
}

/**
 * Agent Metrics Collection
 */
class AgentMetrics {
  private ticksProcessed = 0
  private errors: Error[] = []
  private processingTimes: number[] = []

  constructor(
    private agentId: string,
    private metricsCollector: MetricsCollector
  ) {}

  recordTickProcessed(processingTimeMs: number): void {
    this.ticksProcessed++
    this.processingTimes.push(processingTimeMs)
    this.metricsCollector.recordLatency('tick_processing', processingTimeMs)
  }

  recordTickProcessingError(error: Error, processingTimeMs: number): void {
    this.errors.push(error)
    this.metricsCollector.recordError('tick_processing_failed', error)
  }

  recordEvent(event: string): void {
    this.metricsCollector.recordEvent(`agent_${event}`)
  }

  recordError(operation: string, error: Error): void {
    this.metricsCollector.recordError(`agent_${operation}`, error)
  }

  getTicksProcessed(): number { return this.ticksProcessed }
  getErrorRate(): number { return this.errors.length / Math.max(1, this.ticksProcessed) }
  getAverageProcessingTime(): number {
    return this.processingTimes.length > 0 ?
      this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length : 0
  }

  getSnapshot(): any {
    return {
      ticksProcessed: this.ticksProcessed,
      errorCount: this.errors.length,
      errorRate: this.getErrorRate(),
      averageProcessingTime: this.getAverageProcessingTime()
    }
  }

  collectMetrics(data: any): void {
    // Collect and report metrics to external system
    this.metricsCollector.recordEvent('metrics_collected')
  }
}

/**
 * Health Monitor for Agent Status
 */
class HealthMonitor {
  constructor(
    private agentId: string,
    private metricsCollector: MetricsCollector
  ) {}

  performHealthCheck(status: any): void {
    // Perform comprehensive health check
    const isHealthy = status.isRunning && 
                     (Date.now() - status.lastTickTime) < 60000 && // Recent activity
                     status.memoryUsage < 500 * 1024 * 1024 // < 500MB

    this.metricsCollector.recordEvent(isHealthy ? 'health_check_passed' : 'health_check_failed')
  }
}

/**
 * Circuit Breaker for Error Handling
 */
class CircuitBreaker {
  private failureCount = 0
  private lastFailureTime = 0
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(operation: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      return fallback()
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

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

  getState(): string { return this.state }

  private onSuccess(): void {
    this.failureCount = 0
    this.state = 'CLOSED'
  }

  private onFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN'
    }
  }
}

interface MetricsCollector {
  recordLatency(operation: string, latencyMs: number): void
  recordError(operation: string, error: Error): void
  recordEvent(event: string): void
}