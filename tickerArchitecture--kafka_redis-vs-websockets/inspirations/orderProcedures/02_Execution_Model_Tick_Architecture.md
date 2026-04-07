# 02_Execution_Model_Tick_Architecture.md

The execution model of the `orderProcedures` system is centered around a periodic "tick" architecture. This document details how this tick-based execution works, from its initiation to the actions performed within each cycle.

## The Heartbeat: `setInterval` and `TICK_INTERVAL`

*   **Initiation**: The core execution loop is established in `index.js` using `setInterval`.
    ```javascript
    setInterval(async () => {
      // ... re-initialize procedures ...
      Object.values(ORDER_PROCEDURES).forEach(orderProcedure => {
        orderProcedure.runTick();
      });
    }, config.TICK_INTERVAL);
    ```
*   **`config.TICK_INTERVAL`**: This value, defined in `config.js`, determines the frequency of the ticks. For example, if `TICK_INTERVAL` is 5000 (milliseconds), the entire tick cycle for all active procedures will be initiated every 5 seconds.
*   **Purpose**: This regular interval provides a consistent opportunity for each orderProcedure to:
    1.  Re-evaluate its conditions against the latest market data and its current state.
    2.  Execute any necessary actions based on its pre-defined logic.

## Anatomy of a Tick (`orderProcedure.runTick()`)

When `orderProcedure.runTick()` is called (as seen in `orderProcedureFactory/types/base/base.runTick.js`), a sequence of operations typically occurs:

1.  **Model Refresh (Optional but Good Practice)**:
    *   The procedure might first ensure its local `model` is up-to-date with the persisted state in the database.
        ```javascript
        // Example from base.runTick.js
        this.get(this.model._id) // 'get' is bound to a model getter
         .then(resp => {
            this.model = { ...this.model, ...resp };
         });
        ```
    *   This step is crucial if external changes to the procedure's configuration or state can occur (e.g., via a UI or another service updating the database).

2.  **Data Acquisition**:
    *   The procedure fetches necessary external data required for its logic. A common example is fetching current market prices or indicators.
        ```javascript
        // Example from base.runTick.js
        const smartQuote = services['smartQuotes'].find({ query: { /* ... */ } });
        ```
    *   This data is often retrieved via FeathersJS services.

3.  **Calculations and Data Preparation**:
    *   Based on the fetched data and its current model state, the procedure performs relevant calculations.
        ```javascript
        // Example from base.runTick.js, after smartQuote resolves
        const currentPrice = Number(quote.close);
        const pnl = this.model.numFilled * (currentPrice - this.model.avgFillPrice);
        ```
    *   This prepared data (e.g., `pnl`) is then used to drive state evaluations.

4.  **State Evaluation via SMO (`this.smo.tick(data)`)**:
    *   The calculated data is passed to the procedure's Status Management Object (SMO).
        ```javascript
        // Example from base.runTick.js
        this.smo.tick({ pnl });
        ```
    *   Inside `smo.tick()` (defined in `statusMngr.js` files):
        *   It iterates through its `toStatuses` map. Each entry represents a potential state transition.
        *   The associated `runConditions` function is executed with the provided data.
        *   If a `runConditions` function returns `true` (or a data payload indicating success), the SMO emits an event corresponding to the target state (e.g., `this.eventEmitter.emit('triggerExit', eventData)`).
    *   This is where the core "if condition A, then signal B" logic resides.

5.  **Execution of Sub-Procedures (`this.runSubProcedures(...)`)**:
    *   The `runTick` method also invokes the logic for any active sub-procedures associated with the orderProcedure.
        ```javascript
        // Example from base.runTick.js
        const spsToRun = Object.values(sps).filter(sp => sp.status !== 'executed');
        this.runSubProcedures(spsToRun, { smartQuote }); // Pass relevant data
        ```
    *   This allows entry strategies, exit strategies (like stop-losses or take-profits), or other modular pieces of logic to execute their own checks and actions during the tick.

## Event-Driven Actions

It's important to note that the `smo.tick()` itself usually *signals* a state change by emitting an event rather than directly performing the change. Event listeners (defined in `index.js`, `base/events.js`, or within the procedure type itself) subscribe to these events.

*   When an event like `triggerExit` is emitted by the SMO:
    *   The corresponding listener is activated.
    *   This listener then typically handles the actual state transition, which might involve:
        *   Updating the procedure's status in the database (via a FeathersJS service call).
        *   Calling specific methods on the procedure (e.g., `this.exit()`)
        *   Cleaning up resources or canceling open orders.

## Dynamic Re-initialization within the Tick Cycle

As observed in `index.js`, the main `setInterval` loop also re-runs `init()`:

```javascript
setInterval(async () => {
  let ORDER_PROCEDURES = init(); // Re-fetches and reconstructs

  while (_areOrderProceduresInitialized() === false) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  Object.values(ORDER_PROCEDURES).forEach(orderProcedure => {
    orderProcedure.runTick();
  });
}, config.TICK_INTERVAL);
```

This means that at the beginning of each tick cycle defined by `setInterval`, the system attempts to refresh its entire set of active `ORDER_PROCEDURES` from the database. This design allows the system to:

*   Dynamically pick up newly created orderProcedures.
*   Reflect changes made externally to existing procedure configurations in the database.
*   Potentially recover from isolated errors in individual procedure instances by reconstructing them.

The `while (_areOrderProceduresInitialized() === false)` loop ensures that `runTick()` is only called on a fully initialized set of procedures for that cycle.

## Summary

The tick architecture provides a robust and cyclical execution model. Each tick offers a fresh opportunity for procedures to assess the market, evaluate their internal logic via the SMO, execute sub-strategies, and react to changes in their configuration or the broader market environment. The `TICK_INTERVAL` controls the responsiveness of the system, balancing the need for timely execution with computational resources.
