import { expect } from "chai";
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';

const { ethers, networkHelpers } = await network.connect();
const { duration } = networkHelpers.time;

describe('locking', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only members can lock', async function () {
    const { accounts: {nonMembers}, contracts: {locks} } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[0];
    await expect(locks.connect(user).lockShares(parseUsdc("1000"), duration.days(30))).to.be.revertedWithCustomError(locks, 'OnlyMember');
  });

  it('user should be able to lock shares', async function () {
    const { accounts: {members}, contracts: {locks, registry, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const memberId = await registry.getMemberId(user.address);
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock);
    await locks.connect(user).lockShares(sharesToLock, lockPeriod);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(1);
    expect(memberLocks[0].shares).to.equal(sharesToLock);
    expect(memberLocks[0].period).to.equal(lockPeriod);
    expect(memberLocks[0].startTime).to.equal(await networkHelpers.time.latest());
    expect(await rwaSharesMock.balanceOf(await locks.getAddress())).to.equal(sharesToLock);
  });

  it('user should be able to have multiple locks', async function () {
    const { accounts: {members}, contracts: {locks, registry, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const memberId = await registry.getMemberId(user.address);
    const sharesToLock1 = parseUsdc("1000");
    const sharesToLock2 = parseUsdc("2000");
    const lockPeriod1 = duration.days(30);
    const lockPeriod2 = duration.days(60);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock1 + sharesToLock2);
    await locks.connect(user).lockShares(sharesToLock1, lockPeriod1);
    await locks.connect(user).lockShares(sharesToLock2, lockPeriod2);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(2);
    expect(memberLocks[0].shares).to.equal(sharesToLock1);
    expect(memberLocks[0].period).to.equal(lockPeriod1);
    expect(memberLocks[1].shares).to.equal(sharesToLock2);
    expect(memberLocks[1].period).to.equal(lockPeriod2);
  });

  it('lock must be between 30 days and 2 years', async function () {
    const { accounts: {members}, contracts: {locks, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(29);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock);
    await expect(locks.connect(user).lockShares(sharesToLock, lockPeriod)).to.be.revertedWithCustomError(locks, 'InvalidPeriod');

    const lockPeriod2 = duration.days(2 * 365 + 1);
    await expect(locks.connect(user).lockShares(sharesToLock, lockPeriod2)).to.be.revertedWithCustomError(locks, 'InvalidPeriod');
  });

  it('user should be able to withdraw shares', async function () {
    const { accounts: {members}, contracts: {locks, registry, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const memberId = await registry.getMemberId(user.address);
    const userStartBalance = await rwaSharesMock.balanceOf(user.address);
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(30); 

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock);
    await locks.connect(user).lockShares(sharesToLock, lockPeriod);

    await networkHelpers.time.increase(lockPeriod);
    
    await locks.connect(user).withdrawShares(0);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks[0].shares).to.equal(0);
    expect(memberLocks[0].period).to.equal(0);

    expect(await rwaSharesMock.balanceOf(user.address)).to.equal(userStartBalance);
    expect(await rwaSharesMock.balanceOf(await locks.getAddress())).to.equal(0);
  });

  it('user should not be able to withdraw shares before lock period ends', async function () {
    const { accounts: {members}, contracts: {locks, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock);
    await locks.connect(user).lockShares(sharesToLock, lockPeriod);

    await networkHelpers.time.increase(lockPeriod - 10);

    await expect(locks.connect(user).withdrawShares(0)).to.be.revertedWithCustomError(locks, 'NotExpired');
  });

  it('user should not be able to withdraw shares two times', async function () {
    const { accounts: {members}, contracts: {locks, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock);
    await locks.connect(user).lockShares(sharesToLock, lockPeriod);

    await networkHelpers.time.increase(lockPeriod);

    await locks.connect(user).withdrawShares(0);

    await expect(locks.connect(user).withdrawShares(0)).to.be.revertedWithCustomError(locks, 'LockDoesntExist');
  });

  it('user should be able to edit lock', async function () {
    const { accounts: {members}, contracts: {locks, registry, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const memberId = await registry.getMemberId(user.address);
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), sharesToLock);
    await locks.connect(user).lockShares(sharesToLock, lockPeriod);

    const topUpShares = parseUsdc("2000");
    const newLockPeriod = duration.days(60);

    await rwaSharesMock.connect(user).approve(await locks.getAddress(), topUpShares);
    await locks.connect(user).editLock(0, topUpShares, newLockPeriod);
    const shouldEndAt = await networkHelpers.time.latest() + newLockPeriod;

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks[0].shares).to.equal(sharesToLock + topUpShares);
    expect(memberLocks[0].startTime + memberLocks[0].period).to.equal(shouldEndAt);
  });

  it('lock shares on deposit can be called only by vault contract', async function () {
    const { accounts: {members}, contracts: {locks, registry, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const memberId = await registry.getMemberId(user.address);
    const sharesToLock = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    await expect(locks.connect(user).lockSharesOnDeposit(sharesToLock, memberId, lockPeriod))
      .to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');

    await networkHelpers.impersonateAccount(await rwaSharesMock.getAddress());
    await networkHelpers.setBalance(await rwaSharesMock.getAddress(), ethers.parseEther("1"));
    const rwaSharesMockSigner = await ethers.getSigner(await rwaSharesMock.getAddress());
    await locks.connect(rwaSharesMockSigner).lockSharesOnDeposit(sharesToLock, memberId, lockPeriod);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(1);
    expect(memberLocks[0].shares).to.equal(sharesToLock);
    expect(memberLocks[0].period).to.equal(lockPeriod);
    expect(memberLocks[0].startTime).to.equal(await networkHelpers.time.latest());
  });
});
