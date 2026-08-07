# AI Collaboration Rules: Incremental Development Only

## Core Directives
1. **Never build the entire app at once.** Strictly work on one small piece, feature, or file at a time as explicitly requested.
2. **Do not create or modify additional files** unless explicitly told to do so in the user's prompt.
3. **Do not add unrequested features or placeholder code** for future tasks (e.g., no placeholder functions, unused variables, or speculative modules).

## Required Workflow
For EVERY request:
1. **Confirm & Scope:** State what single file or function you are about to create or edit, and list the exact changes.
2. **Write Minimal Code:** Deliver only the precise code necessary for the current task. Keep implementation focused and bug-free.
3. **Stop & Await Feedback:** End every response by asking to verify/test the code before taking any next steps. Do NOT proceed to the next file automatically.

## Code Quality & Safety
- Maintain strict modularity—keep functions short and single-purpose.
- If a dependency, utility file, or package is needed that hasn't been set up yet, **stop and ask** if you should create/install it first.