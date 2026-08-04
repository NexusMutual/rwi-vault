// Filters vendored and mock sources out of coverage/lcov.info and prints a
// summary for first-party contracts. Hardhat 3 offers no include/exclude
// config for coverage, so the filtering happens after the fact.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const LCOV = "coverage/lcov.info";
const FILTERED = "coverage/lcov.first-party.info";
const EXCLUDE = [/^contracts\/external\//, /^contracts\/mock\//];

if (!existsSync(LCOV)) {
  console.error(`${LCOV} not found - run 'pnpm run test:coverage' first`);
  process.exit(1);
}

const isFirstParty = record => {
  const path = record.match(/SF:(.+)/)?.[1];
  return path !== undefined && EXCLUDE.every(re => !re.test(path));
};

const kept = readFileSync(LCOV, "utf8")
  .split("end_of_record\n")
  .filter(record => record.includes("SF:"))
  .filter(isFirstParty);

writeFileSync(FILTERED, kept.map(record => `${record}end_of_record\n`).join(""));

const files = kept.map(record => {
  const hit = Number(record.match(/LH:(\d+)/)?.[1] ?? 0);
  const found = Number(record.match(/LF:(\d+)/)?.[1] ?? 0);
  return { path: record.match(/SF:(.+)/)[1], hit, found, pct: found === 0 ? 100 : (hit / found) * 100 };
});

const linesHit = files.reduce((sum, f) => sum + f.hit, 0);
const linesFound = files.reduce((sum, f) => sum + f.found, 0);
const total = linesFound === 0 ? 100 : (linesHit / linesFound) * 100;

console.log("\nFirst-party coverage (contracts/, excluding external/ and mock/)\n");
for (const { path, hit, found, pct } of [...files].sort((a, b) => a.pct - b.pct)) {
  console.log(`  ${pct.toFixed(2).padStart(6)}%  ${String(hit).padStart(4)}/${String(found).padEnd(4)}  ${path}`);
}
console.log(`\n  ${total.toFixed(2)}% total  (${linesHit}/${linesFound} lines)`);
console.log(`  filtered report written to ${FILTERED}\n`);
