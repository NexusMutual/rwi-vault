import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { extractStorageLayout, type ContractLayout, type StorageType } from '../../scripts/extract-storage-layout.mjs';

// Contracts sitting behind a proxy, whose storage must stay compatible with
// what is already deployed. TemporaryRWIRegistry is deliberately absent: it was
// the bootstrap implementation, and the proxy it initialised now runs
// RWIRegistry, so that is the layout to protect going forward.
const PROXY_CONTRACTS = ['RWIRegistry', 'RWIVault', 'Locks'];

const BASELINE = 'test/layout/storage/mainnet-1.json';

const describeMembers = (type: StorageType | undefined) =>
  (type?.members ?? []).map(m => `${m.label}@${m.slot}:${m.offset} ${m.type} ${m.size}`).join(' | ');

describe('Storage layout', function () {
  const baseline: Record<string, ContractLayout> = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const current: Record<string, ContractLayout> = extractStorageLayout();

  for (const contractName of PROXY_CONTRACTS) {
    describe(contractName, function () {
      it('is present in both the baseline and the current build', function () {
        expect(baseline[contractName], `${contractName} missing from ${BASELINE}`).to.not.equal(undefined);
        expect(current[contractName], `${contractName} missing from the current build`).to.not.equal(undefined);
      });

      it('keeps every deployed variable at its slot, type and size', function () {
        const before = baseline[contractName].storage;
        const after = current[contractName].storage;

        for (const previous of before) {
          const identifier = `${contractName}.${previous.label} at slot ${previous.slot} offset ${previous.offset}`;

          const now = after.find(({ slot, offset }) => slot === previous.slot && offset === previous.offset);
          expect(now, `nothing occupies ${identifier} any more`).to.not.equal(undefined);

          expect(now!.label, `label changed at ${identifier}`).to.equal(previous.label);
          expect(now!.type, `type changed at ${identifier}`).to.equal(previous.type);
          expect(now!.size, `size changed at ${identifier}`).to.equal(previous.size);
        }

        // Appending above the deployed range is safe and expected between
        // deployments; record what has been added rather than asserting on it.
        const highestDeployedSlot = Math.max(...before.map(({ slot }) => slot));
        for (const { slot, label } of after.filter(s => s.slot > highestDeployedSlot)) {
          console.log(`      ${contractName}: slot ${slot} ${label} added since the baseline`);
        }
      });

      // The slots above only name their types, so repacking a struct held in a
      // mapping or an array leaves every one of those names untouched.
      it('keeps the layout of every type reachable from deployed storage', function () {
        const before = baseline[contractName].types;
        const after = current[contractName].types;

        for (const [typeName, previous] of Object.entries(before)) {
          const identifier = `${contractName} type ${typeName}`;

          const now = after[typeName];
          expect(now, `${identifier} is no longer reachable from storage`).to.not.equal(undefined);

          expect(now!.encoding, `encoding changed for ${identifier}`).to.equal(previous.encoding);
          expect(now!.size, `size changed for ${identifier}`).to.equal(previous.size);
          expect(describeMembers(now), `fields repacked in ${identifier}`).to.equal(describeMembers(previous));
        }
      });
    });
  }
});
