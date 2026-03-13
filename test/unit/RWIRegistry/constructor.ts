import { expect } from 'chai';
import { network } from 'hardhat';
import { ContractIndexes } from '../utils/constants.js';

const { ethers } = await network.connect();

describe('RWIRegistry initialize', function () {
  it('sets governor contract on initialization', async function () {
    const [, governor] = await ethers.getSigners();
    const registry = await ethers.deployContract('RWIRegistry');
    await registry.getFunction('initialize')(governor.address);

    expect(await registry.getContractAddressByIndex(ContractIndexes.C_GOVERNOR)).to.equal(governor.address);
    expect(await registry.getContractIndexByAddress(governor.address)).to.equal(ContractIndexes.C_GOVERNOR);
    expect(await registry.isProxyContract(ContractIndexes.C_GOVERNOR)).to.equal(false);
  });
});
