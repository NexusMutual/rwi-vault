// Extracts the solc storage layout for first-party contracts.
//
// Used by test/layout/slots.ts, and to regenerate the committed baseline in
// test/layout/storage/ after a mainnet deployment.
//
// Usage: node ./scripts/extract-storage-layout.mjs [outputFile]
//        (writes to stdout when no file is given)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ARTIFACTS_DIR = "artifacts/contracts";
const BUILD_INFO_DIR = "artifacts/build-info";
const EXCLUDE = [/^contracts\/external\//, /^contracts\/mock\//];

const isFirstParty = sourceName =>
  sourceName.startsWith("contracts/") && EXCLUDE.every(re => !re.test(sourceName));

const artifactPaths = function* (dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* artifactPaths(path);
    } else if (entry.name.endsWith(".json")) {
      yield path;
    }
  }
};

// solc embeds AST node ids in composite type names - t_struct(Contract)9704_storage -
// and those shift on edits that have nothing to do with storage.
const normaliseType = type =>
  type
    .replace(/\)\d+/g, ")")
    // contract references are plain addresses at the storage level
    .replace(/t_contract\([^)]+\)/g, "t_address")
    .replace(/t_address_payable/g, "t_address");

const describeEntry = (types, { label, slot, offset, type }) => ({
  label,
  slot: Number(slot),
  offset: Number(offset),
  type: normaliseType(type),
  size: Number(types[type].numberOfBytes),
});

// A struct behind a mapping or an array is invisible at the top level, yet
// repacking its fields still corrupts deployed data, so every reachable type is
// recorded. A struct can reach itself through either, hence seen.
const collectTypes = (types, rootTypeNames) => {
  const collected = {};
  const seen = new Set();
  const queue = [...rootTypeNames];

  while (queue.length > 0) {
    const typeName = queue.shift();

    if (seen.has(typeName)) {
      continue;
    }
    seen.add(typeName);

    const { encoding, numberOfBytes, members, key, value, base } = types[typeName];

    collected[normaliseType(typeName)] = {
      encoding,
      size: Number(numberOfBytes),
      ...(members && { members: members.map(member => describeEntry(types, member)) }),
    };

    for (const edge of [...(members?.map(member => member.type) ?? []), key, value, base]) {
      if (edge !== undefined) {
        queue.push(edge);
      }
    }
  }

  return Object.fromEntries(Object.entries(collected).sort(([a], [b]) => a.localeCompare(b)));
};

export function extractStorageLayout() {
  let paths;
  try {
    paths = [...artifactPaths(ARTIFACTS_DIR)];
  } catch {
    throw new Error(`${ARTIFACTS_DIR} not found - run 'pnpm exec hardhat build' first`);
  }

  // Compiling leaves earlier build info in place; each artifact names the build
  // that describes its current source.
  const builds = new Map();
  const readBuild = id => {
    if (!builds.has(id)) {
      builds.set(id, JSON.parse(readFileSync(join(BUILD_INFO_DIR, `${id}.output.json`), "utf8")));
    }
    return builds.get(id);
  };

  const layouts = {};

  for (const path of paths) {
    const { contractName, sourceName, inputSourceName, buildInfoId } = JSON.parse(readFileSync(path, "utf8"));

    if (contractName === undefined || !isFirstParty(sourceName)) {
      continue;
    }

    const contract = readBuild(buildInfoId).output?.contracts?.[inputSourceName ?? sourceName]?.[contractName];

    if (contract?.storageLayout === undefined) {
      throw new Error(`${contractName} has no storageLayout - is outputSelection set in hardhat.config.ts?`);
    }

    const { storage = [], types = {} } = contract.storageLayout;

    // interfaces and stateless base contracts have nothing to protect
    if (storage.length === 0) {
      continue;
    }

    layouts[contractName] = {
      storage: storage.map(entry => describeEntry(types, entry)),
      types: collectTypes(
        types,
        storage.map(({ type }) => type),
      ),
    };
  }

  return Object.fromEntries(Object.entries(layouts).sort(([a], [b]) => a.localeCompare(b)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const layouts = extractStorageLayout();
  const output = `${JSON.stringify(layouts, null, 2)}\n`;
  const outputFile = process.argv[2];

  if (outputFile === undefined) {
    process.stdout.write(output);
  } else {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, output);
    console.log(`Wrote ${Object.keys(layouts).length} contract layouts to ${outputFile}`);
  }
}
