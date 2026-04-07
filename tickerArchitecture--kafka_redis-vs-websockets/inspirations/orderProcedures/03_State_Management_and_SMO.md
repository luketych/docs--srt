# 03_State_Management_and_SMO.md

A core tenet of the `orderProcedures` system is its state-driven nature. Each orderProcedure operates as a state machine, transitioning between various statuses based on pre-defined logic and incoming data. The **Status Management Object (SMO)** is the central component responsible for orchestrating this state management.

## The Role of the Status Management Object (SMO)

*   **Heart of the State Machine**: The SMO encapsulates the specific state logic for an orderProcedure. It determines:
    *   What are the possible states for a procedure?
    *   What conditions must be met to transition from one state to another?
    *   What data is required to evaluate these conditions?
*   **Attached to Each Procedure**: Every orderProcedure instance has its own SMO. This SMO is tailored to the procedure's `type` (e.g., `base`, `bullRR`), with specialized types often extending or overriding the SMO of a base type.
*   **Construction**: SMOs are typically built by a `buildStatusMngtObject` function within the procedure type's definition files (e.g., `orderProcedureFactory/types/base/statusMngr.js`).

## SMO Structure and Key Properties

A typical SMO, as constructed by `buildStatusMngtObject`, includes:

1.  **`subscribedData`**:
    *   An object or reference (often to `this.model` of the parent orderProcedure) indicating the data sources the SMO relies on for its evaluations.
    *   This ensures that the SMO has access to the necessary configuration, current state, and potentially market data (passed into its `tick` method) to make decisions.

2.  **`tick(data)` Method**:
    *   This is the primary method called by the orderProcedure's `runTick()` (usually after fetching market data and performing initial calculations like PNL).
    *   The `data` argument typically contains real-time information (e.g., `{ pnl: calculatedPNL }`).
    *   **Logic**:
        ```javascript
        // Simplified from statusMngr.js
        tick: function(data) {
            Object.entries(this.smo.toStatuses).forEach(([stateEventName, runConditionsFn]) => {
              const runConditionsRetData = runConditionsFn(data); // Evaluate conditions
              if (runConditionsRetData /* evaluates to true or returns actionable data */) {
                this.eventEmitter.emit(stateEventName, runConditionsRetData); // Emit event for state change
              }
            });
        }.bind(this) // 'this' refers to the parent orderProcedure
        ```
    *   It iterates through all defined `toStatuses` (see below) and executes their respective `runConditions` functions.
    *   If a condition set passes, it emits an event using the orderProcedure's `eventEmitter`. The event name usually corresponds to the target state or action (e.g., `triggerExit`, `finishing`).

3.  **`toStatuses` Map**:
    *   This is the core of the state transition logic. It's an object where:
        *   **Keys** are strings representing the *event name* to be emitted if the conditions are met. These event names often correspond to a target state or a significant action (e.g., `triggerExit`, `initializing`, `finishing`).
        *   **Values** are functions, typically named `runConditions(data)`. Each `runConditions` function:
            *   Takes the runtime `data` (e.g., PNL, market prices) as an argument.
            *   Contains an array or series of individual condition checks (often as anonymous functions).
            *   Uses logic like `.every(condition => condition())` (all conditions must pass) or `.some(condition => condition())` (at least one condition must pass).
            *   Returns `true` or a data payload if the overall condition for transition is met, and `false` otherwise.
            *   Is bound to the context of the parent orderProcedure (`.bind(this)`), allowing it to access `this.model`, `this.eventEmitter`, etc.

    *   **Example `toStatuses` Entry (from `base/statusMngr.js`):**
        ```javascript
        "triggerExit": function runConditions(data) {
            const conditionsPassOrFail = [
                () => data?.pnl <= -maxLoss, // Example condition
            ].every(condition => condition());

            if (conditionsPassOrFail === true) {
              return { // Return data payload for the event
                caller: this, // Reference to the orderProcedure
                reason: `triggerExit: pnl: ${data?.pnl} <= -maxLoss: ${-maxLoss}`
              };
            }
            else return false;
        }.bind(this),
        ```

## Building and Extending SMOs

*   **Base SMO**: The `orderProcedureFactory/types/base/statusMngr.js` defines the `buildStatusMngtObject` for the `base` procedure type. This provides a foundational set of states and transitions.
*   **Specialized SMOs**: More specific procedure types (like `bullRR` in `orderProcedureFactory/types/bullRR/statusMngr.js`) can define their own `buildStatusMngtObject`.
*   **Extension/Composition**: As seen in `bullRR/index.js`, a specialized type often takes the `base` object (which includes the base SMO) and then enhances or merges its own SMO properties:
    ```javascript
    // Simplified from bullRR/index.js
    const newSMO = buildStatusMngtObject.call(thisObj); // 'thisObj' is the base object
    newSMO.toStatuses = { ...thisObj.smo.toStatuses, ...newSMO.toStatuses }; // Merge 'toStatuses'
    newSMO.subscribedData = { ...thisObj.smo.subscribedData, ...newSMO.subscribedData };
    thisObj.smo = newSMO; // Replace base SMO with the extended one
    ```
    This allows `bullRR` to inherit base state logic while adding or overriding transitions specific to its strategy.

## Event-Driven State Transitions

A key aspect is that the SMO's `tick()` method **signals** the intent to change state by emitting an event. It does not directly modify the procedure's status in the database.

*   **Decoupling**: This decouples condition evaluation (SMO's job) from the execution of state change actions.
*   **Action Handling**: Event listeners (in `index.js`, `base/events.js`, or within the procedure type's files) subscribe to these events (e.g., `triggerExit`).
*   When an event is caught, the listener is responsible for:
    *   Updating the `status` field of the orderProcedure's model in the database (e.g., via a `services['orderProcedures'].patch(...)` call).
    *   Performing any other associated actions (e.g., logging, calling `this.exit()` on the procedure, cleaning up resources).

## Summary

The Status Management Object (SMO) is the engine of an orderProcedure's stateful behavior. It provides a structured way to define states, the conditions for transitioning between them, and the data required for these evaluations. By emitting events to signal state changes, the SMO enables a clean, decoupled architecture where the responsibility of acting on those state changes lies with dedicated event handlers. This system allows for complex, conditional logic to be implemented in a manageable and extensible way.
