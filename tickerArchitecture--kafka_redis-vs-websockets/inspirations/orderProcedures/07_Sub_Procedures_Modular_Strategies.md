# 07_Sub_Procedures_Modular_Strategies.md

Sub-Procedures are a key architectural feature of the `orderProcedures` system, enabling modularity and reusability in defining complex trading strategies. They represent discrete components or phases of an overall orderProcedure, such as entry mechanisms, risk management (stop-loss), profit-taking, or scaled execution (drip-buying/selling).

## Purpose and Concept

*   **Modularity**: Sub-Procedures break down a complex trading strategy into smaller, manageable, and often reusable parts. For example, a `stopLoss` sub-procedure can be used by many different types of parent orderProcedures.
*   **Composition**: An orderProcedure (like `bullRR`) is composed of one or more sub-procedures. The specific sub-procedures and their configurations are defined by the parent orderProcedure's type and its model.
*   **Independent Logic**: Each sub-procedure encapsulates its own specific logic and maintains its own state (e.g., "pending", "active", "executed", "cancelled").
*   **Conditional Execution**: Sub-Procedures are typically executed by the parent orderProcedure based on its current state and market conditions. For instance, an "entry" sub-procedure might run when the parent is "initializing" or "pendingEntry", while a "stopLoss" sub-procedure runs when the parent is "active" (i.e., has a position).

## Configuration

1.  **`proceduresConfig.json`**:
    *   This file (located at `src/proceduresConfig.json`) defines the available types of sub-procedures and their basic characteristics.
    *   It categorizes sub-procedures (e.g., "entrySP", "exitSP", "managementSP").
    *   For each sub-procedure type, it might specify default parameters or behaviors.
        ```json
        // Example snippet from proceduresConfig.json
        "subProcedures": {
          "buyNow": {
            "allocation": "entrySP", // Category
            "description": "Buys the full amount immediately."
          },
          "stopLoss": {
            "allocation": "exitSP",
            "description": "Exits position if price drops below a certain level."
          },
          // ... other sub-procedure types
        }
        ```

2.  **Parent OrderProcedure Model**:
    *   The parent orderProcedure's model (from the database) specifies which sub-procedures it will use and their specific configurations.
    *   This is often managed by the type-specific constructor of the orderProcedure (e.g., `bullRR/index.js` might define that a `bullRR` strategy uses a `buyNow` entry and a `stopLoss` exit).
    *   The parent model might store an array of sub-procedure configurations or IDs that link to separate sub-procedure records in the database.
    *   The `setupSubProcedures.js` utility (called during `base.index.js` construction) is responsible for linking these configured sub-procedures to the parent instance.

## Instantiation

*   **`subProcedureFactory`**:
    *   Sub-Procedure objects are created by the `subProcedureFactory` (likely located in `subProcedureFactory/index.js`, though its exact location was not explicitly viewed in detail, its existence is inferred from `init.js`).
    *   The `init.js` script fetches all sub-procedure models from the database.
    *   It then iterates through these models, passing each one to `subProcedureFactory.construct(spModel)` to create runtime instances.
    *   These instances are then linked to their respective parent orderProcedure instances.

## Execution Lifecycle

1.  **`runSubProcedures` Method**:
    *   The `baseObject` for orderProcedures (from `orderProcedureFactory/types/base/base.index.js`) includes a `runSubProcedures` method.
    *   This method is called within the parent's `runTick()` (typically from `base.runTick.js`).
        ```javascript
        // From orderProcedureFactory/types/base/base.runTick.js
        // ... after fetching smartQuote and calculating PNL ...
        this.runSubProcedures(spsToRun, { smartQuote });
        ```

2.  **Determining `spsToRun`**:
    *   The `spsToRun` (sub-procedures to run) argument is crucial. It's an array of sub-procedure instances that are relevant for the current state of the parent orderProcedure.
    *   The logic for determining `spsToRun` resides within the parent orderProcedure, often within its Status Management Object (SMO) or type-specific logic. For example:
        *   If parent status is "pendingEntry", `spsToRun` might include entry-type sub-procedures.
        *   If parent status is "active", `spsToRun` might include `stopLoss` and `takeProfit` sub-procedures.
    *   The `base/statusMngr.js` for the SMO defines which sub-procedures are active for each parent status:
        ```javascript
        // Example from base/statusMngr.js toStatuses map
        active: {
          // ... other properties ...
          activeSubProcedures: ['stopLoss', 'takeProfit', /* other management SPs */],
          runConditions: (subscribedData, thisOp) => { /* ... */ }
        }
        ```
        The `activeSubProcedures` array lists the *types* of sub-procedures that should be considered. The actual instances are then filtered from `this.subProcedures`.

3.  **Execution of Sub-Procedure `runTick()`**:
    *   The `runSubProcedures` method iterates through the provided `spsToRun`.
    *   For each active sub-procedure, it calls its own `runTick(data)` method, passing relevant data (like the `smartQuote`).
    *   Each sub-procedure's `runTick` contains the logic specific to its task (e.g., checking if stop-loss price is breached, executing a buy order).

## State Management

*   **Independent Status**: Each sub-procedure instance maintains its own status in its database model (e.g., `status: 'pending'`, `status: 'active'`, `status: 'executed'`).
*   **Updates**: When a sub-procedure completes its task or changes state, it updates its model in the database (likely via a `this.set()` method similar to the parent or through event handling).
*   **Parent Awareness**: The parent orderProcedure can be aware of its sub-procedures' statuses by:
    *   Checking their `model.status` directly.
    *   Listening for events emitted by sub-procedures (if they have their own event emitters).
    *   The completion or state change of a sub-procedure can trigger state transitions in the parent orderProcedure's SMO.

## Examples of Sub-Procedure Types

As seen in `proceduresConfig.json` and inferred from strategy names:
*   **Entry Sub-Procedures**:
    *   `buyNow`: Executes a market buy for the configured quantity.
    *   `dripBuy`: Scales into a position by buying smaller amounts over time or at different price levels.
*   **Exit Sub-Procedures**:
    *   `stopLoss`: Exits the position if the price drops to a specified level.
    *   `takeProfit`: Exits the position if the price rises to a target level.
    *   `trailingStop`: A stop-loss that adjusts as the price moves favorably.
*   **Management Sub-Procedures**:
    *   Could include logic for adjusting parameters, partial exits, or other ongoing management tasks while a position is active.

## Conclusion

Sub-Procedures provide a powerful mechanism for building sophisticated, multi-stage trading strategies in a modular and maintainable way. By encapsulating specific tasks and being managed by a parent orderProcedure, they allow for clear separation of concerns and promote the reuse of common trading components across different overall strategies. Their interaction with the parent via `runSubProcedures` and their independent state management are central to their effective operation within the system.
