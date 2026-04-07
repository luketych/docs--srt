/**
 * Configuration Management System
 * 
 * This implementation provides comprehensive configuration management with:
 * 1. Environment-specific configuration loading
 * 2. Hot reloading and dynamic updates
 * 3. Configuration validation and schema enforcement
 * 4. Secrets management and security
 * 5. Configuration versioning and rollback capabilities
 */

import { SystemConfiguration } from './01_core_interfaces'

// =============================================================================
// CONFIGURATION MANAGER IMPLEMENTATION
// =============================================================================

export class ConfigurationManager {
  private currentConfig: SystemConfiguration
  private configWatchers: ConfigWatcher[] = []
  private validators: ConfigValidator[] = []
  private secretsManager: SecretsManager
  private configHistory: ConfigurationVersion[] = []
  private isWatching: boolean = false

  constructor(
    private environment: string = process.env.NODE_ENV || 'development',
    private configPath: string = process.env.CONFIG_PATH || './config'
  ) {
    this.secretsManager = new SecretsManager(environment)
    this.setupValidators()
  }

  /**
   * Load and initialize configuration
   * 
   * Loading Strategy:
   * 1. Load base configuration for environment
   * 2. Apply environment-specific overrides
   * 3. Inject secrets from secure storage
   * 4. Validate complete configuration
   * 5. Start configuration watching if enabled
   */
  async initialize(): Promise<SystemConfiguration> {
    try {
      console.log(`Loading configuration for environment: ${this.environment}`)
      
      // 1. Load base configuration
      const baseConfig = await this.loadBaseConfiguration()
      
      // 2. Apply environment overrides
      const envConfig = await this.applyEnvironmentOverrides(baseConfig)
      
      // 3. Inject secrets
      const configWithSecrets = await this.injectSecrets(envConfig)
      
      // 4. Validate configuration
      await this.validateConfiguration(configWithSecrets)
      
      // 5. Store as current configuration
      this.currentConfig = configWithSecrets
      this.addToHistory(configWithSecrets, 'initial_load')
      
      // 6. Start watching for changes
      if (this.shouldWatchConfig()) {
        await this.startConfigWatching()
      }
      
      console.log('Configuration loaded successfully')
      return this.currentConfig
      
    } catch (error) {
      console.error('Configuration loading failed:', error)
      throw new ConfigurationError(`Failed to load configuration: ${error.message}`, {
        environment: this.environment,
        configPath: this.configPath,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Load base configuration from files
   * 
   * Configuration File Structure:
   * - config/default.json (base configuration)
   * - config/development.json (dev overrides)
   * - config/staging.json (staging overrides)
   * - config/production.json (prod overrides)
   */
  private async loadBaseConfiguration(): Promise<Partial<SystemConfiguration>> {
    const fs = require('fs').promises
    const path = require('path')
    
    try {
      // 1. Load default configuration
      const defaultConfigPath = path.join(this.configPath, 'default.json')
      const defaultConfigData = await fs.readFile(defaultConfigPath, 'utf8')
      const defaultConfig = JSON.parse(defaultConfigData)
      
      console.log('Loaded default configuration')
      return defaultConfig
      
    } catch (error) {
      throw new Error(`Failed to load base configuration: ${error.message}`)
    }
  }

  /**
   * Apply environment-specific configuration overrides
   */
  private async applyEnvironmentOverrides(
    baseConfig: Partial<SystemConfiguration>
  ): Promise<Partial<SystemConfiguration>> {
    const fs = require('fs').promises
    const path = require('path')
    
    try {
      // 1. Try to load environment-specific config
      const envConfigPath = path.join(this.configPath, `${this.environment}.json`)
      
      try {
        const envConfigData = await fs.readFile(envConfigPath, 'utf8')
        const envConfig = JSON.parse(envConfigData)
        
        // 2. Deep merge environment config with base config
        const mergedConfig = this.deepMerge(baseConfig, envConfig)
        
        console.log(`Applied ${this.environment} configuration overrides`)
        return mergedConfig
        
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.log(`No environment-specific config found for ${this.environment}, using defaults`)
          return baseConfig
        }
        throw error
      }
      
    } catch (error) {
      throw new Error(`Failed to apply environment overrides: ${error.message}`)
    }
  }

  /**
   * Inject secrets from secure storage
   * 
   * Secrets Management Strategy:
   * 1. Replace placeholder values with actual secrets
   * 2. Support multiple secret sources (env vars, vault, etc.)
   * 3. Validate secret availability and format
   * 4. Log secret injection without exposing values
   */
  private async injectSecrets(
    config: Partial<SystemConfiguration>
  ): Promise<SystemConfiguration> {
    try {
      // 1. Create a deep copy to avoid mutating input
      const configWithSecrets = JSON.parse(JSON.stringify(config))
      
      // 2. Inject Redis secrets
      if (configWithSecrets.redis) {
        configWithSecrets.redis.url = await this.secretsManager.getSecret(
          'REDIS_URL',
          configWithSecrets.redis.url
        )
      }
      
      // 3. Inject database secrets
      if (configWithSecrets.database) {
        configWithSecrets.database.url = await this.secretsManager.getSecret(
          'DATABASE_URL',
          configWithSecrets.database.url
        )
      }
      
      // 4. Inject monitoring secrets
      if (configWithSecrets.monitoring?.apiKeys) {
        for (const [key, placeholder] of Object.entries(configWithSecrets.monitoring.apiKeys)) {
          configWithSecrets.monitoring.apiKeys[key] = await this.secretsManager.getSecret(
            `MONITORING_${key.toUpperCase()}_API_KEY`,
            placeholder as string
          )
        }
      }
      
      // 5. Validate all required secrets are present
      await this.validateSecrets(configWithSecrets)
      
      console.log('Secrets injected successfully')
      return configWithSecrets as SystemConfiguration
      
    } catch (error) {
      throw new Error(`Failed to inject secrets: ${error.message}`)
    }
  }

  /**
   * Validate complete configuration against schema
   */
  private async validateConfiguration(config: SystemConfiguration): Promise<void> {
    const validationErrors: string[] = []
    
    // 1. Run all registered validators
    for (const validator of this.validators) {
      try {
        const result = await validator.validate(config)
        if (!result.valid) {
          validationErrors.push(...result.errors)
        }
      } catch (error) {
        validationErrors.push(`Validator ${validator.name} failed: ${error.message}`)
      }
    }
    
    // 2. Check for validation errors
    if (validationErrors.length > 0) {
      throw new ConfigurationError('Configuration validation failed', {
        errors: validationErrors,
        timestamp: Date.now()
      })
    }
    
    console.log('Configuration validation passed')
  }

  /**
   * Start watching configuration files for changes
   */
  private async startConfigWatching(): Promise<void> {
    if (this.isWatching) {
      return
    }
    
    try {
      const fs = require('fs')
      const path = require('path')
      
      // 1. Watch default configuration file
      const defaultConfigPath = path.join(this.configPath, 'default.json')
      this.watchConfigFile(defaultConfigPath, 'default')
      
      // 2. Watch environment-specific configuration file
      const envConfigPath = path.join(this.configPath, `${this.environment}.json`)
      if (fs.existsSync(envConfigPath)) {
        this.watchConfigFile(envConfigPath, this.environment)
      }
      
      this.isWatching = true
      console.log('Configuration watching started')
      
    } catch (error) {
      console.error('Failed to start configuration watching:', error)
    }
  }

  /**
   * Watch individual configuration file for changes
   */
  private watchConfigFile(filePath: string, configType: string): void {
    const fs = require('fs')
    
    const watcher = fs.watch(filePath, { persistent: false }, async (eventType: string) => {
      if (eventType === 'change') {
        console.log(`Configuration file changed: ${configType}`)
        
        try {
          // 1. Reload configuration
          const newConfig = await this.reloadConfiguration()
          
          // 2. Notify watchers of configuration change
          await this.notifyConfigWatchers(newConfig)
          
          console.log('Configuration reloaded successfully')
          
        } catch (error) {
          console.error('Failed to reload configuration:', error)
          
          // 3. Optionally rollback to previous configuration
          if (this.shouldRollbackOnError()) {
            await this.rollbackToPreviousConfiguration()
          }
        }
      }
    })
    
    watcher.on('error', (error) => {
      console.error(`Configuration file watcher error for ${configType}:`, error)
    })
  }

  /**
   * Reload configuration from files
   */
  private async reloadConfiguration(): Promise<SystemConfiguration> {
    // 1. Load fresh configuration
    const baseConfig = await this.loadBaseConfiguration()
    const envConfig = await this.applyEnvironmentOverrides(baseConfig)
    const configWithSecrets = await this.injectSecrets(envConfig)
    
    // 2. Validate new configuration
    await this.validateConfiguration(configWithSecrets)
    
    // 3. Store previous configuration for rollback
    this.addToHistory(this.currentConfig, 'backup_before_reload')
    
    // 4. Update current configuration
    this.currentConfig = configWithSecrets
    this.addToHistory(configWithSecrets, 'hot_reload')
    
    return configWithSecrets
  }

  /**
   * Notify all registered watchers of configuration changes
   */
  private async notifyConfigWatchers(newConfig: SystemConfiguration): Promise<void> {
    const notifications: Promise<void>[] = []
    
    for (const watcher of this.configWatchers) {
      const notification = watcher.onConfigChange(newConfig, this.currentConfig)
        .catch(error => {
          console.error(`Config watcher ${watcher.name} failed:`, error)
        })
      
      notifications.push(notification)
    }
    
    // Wait for all notifications to complete
    await Promise.allSettled(notifications)
  }

  /**
   * Register configuration change watcher
   */
  registerWatcher(watcher: ConfigWatcher): void {
    this.configWatchers.push(watcher)
    console.log(`Registered configuration watcher: ${watcher.name}`)
  }

  /**
   * Unregister configuration change watcher
   */
  unregisterWatcher(watcherName: string): void {
    const index = this.configWatchers.findIndex(w => w.name === watcherName)
    if (index >= 0) {
      this.configWatchers.splice(index, 1)
      console.log(`Unregistered configuration watcher: ${watcherName}`)
    }
  }

  /**
   * Get current configuration
   */
  getCurrentConfiguration(): SystemConfiguration {
    if (!this.currentConfig) {
      throw new Error('Configuration not initialized')
    }
    
    // Return a deep copy to prevent external modification
    return JSON.parse(JSON.stringify(this.currentConfig))
  }

  /**
   * Update configuration programmatically
   */
  async updateConfiguration(
    updates: Partial<SystemConfiguration>,
    reason: string = 'programmatic_update'
  ): Promise<void> {
    try {
      // 1. Create updated configuration
      const updatedConfig = this.deepMerge(this.currentConfig, updates)
      
      // 2. Validate updated configuration
      await this.validateConfiguration(updatedConfig as SystemConfiguration)
      
      // 3. Store previous configuration for rollback
      this.addToHistory(this.currentConfig, 'backup_before_update')
      
      // 4. Apply updates
      this.currentConfig = updatedConfig as SystemConfiguration
      this.addToHistory(this.currentConfig, reason)
      
      // 5. Notify watchers
      await this.notifyConfigWatchers(this.currentConfig)
      
      console.log(`Configuration updated: ${reason}`)
      
    } catch (error) {
      throw new ConfigurationError(`Failed to update configuration: ${error.message}`, {
        updates,
        reason,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Rollback to previous configuration version
   */
  async rollbackToPreviousConfiguration(): Promise<void> {
    if (this.configHistory.length < 2) {
      throw new Error('No previous configuration available for rollback')
    }
    
    try {
      // 1. Find the most recent backup configuration
      const backupConfig = this.configHistory
        .slice()
        .reverse()
        .find(version => version.reason.includes('backup'))
      
      if (!backupConfig) {
        throw new Error('No backup configuration found')
      }
      
      // 2. Validate backup configuration
      await this.validateConfiguration(backupConfig.config)
      
      // 3. Rollback to backup configuration
      this.currentConfig = backupConfig.config
      this.addToHistory(this.currentConfig, 'rollback')
      
      // 4. Notify watchers
      await this.notifyConfigWatchers(this.currentConfig)
      
      console.log(`Configuration rolled back to version from ${new Date(backupConfig.timestamp).toISOString()}`)
      
    } catch (error) {
      throw new ConfigurationError(`Failed to rollback configuration: ${error.message}`, {
        timestamp: Date.now()
      })
    }
  }

  /**
   * Get configuration history
   */
  getConfigurationHistory(): ConfigurationVersion[] {
    return this.configHistory.slice() // Return copy
  }

  /**
   * Export configuration for backup or deployment
   */
  exportConfiguration(includeSensitive: boolean = false): string {
    const configToExport = includeSensitive ? 
      this.currentConfig : 
      this.sanitizeConfiguration(this.currentConfig)
    
    return JSON.stringify(configToExport, null, 2)
  }

  /**
   * Import configuration from backup or deployment
   */
  async importConfiguration(
    configData: string,
    reason: string = 'import'
  ): Promise<void> {
    try {
      // 1. Parse configuration data
      const importedConfig = JSON.parse(configData) as SystemConfiguration
      
      // 2. Validate imported configuration
      await this.validateConfiguration(importedConfig)
      
      // 3. Apply imported configuration
      await this.updateConfiguration(importedConfig, reason)
      
      console.log(`Configuration imported: ${reason}`)
      
    } catch (error) {
      throw new ConfigurationError(`Failed to import configuration: ${error.message}`, {
        reason,
        timestamp: Date.now()
      })
    }
  }

  // =============================================================================
  // PRIVATE UTILITY METHODS
  // =============================================================================

  /**
   * Deep merge two configuration objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target }
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }
    
    return result
  }

  /**
   * Add configuration to history
   */
  private addToHistory(config: SystemConfiguration, reason: string): void {
    this.configHistory.push({
      config: JSON.parse(JSON.stringify(config)), // Deep copy
      timestamp: Date.now(),
      reason,
      version: this.generateVersionHash(config)
    })
    
    // Keep only last 10 versions
    if (this.configHistory.length > 10) {
      this.configHistory.shift()
    }
  }

  /**
   * Generate version hash for configuration
   */
  private generateVersionHash(config: SystemConfiguration): string {
    const crypto = require('crypto')
    const configString = JSON.stringify(config, Object.keys(config).sort())
    return crypto.createHash('sha256').update(configString).digest('hex').substring(0, 8)
  }

  /**
   * Sanitize configuration by removing sensitive data
   */
  private sanitizeConfiguration(config: SystemConfiguration): any {
    const sanitized = JSON.parse(JSON.stringify(config))
    
    // Remove sensitive fields
    if (sanitized.redis?.url) {
      sanitized.redis.url = this.maskUrl(sanitized.redis.url)
    }
    
    if (sanitized.database?.url) {
      sanitized.database.url = this.maskUrl(sanitized.database.url)
    }
    
    if (sanitized.monitoring?.apiKeys) {
      for (const key in sanitized.monitoring.apiKeys) {
        sanitized.monitoring.apiKeys[key] = '***MASKED***'
      }
    }
    
    return sanitized
  }

  /**
   * Mask sensitive parts of URLs
   */
  private maskUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      if (urlObj.password) {
        urlObj.password = '***'
      }
      return urlObj.toString()
    } catch {
      return '***MASKED_URL***'
    }
  }

  /**
   * Setup configuration validators
   */
  private setupValidators(): void {
    // 1. Redis configuration validator
    this.validators.push(new RedisConfigValidator())
    
    // 2. Database configuration validator
    this.validators.push(new DatabaseConfigValidator())
    
    // 3. Agent configuration validator
    this.validators.push(new AgentConfigValidator())
    
    // 4. Monitoring configuration validator
    this.validators.push(new MonitoringConfigValidator())
  }

  /**
   * Validate that all required secrets are present
   */
  private async validateSecrets(config: SystemConfiguration): Promise<void> {
    const requiredSecrets = [
      { path: 'redis.url', name: 'Redis URL' },
      { path: 'database.url', name: 'Database URL' }
    ]
    
    for (const { path, name } of requiredSecrets) {
      const value = this.getNestedValue(config, path)
      if (!value || value.includes('${') || value === 'PLACEHOLDER') {
        throw new Error(`Required secret not found: ${name}`)
      }
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }

  /**
   * Determine if configuration watching should be enabled
   */
  private shouldWatchConfig(): boolean {
    return process.env.ENABLE_CONFIG_WATCHING !== 'false' && this.environment !== 'production'
  }

  /**
   * Determine if configuration should rollback on error
   */
  private shouldRollbackOnError(): boolean {
    return process.env.ENABLE_CONFIG_ROLLBACK !== 'false'
  }
}

// =============================================================================
// SUPPORTING CLASSES AND INTERFACES
// =============================================================================

/**
 * Configuration Error Class
 */
class ConfigurationError extends Error {
  constructor(message: string, public context: any) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

/**
 * Configuration Version Interface
 */
interface ConfigurationVersion {
  config: SystemConfiguration
  timestamp: number
  reason: string
  version: string
}

/**
 * Configuration Watcher Interface
 */
interface ConfigWatcher {
  name: string
  onConfigChange(newConfig: SystemConfiguration, oldConfig: SystemConfiguration): Promise<void>
}

/**
 * Configuration Validator Interface
 */
interface ConfigValidator {
  name: string
  validate(config: SystemConfiguration): Promise<ValidationResult>
}

interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Secrets Manager for Secure Configuration
 */
class SecretsManager {
  constructor(private environment: string) {}

  async getSecret(key: string, defaultValue?: string): Promise<string> {
    // 1. Try environment variable first
    const envValue = process.env[key]
    if (envValue) {
      return envValue
    }
    
    // 2. Try external secret management system (AWS Secrets Manager, HashiCorp Vault, etc.)
    try {
      const externalValue = await this.getExternalSecret(key)
      if (externalValue) {
        return externalValue
      }
    } catch (error) {
      console.warn(`Failed to get external secret ${key}:`, error.message)
    }
    
    // 3. Use default value if provided
    if (defaultValue !== undefined) {
      return defaultValue
    }
    
    throw new Error(`Secret ${key} not found and no default provided`)
  }

  private async getExternalSecret(key: string): Promise<string | null> {
    // Implementation would integrate with external secret management
    // For now, return null to fall back to environment variables
    return null
  }
}

// =============================================================================
// CONFIGURATION VALIDATORS
// =============================================================================

/**
 * Redis Configuration Validator
 */
class RedisConfigValidator implements ConfigValidator {
  name = 'RedisConfigValidator'

  async validate(config: SystemConfiguration): Promise<ValidationResult> {
    const errors: string[] = []
    
    if (!config.redis) {
      errors.push('Redis configuration is required')
      return { valid: false, errors }
    }
    
    // Validate Redis URL
    if (!config.redis.url) {
      errors.push('Redis URL is required')
    } else {
      try {
        new URL(config.redis.url)
      } catch {
        errors.push('Redis URL is invalid')
      }
    }
    
    // Validate numeric values
    if (config.redis.maxRetries < 0) {
      errors.push('Redis maxRetries must be non-negative')
    }
    
    if (config.redis.connectTimeoutMs < 1000) {
      errors.push('Redis connectTimeoutMs should be at least 1000ms')
    }
    
    if (config.redis.commandTimeoutMs < 1000) {
      errors.push('Redis commandTimeoutMs should be at least 1000ms')
    }
    
    return { valid: errors.length === 0, errors }
  }
}

/**
 * Database Configuration Validator
 */
class DatabaseConfigValidator implements ConfigValidator {
  name = 'DatabaseConfigValidator'

  async validate(config: SystemConfiguration): Promise<ValidationResult> {
    const errors: string[] = []
    
    if (!config.database) {
      errors.push('Database configuration is required')
      return { valid: false, errors }
    }
    
    // Validate database URL
    if (!config.database.url) {
      errors.push('Database URL is required')
    } else {
      try {
        const url = new URL(config.database.url)
        if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
          errors.push('Database URL must use postgres:// or postgresql:// protocol')
        }
      } catch {
        errors.push('Database URL is invalid')
      }
    }
    
    // Validate connection pool settings
    if (config.database.maxConnections < 1) {
      errors.push('Database maxConnections must be at least 1')
    }
    
    if (config.database.maxConnections > 100) {
      errors.push('Database maxConnections should not exceed 100')
    }
    
    if (config.database.idleTimeoutMs < 10000) {
      errors.push('Database idleTimeoutMs should be at least 10000ms')
    }
    
    return { valid: errors.length === 0, errors }
  }
}

/**
 * Agent Configuration Validator
 */
class AgentConfigValidator implements ConfigValidator {
  name = 'AgentConfigValidator'

  async validate(config: SystemConfiguration): Promise<ValidationResult> {
    const errors: string[] = []
    
    if (!config.agents) {
      errors.push('Agents configuration is required')
      return { valid: false, errors }
    }
    
    // Validate symbols
    if (!config.agents.symbols || config.agents.symbols.length === 0) {
      errors.push('At least one trading symbol is required')
    } else {
      for (const symbol of config.agents.symbols) {
        if (!/^[A-Z]{1,5}$/.test(symbol)) {
          errors.push(`Invalid symbol format: ${symbol}`)
        }
      }
    }
    
    // Validate checkpoint frequency
    if (config.agents.checkpointFrequency < 10) {
      errors.push('Checkpoint frequency should be at least 10')
    }
    
    // Validate risk limits
    if (config.agents.riskLimits) {
      if (config.agents.riskLimits.maxDrawdown < 0 || config.agents.riskLimits.maxDrawdown > 1) {
        errors.push('Max drawdown must be between 0 and 1')
      }
      
      if (config.agents.riskLimits.maxLeverage < 1) {
        errors.push('Max leverage must be at least 1')
      }
    }
    
    return { valid: errors.length === 0, errors }
  }
}

/**
 * Monitoring Configuration Validator
 */
class MonitoringConfigValidator implements ConfigValidator {
  name = 'MonitoringConfigValidator'

  async validate(config: SystemConfiguration): Promise<ValidationResult> {
    const errors: string[] = []
    
    if (!config.monitoring) {
      errors.push('Monitoring configuration is required')
      return { valid: false, errors }
    }
    
    // Validate intervals
    if (config.monitoring.metricsIntervalMs < 1000) {
      errors.push('Metrics interval should be at least 1000ms')
    }
    
    if (config.monitoring.healthCheckIntervalMs < 5000) {
      errors.push('Health check interval should be at least 5000ms')
    }
    
    // Validate alert thresholds
    if (config.monitoring.alertThresholds) {
      const thresholds = config.monitoring.alertThresholds
      
      if (thresholds.errorRate < 0 || thresholds.errorRate > 1) {
        errors.push('Error rate threshold must be between 0 and 1')
      }
      
      if (thresholds.latencyMs < 0) {
        errors.push('Latency threshold must be non-negative')
      }
      
      if (thresholds.memoryUsagePercent < 0 || thresholds.memoryUsagePercent > 100) {
        errors.push('Memory usage threshold must be between 0 and 100')
      }
    }
    
    return { valid: errors.length === 0, errors }
  }
}

// =============================================================================
// EXAMPLE CONFIGURATION WATCHER
// =============================================================================

/**
 * Example Agent Configuration Watcher
 * 
 * This watcher demonstrates how to respond to configuration changes
 * by updating agent behavior without restarting the system.
 */
export class AgentConfigWatcher implements ConfigWatcher {
  name = 'AgentConfigWatcher'

  constructor(private systemOrchestrator: any) {}

  async onConfigChange(
    newConfig: SystemConfiguration,
    oldConfig: SystemConfiguration
  ): Promise<void> {
    try {
      // 1. Check if agent symbols changed
      const oldSymbols = new Set(oldConfig.agents.symbols)
      const newSymbols = new Set(newConfig.agents.symbols)
      
      // 2. Add new agents for new symbols
      for (const symbol of newSymbols) {
        if (!oldSymbols.has(symbol)) {
          console.log(`Adding new agent for symbol: ${symbol}`)
          await this.systemOrchestrator.addAgent(symbol)
        }
      }
      
      // 3. Remove agents for removed symbols
      for (const symbol of oldSymbols) {
        if (!newSymbols.has(symbol)) {
          console.log(`Removing agent for symbol: ${symbol}`)
          const agentId = `agent_${symbol.toLowerCase()}`
          await this.systemOrchestrator.removeAgent(agentId)
        }
      }
      
      // 4. Update existing agents with new configuration
      // This would require agents to support configuration updates
      console.log('Agent configuration updated successfully')
      
    } catch (error) {
      console.error('Failed to apply agent configuration changes:', error)
      throw error
    }
  }
}