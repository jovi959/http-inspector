# HTTP Inspector Architecture

## Dependency direction

- `src/app` composes dependencies and owns startup only.
- `src/features` renders user workflows and consumes state/ports through public APIs.
- `src/state` owns normalized UI state and selectors; it cannot import UI components.
- `src/data/ports` defines capture capabilities; `src/data/adapters` performs runtime I/O.
- `src/domain` contains pure display and body-presentation behavior with no React, Zustand, browser, or Tauri dependency.
- `inspector-core` owns canonical Rust types and application behavior. `inspector-server` may depend on core. Tauri and development binaries compose concrete dependencies.

## Module rules

- Feature internals are private. Import only another feature's `index.ts` surface.
- `CaptureReader`, `CaptureSubscription`, and `CaptureController` stay separate; `CaptureDataSource` composes them.
- A module has one identifiable responsibility. Do not add `utils`, `helpers`, `common`, `misc`, or `manager` dumping grounds.
- React components/hooks should normally remain at or below 200 handwritten lines. TypeScript state/adapters and Rust modules should normally remain at or below 300. Handwritten source may not exceed 400 lines.
- A temporary exception requires a nearby TODO with a removal date. Generated contracts, schemas, lockfiles, and fixtures are excluded.

## Enforcement

Run `pnpm check:architecture` before normal build/package commands. It applies lint import restrictions, dependency-cycle checks, handwritten-file budgets, generic-name rules, and Cargo core-boundary validation.
