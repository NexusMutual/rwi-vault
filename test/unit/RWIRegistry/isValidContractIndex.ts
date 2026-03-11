import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

describe('isValidContractIndex', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  it('returns true for valid powers of two', async function () {
    const { contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    for (let i = 0n; i <= 255n; i++) {
      expect(await registry.isValidContractIndex(2n ** i)).to.equal(true);
    }
  });

  it('returns true for all predefined constants', async function () {
    const { contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    for (const idx of Object.values(ContractIndexes)) {
      expect(await registry.isValidContractIndex(idx)).to.equal(true);
    }
  });

  it('returns false for zero and non-powers of two', async function () {
    const { contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    expect(await registry.isValidContractIndex(0)).to.equal(false);
    for (const idx of [3n, 5n, 6n, 7n, (2n ** 256n) - 1n]) {
      expect(await registry.isValidContractIndex(idx)).to.equal(false);
    }
  });
});
