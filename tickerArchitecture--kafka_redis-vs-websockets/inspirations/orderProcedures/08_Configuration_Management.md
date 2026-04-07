# 08_Configuration_Management.md

Configuration management in the `orderProcedures` system is multi-layered, combining static definitions with dynamic, instance-specific parameters stored in the database. This approach provides both a foundational structure for procedure types and the flexibility to customize individual strategy instances.

## Layers of Configuration

1.  **Static Definitions (`proceduresConfig.json`)**:
    *   **Location**: `src/proceduresConfig.json`
    *   **Purpose**: This file serves as a central registry for defining the *types* of orderProcedures and sub-Procedures that the system recognizes. It establishes a baseline understanding of what constitutes each procedure type.
    *   **Content**:
        *   **OrderProcedure Types**: Lists available main strategies (e.g., `bullRR`, `bearRR`). For each type, it might specify:
            *   `description`: A human-readable explanation.
            *   `category`: A classification (e.g., "directional", "meanReversion").
            *   Potentially, default sub-procedures that this type typically uses or other structural defaults.
        *   **Sub-Procedure Types**: Lists available modular components (e.g., `buyNow`, `stopLoss`, `dripBuy`, `takeProfit`). For each type:
            *   `allocation`: Categorizes the sub-procedure (e.g., "entrySP", "exitSP", "managementSP"). This helps in organizing and selecting appropriate sub-procedures.
            *   `description`: A human-readable explanation.
            *   Potentially, default parameters or behaviors specific to this sub-procedure type.
    *   **Usage**:
        *   Likely consulted by factories (`orderProcedureFactory`, `subProcedureFactory`) to validate procedure types passed in models or to understand the basic structure associated with a type.
        *   May be used by UI or administrative tools to present users with available procedure options.
        *   Changes to this file generally require a code update and restart/re-deploy of the application.
        ```json
        // Example structure from proceduresConfig.json
        {
          "orderProcedures": {
            "bullRR": {
              "description": "Bullish Risk/Reward strategy.",
              "category": "directional"
            }
          },
          "subProcedures": {
            "buyNow": {
              "allocation": "entrySP",
              "description": "Buys the full amount immediately."
            },
            "stopLoss": {
              "allocation": "exitSP",
              "description": "Exits position if price drops below a certain level."
            }
          }
        }
        ```

2.  **Instance-Specific Configuration (Database Models)**:
    *   **Storage**: Each active or defined orderProcedure and subProcedure has a corresponding record (document) in the database (managed via FeathersJS services like `orderProcedures` and `subProcedures`).
    *   **Purpose**: This is where the *specific parameters* for an individual instance of a strategy are stored.
    *   **Content**:
        *   For an orderProcedure model: `tickerSymbol`, `type` (e.g., "bullRR"), `status`, `userID`, risk parameters (e.g., `maxCapitalToRisk`, `targetProfitPercentage`), references to its specific sub-procedures, and any other operational parameters.
        *   For a sub-Procedure model: `type` (e.g., "stopLoss"), `status`, `parentID` (linking to the parent orderProcedure), and parameters specific to its function (e.g., `stopPrice` for a `stopLoss`, `quantity` for a `buyNow`).
    *   **Source of Truth for Execution**: The runtime instances of procedures primarily operate based on the data in their `model` property, which is loaded from these database records.
    *   **Dynamic Updates**: These configurations can be updated dynamically by modifying the records in the database. The system reflects these changes through:
        *   Periodic re-initialization (polling) in `init.js`.
        *   Real-time `patched` events from FeathersJS, updating the in-memory `model` of active procedures.

3.  **System-Level Configuration (`src/config.js`)**:
    *   **Purpose**: Defines global operational parameters for the `orderProcedures` system itself, rather than for individual strategies.
    *   **Content**: Examples include:
        *   `TICK_INTERVAL`: The frequency (in milliseconds) at which the main `runTick()` loop executes for all active procedures.
        *   Database connection details (though often managed by FeathersJS configuration).
        *   Logging levels or other system-wide settings.
    *   **Usage**: These values are typically imported and used by core modules like `index.js` to control the overall behavior of the application.
    *   Changes here usually require a restart.

## Configuration Flow and Application

1.  **Initialization (`init.js`)**:
    *   Fetches orderProcedure and subProcedure models from the database. These models contain the instance-specific configurations.
2.  **Factory Construction**:
    *   `orderProcedureFactory` and `subProcedureFactory` receive these models.
    *   They use the `type` field from the model to determine which specific constructor function to use (e.g., `constructBullRRObject`).
    *   The factories or the type-specific constructors might cross-reference `proceduresConfig.json` to validate the type or to apply default structural elements if not fully specified in the model.
3.  **Runtime Operation**:
    *   The constructed procedure objects hold their configuration and state in their `this.model` property.
    *   Methods like `runTick()`, SMO `runConditions`, and sub-procedure logic all refer to `this.model` to access their operational parameters.

## Managing Configuration Changes

*   **Static (`proceduresConfig.json`, `src/config.js`)**:
    *   Changes involve editing the file, committing to version control, and re-deploying/restarting the application.
    *   Suitable for defining new types of strategies or fundamental system parameters.
*   **Dynamic (Database Models)**:
    *   Changes can be made directly to the database records (e.g., via a UI, an API endpoint, or direct database access).
    *   The `orderProcedures` system is designed to pick up these changes:
        *   **New Procedures**: Picked up by `init.js` during its next periodic run.
        *   **Modifications to Existing Procedures**: Reflected in active instances via the FeathersJS `patched` event listener in `index.js`, or upon the next full model refresh within `base.runTick.js` or `init.js`.
        *   **Deactivation/Deletion**: Procedures whose status changes to "finished", "error", or are removed from the DB will typically cease to be processed or will be cleaned up from the active `ORDER_PROCEDURES` map.

## Conclusion

The configuration management strategy in `orderProcedures` effectively balances the need for predefined structural templates (via `proceduresConfig.json` and `src/config.js`) with the requirement for highly flexible, instance-specific, and dynamically updatable strategy parameters (via database models). This layered approach supports a robust and adaptable automated trading system.
