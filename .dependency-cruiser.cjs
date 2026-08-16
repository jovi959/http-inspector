/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      comment: "Cycles blur ownership and make live-capture state difficult to reason about.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-does-not-depend-outward",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/(app|components|data/adapters|features|state)" },
    },
    {
      name: "state-does-not-depend-on-ui",
      severity: "error",
      from: { path: "^src/state" },
      to: { path: "^src/(app|components|features)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.app.json" },
  },
};
