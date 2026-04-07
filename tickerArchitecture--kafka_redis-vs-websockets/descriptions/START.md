---

## **1. System Overview**

**Purpose**: Provide a unified tick-driven architecture for live trading and backtesting, with decoupled agents that can scale horizontally and recover from failures.

**Key Components**:

- Overmind (tick producer)
- Redis (tick event broker)
- Zombie-Agents (consumers)
- Monitoring & Logging

---

## **2. Event Flow**

- **Tick Creation**:
  - Frequency (every 1 minute for MVP)
  - Contents of the tick event (timestamp, tick_id)
- **Tick Delivery**:
  - Redis topic name (e.g., ticks.global)
  - Consumer group setup (one per agent? or shared?)
- **Zombie-Agent Processing**:
  - Describe state machine flow:
    - Receive tick → Update state → Decide trade → Emit event/log

---

## **3. State Management**

- How agents **store and recover state**:
  - Postgres
  - Checkpoint frequency
  - 🚧 What happens on crash/restart

---

## **4. Error Handling & Observability**

- **How agents report errors** back to Overmind:
  - Redis agent_errors topic
- **Monitoring**:
  - Redis consumer lag detection
  - Agent heartbeat mechanism
- **Dashboard / Logs**:
  - What metrics to expose (agent health, last tick processed)

------

## **5. Milestones / Roadmap**

1. **Milestone 1 (MVP)**
   - Zombie-Agents print “Hello World” on tick
2. **Milestone 2**
   - Agents maintain and persist state to Postgres
   - Dashboard shows active agents and last tick
3. **Milestone 3**
   - Error reporting and automatic agent recovery



---



## 6. Future Enhancements

### <u>**Event Replay**</u>


#### **Why Event Replay is Important**

Event replay means your system can **re-consume past ticks** from storage (Kafka log, Redis Streams, DB) to **reconstruct state or backtest strategies**.

**Here’s why it’s valuable:**

##### **A. Crash Recovery**
- Zombie-agents **maintain in-memory state**.
- If an agent crashes or you restart the system:
  - You may want to **replay missed ticks** to restore its state accurately.
  - Without replay, the agent might **start with stale or incomplete context**.
  

**Example:**
- Agent tracks a 20-minute moving average.
- It crashes for 5 minutes → without replay, it has a gap in its calculation.

##### **B. Backtesting & Simulation**
- To test new strategies, you need **historical ticks**:
  - Run the exact same event stream **offline**.
  - Validate if a zombie-agent would have traded correctly.
- Event replay gives you **deterministic reproducibility**:
  - Same input ticks → same outputs → confidence in results.

##### **C. Audit and Compliance**
- In trading, it’s often required to **prove why a trade happened**.
- If you can **replay the tick sequence**, you can reproduce:
  - Agent state at the time
  - Decision logic that led to the trade
  

##### **Kafka Advantage for Replay**

- Kafka stores events for a configurable **retention period**.

- Agents can **reset their consumer offset** to:

  - Reprocess from the beginning
  - Rewind to a specific timestamp
  
  ```
  kafka-consumer-groups.sh --reset-offsets --to-earliest --group zombie-agent-42 --topic ticks --execute
  ```
  
---



## 7. Considerations

### <u>**Why Use Redis Before Kafka**</u>

Many systems start with **Redis** before adopting **Kafka** because Redis is:



### **A. Simpler for Early Development**

- **Zero cluster setup**: single brew install redis or Docker container.
- **Pub/Sub** lets you **broadcast ticks** to all agents with almost no configuration.
- Perfect for **MVP or <200 agents**.

### **B. Lower Latency & Simpler Ops**

- Redis Pub/Sub is **in-memory** and **ultra-fast** (<1ms local).
- **No partitioning, brokers, or Zookeeper** needed.
- Easier for local testing & backtesting prototypes.

### **C. Natural Evolution Path**

1. **Stage 1: Redis Pub/Sub (MVP)**
   - Broadcast ticks → all agents get events
   - Central tick loop + Postgres for state
2. **Stage 2: Redis Streams (Add Replay & Persistence)**
   - Streams allow **acknowledgements & limited replay**
   - Crash recovery without a full Kafka setup
3. **Stage 3: Kafka (Scale Out)**
   - When you need:
     - **>1k agents**
     - **Cross-server distribution**
     - **Large-scale historical replay**
     - **Partitioning for throughput**

### **Rule of Thumb**

- **Redis for simplicity & iteration**
  - Single-node, in-memory, good for prototypes and small clusters.
- **Kafka for scale & durability**
  - Distributed, partitioned, persistent, enterprise-ready.



Starting with Redis avoids the **complexity tax of Kafka** while still letting you design **agent interfaces and error handling** correctly.

When you migrate to Kafka, **agent code doesn’t change** — only the transport layer.