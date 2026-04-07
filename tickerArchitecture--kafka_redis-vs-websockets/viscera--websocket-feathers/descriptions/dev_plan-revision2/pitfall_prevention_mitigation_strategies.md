# WebSocket Development Plan - Revision 2

## **4. Pitfall Prevention with Mitigation Strategies**

### **WebSocket Pitfall 1: Framework Lock-in**
**Scenario**: Heavy dependence on FeathersJS patterns and ecosystem
**Impact**: Difficult to migrate, vendor lock-in, limited flexibility for future changes
**Prevention**: Abstract business logic from framework-specific code

#### **Mitigation Strategy: Business Logic Abstraction**

```typescript
// ❌ Tightly coupled to FeathersJS
class TickerService {
  async create(data, params) {
    // Business logic mixed with framework
    const user = params.user;
    const ticker = await this.Model.create({...});
    this.emit('created', ticker);
  }
}

// ✅ Business logic abstracted
class TickerBusinessLogic {
  constructor(private repository: TickerRepository) {}
  
  async createTicker(userId: string, tickerData: TickerData): Promise<Ticker> {
    // Pure business logic, no framework dependencies
    const ticker = new Ticker(tickerData);
    ticker.validateForUser(userId);
    return await this.repository.save(ticker);
  }
}

// FeathersJS service becomes thin wrapper
class TickerService {
  constructor(private businessLogic: TickerBusinessLogic) {}
  
  async create(data, params) {
    const ticker = await this.businessLogic.createTicker(params.user.id, data);
    this.emit('created', ticker); // Only framework-specific code here
    return ticker;
  }
}
```

**Early Warning Signs**: Business logic in service methods, direct database calls in hooks, framework imports in domain models
**Recovery**: Extract business logic immediately, create interface layers, implement dependency injection

---

### **WebSocket Pitfall 2: Connection State Complexity**
**Scenario**: Connection state management more complex than stateless HTTP
**Impact**: Unreliable connections, difficult debugging, race conditions
**Prevention**: Implement systematic connection lifecycle management

#### **Mitigation Strategy: State Machine + Heartbeat System**

```typescript
// ✅ Connection state machine
enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting', 
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed'
}

class WebSocketManager {
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private heartbeatInterval: NodeJS.Timeout;

  async connect() {
    this.setState(ConnectionState.CONNECTING);
    
    try {
      this.socket = new WebSocket(this.url);
      this.setupEventHandlers();
      this.startHeartbeat();
      this.setState(ConnectionState.CONNECTED);
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.state === ConnectionState.CONNECTED) {
        this.socket.ping();
      }
    }, 30000); // 30 second heartbeat
  }

  private async handleConnectionError(error: Error) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.setState(ConnectionState.RECONNECTING);
      const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
      setTimeout(() => this.connect(), delay);
      this.reconnectAttempts++;
    } else {
      this.setState(ConnectionState.FAILED);
    }
  }
}
```

**Early Warning Signs**: Manual connection handling, no reconnection logic, missing heartbeat mechanisms, connection state scattered across components
**Recovery**: Implement state machine immediately, add heartbeat system, centralize connection management

---

### **WebSocket Pitfall 3: Single Point of Failure**
**Scenario**: FeathersJS server becomes critical bottleneck
**Impact**: System unavailable if server fails, poor scalability, no redundancy
**Prevention**: Implement load balancing and graceful degradation

#### **Mitigation Strategy: Load Balancing + Circuit Breaker**

```typescript
// ✅ Load balancing with health checks
class WebSocketCluster {
  private servers: ServerInstance[] = [];
  private currentServerIndex = 0;

  async getHealthyServer(): Promise<ServerInstance> {
    // Round-robin with health check
    for (let i = 0; i < this.servers.length; i++) {
      const server = this.servers[this.currentServerIndex];
      
      if (await this.isServerHealthy(server)) {
        this.currentServerIndex = (this.currentServerIndex + 1) % this.servers.length;
        return server;
      }
      
      this.currentServerIndex = (this.currentServerIndex + 1) % this.servers.length;
    }
    
    throw new Error('No healthy servers available');
  }

  private async isServerHealthy(server: ServerInstance): Promise<boolean> {
    try {
      const response = await fetch(`${server.url}/health`, { timeout: 5000 });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ✅ Circuit breaker pattern
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > 60000) { // 1 minute timeout
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= 5) { // Threshold
      this.state = 'OPEN';
    }
  }
}

// ✅ Graceful shutdown
class WebSocketServer {
  private isShuttingDown = false;
  private activeConnections = new Set<WebSocket>();

  async gracefulShutdown() {
    this.isShuttingDown = true;
    
    // Stop accepting new connections
    this.server.close();
    
    // Notify existing clients
    this.activeConnections.forEach(ws => {
      ws.send(JSON.stringify({ type: 'server_shutdown', reconnect: true }));
    });
    
    // Wait for connections to close or force after timeout
    await Promise.race([
      this.waitForConnectionsToClose(),
      this.delay(30000) // 30 second timeout
    ]);
    
    process.exit(0);
  }
}
```

**Early Warning Signs**: Single server instance, no health checks, no graceful shutdown procedures, missing load balancing
**Recovery**: Add health check endpoints immediately, implement load balancing, create graceful shutdown procedures