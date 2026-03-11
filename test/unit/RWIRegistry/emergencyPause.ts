import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';
import { PauseTypes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();
const PAUSE_EVERYTHING = (2n ** 48n) - 1n;

describe('emergencyPause', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  it('only governor can set emergency admins', async function () {
    const { accounts: { nonMembers, emergencyAdmin }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.connect(nonMembers[0]).setEmergencyAdmin(emergencyAdmin.address, false))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');
  });

  it('only emergency admins can propose and confirm', async function () {
    const { accounts: { governor, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const secondEmergencyAdmin = nonMembers[1];
    await registry.connect(governor).setEmergencyAdmin(secondEmergencyAdmin.address, true);

    await expect(registry.connect(nonMembers[2]).proposePauseConfig(PauseTypes.PAUSE_LOCKS))
      .to.be.revertedWithCustomError(registry, 'OnlyEmergencyAdmin');
    await expect(registry.connect(nonMembers[2]).confirmPauseConfig(PauseTypes.PAUSE_LOCKS))
      .to.be.revertedWithCustomError(registry, 'OnlyEmergencyAdmin');
  });

  it('validates propose/confirm flow', async function () {
    const { accounts: { governor, emergencyAdmin, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const secondEmergencyAdmin = nonMembers[0];
    await registry.connect(governor).setEmergencyAdmin(secondEmergencyAdmin.address, true);

    await expect(registry.connect(emergencyAdmin).confirmPauseConfig(PauseTypes.PAUSE_LOCKS))
      .to.be.revertedWithCustomError(registry, 'NoConfigProposed');

    await registry.connect(emergencyAdmin).proposePauseConfig(PauseTypes.PAUSE_LOCKS);

    await expect(registry.connect(emergencyAdmin).confirmPauseConfig(PauseTypes.PAUSE_LOCKS))
      .to.be.revertedWithCustomError(registry, 'ProposerCannotConfirmPause');
    await expect(registry.connect(secondEmergencyAdmin).confirmPauseConfig(PauseTypes.PAUSE_VAULT))
      .to.be.revertedWithCustomError(registry, 'PauseConfigMismatch');

    await expect(registry.connect(secondEmergencyAdmin).confirmPauseConfig(PauseTypes.PAUSE_LOCKS))
      .to.emit(registry, 'PauseConfigConfirmed')
      .withArgs(PauseTypes.PAUSE_LOCKS, secondEmergencyAdmin.address);

    expect(await registry.getPauseConfig()).to.equal(PauseTypes.PAUSE_LOCKS);
    expect(await registry.isPaused(PauseTypes.PAUSE_LOCKS)).to.equal(true);
    expect(await registry.isPaused(PauseTypes.PAUSE_VAULT)).to.equal(false);
  });

  it('supports pause overwrite and unpause', async function () {
    const { accounts: { governor, emergencyAdmin, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const secondEmergencyAdmin = nonMembers[0];
    await registry.connect(governor).setEmergencyAdmin(secondEmergencyAdmin.address, true);

    await registry.connect(emergencyAdmin).proposePauseConfig(PAUSE_EVERYTHING);
    await registry.connect(emergencyAdmin).proposePauseConfig(PauseTypes.PAUSE_VAULT);
    await registry.connect(secondEmergencyAdmin).confirmPauseConfig(PauseTypes.PAUSE_VAULT);
    expect(await registry.getPauseConfig()).to.equal(PauseTypes.PAUSE_VAULT);

    await registry.connect(emergencyAdmin).proposePauseConfig(0);
    await registry.connect(secondEmergencyAdmin).confirmPauseConfig(0);
    expect(await registry.getPauseConfig()).to.equal(0);
  });

  it('reverts for pause config larger than uint48', async function () {
    const { accounts: { emergencyAdmin }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.connect(emergencyAdmin).proposePauseConfig(2n ** 48n))
      .to.be.revertedWithCustomError(registry, 'SafeCastOverflowedUintDowncast')
      .withArgs(48, 2n ** 48n);
  });
});
