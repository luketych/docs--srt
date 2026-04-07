# Foundation Constraints Checklist

## Context Primer (Primary)

This document establishes the non-negotiable architectural requirements that must be implemented in Milestone 1 regardless of chosen proposal scope, representing decisions that become exponentially more expensive to change as system complexity and agent count grow. These constraints transform from optional features to mandatory architectural patterns that prevent technical debt accumulation and enable future scaling without rewrites.

• **Authentication-as-Architecture Enforcement**: Every Redis operation must include sender validation from day one, as Redis pub/sub flows directly to consumers without middleware, making authentication retrofit require rewriting every message handler, state manager, and recovery procedure with quadratic cost growth
• **Versioned Message Schema Implementation**: All Redis messages must include version fields and backward compatibility handling to prevent breaking changes across distributed agents, enabling gradual migration and preventing coordinated rollout requirements that grow exponentially with agent count
• **Atomic State Operation Requirements**: All checkpoint operations must use Redis MULTI/EXEC transactions with integrity validation to prevent partial state corruption during network partitions, as Redis lacks built-in transaction rollback for complex state objects
• **Resource Monitoring and Circuit Breaker Patterns**: Memory usage, connection count, and latency monitoring with alert thresholds must be embedded to prevent Redis performance cliff behavior that causes sudden system failure rather than gradual degradation

---

**Created**: 2025-08-06  
**Purpose**: Define non-negotiable architectural requirements for all milestone 1 proposals

---

## **Critical Foundation Constraints**

These architectural decisions MUST be implemented in Milestone 1 due to exponential change costs. They are not features to add later - they are architectural constraints that affect every subsequent design decision.

---

## **1. Authentication-as-Architecture (MANDATORY)**

### **Requirement**
Every Redis operation must include sender validation from day one.

### **Why This Cannot Be Added Later**
- Redis pub/sub flows directly to consumers without centralized middleware
- Retrofitting requires rewriting every message handler, state manager, and recovery procedure
- Cost grows quadratically with number of message handlers
- Security debt creates audit and compliance gaps

### **Implementation Checklist**

#### **Message Format Requirements**
- [ ] All Redis messages include `agentId` field
- [ ] All Redis messages include `signature` field  
- [ ] All Redis messages include `timestamp` field for replay attack prevention
- [ ] Message signature covers payload + timestamp + agentId

#### **Validation Requirements**
- [ ] Every message handler validates authentication before processing
- [ ] Invalid messages are rejected and logged (never processed)
- [ ] Authentication failures are counted and trigger lockout after threshold
- [ ] Signature validation includes timestamp freshness check (max 30 seconds)

#### **Infrastructure Requirements**
- [ ] Agent credential management system implemented
- [ ] Signature generation and validation functions implemented
- [ ] Authentication failure logging and alerting implemented
- [ ] Credential rotation support implemented

### **Code Pattern Requirements**
```typescript
// REQUIRED: Every message handler must follow this pattern
async function processMessage(message: AuthenticatedMessage): Promise<void> {
  // Step 1: Validate authentication (NEVER skip this)
  const authResult = await validateMessageAuth(message);
  if (!authResult.valid) {
    await logAuthFailure(message.agentId, authResult.reason);
    return; // Reject unauthenticated messages
  }
  
  // Step 2: Process with authenticated context
  await processBusinessLogic(message.payload, authResult.context);
}

// REQUIRED: Authentication validation function
async function validateMessageAuth(message: AuthenticatedMessage): Promise<AuthResult> {
  const expectedSignature = calculateSignature(
    message.payload, 
    message.timestamp, 
    getAgentSecret(message.agentId)
  );
  
  const isValid = expectedSignature === message.signature;
  const isTimestampValid = Math.abs(Date.now() - message.timestamp) < 30000;
  
  return {
    valid: isValid && isTimestampValid,
    agentId: message.agentId,
    context: isValid ? { agentId: message.agentId, timestamp: message.timestamp } : null,
    reason: !isValid ? 'Invalid signature' : !isTimestampValid ? 'Timestamp expired' : null
  };
}
```

### **Validation Criteria**
- [ ] 100% of Redis operations include authentication validation
- [ ] Zero successful unauthorized message processing attempts
- [ ] Authentication adds <5ms latency overhead
- [ ] Complete audit trail of all authentication events

---

## **2. Versioned Message Schema (MANDATORY)**

### **Requirement**
All Redis messages must include version fields and support backward compatibility.

### **Why This Cannot Be Added Later**
- Message format changes break all existing consumers in distributed system
- Without versioning, any schema change requires coordinated rollout of all agents
- Coordination complexity grows exponentially with agent count
- Breaking changes create deployment nightmares

### **Implementation Checklist**

#### **Message Structure Requirements**
- [ ] All messages include `version` field (e.g., "1.0", "1.1")
- [ ] All messages include `type` field for message categorization
- [ ] All messages include `timestamp` field for ordering and freshness
- [ ] Payload structure is version-specific but extensible

#### **Version Handling Requirements**
- [ ] Message processors handle multiple versions gracefully
- [ ] Unknown versions are rejected with clear error messages
- [ ] Version migration utilities implemented for schema evolution
- [ ] Backward compatibility maintained for at least 2 versions

#### **Schema Evolution Requirements**
- [ ] New fields are additive (don't break existing consumers)
- [ ] Field removal follows deprecation process
- [ ] Schema changes are documented with migration guides
- [ ] Version compatibility matrix maintained

### **Code Pattern Requirements**
```typescript
// REQUIRED: Versioned message structure
interface VersionedMessage {
  version: string;    // "1.0", "1.1", etc.
  type: string;       // "tick", "heartbeat", "command"
  timestamp: number;  // Unix timestamp
  payload: any;       // Version-specific content
}

// REQUIRED: Version-aware message processing
function processMessage(message: VersionedMessage): void {
  switch (message.version) {
    case "1.0":
      return processV1Message(message.payload);
    case "1.1":
      return processV1_1Message(message.payload);
    default:
      throw new Error(`Unsupported message version: ${message.version}`);
  }
}

// REQUIRED: Schema evolution support
class SchemaEvolutionManager {
  async migrateMessage(oldMessage: any, targetVersion: string): Promise<VersionedMessage> {
    switch (targetVersion) {
      case "1.1":
        return this.migrateToV1_1(oldMessage);
      default:
        throw new Error(`Unknown target version: ${targetVersion}`);
    }
  }
}
```

### **Validation Criteria**
- [ ] All messages include version field
- [ ] Message processors handle multiple versions
- [ ] Schema evolution procedures documented and tested
- [ ] Backward compatibility validated for all version combinations

---

## **3. Atomic State Operations (MANDATORY)**

### **Requirement**
All checkpoint operations must use Redis MULTI/EXEC transactions with integrity validation.

### **Why This Cannot Be Added Later**
- Redis lacks built-in transaction rollback for complex state objects
- Non-atomic operations create race conditions under load
- State corruption cascades through agent decision-making
- Recovery procedures must handle partial state scenarios

### **Implementation Checklist**

#### **Transaction Requirements**
- [ ] All state writes use Redis MULTI/EXEC transactions
- [ ] Checkpoint operations are atomic across all related keys
- [ ] Transaction failures are detected and handled appropriately
- [ ] No partial state writes possible under any failure scenario

#### **Integrity Validation Requirements**
- [ ] All checkpoints include integrity checksums
- [ ] Checksum validation on every state load operation
- [ ] Corrupted state detection triggers recovery procedures
- [ ] State validation includes business logic consistency checks

#### **Recovery Requirements**
- [ ] Backup checkpoints maintained in PostgreSQL
- [ ] Automatic recovery from corrupted state
- [ ] State rollback to last known good checkpoint
- [ ] Recovery procedures tested under various failure scenarios

### **Code Pattern Requirements**
```typescript
// REQUIRED: Atomic checkpoint operations
class AtomicStateManager {
  async saveAgentCheckpoint(agentId: string, state: AgentState): Promise<void> {
    const checkpoint = JSON.stringify(state);
    const checksum = this.calculateChecksum(checkpoint);
    const timestamp = Date.now();
    
    // REQUIRED: Atomic operation prevents partial state corruption
    const result = await this.redis.multi()
      .set(`agent:${agentId}:checkpoint`, checkpoint)
      .set(`agent:${agentId}:checksum`, checksum)
      .set(`agent:${agentId}:timestamp`, timestamp)
      .exec();
      
    if (!result || result.some(([err]) => err)) {
      throw new Error(`Checkpoint save failed for agent ${agentId}`);
    }
  }
  
  async loadAgentCheckpoint(agentId: string): Promise<AgentState | null> {
    const [checkpoint, storedChecksum] = await this.redis.mget([
      `agent:${agentId}:checkpoint`,
      `agent:${agentId}:checksum`
    ]);
    
    if (!checkpoint || !storedChecksum) {
      return null;
    }
    
    // REQUIRED: Integrity validation
    const calculatedChecksum = this.calculateChecksum(checkpoint);
    if (calculatedChecksum !== storedChecksum) {
      throw new Error(`Checkpoint corruption detected for agent ${agentId}`);
    }
    
    return JSON.parse(checkpoint);
  }
}
```

### **Validation Criteria**
- [ ] 100% of state operations are atomic
- [ ] Zero partial state writes detected
- [ ] Checksum validation success rate >99.9%
- [ ] Recovery procedures work correctly for all corruption scenarios

---

## **4. Resource Monitoring and Circuit Breakers (MANDATORY)**

### **Requirement**
Memory usage, connection count, and latency monitoring with alert thresholds must be embedded.

### **Why This Cannot Be Added Later**
- Redis exhibits cliff-edge performance failure rather than gradual degradation
- Without proactive monitoring, system goes from normal to completely failed instantly
- Resource exhaustion affects all agents simultaneously
- Recovery requires system-wide restart and state validation

### **Implementation Checklist**

#### **Monitoring Requirements**
- [ ] Redis memory usage monitoring with percentage thresholds
- [ ] Connection count monitoring with max_clients awareness
- [ ] Command latency monitoring with P95/P99 tracking
- [ ] Resource usage trending and capacity planning

#### **Alert Threshold Requirements**
- [ ] Memory warning at 80%, critical at 90%
- [ ] Connection warning at 80% of max_clients
- [ ] Latency warning at 50ms, critical at 100ms
- [ ] Alert escalation procedures documented

#### **Circuit Breaker Requirements**
- [ ] Redis operations protected by circuit breakers
- [ ] Automatic failure detection and recovery
- [ ] Graceful degradation when Redis unavailable
- [ ] Circuit breaker state monitoring and alerting

### **Code Pattern Requirements**
```typescript
// REQUIRED: Resource monitoring with thresholds
class ResourceMonitor {
  private readonly thresholds = {
    memory: { warning: 80, critical: 90 },      // Percentage
    connections: { warning: 80, critical: 95 }, // Percentage of max_clients
    latency: { warning: 50, critical: 100 }     // Milliseconds
  };
  
  async checkResourceHealth(): Promise<ResourceStatus> {
    const memoryInfo = await this.redis.memory('usage');
    const connectionCount = await this.getConnectionCount();
    const latency = await this.measureLatency();
    
    const memoryPercent = this.calculateMemoryPercent(memoryInfo);
    
    // REQUIRED: Check thresholds and alert
    if (memoryPercent > this.thresholds.memory.critical) {
      await this.alerting.critical('Redis memory critical', { memoryPercent });
    } else if (memoryPercent > this.thresholds.memory.warning) {
      await this.alerting.warning('Redis memory high', { memoryPercent });
    }
    
    return {
      memory: { usage: memoryPercent, status: this.getMemoryStatus(memoryPercent) },
      connections: { count: connectionCount, status: this.getConnectionStatus(connectionCount) },
      latency: { value: latency, status: this.getLatencyStatus(latency) }
    };
  }
}

// REQUIRED: Circuit breaker for Redis operations
class RedisCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly timeout = 30000;

  async execute<T>(operation: () => Promise<T>, fallback: () => T): Promise<T> {
    if (this.isOpen()) {
      return fallback();
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      return fallback();
    }
  }
}
```

### **Validation Criteria**
- [ ] Resource monitoring active with 15-second intervals
- [ ] Alert thresholds trigger before critical conditions
- [ ] Circuit breakers prevent cascade failures
- [ ] Graceful degradation works during Redis unavailability

---

## **5. Three-Layer Architecture Separation (MANDATORY)**

### **Requirement**
Business logic, Redis operations, and orchestration must be separated into distinct layers.

### **Why This Cannot Be Added Later**
- Mixed concerns create testing and maintenance nightmares
- Business logic changes require Redis expertise
- Redis changes require business logic understanding
- Debugging becomes exponentially more complex

### **Implementation Checklist**

#### **Layer Separation Requirements**
- [ ] Pure business logic functions (no Redis dependencies)
- [ ] Redis operation classes (no business logic)
- [ ] Orchestration layer (coordinates pure functions with Redis)
- [ ] Clear interfaces between all layers

#### **Testing Requirements**
- [ ] Business logic unit tests (no Redis required)
- [ ] Redis operation integration tests
- [ ] End-to-end orchestration tests
- [ ] Layer isolation validated in test suite

### **Code Pattern Requirements**
```typescript
// REQUIRED: Pure business logic (no Redis dependencies)
class TickBusinessLogic {
  processTick(tick: TickData, currentState: AgentState): AgentState {
    // Pure calculations - no I/O, no Redis, no side effects
    const newIndicators = this.calculateIndicators(tick, currentState.indicators);
    const newPosition = this.calculatePosition(tick, currentState, newIndicators);
    
    return {
      ...currentState,
      position: newPosition,
      lastPrice: tick.price,
      indicators: newIndicators,
      processedTicks: currentState.processedTicks + 1,
      lastUpdate: tick.timestamp
    };
  }
}

// REQUIRED: Redis operations only (no business logic)
class AgentStateManager {
  async getState(agentId: string): Promise<AgentState> {
    // Redis operations only - no business logic
    const state = await this.redis.get(`agent:${agentId}:state`);
    return state ? JSON.parse(state) : this.getDefaultState();
  }

  async setState(agentId: string, state: AgentState): Promise<void> {
    // Redis operations only - no business logic
    await this.redis.set(`agent:${agentId}:state`, JSON.stringify(state));
  }
}

// REQUIRED: Orchestration only (coordinates layers)
class TickProcessor {
  constructor(
    private stateManager: AgentStateManager,
    private businessLogic: TickBusinessLogic
  ) {}

  async processTick(agentId: string, tick: TickData): Promise<void> {
    // Orchestration only - no business logic, no direct Redis
    const currentState = await this.stateManager.getState(agentId);
    const newState = this.businessLogic.processTick(tick, currentState);
    await this.stateManager.setState(agentId, newState);
  }
}
```

### **Validation Criteria**
- [ ] Business logic functions have zero Redis dependencies
- [ ] Redis operations contain zero business logic
- [ ] Orchestration layer only coordinates between layers
- [ ] Each layer can be tested independently

---

## **6. Configuration Management (MANDATORY)**

### **Requirement**
All configuration must be externalized via environment variables.

### **Why This Cannot Be Added Later**
- Hardcoded values prevent environment-specific deployments
- Configuration changes require code changes and deployments
- A/B testing and gradual rollouts become impossible
- Operational flexibility is severely limited

### **Implementation Checklist**

#### **Configuration Externalization Requirements**
- [ ] Redis connection settings via environment variables
- [ ] Authentication settings via environment variables
- [ ] Monitoring thresholds via environment variables
- [ ] Business logic parameters via environment variables

#### **Configuration Validation Requirements**
- [ ] Required environment variables validated at startup
- [ ] Configuration values validated for correctness
- [ ] Default values provided for optional settings
- [ ] Configuration changes logged for audit trail

### **Code Pattern Requirements**
```typescript
// REQUIRED: Environment-driven configuration
const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3')
  },
  
  monitoring: {
    memoryWarningThreshold: parseInt(process.env.MEMORY_WARNING || '80'),
    latencyWarningThreshold: parseInt(process.env.LATENCY_WARNING || '50'),
    checkInterval: parseInt(process.env.MONITOR_INTERVAL || '15000')
  },
  
  authentication: {
    signatureAlgorithm: process.env.AUTH_ALGORITHM || 'HMAC-SHA256',
    timestampTolerance: parseInt(process.env.AUTH_TIMESTAMP_TOLERANCE || '30000')
  }
};

// REQUIRED: Configuration validation
function validateConfiguration(): void {
  const required = ['REDIS_HOST', 'REDIS_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

### **Validation Criteria**
- [ ] Zero hardcoded configuration values in code
- [ ] All environment-specific settings externalized
- [ ] Configuration validation prevents startup with invalid settings
- [ ] Configuration changes don't require code deployment

---

## **Foundation Constraints Validation Checklist**

### **Pre-Development Validation**
- [ ] All team members understand why each constraint is mandatory
- [ ] Architecture design includes all foundation constraints
- [ ] Development environment configured for constraint validation
- [ ] Code review checklist includes foundation constraint verification

### **During Development Validation**
- [ ] Every Redis operation includes authentication validation
- [ ] Every message includes version field and backward compatibility
- [ ] Every state operation uses atomic transactions
- [ ] Resource monitoring active with appropriate thresholds
- [ ] Business logic separated from Redis operations
- [ ] All configuration externalized via environment variables

### **Post-Implementation Validation**
- [ ] Authentication bypass attempts fail 100% of the time
- [ ] Message schema evolution works without breaking existing consumers
- [ ] State corruption detection and recovery procedures work correctly
- [ ] Resource monitoring triggers alerts before critical conditions
- [ ] Each architectural layer can be tested independently
- [ ] System can be deployed to different environments without code changes

### **Success Criteria**
- [ ] All foundation constraints implemented and tested
- [ ] Constraint violations detected by automated testing
- [ ] Manual verification procedures validate constraint compliance
- [ ] System architecture supports future scaling without constraint violations

---

## **Common Anti-Patterns to Avoid**

### **Authentication Anti-Patterns**
- ❌ Processing any message without authentication validation
- ❌ Implementing authentication as optional or configurable
- ❌ Mixing authentication logic with business logic
- ❌ Storing credentials in code or configuration files

### **Message Schema Anti-Patterns**
- ❌ Direct message format changes without versioning
- ❌ Breaking changes that require coordinated rollouts
- ❌ Hardcoded message structure assumptions
- ❌ Missing backward compatibility handling

### **State Management Anti-Patterns**
- ❌ Non-atomic multi-key operations
- ❌ State operations without integrity validation
- ❌ Missing corruption detection and recovery
- ❌ Partial state writes during failures

### **Resource Management Anti-Patterns**
- ❌ No resource monitoring or alerting
- ❌ Missing circuit breakers for Redis operations
- ❌ No graceful degradation during resource exhaustion
- ❌ Reactive rather than proactive resource management

### **Architecture Anti-Patterns**
- ❌ Business logic mixed with Redis operations
- ❌ Direct Redis calls from business logic
- ❌ Hardcoded configuration values
- ❌ Tight coupling between architectural layers

These foundation constraints are non-negotiable architectural requirements that must be implemented correctly from day one. They represent decisions that become exponentially more expensive to change as system complexity grows, and their proper implementation is essential for long-term system success.