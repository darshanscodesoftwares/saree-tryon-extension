5. Preserve Existing Functionality

The POC already has its core logic and functionality implemented.

Before editing:

Inspect the project structure, routing, existing components, state management, and current workflows.

Identify the existing implementation for saree selection, multi-selection, photo capture, countdown, and virtual try-on.

Understand how the different steps pass data between one another.

Identify the existing methods used to produce and display virtual try-on results.

Then modify the presentation layer while preserving the existing behaviour.

Do not rewrite working business logic just to make the new UI easier to implement.

Do not replace working functionality with mock data, static images, fake buttons, or placeholder interactions. Reference images illustrate the intended appearance; they must not replace the actual working POC.

Preserve existing code comments. Do not remove commented-out code.

Reuse the current framework, libraries, project conventions, and components wherever practical. Do not introduce additional dependencies unless they are genuinely necessary.