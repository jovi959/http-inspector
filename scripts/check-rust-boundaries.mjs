import { execFileSync } from "node:child_process";

const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--format-version=1", "--no-deps"], { encoding: "utf8" }));
const packages = new Map(metadata.packages.map((pkg) => [pkg.name, pkg]));
const forbiddenCoreDependencies = new Set(["axum", "tauri", "tokio"]);
const core = packages.get("inspector-core");

// The core stays portable by refusing transport and desktop-runtime dependencies.
if (!core) throw new Error("inspector-core is missing from Cargo metadata.");
const violations = core.dependencies
  .filter((dependency) => forbiddenCoreDependencies.has(dependency.name))
  .map((dependency) => dependency.name);

if (violations.length > 0) {
  throw new Error(`inspector-core has forbidden dependencies: ${violations.join(", ")}.`);
}
