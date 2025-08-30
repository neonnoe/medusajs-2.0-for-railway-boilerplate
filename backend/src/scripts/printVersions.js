// scripts/printVersions.js
const fs = require("fs");
const path = require("path");

function getVersionSafe(pkgName) {
  // 1) Schneller Pfad: Falls exportiert (z. B. @medusajs/medusa)
  try {
    const v = require(`${pkgName}/package.json`).version;
    if (v) return v;
  } catch (_) {}

  // 2) Fallback: Entry-Point auflösen und nach oben laufen bis package.json
  try {
    const entry = require.resolve(pkgName);
    let dir = path.dirname(entry);

    while (true) {
      const pj = path.join(dir, "package.json");
      if (fs.existsSync(pj)) {
        const json = JSON.parse(fs.readFileSync(pj, "utf8"));
        if (json && json.version) return json.version;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // Root erreicht
      dir = parent;
    }
  } catch (e) {
    // ignorieren – wir loggen unten "unknown"
  }

  return "unknown";
}

const targets = [
  "@medusajs/medusa",
  "@medusajs/framework",
  "@medusajs/cli",
  "@medusajs/core-flows",
  "@medusajs/payment-stripe",
  "@medusajs/workflow-engine-redis",
];

console.log("=== Medusa Runtime Versions ===");
for (const name of targets) {
  console.log(`${name}: ${getVersionSafe(name)}`);
}
console.log("================================");
