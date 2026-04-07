# 04_Object_Creation_Factories.md

The `orderProcedures` system utilizes a factory pattern for instantiating orderProcedure and subProcedure objects. This approach promotes modularity and flexibility in how different types of procedures are created and configured. This document details the role and structure of these factories and discusses the object creation paradigm.

## Core Factories

1.  **`orderProcedureFactory` (located in `orderProcedureFactory/index.js`)**:
    *   **Purpose**: Responsible for constructing the main orderProcedure objects. These are the higher-level objects that encapsulate an entire trading strategy (e.g., a `bullRR` strategy).
    *   **Mechanism**:
        *   It exposes a `construct(model)` method that takes a procedure `model` (typically fetched from the database) as input.
        *   Based on the `model.type` (e.g., "bullRR"), it delegates the construction to a type-specific constructor function (e.g., `constructBullRRObject` from `orderProcedureFactory/types/bullRR/index.js`).
        *   It also provides a `constructBulk(models)` method for creating multiple instances from an array of models.
    *   **Compositional Approach**: A key aspect is its use of composition. For instance, when constructing a `bullRR` object:
        1.  A `baseObject` is first created using `constructBaseObject(model)` (from `orderProcedureFactory/types/base/base.index.js`). This `baseObject` contains common functionalities and properties shared by all orderProcedures (like the core `runTick`, `init` methods, and a base SMO).
        2.  This `baseObject` is then passed to the type-specific constructor (e.g., `constructBullRRObject(baseObject)`).
        3.  The type-specific constructor augments or modifies the `baseObject` with its specialized logic, configurations (like specific sub-procedure setups), and an extended/modified SMO.
        ```javascript
        // Simplified from orderProcedureFactory/index.js
        function construct(model) {
            let finalObject = null;
            const baseObject = constructBaseObject(model); // Create base

            if (model.type === 'bullRR') {
              const bullRRobject = constructBullRRObject(baseObject); // Augment base
              finalObject = bullRRobject;
            } else {
              throw new Error(`Unknown orderProcedure type: ${model.type}`);
            }
            return finalObject;
        }
        ```

2.  **`subProcedureFactory` (likely in `subProcedureFactory/index.js`)**:
    *   **Purpose**: Responsible for constructing the individual subProcedure objects. These are the smaller, modular components that make up parts of an orderProcedure's strategy (e.g., `buyNow`, `stopLoss`, `takeProfit`, `dripBuy`).
    *   **Mechanism**:
        *   Similar to the `orderProcedureFactory`, it would have a `construct(spModel)` method that takes a sub-procedure model.
        *   Based on `spModel.type`, it delegates to a specific constructor for that sub-procedure type (e.g., `constructBuyNowSP`, `constructStopLossSP`).
        *   These sub-procedure objects encapsulate the logic for their specific task and maintain their own status.
    *   **Integration**: The `init.js` file uses this factory to create all necessary sub-procedures, which are then linked to their parent orderProcedure instances (e.g., via `setupSubProcedures.js`).

## Object Creation Paradigm: Functional Composition vs. Classical OOP

The current implementation leans heavily towards a **functional composition** approach rather than classical, class-based Object-Oriented Programming (OOP).

*   **Current Approach (Functional Composition)**:
    *   Objects are generally plain JavaScript objects or objects created via `Object.create({})`.
    *   Functionality (methods) is attached directly to these objects, often by importing functions and binding them or assigning them as properties (e.g., `thisObj.runTick = runTick.bind(thisObj)`).
    *   "Inheritance" or specialization is achieved by taking a base object and having a subsequent function add or modify its properties and methods (as seen with `bullRR` extending `base`).
    *   State (like the `model` or `smo`) is directly held as properties on the object.

*   **Pros of the Current Approach**:
    *   **Flexibility**: Easy to mix and match functionalities. Can be more dynamic in how objects are assembled.
    *   **Simplicity (in some cases)**: Avoids the complexities of class hierarchies, `super` calls, and `this` binding issues that can arise in classical OOP.
    *   **Explicit Dependencies**: Dependencies (imported functions) are often very clear at the top of each module.
    *   **Testability**: Individual functions can often be tested in isolation more easily.

*   **Classical OOP (Alternative)**:
    *   One might define a `BaseOrderProcedure` class, and then `BullRROrderProcedure` would `extend BaseOrderProcedure`.
    *   Methods like `runTick` would be defined in the base class and potentially overridden or extended in subclasses using `super.runTick()`.
    *   `instanceof` checks could be used for type identification.

*   **Cons of the Current Approach / Potential Benefits of Classical OOP**:
    *   **Discoverability**: It might be less immediately obvious what the "shape" or "interface" of a procedure object is without tracing through the constructor functions. Classical OOP provides a clearer contract via class definitions.
    *   **`instanceof` Typing**: True type checking with `instanceof` is not straightforward. Type identification relies on properties like `model.type`.
    *   **Shared Methods & Prototypal Inheritance**: In classical OOP, methods defined on a class's prototype are shared among all instances, which can be more memory-efficient for a very large number of objects (though this is often a micro-optimization in modern JS engines for typical scenarios). The current approach gives each object its own copy of methods (or rather, functions bound to it).
    *   **Encapsulation**: Classical OOP can offer stronger encapsulation mechanisms (e.g., private fields, though JavaScript's functional closures also provide strong encapsulation).

## Conclusion on Factories and Object Creation

The factory pattern employed is effective for decoupling the client (e.g., `init.js`) from the concrete creation logic of different procedure types. It centralizes the construction process and makes the system extensible to new procedure or sub-procedure types by adding new constructor functions and updating the factory logic.

The choice of functional composition for object creation is a valid and common pattern in JavaScript. It offers considerable flexibility. While it differs from classical OOP, the current structure achieves specialization and shared functionality through the base object augmentation pattern. The trade-offs are generally between explicitness of class contracts (OOP) and the dynamic flexibility of composition. For this system, where procedures are largely data-driven and their core logic is encapsulated in distinct functions and SMOs, the current approach appears well-suited.
