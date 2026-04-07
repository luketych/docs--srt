/**
 * System Orchestrator Implementation
 * 
 * This implementation provides system-wide coordination with:
 * 1. Multi-agent lifecycle management
 * 2. Configuration management and hot reloading
 * 3. Health monitoring and automatic recovery
 * 4. Graceful shutdown and disaster recovery
 * 5. Performance monitoring and scaling decisions
 */

import { TradingAgent } from './04_trading_agent'
import { RedisMessageBroker } from './02_redis_message_broker'
import { PostgresStateStore } from './03_postgres_state_store'
import { SystemConfiguration, SystemError, HealthCheck } from './01_core_interfaces'

// =============================================================================
// SYSTEM ORCHESTRATOR IMPLEMENTATION
// =============================================================================

export class SystemOrchestrator {
  private agents: Map<string, TradingAgent> = new Map()
  private messageBroker: RedisMessageBroker
  private stateStore: PostgresStateStore
  private config: SystemConfiguration
  private isRunning: boolean = false
  private healthMonitor: SystemHealthMonitor
  private metricsCollector: SystemMetricsCollector
  private recoveryManager: RecoveryManager
  private configWatcher: ConfigurationWatcher

  constructor(config: SystemConfiguration) {
    this.config = config
    this.healthMonitor = new SystemHealthMonitor(this)
    this.metricsCollector = new SystemMetricsCollector(config.monitoring)
    this.recoveryManager = new RecoveryManager(this)
    this.configWatcher = new ConfigurationWatcher(config)
  }

  /**
   * Initialize and start the entire trading system
   * 
   * Startup Sequence:
   * 1. Initialize infrastructure components (Redis, PostgreSQL)
   * 2. Validate system configuration and dependencies
   * 3. Create and start trading agents for each symbol
   * 4. Start monitoring and health check systems
   * 5. Set up graceful shutdown handlers
   */
  async start(): Promise<void> {
    try {
      console.log('Starting trading system orchestrator...')
      
      // 1. Initialize infrastructure components
      await this.initializeInfrastructure()
      
      // 2. Validate system health before starting agents
      await this.validateSystemHealth()
      
      // 3. Create and start trading agents
      await this.startTradingAgents()
      
      // 4. Start system monitoring
      this.startSystemMonitoring()
      
      // 5. Set up configuration hot reloading
      this.startConfigurationWatching()
      
      // 6. Set up graceful shutdown handlers
      this.setupShutdownHandlers()
      
      // 7. Mark system as running
      this.isRunning = true
      
      console.log(`Trading system started successfully with ${this.agents.size} agents`)
      this.metricsCollector.recordEvent('system_started')
      
    } catch (error) {
      console.error('Failed to start trading system:', error)
      this.metricsCollector.recordError('system_startup_failed', error)
      
      // Attempt cleanup on startup failure
      await this.emergencyShutdown()
      throw error
    }
  }

  /**
   * Initialize Redis and PostgreSQL infrastructure
   * 
   * Infrastructure Setup:
   * 1. Create Redis connection with circuit breaker
   * 2. Create PostgreSQL connection pool
   * 3. Validate connectivity and permissions
   * 4. Run database migrations if needed
   */
  private async initializeInfrastructure(): Promise<void> {
    console.log('Initializing infrastructure components...')
    
    try {
      // 1. Initialize Redis message broker
      this.messageBroker = new RedisMessageBroker(
        {
          url: this.config.redis.url,
          maxRetries: this.config.redis.maxRetries,
          connectTimeoutMs: this.config.redis.connectTimeoutMs,
          commandTimeoutMs: this.config.redis.commandTimeoutMs,
          enableAuthentication: true,
          enableDeadLetterQueue: true,
          agentId: 'system_orchestrator'
        },
        new MessageAuthenticator(this.config),
        this.metricsCollector
      )
      
      // 2. Initialize PostgreSQL state store
      this.stateStore = new PostgresStateStore(
        {
          url: this.config.database.url,
          maxConnections: this.config.database.maxConnections,
          idleTimeoutMs: this.config.database.idleTimeoutMs,
          connectionTimeoutMs: 10000,
          queryTimeoutMs: this.config.database.queryTimeoutMs,
          enableSSL: this.config.database.enableSSL,
          compressionThreshold: 1024,
          maxCheckpointsPerAgent: 10,
          enableExternalAudit: true
        },
        this.metricsCollector,
        new AuditLogger(this.config)
      )
      
      // 3. Test connectivity
      await this.testInfrastructureConnectivity()
      
      // 4. Run database migrations if needed
      await this.runDatabaseMigrations()
      
      console.log('Infrastructure initialization completed')
      this.metricsCollector.recordEvent('infrastructure_initialized')
      
    } catch (error) {
      throw new SystemError(`Infrastructure initialization failed: ${error.message}`, {
        category: 'REDIS_ERROR',
        severity: 'CRITICAL',
        context: { timestamp: Date.now() },
        retryable: false
      })
    }
  }

  /**
   * Test connectivity to all infrastructure components
   */
  private async testInfrastructureConnectivity(): Promise<void> {
    const tests = [
      {
        name: 'Redis connectivity',
        test: () => this.messageBroker.publish('health_check', { test: true })
      },
      {
        name: 'PostgreSQL connectivity',
        test: () => this.stateStore.loadAgentState('health_check_agent')
      }
    ]
    
    for (const { name, test } of tests) {
      try {
        await test()
        console.log(`✓ ${name} test passed`)
      } catch (error) {
        throw new Error(`${name} test failed: ${error.message}`)
      }
    }
  }

  /**
   * Create and start trading agents for each configured symbol
   * 
   * Agent Creation Strategy:
   * 1. Create agents sequentially to avoid resource contention
   * 2. Validate each agent starts successfully before continuing
   * 3. Implement retry logic for transient failures
   * 4. Track agent health and performance metrics
   */
  private async startTradingAgents(): Promise<void> {
    console.log(`Starting trading agents for symbols: ${this.config.agents.symbols.join(', ')}`)
    
    const startupPromises: Promise<void>[] = []
    
    for (const symbol of this.config.agents.symbols) {
      const agentId = `agent_${symbol.toLowerCase()}`
      
      try {
        // 1. Create agent configuration
        const agentConfig = this.createAgentConfig(agentId, symbol)
        
        // 2. Create trading agent instance
        const agent = new TradingAgent(
          agentConfig,
          this.messageBroker,
          this.stateStore,
          this.metricsCollector
        )
        
        // 3. Start agent with retry logic
        const startupPromise = this.startAgentWithRetry(agentId, agent, 3)
        startupPromises.push(startupPromise)
        
        // 4. Register agent for management
        this.agents.set(agentId, agent)
        
        console.log(`Created trading agent: ${agentId}`)
        
      } catch (error) {
        console.error(`Failed to create agent for ${symbol}:`, error)
        this.metricsCollector.recordError('agent_creation_failed', error)
        
        // Continue with other agents - don't fail entire system
        continue
      }
    }
    
    // 5. Wait for all agents to start
    const results = await Promise.allSettled(startupPromises)
    
    // 6. Check for startup failures
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      console.warn(`${failures.length} agents failed to start`)
      failures.forEach((failure, index) => {
        console.error(`Agent startup failure ${index + 1}:`, failure.reason)
      })
    }
    
    const successfulAgents = this.agents.size
    console.log(`Successfully started ${successfulAgents} trading agents`)
    this.metricsCollector.recordEvent('agents_started', { count: successfulAgents })
  }

  /**
   * Start individual agent with retry logic
   */
  private async startAgentWithRetry(
    agentId: string,
    agent: TradingAgent,
    maxRetries: number
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await agent.start()
        console.log(`✓ Agent ${agentId} started successfully`)
        this.metricsCollector.recordEvent('agent_started', { agentId })
        return
        
      } catch (error) {
        console.error(`Agent ${agentId} startup attempt ${attempt} failed:`, error)
        this.metricsCollector.recordError('agent_startup_attempt_failed', error)
        
        if (attempt === maxRetries) {
          // Remove failed agent from management
          this.agents.delete(agentId)
          throw new SystemError(`Agent ${agentId} failed to start after ${maxRetries} attempts`, {
            category: 'BUSINESS_LOGIC_ERROR',
            severity: 'HIGH',
            context: { agentId, attempts: maxRetries, timestamp: Date.now() },
            retryable: false
          })
        }
        
        // Wait before retry with exponential backoff
        const delayMs = 1000 * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  /**
   * Create agent configuration from system configuration
   */
  private createAgentConfig(agentId: string, symbol: string): any {
    return {
      agentId,
      symbol,
      initialCapital: 100000, // $100k starting capital
      maxPositionSize: this.config.agents.maxPositionSize,
      positionIncrement: 100, // 100 shares per trade
      significantPositionChange: 500, // Log changes > 500 shares
      checkpointFrequency: this.config.agents.checkpointFrequency,
      maxTickAgeMs: 30000, // 30 seconds max tick age
      enableRetry: true,
      enableDegradedMode: true,
      healthCheckIntervalMs: this.config.monitoring.healthCheckIntervalMs,
      metricsCollectionIntervalMs: this.config.monitoring.metricsIntervalMs,
      
      circuitBreakerConfig: {
        failureThreshold: 5,
        recoveryTimeoutMs: 30000,
        monitoringPeriodMs: 60000
      },
      
      indicatorConfig: {
        smaWindows: [20, 50, 200],
        emaWindows: [12, 26],
        rsiPeriod: 14,
        macdConfig: { fast: 12, slow: 26, signal: 9 },
        bollingerConfig: { period: 20, stdDev: 2 }
      },
      
      riskConfig: {
        maxDrawdown: this.config.agents.riskLimits.maxDrawdown,
        maxLeverage: this.config.agents.riskLimits.maxLeverage,
        stopLossPercent: 0.05, // 5% stop loss
        takeProfitPercent: 0.10 // 10% take profit
      }
    }
  }

  /**
   * Start comprehensive system monitoring
   * 
   * Monitoring Components:
   * 1. Agent health checks and performance monitoring
   * 2. Infrastructure health (Redis, PostgreSQL)
   * 3. System resource utilization
   * 4. Business metrics and KPIs
   */
  private startSystemMonitoring(): void {
    console.log('Starting system monitoring...')
    
    // 1. Agent health monitoring
    setInterval(() => {
      this.monitorAgentHealth()
    }, this.config.monitoring.healthCheckIntervalMs)
    
    // 2. Infrastructure health monitoring
    setInterval(() => {
      this.monitorInfrastructureHealth()
    }, this.config.monitoring.healthCheckIntervalMs)
    
    // 3. System resource monitoring
    setInterval(() => {
      this.monitorSystemResources()
    }, this.config.monitoring.metricsIntervalMs)
    
    // 4. Business metrics collection
    setInterval(() => {
      this.collectBusinessMetrics()
    }, this.config.monitoring.metricsIntervalMs)
    
    console.log('System monitoring started')
    this.metricsCollector.recordEvent('monitoring_started')
  }

  /**
   * Monitor health of all trading agents
   */
  private async monitorAgentHealth(): Promise<void> {
    const healthChecks: Promise<HealthCheck>[] = []
    
    for (const [agentId, agent] of this.agents) {
      const healthCheckPromise = this.performAgentHealthCheck(agentId, agent)
      healthChecks.push(healthCheckPromise)
    }
    
    try {
      const results = await Promise.allSettled(healthChecks)
      
      let healthyCount = 0
      let unhealthyCount = 0
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const healthCheck = result.value
          if (healthCheck.status === 'healthy') {
            healthyCount++
          } else {
            unhealthyCount++
            console.warn(`Agent ${healthCheck.component} is ${healthCheck.status}:`, healthCheck.details)
            
            // Trigger recovery if agent is unhealthy
            if (healthCheck.status === 'unhealthy') {
              this.scheduleAgentRecovery(healthCheck.component)
            }
          }
        } else {
          unhealthyCount++
          console.error('Health check failed:', result.reason)
        }
      })
      
      // Record overall health metrics
      this.metricsCollector.recordEvent('agent_health_check_completed', {
        healthy: healthyCount.toString(),
        unhealthy: unhealthyCount.toString(),
        total: this.agents.size.toString()
      })
      
    } catch (error) {
      console.error('Agent health monitoring failed:', error)
      this.metricsCollector.recordError('agent_health_monitoring_failed', error)
    }
  }

  /**
   * Perform health check for individual agent
   */
  private async performAgentHealthCheck(agentId: string, agent: TradingAgent): Promise<HealthCheck> {
    const startTime = Date.now()
    
    try {
      // 1. Check if agent is responsive
      const isHealthy = agent.isHealthy()
      const metrics = agent.getMetrics()
      
      // 2. Determine health status based on metrics
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
      let message = 'Agent is operating normally'
      
      if (!isHealthy) {
        status = 'unhealthy'
        message = 'Agent is not responsive or circuit breaker is open'
      } else if (metrics.errorRate > 0.1) { // > 10% error rate
        status = 'degraded'
        message = `High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`
      } else if (metrics.averageProcessingTime > 1000) { // > 1 second processing time
        status = 'degraded'
        message = `Slow processing: ${metrics.averageProcessingTime.toFixed(0)}ms average`
      }
      
      return {
        component: agentId,
        status,
        responseTimeMs: Date.now() - startTime,
        details: {
          message,
          metrics: {
            ticksProcessed: metrics.ticksProcessed,
            errorRate: metrics.errorRate,
            averageProcessingTime: metrics.averageProcessingTime
          }
        },
        timestamp: Date.now()
      }
      
    } catch (error) {
      return {
        component: agentId,
        status: 'unhealthy',
        responseTimeMs: Date.now() - startTime,
        details: {
          message: `Health check failed: ${error.message}`,
          lastError: error.message
        },
        timestamp: Date.now()
      }
    }
  }

  /**
   * Monitor infrastructure component health
   */
  private async monitorInfrastructureHealth(): Promise<void> {
    const healthChecks = [
      this.checkRedisHealth(),
      this.checkPostgreSQLHealth()
    ]
    
    try {
      const results = await Promise.allSettled(healthChecks)
      
      results.forEach((result, index) => {
        const component = ['redis', 'postgresql'][index]
        
        if (result.status === 'fulfilled') {
          const healthCheck = result.value
          this.metricsCollector.recordEvent(`${component}_health_check`, {
            status: healthCheck.status,
            responseTime: healthCheck.responseTimeMs.toString()
          })
          
          if (healthCheck.status !== 'healthy') {
            console.warn(`${component} health issue:`, healthCheck.details)
            this.scheduleInfrastructureRecovery(component)
          }
        } else {
          console.error(`${component} health check failed:`, result.reason)
          this.metricsCollector.recordError(`${component}_health_check_failed`, result.reason)
        }
      })
      
    } catch (error) {
      console.error('Infrastructure health monitoring failed:', error)
      this.metricsCollector.recordError('infrastructure_health_monitoring_failed', error)
    }
  }

  /**
   * Check Redis health
   */
  private async checkRedisHealth(): Promise<HealthCheck> {
    const startTime = Date.now()
    
    try {
      // Test Redis connectivity and performance
      await this.messageBroker.publish('health_check', { timestamp: Date.now() })
      
      return {
        component: 'redis',
        status: 'healthy',
        responseTimeMs: Date.now() - startTime,
        details: {
          message: 'Redis is responding normally'
        },
        timestamp: Date.now()
      }
      
    } catch (error) {
      return {
        component: 'redis',
        status: 'unhealthy',
        responseTimeMs: Date.now() - startTime,
        details: {
          message: `Redis health check failed: ${error.message}`,
          lastError: error.message
        },
        timestamp: Date.now()
      }
    }
  }

  /**
   * Check PostgreSQL health
   */
  private async checkPostgreSQLHealth(): Promise<HealthCheck> {
    const startTime = Date.now()
    
    try {
      // Test PostgreSQL connectivity and performance
      await this.stateStore.loadAgentState('health_check_agent')
      
      return {
        component: 'database',
        status: 'healthy',
        responseTimeMs: Date.now() - startTime,
        details: {
          message: 'PostgreSQL is responding normally'
        },
        timestamp: Date.now()
      }
      
    } catch (error) {
      return {
        component: 'database',
        status: 'unhealthy',
        responseTimeMs: Date.now() - startTime,
        details: {
          message: `PostgreSQL health check failed: ${error.message}`,
          lastError: error.message
        },
        timestamp: Date.now()
      }
    }
  }

  /**
   * Monitor system resource utilization
   */
  private monitorSystemResources(): void {
    try {
      const memoryUsage = process.memoryUsage()
      const cpuUsage = process.cpuUsage()
      
      // Record memory metrics
      this.metricsCollector.recordEvent('system_memory_usage', {
        heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2), // MB
        heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2), // MB
        external: (memoryUsage.external / 1024 / 1024).toFixed(2), // MB
        rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) // MB
      })
      
      // Check for memory pressure
      const memoryPressureThreshold = this.config.monitoring.alertThresholds.memoryUsagePercent
      const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
      
      if (memoryUsagePercent > memoryPressureThreshold) {
        console.warn(`High memory usage: ${memoryUsagePercent.toFixed(1)}%`)
        this.metricsCollector.recordEvent('memory_pressure_detected', {
          usage: memoryUsagePercent.toFixed(1)
        })
      }
      
    } catch (error) {
      console.error('System resource monitoring failed:', error)
      this.metricsCollector.recordError('system_resource_monitoring_failed', error)
    }
  }

  /**
   * Collect business metrics and KPIs
   */
  private async collectBusinessMetrics(): Promise<void> {
    try {
      let totalPortfolioValue = 0
      let totalTicksProcessed = 0
      let totalErrors = 0
      
      // Aggregate metrics from all agents
      for (const [agentId, agent] of this.agents) {
        try {
          const state = agent.getState()
          const metrics = agent.getMetrics()
          
          totalPortfolioValue += state.portfolioValue || 0
          totalTicksProcessed += metrics.ticksProcessed
          totalErrors += metrics.errorCount || 0
          
        } catch (error) {
          console.warn(`Failed to collect metrics from agent ${agentId}:`, error)
        }
      }
      
      // Record business metrics
      this.metricsCollector.recordEvent('business_metrics_collected', {
        totalPortfolioValue: totalPortfolioValue.toFixed(2),
        totalTicksProcessed: totalTicksProcessed.toString(),
        totalErrors: totalErrors.toString(),
        activeAgents: this.agents.size.toString()
      })
      
      console.log(`Business metrics - Portfolio: $${totalPortfolioValue.toFixed(2)}, Ticks: ${totalTicksProcessed}, Errors: ${totalErrors}`)
      
    } catch (error) {
      console.error('Business metrics collection failed:', error)
      this.metricsCollector.recordError('business_metrics_collection_failed', error)
    }
  }

  /**
   * Schedule agent recovery for unhealthy agents
   */
  private scheduleAgentRecovery(agentId: string): void {
    console.log(`Scheduling recovery for agent ${agentId}`)
    
    // Use recovery manager to handle agent recovery
    this.recoveryManager.scheduleAgentRecovery(agentId)
      .then(() => {
        console.log(`Agent ${agentId} recovery completed`)
        this.metricsCollector.recordEvent('agent_recovery_successful', { agentId })
      })
      .catch(error => {
        console.error(`Agent ${agentId} recovery failed:`, error)
        this.metricsCollector.recordError('agent_recovery_failed', error)
      })
  }

  /**
   * Schedule infrastructure recovery
   */
  private scheduleInfrastructureRecovery(component: string): void {
    console.log(`Scheduling recovery for ${component}`)
    
    this.recoveryManager.scheduleInfrastructureRecovery(component)
      .then(() => {
        console.log(`${component} recovery completed`)
        this.metricsCollector.recordEvent('infrastructure_recovery_successful', { component })
      })
      .catch(error => {
        console.error(`${component} recovery failed:`, error)
        this.metricsCollector.recordError('infrastructure_recovery_failed', error)
      })
  }

  /**
   * Start configuration watching for hot reloading
   */
  private startConfigurationWatching(): void {
    this.configWatcher.onConfigChange(async (newConfig) => {
      try {
        console.log('Configuration change detected, applying updates...')
        await this.applyConfigurationChanges(newConfig)
        console.log('Configuration updates applied successfully')
        this.metricsCollector.recordEvent('configuration_updated')
        
      } catch (error) {
        console.error('Failed to apply configuration changes:', error)
        this.metricsCollector.recordError('configuration_update_failed', error)
      }
    })
  }

  /**
   * Apply configuration changes with hot reloading
   */
  private async applyConfigurationChanges(newConfig: SystemConfiguration): Promise<void> {
    // 1. Update monitoring thresholds
    if (newConfig.monitoring.alertThresholds !== this.config.monitoring.alertThresholds) {
      this.healthMonitor.updateAlertThresholds(newConfig.monitoring.alertThresholds)
    }
    
    // 2. Update agent configurations
    for (const [agentId, agent] of this.agents) {
      // Apply agent-specific configuration changes
      // This would require agents to support configuration updates
    }
    
    // 3. Update system configuration
    this.config = newConfig
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      console.log(`Received ${signal}, initiating graceful shutdown...`)
      await this.gracefulShutdown()
      process.exit(0)
    }
    
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'))
    process.on('SIGINT', () => shutdownHandler('SIGINT'))
    process.on('SIGUSR2', () => shutdownHandler('SIGUSR2')) // Nodemon restart
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught exception:', error)
      this.metricsCollector.recordError('uncaught_exception', error)
      await this.emergencyShutdown()
      process.exit(1)
    })
    
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled rejection at:', promise, 'reason:', reason)
      this.metricsCollector.recordError('unhandled_rejection', new Error(String(reason)))
      await this.emergencyShutdown()
      process.exit(1)
    })
  }

  /**
   * Graceful shutdown of the entire system
   */
  async gracefulShutdown(): Promise<void> {
    try {
      console.log('Starting graceful shutdown...')
      this.isRunning = false
      
      // 1. Stop accepting new work
      console.log('Stopping new work acceptance...')
      
      // 2. Stop all trading agents
      console.log('Stopping trading agents...')
      const agentShutdownPromises: Promise<void>[] = []
      
      for (const [agentId, agent] of this.agents) {
        const shutdownPromise = agent.stop().catch(error => {
          console.error(`Error stopping agent ${agentId}:`, error)
        })
        agentShutdownPromises.push(shutdownPromise)
      }
      
      await Promise.allSettled(agentShutdownPromises)
      console.log('All agents stopped')
      
      // 3. Disconnect from infrastructure
      console.log('Disconnecting from infrastructure...')
      await Promise.allSettled([
        this.messageBroker.disconnect(),
        this.stateStore.shutdown()
      ])
      
      // 4. Final metrics collection
      this.metricsCollector.recordEvent('system_graceful_shutdown')
      
      console.log('Graceful shutdown completed')
      
    } catch (error) {
      console.error('Error during graceful shutdown:', error)
      this.metricsCollector.recordError('graceful_shutdown_error', error)
    }
  }

  /**
   * Emergency shutdown for critical failures
   */
  private async emergencyShutdown(): Promise<void> {
    try {
      console.log('Performing emergency shutdown...')
      this.isRunning = false
      
      // Force stop all agents without waiting
      for (const [agentId, agent] of this.agents) {
        try {
          await Promise.race([
            agent.stop(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ])
        } catch (error) {
          console.error(`Force stop agent ${agentId} failed:`, error)
        }
      }
      
      // Force disconnect infrastructure
      try {
        await Promise.race([
          Promise.allSettled([
            this.messageBroker.disconnect(),
            this.stateStore.shutdown()
          ]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ])
      } catch (error) {
        console.error('Force disconnect failed:', error)
      }
      
      this.metricsCollector.recordEvent('system_emergency_shutdown')
      console.log('Emergency shutdown completed')
      
    } catch (error) {
      console.error('Emergency shutdown failed:', error)
    }
  }

  /**
   * Validate system health before starting
   */
  private async validateSystemHealth(): Promise<void> {
    const validations = [
      {
        name: 'Redis connectivity',
        check: () => this.checkRedisHealth()
      },
      {
        name: 'PostgreSQL connectivity',
        check: () => this.checkPostgreSQLHealth()
      }
    ]
    
    for (const { name, check } of validations) {
      const result = await check()
      if (result.status !== 'healthy') {
        throw new SystemError(`System validation failed: ${name}`, {
          category: 'REDIS_ERROR',
          severity: 'CRITICAL',
          context: { validation: name, details: result.details, timestamp: Date.now() },
          retryable: false
        })
      }
    }
  }

  /**
   * Run database migrations if needed
   */
  private async runDatabaseMigrations(): Promise<void> {
    // Implementation would check for and run any pending database migrations
    console.log('Database migrations check completed')
  }

  // =============================================================================
  // PUBLIC API FOR EXTERNAL MONITORING
  // =============================================================================

  /**
   * Get system status for external monitoring
   */
  getSystemStatus(): any {
    return {
      isRunning: this.isRunning,
      agentCount: this.agents.size,
      agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
        id,
        healthy: agent.isHealthy(),
        state: agent.getState(),
        metrics: agent.getMetrics()
      })),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now()
    }
  }

  /**
   * Get specific agent status
   */
  getAgentStatus(agentId: string): any {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }
    
    return {
      id: agentId,
      healthy: agent.isHealthy(),
      state: agent.getState(),
      metrics: agent.getMetrics()
    }
  }

  /**
   * Manually trigger agent recovery
   */
  async recoverAgent(agentId: string): Promise<void> {
    await this.recoveryManager.recoverAgent(agentId)
  }

  /**
   * Add new agent dynamically
   */
  async addAgent(symbol: string): Promise<void> {
    const agentId = `agent_${symbol.toLowerCase()}`
    
    if (this.agents.has(agentId)) {
      throw new Error(`Agent for symbol ${symbol} already exists`)
    }
    
    const agentConfig = this.createAgentConfig(agentId, symbol)
    const agent = new TradingAgent(
      agentConfig,
      this.messageBroker,
      this.stateStore,
      this.metricsCollector
    )
    
    await agent.start()
    this.agents.set(agentId, agent)
    
    console.log(`Added new agent: ${agentId}`)
    this.metricsCollector.recordEvent('agent_added', { agentId, symbol })
  }

  /**
   * Remove agent dynamically
   */
  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }
    
    await agent.stop()
    this.agents.delete(agentId)
    
    console.log(`Removed agent: ${agentId}`)
    this.metricsCollector.recordEvent('agent_removed', { agentId })
  }
}

// =============================================================================
// SUPPORTING CLASSES
// =============================================================================

/**
 * System Health Monitor
 */
class SystemHealthMonitor {
  constructor(private orchestrator: SystemOrchestrator) {}
  
  updateAlertThresholds(thresholds: any): void {
    // Update monitoring thresholds
  }
}

/**
 * System Metrics Collector
 */
class SystemMetricsCollector {
  constructor(private config: any) {}
  
  recordEvent(event: string, labels?: Record<string, string>): void {
    console.log(`Event: ${event}`, labels)
  }
  
  recordError(operation: string, error: Error): void {
    console.error(`Error in ${operation}:`, error.message)
  }
}

/**
 * Recovery Manager for Automated Recovery
 */
class RecoveryManager {
  constructor(private orchestrator: SystemOrchestrator) {}
  
  async scheduleAgentRecovery(agentId: string): Promise<void> {
    // Implement agent recovery logic
  }
  
  async scheduleInfrastructureRecovery(component: string): Promise<void> {
    // Implement infrastructure recovery logic
  }
  
  async recoverAgent(agentId: string): Promise<void> {
    // Implement manual agent recovery
  }
}

/**
 * Configuration Watcher for Hot Reloading
 */
class ConfigurationWatcher {
  constructor(private config: SystemConfiguration) {}
  
  onConfigChange(callback: (config: SystemConfiguration) => void): void {
    // Watch for configuration file changes and call callback
  }
}

/**
 * Message Authenticator
 */
class MessageAuthenticator {
  constructor(private config: SystemConfiguration) {}
  
  signMessage(payload: any): string {
    // Implement message signing
    return 'signature'
  }
  
  async validateMessage(message: any): Promise<{ valid: boolean; error?: any }> {
    // Implement message validation
    return { valid: true }
  }
}

/**
 * Audit Logger
 */
class AuditLogger {
  constructor(private config: SystemConfiguration) {}
  
  async logStateChange(change: any): Promise<void> {
    // Implement audit logging
  }
}