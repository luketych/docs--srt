# 01_System_Architecture.md

This document outlines the high-level system architecture of the `orderProcedures` module. It describes the main components and their interactions, providing a foundational understanding of how the system operates.

## Core Components:

The system is composed of several key JavaScript files and directories, working in concert with a FeathersJS backend for data persistence and real-time communication.

1.  **`index.js` (Main Entry Point):**
    *   Initializes the system by calling `init()`.
    *   Sets up a periodic execution loop (`setInterval`) that drives the `runTick()` method of each active orderProcedure.
    *   Listens for real-time updates (e.g., `patched` events) from FeathersJS services to keep local procedure models synchronized with the database.
    *   Manages the collection of active `ORDER_PROCEDURES`.

2.  **`init.js` (Initialization Logic):**
    *   Responsible for fetching active orderProcedure (`OP`) models and subProcedure (`SP`) models from the database (via FeathersJS services).
    *   Uses `orderProcedureFactory` and `subProcedureFactory` to construct runtime instances of OPs and SPs from these models.
    *   Connects sub-procedures to their parent orderProcedures.
    *   Populates the main `ORDER_PROCEDURES` collection asynchronously. The system waits for this initialization to complete before starting the tick cycle.
    *   The periodic re-invocation of `init()` by `index.js` allows for dynamic loading of new or modified procedures from the database.

3.  **Factories (`orderProcedureFactory/`, `subProcedureFactory/`):**
    *   **`orderProcedureFactory`**: Constructs orderProcedure instances based on their `type` (e.g., `bullRR`). It often employs a compositional pattern, where specialized procedures (like `bullRR`) are built upon a `base` procedure object, inheriting or extending its core functionalities.
    *   **`subProcedureFactory`**: Constructs individual sub-procedure instances (e.g., `buyNow`, `stopLoss`, `takeProfit`) based on their configuration. These are the building blocks for entry, exit, and other specific actions within a larger orderProcedure strategy.

4.  **OrderProcedure Objects (e.g., `base`, `bullRR`):**
    *   These are the runtime representations of individual trading strategies.
    *   Each procedure object encapsulates:
        *   Its `model` (configuration and state, largely mirroring the database record).
        *   A `StatusManagementObject (SMO)` which defines its state machine logic (states, transition conditions, data dependencies).
        *   References to its constituent `subProcedures`.
        *   Core methods like `init()` (for self-initialization), `runTick()` (to evaluate logic periodically), `runSubProcedures()`, and `exit()`.
        *   An `eventEmitter` for internal signaling.

5.  **Sub-Procedure Objects:**
    *   Represent discrete actions or conditions within an orderProcedure (e.g., executing a buy order, checking a stop-loss condition).
    *   Each has its own model, status, and execution logic.

6.  **Status Management Object (SMO):**
    *   A critical component attached to each orderProcedure.
    *   Defines the procedure's state machine:
        *   `toStatuses`: Maps target states to functions (`runConditions`) that determine if a transition to that state should occur.
        *   `subscribedData`: Specifies the data required for evaluation.
    *   The `smo.tick(data)` method evaluates conditions and emits events to signal state transitions.

7.  **Configuration Files:**
    *   `proceduresConfig.json`: High-level definitions of available orderProcedure types and their associated sub-procedure categories.
    *   Type-specific `subProceduresConfig.json` (e.g., in `orderProcedureFactory/types/bullRR/`): Defines the specific sub-procedures and their parameters for a particular strategy type.
    *   `config.js`: General application-level configurations, such as `TICK_INTERVAL`.

8.  **FeathersJS Integration (`feathersClients/`):**
    *   Provides connectivity to a FeathersJS backend.
    *   Used for:
        *   Fetching and persisting orderProcedure and subProcedure models.
        *   Accessing real-time market data (e.g., `smartQuotes` service).
        *   Receiving real-time updates to models via service events (e.g., `patched`).

## Conceptual Flow (Simplified Tick Cycle):

1.  **`index.js` Timer:** Triggers at `config.TICK_INTERVAL`.
2.  **`init.js` (Periodic Re-init):**
    *   Fetches active OP/SP models from the database.
    *   Reconstructs OP/SP instances using factories.
3.  **`index.js` waits for `_areOrderProceduresInitialized()`**.
4.  **For each active `OrderProcedure`:**
    *   **`orderProcedure.runTick()` is called:**
        *   The procedure may refresh its local `model` from the database.
        *   Fetches necessary external data (e.g., `smartQuote`).
        *   Performs calculations (e.g., PNL).
        *   Calls `this.smo.tick(calculated_data)`:
            *   SMO evaluates `runConditions` for all potential state transitions.
            *   If conditions for a transition are met, SMO emits an event (e.g., `triggerExit`).
        *   Event listeners (in `index.js` or the procedure itself) react to these events, potentially:
            *   Updating the procedure's status in the database.
            *   Calling methods like `this.exit()`.
        *   Calls `this.runSubProcedures()` to execute logic for active entry/exit/other sub-strategies.

This architecture allows for dynamic, stateful, and data-driven execution of complex trading strategies, with a clear separation of concerns between configuration, state management, and execution logic.
