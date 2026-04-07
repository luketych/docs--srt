# Redis Operational Readiness

## Context Primer (Primary)

This document establishes production-ready operational procedures that address Redis-specific challenges (memory management, clustering, state recovery) and real-time system requirements (zero-downtime deployments, rapid recovery, continuous monitoring) through comprehensive backup strategies, deployment methodologies, and incident response frameworks. The operational readiness framework transforms development-focused Redis implementation into production-capable infrastructure with documented procedures executable under pressure.

• **Multi-Layer Backup and Recovery Strategy**: Redis persistence (RDB snapshots, AOF files), agent state backup (PostgreSQL checkpoints), and configuration backup (versioned environments) provide comprehensive data protection with specific recovery time objectives (5 minutes for Redis, 2 minutes for agents, 15 minutes for full system)
• **Environment-Specific Deployment Architecture**: Development, staging, and production environment configurations with Docker Compose orchestration, secret management, and resource allocation ensure consistent deployment patterns while supporting blue-green and rolling update strategies for zero-downtime operations
• **Comprehensive Monitoring and Alerting Framework**: Redis performance metrics (memory, connections, latency), agent health metrics (processing rates, state consistency), and system integration metrics (message flow, database performance) with critical, warning, and info alert thresholds enable proactive issue detection and resolution
• **Incident Response Runbook Implementation**: Detailed procedures for Redis memory exhaustion, agent processing failures, and database connectivity issues with immediate actions (0-5 minutes), investigation steps (5-30 minutes), and recovery procedures (30+ minutes) provide executable guidance during high-pressure situations
• **Maintenance and Capacity Planning Procedures**: Redis upgrade procedures, capacity planning methodologies, and scaling decision matrices ensure system evolution and growth management through documented processes for routine maintenance, performance analysis, and infrastructure scaling decisions

---

**Created**: 2025-08-04  
**Purpose**: Establish production-ready operational procedures addressing Redis-specific challenges and real-time system requirements

---

## **Operational Readiness Framework**

This framework addresses Redis-specific operational challenges (memory management, clustering, state recovery) and real-time system requirements (zero-downtime deployments, rapid recovery, continuous monitoring) specific to tick processing systems.

---

## **🔄 Backup and Recovery Procedures**

### **Redis Data Backup Strategy**

#### **Multi-Layer Backup Approach**
```markdown
**Layer 1: Redis Persistence**
- **RDB Snapshots**: Automated point-in-time snapshots every 15 minutes during market hours
- **AOF Persistence**: Append-only file with fsync every second for transaction-level durability
- **Backup Retention**: 24 hours of RDB snapshots, 7 days of AOF files

**Layer 2: Agent State Backup**
- **PostgreSQL Checkpoints**: Agent state backed up every hour to PostgreSQL
- **Incremental Backups**: Delta changes captured every 15 minutes
- **Cross-Validation**: State checksums verified against Redis data

**Layer 3: Configuration Backup**
- **Environment Variables**: Versioned in Git with deployment tags
- **Redis Configuration**: Config files backed up with each deployment
- **Schema Migrations**: Database schema changes tracked and versioned
```

#### **Backup Implementation**
```bash
#!/bin/bash
# Redis backup script - runs every 15 minutes during market hours

BACKUP_DIR="/backups/redis/$(date +%Y%m%d)"
TIMESTAMP=$(date +%H%M)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# RDB snapshot backup
redis-cli --rdb "$BACKUP_DIR/dump_$TIMESTAMP.rdb"

# AOF backup (if enabled)
if [ -f /var/lib/redis/appendonly.aof ]; then
    cp /var/lib/redis/appendonly.aof "$BACKUP_DIR/aof_$TIMESTAMP.aof"
fi

# Agent state backup
pg_dump -h $POSTGRES_HOST -U $POSTGRES_USER ticker_system > "$BACKUP_DIR/agent_state_$TIMESTAMP.sql"

# Verify backup integrity
redis-cli --rdb-check-only "$BACKUP_DIR/dump_$TIMESTAMP.rdb"
if [ $? -eq 0 ]; then
    echo "Backup successful: $BACKUP_DIR/dump_$TIMESTAMP.rdb"
else
    echo "Backup failed: RDB integrity check failed"
    exit 1
fi
```

### **Recovery Procedures**

#### **Redis Instance Recovery**
```markdown
**Scenario**: Redis instance failure or corruption

**Recovery Steps**:
1. **Stop Redis Service**
   ```bash
   systemctl stop redis
   ```

2. **Restore from Latest RDB**
   ```bash
   cp /backups/redis/latest/dump.rdb /var/lib/redis/
   chown redis:redis /var/lib/redis/dump.rdb
   ```

3. **Replay AOF if Available**
   ```bash
   redis-server --appendonly yes --appendfilename appendonly.aof
   ```

4. **Validate Data Integrity**
   ```bash
   redis-cli ping
   redis-cli dbsize
   redis-cli --scan --pattern "agent:*" | wc -l
   ```

5. **Restart Agents**
   ```bash
   docker-compose restart agents
   ```

**Recovery Time Objective**: 5 minutes
**Recovery Point Objective**: <15 minutes of data loss
```

#### **Agent State Recovery**
```markdown
**Scenario**: Agent state corruption or inconsistency

**Recovery Steps**:
1. **Stop Affected Agent**
   ```bash
   docker stop agent-$AGENT_ID
   ```

2. **Validate State Corruption**
   ```bash
   node scripts/validate-agent-state.js $AGENT_ID
   ```

3. **Restore from PostgreSQL Checkpoint**
   ```sql
   SELECT * FROM agent_checkpoints 
   WHERE agent_id = '$AGENT_ID' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

4. **Replay Missed Ticks**
   ```bash
   node scripts/replay-ticks.js $AGENT_ID --from=$CHECKPOINT_TIME
   ```

5. **Verify State Consistency**
   ```bash
   node scripts/verify-agent-consistency.js $AGENT_ID
   ```

**Recovery Time Objective**: 2 minutes
**Recovery Point Objective**: <1 hour of processing
```

#### **Full System Recovery**
```markdown
**Scenario**: Complete system failure (Redis + PostgreSQL + Agents)

**Recovery Steps**:
1. **Assess Damage Scope**
   ```bash
   ./scripts/system-health-check.sh
   ```

2. **Restore PostgreSQL Database**
   ```bash
   pg_restore -h $POSTGRES_HOST -U $POSTGRES_USER -d ticker_system /backups/postgres/latest.dump
   ```

3. **Restore Redis Instance**
   ```bash
   cp /backups/redis/latest/dump.rdb /var/lib/redis/
   systemctl start redis
   ```

4. **Validate Data Consistency**
   ```bash
   node scripts/validate-system-consistency.js
   ```

5. **Restart All Agents**
   ```bash
   docker-compose up -d agents
   ```

6. **Monitor Recovery Progress**
   ```bash
   ./scripts/monitor-recovery.sh
   ```

**Recovery Time Objective**: 15 minutes
**Recovery Point Objective**: <1 hour of data loss
```

---

## **🚀 Deployment Strategy**

### **Environment Management**

#### **Development Environment**
```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: ticker_system_dev
      POSTGRES_USER: dev_user
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  agent:
    build: .
    environment:
      NODE_ENV: development
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgresql://dev_user:dev_password@postgres:5432/ticker_system_dev
    depends_on:
      - redis
      - postgres
```

#### **Staging Environment**
```yaml
# docker-compose.staging.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    deploy:
      replicas: 1
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 512M
    volumes:
      - redis_data:/data
    command: redis-server /usr/local/etc/redis/redis.conf
    configs:
      - source: redis_config
        target: /usr/local/etc/redis/redis.conf

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: ticker_system_staging
      POSTGRES_USER_FILE: /run/secrets/postgres_user
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    secrets:
      - postgres_user
      - postgres_password

  agent:
    image: ticker-agent:${VERSION}
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 30s
        failure_action: rollback
    environment:
      NODE_ENV: staging
      REDIS_URL_FILE: /run/secrets/redis_url
      DATABASE_URL_FILE: /run/secrets/database_url
    secrets:
      - redis_url
      - database_url
```

#### **Production Environment**
```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  redis-cluster:
    image: redis:7-alpine
    deploy:
      replicas: 6
      placement:
        max_replicas_per_node: 2
    command: redis-server /usr/local/etc/redis/redis.conf --cluster-enabled yes
    configs:
      - source: redis_cluster_config
        target: /usr/local/etc/redis/redis.conf

  postgres-primary:
    image: postgres:15
    environment:
      POSTGRES_DB: ticker_system
      POSTGRES_USER_FILE: /run/secrets/postgres_user
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_REPLICATION_MODE: master
    volumes:
      - postgres_primary_data:/var/lib/postgresql/data

  postgres-replica:
    image: postgres:15
    environment:
      POSTGRES_REPLICATION_MODE: slave
      POSTGRES_MASTER_SERVICE: postgres-primary
    volumes:
      - postgres_replica_data:/var/lib/postgresql/data

  agent:
    image: ticker-agent:${VERSION}
    deploy:
      replicas: 10
      update_config:
        parallelism: 2
        delay: 60s
        failure_action: rollback
        monitor: 120s
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 3
    environment:
      NODE_ENV: production
    secrets:
      - redis_cluster_url
      - database_url
      - agent_auth_key
```

### **Deployment Pipeline**

#### **Blue-Green Deployment Strategy**
```bash
#!/bin/bash
# Blue-Green deployment script for zero-downtime updates

set -e

VERSION=$1
ENVIRONMENT=$2

if [ -z "$VERSION" ] || [ -z "$ENVIRONMENT" ]; then
    echo "Usage: $0 <version> <environment>"
    exit 1
fi

echo "Starting Blue-Green deployment for version $VERSION in $ENVIRONMENT"

# Step 1: Deploy to Green environment
echo "Deploying to Green environment..."
docker stack deploy -c docker-compose.$ENVIRONMENT.yml ticker-green

# Step 2: Health check Green environment
echo "Performing health checks on Green environment..."
./scripts/health-check.sh ticker-green
if [ $? -ne 0 ]; then
    echo "Health check failed, rolling back..."
    docker stack rm ticker-green
    exit 1
fi

# Step 3: Migrate agent state from Blue to Green
echo "Migrating agent state..."
./scripts/migrate-agent-state.sh blue green
if [ $? -ne 0 ]; then
    echo "State migration failed, rolling back..."
    docker stack rm ticker-green
    exit 1
fi

# Step 4: Switch traffic to Green
echo "Switching traffic to Green environment..."
./scripts/switch-traffic.sh green

# Step 5: Monitor Green environment
echo "Monitoring Green environment for 5 minutes..."
./scripts/monitor-deployment.sh green 300
if [ $? -ne 0 ]; then
    echo "Monitoring detected issues, rolling back..."
    ./scripts/switch-traffic.sh blue
    docker stack rm ticker-green
    exit 1
fi

# Step 6: Remove Blue environment
echo "Removing Blue environment..."
docker stack rm ticker-blue

# Step 7: Rename Green to Blue for next deployment
echo "Renaming Green to Blue..."
docker service update --label-add color=blue ticker-green_agent

echo "Blue-Green deployment completed successfully"
```

#### **Rolling Update Strategy**
```bash
#!/bin/bash
# Rolling update script for gradual agent replacement

VERSION=$1
REPLICAS=${2:-5}

echo "Starting rolling update to version $VERSION with $REPLICAS replicas"

# Update service with rolling update configuration
docker service update \
    --image ticker-agent:$VERSION \
    --update-parallelism 1 \
    --update-delay 30s \
    --update-failure-action rollback \
    --update-monitor 60s \
    ticker_agent

# Monitor update progress
echo "Monitoring rolling update progress..."
while true; do
    STATUS=$(docker service ps ticker_agent --format "table {{.Name}}\t{{.Image}}\t{{.CurrentState}}" | grep -v "Shutdown\|Failed")
    UPDATED=$(echo "$STATUS" | grep "$VERSION" | wc -l)
    TOTAL=$(echo "$STATUS" | wc -l)
    
    echo "Progress: $UPDATED/$TOTAL agents updated"
    
    if [ $UPDATED -eq $TOTAL ]; then
        echo "Rolling update completed successfully"
        break
    fi
    
    sleep 10
done
```

### **Rollback Procedures**

#### **Automated Rollback Triggers**
```typescript
interface RollbackTriggers {
  errorRateThreshold: 5; // Percent
  latencyThreshold: 200; // Milliseconds
  healthCheckFailures: 3; // Consecutive failures
  memoryUsageThreshold: 95; // Percent
}

class AutomatedRollback {
  private metrics: MetricsCollector;
  private triggers: RollbackTriggers;

  async monitorDeployment(deploymentId: string): Promise<void> {
    const monitoringDuration = 10 * 60 * 1000; // 10 minutes
    const checkInterval = 30 * 1000; // 30 seconds
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < monitoringDuration) {
      const metrics = await this.metrics.collect();
      
      if (this.shouldRollback(metrics)) {
        await this.executeRollback(deploymentId);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  private shouldRollback(metrics: SystemMetrics): boolean {
    return (
      metrics.errorRate > this.triggers.errorRateThreshold ||
      metrics.averageLatency > this.triggers.latencyThreshold ||
      metrics.consecutiveHealthCheckFailures >= this.triggers.healthCheckFailures ||
      metrics.memoryUsage > this.triggers.memoryUsageThreshold
    );
  }

  private async executeRollback(deploymentId: string): Promise<void> {
    console.log(`Executing automated rollback for deployment ${deploymentId}`);
    
    // Get previous version
    const previousVersion = await this.getPreviousVersion(deploymentId);
    
    // Execute rollback
    await this.deployVersion(previousVersion);
    
    // Notify operations team
    await this.notifyRollback(deploymentId, previousVersion);
  }
}
```

---

## **📊 Monitoring and Alerting Framework**

### **Critical Metrics to Monitor**

#### **Redis Performance Metrics**
```typescript
interface RedisMetrics {
  // Memory Management
  memoryUsage: number;           // Current memory usage in bytes
  memoryUsagePercent: number;    // Percentage of max memory
  memoryFragmentation: number;   // Fragmentation ratio
  evictionEvents: number;        // Number of key evictions

  // Connection Management
  connectedClients: number;      // Current client connections
  connectionFailures: number;    // Failed connection attempts
  connectionLatency: number;     // Average connection latency

  // Command Performance
  commandsPerSecond: number;     // Commands processed per second
  averageLatency: number;        // Average command latency
  slowLogEntries: number;        // Number of slow log entries

  // Persistence
  lastSaveTime: number;          // Last RDB save timestamp
  aofRewriteInProgress: boolean; // AOF rewrite status
  persistenceErrors: number;     // Persistence operation errors
}
```

#### **Agent Health Metrics**
```typescript
interface AgentMetrics {
  // Processing Performance
  ticksProcessedPerSecond: number;  // Processing throughput
  averageProcessingLatency: number; // Time per tick
  processingErrorRate: number;      // Percentage of failed ticks

  // State Management
  stateConsistencyRate: number;     // Percentage of consistent states
  checkpointSuccessRate: number;    // Successful checkpoint percentage
  recoveryTime: number;             // Time to recover from failure

  // Resource Usage
  memoryUsage: number;              // Agent memory consumption
  cpuUsage: number;                 // Agent CPU utilization
  networkBandwidth: number;         // Network usage

  // Business Logic
  positionAccuracy: number;         // Accuracy of position calculations
  indicatorCalculationTime: number; // Time for indicator calculations
}
```

#### **System Integration Metrics**
```typescript
interface SystemMetrics {
  // Message Flow
  messagePublishRate: number;       // Messages published per second
  messageConsumptionRate: number;   // Messages consumed per second
  messageQueueDepth: number;        // Pending messages in queue

  // Database Performance
  databaseConnectionCount: number;  // Active database connections
  queryLatency: number;            // Average query response time
  transactionSuccessRate: number;  // Successful transaction percentage

  // Network Connectivity
  networkLatency: number;          // Network round-trip time
  packetLossRate: number;          // Network packet loss percentage
  bandwidthUtilization: number;    // Network bandwidth usage
}
```

### **Alert Thresholds and Escalation**

#### **Critical Alerts (Immediate Response Required)**
```yaml
critical_alerts:
  redis_memory_critical:
    condition: redis.memory_usage_percent > 90
    action: "Scale Redis horizontally or enable eviction policy"
    escalation: "Page on-call engineer immediately"
    
  agent_processing_stopped:
    condition: agent.ticks_processed_per_second == 0 for 60 seconds
    action: "Restart affected agents and investigate root cause"
    escalation: "Page on-call engineer and notify development team"
    
  database_connectivity_lost:
    condition: database.connection_count == 0
    action: "Check database health and restart connections"
    escalation: "Page database administrator and on-call engineer"
    
  system_availability_down:
    condition: system.health_check_success_rate < 50
    action: "Execute disaster recovery procedures"
    escalation: "Page entire on-call team and management"
```

#### **Warning Alerts (Action Required Within 30 Minutes)**
```yaml
warning_alerts:
  redis_memory_warning:
    condition: redis.memory_usage_percent > 80
    action: "Plan Redis scaling or memory optimization"
    escalation: "Notify on-call engineer via email"
    
  agent_latency_degraded:
    condition: agent.average_processing_latency > 100ms
    action: "Investigate performance bottlenecks"
    escalation: "Create incident ticket and notify team"
    
  error_rate_elevated:
    condition: system.error_rate > 1
    action: "Investigate error patterns and root causes"
    escalation: "Notify development team via Slack"
    
  resource_utilization_high:
    condition: system.cpu_usage > 80 OR system.memory_usage > 80
    action: "Monitor resource usage and plan capacity scaling"
    escalation: "Notify infrastructure team"
```

#### **Info Alerts (Monitoring and Trending)**
```yaml
info_alerts:
  configuration_changed:
    condition: config.last_modified > 1 hour ago
    action: "Log configuration change for audit trail"
    escalation: "Notify team via email"
    
  planned_maintenance:
    condition: maintenance.scheduled_window_approaching
    action: "Prepare maintenance procedures and notifications"
    escalation: "Notify all stakeholders"
    
  performance_trending:
    condition: performance.trend_analysis_available
    action: "Review performance trends and capacity planning"
    escalation: "Weekly performance review meeting"
```

### **Monitoring Implementation**

#### **Metrics Collection Setup**
```typescript
// Prometheus metrics configuration
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Redis metrics
const redisMemoryUsage = new Gauge({
  name: 'redis_memory_usage_bytes',
  help: 'Redis memory usage in bytes'
});

const redisConnectionCount = new Gauge({
  name: 'redis_connected_clients',
  help: 'Number of connected Redis clients'
});

const redisCommandLatency = new Histogram({
  name: 'redis_command_duration_seconds',
  help: 'Redis command execution time',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});

// Agent metrics
const ticksProcessed = new Counter({
  name: 'agent_ticks_processed_total',
  help: 'Total number of ticks processed by agents',
  labelNames: ['agent_id', 'symbol']
});

const processingLatency = new Histogram({
  name: 'agent_processing_duration_seconds',
  help: 'Time taken to process a tick',
  labelNames: ['agent_id'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

// System metrics
const systemHealthCheck = new Gauge({
  name: 'system_health_check_success',
  help: 'System health check success (1 = success, 0 = failure)'
});

// Metrics collection function
async function collectMetrics(): Promise<void> {
  // Collect Redis metrics
  const redisInfo = await redis.info('memory');
  redisMemoryUsage.set(parseInt(redisInfo.used_memory));
  
  const clientList = await redis.client('list');
  redisConnectionCount.set(clientList.split('\n').length - 1);
  
  // Collect agent metrics
  for (const agent of activeAgents) {
    const metrics = await agent.getMetrics();
    ticksProcessed.labels(agent.id, agent.symbol).inc(metrics.ticksProcessed);
    processingLatency.labels(agent.id).observe(metrics.averageLatency / 1000);
  }
  
  // Collect system health
  const healthStatus = await performHealthCheck();
  systemHealthCheck.set(healthStatus.success ? 1 : 0);
}

// Start metrics collection
setInterval(collectMetrics, 15000); // Every 15 seconds
```

---

## **📖 Operational Runbooks**

### **Incident Response Procedures**

#### **Redis Memory Exhaustion Response**
```markdown
**Incident**: Redis memory usage >90% or eviction events detected

**Immediate Actions** (0-5 minutes):
1. **Assess Impact**
   ```bash
   redis-cli info memory
   redis-cli info stats | grep evicted_keys
   ```

2. **Emergency Memory Relief**
   ```bash
   # Enable LRU eviction if not already enabled
   redis-cli config set maxmemory-policy allkeys-lru
   
   # Increase memory limit if system resources available
   redis-cli config set maxmemory 8gb
   ```

3. **Stop Non-Critical Agents**
   ```bash
   docker stop $(docker ps -q --filter "label=priority=low")
   ```

**Short-term Actions** (5-30 minutes):
1. **Analyze Memory Usage**
   ```bash
   redis-cli --bigkeys
   redis-cli memory usage {key-pattern}
   ```

2. **Clean Up Old Data**
   ```bash
   # Remove expired checkpoints
   redis-cli eval "$(cat cleanup-old-checkpoints.lua)" 0
   
   # Set TTL on temporary data
   redis-cli eval "$(cat set-ttl-temp-data.lua)" 0
   ```

3. **Scale Redis Horizontally**
   ```bash
   # Deploy additional Redis instances
   docker-compose -f redis-cluster.yml up -d
   
   # Migrate data to new instances
   ./scripts/migrate-redis-data.sh
   ```

**Long-term Actions** (30 minutes - 2 hours):
1. **Implement Redis Clustering**
2. **Optimize Data Structures**
3. **Establish Memory Monitoring**
4. **Update Capacity Planning**
```

#### **Agent Processing Failure Response**
```markdown
**Incident**: Agent stops processing ticks or error rate >5%

**Immediate Actions** (0-2 minutes):
1. **Identify Affected Agents**
   ```bash
   ./scripts/check-agent-health.sh
   ```

2. **Restart Failed Agents**
   ```bash
   docker restart $(docker ps -q --filter "health=unhealthy")
   ```

3. **Validate State Recovery**
   ```bash
   ./scripts/validate-agent-state.sh --all
   ```

**Investigation Actions** (2-15 minutes):
1. **Analyze Error Logs**
   ```bash
   docker logs agent-$AGENT_ID --tail=100
   grep "ERROR\|FATAL" /var/log/agents/*.log
   ```

2. **Check Resource Usage**
   ```bash
   docker stats --no-stream
   free -h
   df -h
   ```

3. **Validate Dependencies**
   ```bash
   redis-cli ping
   pg_isready -h $POSTGRES_HOST
   ```

**Recovery Actions** (15-30 minutes):
1. **Replay Missed Ticks**
   ```bash
   ./scripts/replay-missed-ticks.sh $AGENT_ID
   ```

2. **Verify Processing Resume**
   ```bash
   ./scripts/monitor-agent-recovery.sh $AGENT_ID
   ```

3. **Update Monitoring**
   ```bash
   ./scripts/update-alert-thresholds.sh
   ```
```

#### **Database Connectivity Issues Response**
```markdown
**Incident**: Database connection failures or query timeouts

**Immediate Actions** (0-3 minutes):
1. **Check Database Status**
   ```bash
   pg_isready -h $POSTGRES_HOST -p $POSTGRES_PORT
   psql -h $POSTGRES_HOST -c "SELECT 1;"
   ```

2. **Restart Connection Pools**
   ```bash
   docker restart $(docker ps -q --filter "label=component=agent")
   ```

3. **Enable Degraded Mode**
   ```bash
   # Agents continue with cached state
   ./scripts/enable-degraded-mode.sh
   ```

**Investigation Actions** (3-10 minutes):
1. **Analyze Database Logs**
   ```bash
   tail -f /var/log/postgresql/postgresql.log
   ```

2. **Check Connection Limits**
   ```sql
   SELECT count(*) FROM pg_stat_activity;
   SELECT setting FROM pg_settings WHERE name = 'max_connections';
   ```

3. **Validate Network Connectivity**
   ```bash
   telnet $POSTGRES_HOST $POSTGRES_PORT
   ping $POSTGRES_HOST
   ```

**Recovery Actions** (10-30 minutes):
1. **Restore Database Service**
   ```bash
   systemctl restart postgresql
   ```

2. **Validate Data Integrity**
   ```bash
   ./scripts/validate-database-integrity.sh
   ```

3. **Resume Normal Operations**
   ```bash
   ./scripts/disable-degraded-mode.sh
   ```
```

### **Maintenance Procedures**

#### **Redis Upgrade Procedure**
```markdown
**Preparation** (1 week before):
1. **Review Release Notes**
2. **Test Upgrade in Staging**
3. **Prepare Rollback Plan**
4. **Schedule Maintenance Window**

**Pre-Maintenance** (1 hour before):
1. **Create Full Backup**
   ```bash
   ./scripts/full-system-backup.sh
   ```

2. **Notify Stakeholders**
   ```bash
   ./scripts/send-maintenance-notification.sh
   ```

3. **Prepare Monitoring**
   ```bash
   ./scripts/setup-upgrade-monitoring.sh
   ```

**Maintenance Window**:
1. **Stop Agent Processing**
   ```bash
   docker-compose stop agents
   ```

2. **Backup Current Redis**
   ```bash
   redis-cli bgsave
   cp /var/lib/redis/dump.rdb /backups/pre-upgrade/
   ```

3. **Upgrade Redis**
   ```bash
   docker pull redis:7.2
   docker-compose up -d redis
   ```

4. **Validate Upgrade**
   ```bash
   redis-cli info server
   ./scripts/validate-redis-upgrade.sh
   ```

5. **Restart Agents**
   ```bash
   docker-compose up -d agents
   ```

6. **Monitor System Health**
   ```bash
   ./scripts/post-upgrade-monitoring.sh
   ```

**Post-Maintenance**:
1. **Validate Full Functionality**
2. **Update Documentation**
3. **Notify Completion**
4. **Schedule Follow-up Review**
```

#### **Capacity Planning Procedure**
```markdown
**Monthly Capacity Review**:

1. **Collect Performance Data**
   ```bash
   ./scripts/generate-capacity-report.sh --month=$(date +%Y-%m)
   ```

2. **Analyze Growth Trends**
   - Message volume growth rate
   - Memory usage trends
   - CPU utilization patterns
   - Storage growth rate

3. **Project Future Requirements**
   - 3-month capacity forecast
   - 6-month scaling requirements
   - Annual infrastructure planning

4. **Update Scaling Triggers**
   ```bash
   ./scripts/update-scaling-thresholds.sh
   ```

**Scaling Decision Matrix**:
- **Redis Memory >70%**: Plan horizontal scaling
- **Agent CPU >60%**: Add agent instances
- **Database Connections >80%**: Increase connection limits
- **Network Bandwidth >70%**: Upgrade network capacity
```

This operational readiness framework ensures the Redis-based tick processing system can be reliably deployed, monitored, and maintained in production environments with minimal downtime and rapid incident response capabilities.