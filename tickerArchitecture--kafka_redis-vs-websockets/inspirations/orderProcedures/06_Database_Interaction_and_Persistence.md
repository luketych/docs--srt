# 06_Database_Interaction_and_Persistence.md

The database plays a central and critical role in the `orderProcedures` system. It serves as the primary source of truth for procedure configurations, their current state, and facilitates dynamic updates to running strategies. Interaction with the database is predominantly managed via FeathersJS services.

## Database as the Source of Truth

*   **Procedure Models**: Each orderProcedure and subProcedure corresponds to a record (or document) in the database. This record stores:
    *   **Configuration**: Parameters defining the strategy, such as `tickerSymbol`, `type` (e.g., "bullRR"), risk parameters (e.g., `maxLoss`, though some might be in code currently), and settings for its sub-procedures.
    *   **State**: The current operational status of the procedure (e.g., "initializing", "active", "exiting", "finished", "error"), execution details like `avgFillPrice`, `numFilled`, and any other persisted state variables.
    *   **Relationships**: Links between an orderProcedure and its constituent subProcedures (e.g., via a `parentID` in sub-procedure models).

*   **Why this is important**:
    *   **Persistence**: Ensures that strategy configurations and their progress are not lost if the application restarts.
    *   **Centralization**: Provides a single, authoritative source for what procedures should be running and their current state.
    *   **External Management**: Allows for procedures to be potentially created, monitored, and modified by external tools or UIs that interact with the same database (via FeathersJS).

## Fetching Models during Initialization (`init.js`)

*   The main `init.js` script is responsible for loading active procedures from the database at startup and periodically thereafter.
    ```javascript
    // From src/init.js
    const opModelsPromise = getOPmodelsFromDB({
      query: {
        $and: [ // Only fetch active/relevant procedures
          { 'status': { $ne: "error" } },
          { 'status': { $ne: "executed" } },
          { 'status': { $ne: "finished" } },
        ]
      }
    });
    const spModelsPromise = getSPmodelsFromDB();

    Promise.all([opModelsPromise, spModelsPromise])
      .then(([ops, sps]) => {
        const opModels = ops.data; // Data from DB
        const spModels = sps.data; // Data from DB
        // ... then construct instances using factories ...
      });
    ```
*   `getOPmodelsFromDB` and `getSPmodelsFromDB` are utility functions that wrap FeathersJS service calls (e.g., `services['orderProcedures'].find(...)`) to retrieve these models.

## Dynamic Loading and Periodic Re-initialization

*   As detailed in `02_Execution_Model_Tick_Architecture.md`, the `index.js` `setInterval` loop calls `init()` at each `TICK_INTERVAL`.
*   This effectively means the system **polls the database** periodically for the current set of active orderProcedures.
*   **Benefits**:
    *   **Dynamic Addition**: New procedures created directly in the database will be picked up and instantiated by the running system on the next tick cycle.
    *   **Reflection of External Changes**: Modifications made to procedure records in the database (e.g., changing a parameter via an admin UI) will be reflected in the local instances after the next `init()` call.

## Persisting State Changes

When an orderProcedure changes its state (e.g., from "active" to "exiting" due to a stop-loss condition), this change must be persisted back to the database.

*   **Mechanism**: This is typically handled by event listeners that react to events emitted by the procedure's SMO.
*   **Example Flow**:
    1.  SMO's `runConditions` for a `triggerExit` are met.
    2.  SMO emits a `triggerExit` event: `this.eventEmitter.emit('triggerExit', eventData)`.
    3.  An event listener (e.g., in `index.js` or `base/events.js`) catches this event.
    4.  The listener then calls the appropriate FeathersJS service method to update the procedure's record in the database:
        ```javascript
        // Conceptual listener for 'triggerExit'
        orderProcedure.eventEmitter.on('triggerExit', (data) => {
          logger.warn('triggerExit event', data);
          // Update status in DB
          services['orderProcedures'].patch(data.caller.model._id, { status: 'exiting', reasonForExit: data.reason })
            .then(() => {
              // Potentially delete local instance or mark as inactive
              delete ORDER_PROCEDURES[data.caller.model._id];
            })
            .catch(err => logger.error('Failed to patch OP to exiting:', err));
        });
        ```
*   **Sub-Procedures**: Sub-procedures would follow a similar pattern, updating their own models in their respective database collections/tables via FeathersJS services when their state changes.

## Real-time Synchronization with `patched` Events

*   In addition to periodic polling via `init()`, the system uses FeathersJS real-time capabilities.
*   `index.js` listens for `patched` events on the `orderProcedures` service:
    ```javascript
    // From src/index.js
    services['orderProcedures'].on('patched', (data) => {
      if (ORDER_PROCEDURES[data._id]) {
        ORDER_PROCEDURES[data._id].model = { ...ORDER_PROCEDURES[data._id].model, ...data };
      }
    });
    ```
*   If a procedure's record is updated in the DB (by any client, including itself or an external tool), this event is broadcast. The listener updates the local in-memory `model` of the active procedure instance.
*   This provides faster synchronization than relying solely on the periodic `init()` polling for changes made by other actors.

## Model Getters/Setters

*   OrderProcedure objects are equipped with `get` and `set` methods (from `opFactory/model/getter.js` and `setter.js`).
    *   `this.get(this.model._id)`: Fetches the latest model from the DB. Used in `base.runTick.js` to ensure the tick starts with fresh data.
    *   `this.set(updateData)`: Patches the model in the DB with `updateData`. This would be the preferred way for a procedure to update its own persisted state directly if needed, rather than relying solely on external event handlers.

## Summary

The database, accessed via FeathersJS services, is integral to the `orderProcedures` system. It ensures:
*   **Persistence** of strategy definitions and their operational states.
*   **Dynamic behavior**, allowing the system to adapt to new or modified procedures without restarts through a combination of periodic polling (`init()`) and real-time `patched` events.
*   **Centralized state management**, where changes to a procedure's status are written back to the database, maintaining it as the authoritative source of truth.

This robust interaction model supports a flexible and resilient system where the runtime environment stays closely synchronized with the persisted strategic directives.
