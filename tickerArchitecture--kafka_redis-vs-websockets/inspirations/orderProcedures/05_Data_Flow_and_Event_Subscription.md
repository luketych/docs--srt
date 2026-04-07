# 05_Data_Flow_and_Event_Subscription.md

The `orderProcedures` system is inherently data-driven and event-aware. Procedures make decisions based on incoming data streams and can also react to asynchronous events, primarily those related to changes in their underlying models. This document outlines how data flows into the procedures and how they subscribe to relevant events.

## Data Acquisition during `runTick()`

The primary point of data ingress for decision-making within an active orderProcedure is during its `runTick()` method.

1.  **Fetching Market Data**:
    *   A crucial step in `base.runTick.js` is the acquisition of current market information. This is typically done by querying a FeathersJS service.
        ```javascript
        // From orderProcedureFactory/types/base/base.runTick.js
        const smartQuote = services['smartQuotes'].find({
          query: {
            "tickerSymbol": tickerSymbol, // From this.model
            "source": "marketwatch"      // Example source
          }
        });
        ```
    *   The `tickerSymbol` and other necessary parameters for the query are usually derived from the procedure's own `model`.
    *   The result of this asynchronous call (e.g., `smartQuote.then(quote => { ... })`) provides the fresh market data (like `quote.close` price) needed for calculations.

2.  **Internal Calculations**:
    *   Using the fetched market data and its internal state (from `this.model`, e.g., `numFilled`, `avgFillPrice`), the procedure calculates runtime values critical for its logic.
        ```javascript
        // From orderProcedureFactory/types/base/base.runTick.js
        const currentPrice = Number(quote.close);
        const pnl = this.model.numFilled * (currentPrice - this.model.avgFillPrice);
        ```
    *   This calculated data (e.g., `{ pnl }`) is then passed to `this.smo.tick(data)` to drive state evaluations.

3.  **Data for Sub-Procedures**:
    *   Relevant data (like the resolved `smartQuote` or other calculations) is also passed down to `this.runSubProcedures(spsToRun, { smartQuote })`. This allows sub-procedures (e.g., a trailing stop) to make decisions based on the most current information available during that tick.

## Model Data as a Primary Input

*   **`this.model`**: Each orderProcedure instance holds a `model` object. This object represents the procedure's configuration and its last known state as persisted in the database.
*   **Source of Truth**: The database is the ultimate source of truth for this model.
*   **Usage**:
    *   The `model` provides parameters for data fetching (e.g., `tickerSymbol`).
    *   It supplies values for calculations (e.g., `avgFillPrice`, `numFilled`).
    *   The Status Management Object (SMO) often refers to `this.model` (via its `subscribedData` property or direct access within `runConditions` functions) to check current status, configuration limits, or other persisted attributes.

## Event Subscription for Model Synchronization

OrderProcedures need to stay synchronized with any changes made to their models in the database, especially if these changes occur between `runTick()` cycles (e.g., due to external administrative actions or other linked services).

1.  **FeathersJS `patched` Event**:
    *   The primary mechanism for this is listening to `patched` events from the relevant FeathersJS service (e.g., `services['orderProcedures']`).
    *   This is set up in `index.js`:
        ```javascript
        // From src/index.js
        services['orderProcedures'].on('patched', (data) => {
          // 'data' is the updated model from the database
          if (ORDER_PROCEDURES[data._id]) { // Check if the procedure is active locally
            const newData = { ...ORDER_PROCEDURES[data._id].model, ...data };
            ORDER_PROCEDURES[data._id].model = newData; // Update local model
          }
        });
        ```
    *   When a procedure's record is updated in the database and FeathersJS emits a `patched` event, this listener updates the local `model` of the corresponding active orderProcedure instance.
    *   This ensures that the next `runTick()` cycle for that procedure will operate with the most recent state/configuration.

2.  **Periodic Model Refresh in `runTick()` (Defensive Measure)**:
    *   As a defensive measure, or to ensure the absolute latest data at the start of a tick, `base.runTick.js` also includes a call to `this.get(this.model._id)` (which fetches the model from the DB).
        ```javascript
        // From orderProcedureFactory/types/base/base.runTick.js
        this.get(this.model._id)
         .then(resp => {
            this.model = { ...this.model, ...resp };
         });
        ```
    *   This can be seen as a complementary approach to the real-time `patched` event, ensuring consistency even if an event were missed or if there's a desire to always start a tick from a freshly confirmed DB state.

## Internal Event Emission by SMO

*   As detailed in `03_State_Management_and_SMO.md`, the SMO emits events (e.g., `triggerExit`, `finishing`) via the orderProcedure's `eventEmitter` when its `runConditions` are met.
*   These are internal events within the `orderProcedures` system, signaling that a state transition should occur.
*   Listeners for these events (in `index.js`, `base/events.js`, or type-specific files) then handle the side effects of these transitions, such as updating the model's status in the database.

## Summary

Data flows into orderProcedures primarily through:
1.  **Direct fetching of market data** (e.g., quotes) during each `runTick()`.
2.  **Access to its own `model`** (configuration and persisted state).

Event subscriptions play a crucial role in:
1.  **Keeping the local `model` synchronized** with the database via FeathersJS `patched` events.
2.  **Driving internal state transitions** through events emitted by the SMO, which are then handled by dedicated listeners.

This combination of periodic data polling, real-time event-driven updates for model synchronization, and internal eventing for state management allows orderProcedures to be responsive and adaptive to both market changes and modifications to their own defined parameters.
