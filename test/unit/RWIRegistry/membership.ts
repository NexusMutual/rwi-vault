import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';

const { ethers, networkHelpers } = await network.connect();

describe('membership', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  it('allows membership operator to add members', async function () {
    const { accounts: { membershipOperator, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[0];

    expect(await registry.isMember(user.address)).to.equal(false);

    await expect(registry.connect(membershipOperator).addMember(user.address))
      .to.emit(registry, 'MembershipChanged')
      .withArgs(1n, ethers.ZeroAddress, user.address);

    expect(await registry.isMember(user.address)).to.equal(true);
    expect(await registry.getMemberCount()).to.equal(1);
    expect(await registry.getLastMemberId()).to.equal(1);
    expect(await registry.getMemberId(user.address)).to.equal(1);
    expect(await registry.getMemberAddress(1)).to.equal(user.address);
  });

  it('addMember reverts for non-membership operator and duplicates', async function () {
    const { accounts: { governor, membershipOperator, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[1];

    await expect(registry.connect(governor).addMember(user.address))
      .to.be.revertedWithCustomError(registry, 'OnlyMembershipOperator');

    await registry.connect(membershipOperator).addMember(user.address);
    await expect(registry.connect(membershipOperator).addMember(user.address))
      .to.be.revertedWithCustomError(registry, 'AlreadyMember');
  });

  it('allows member to remove itself', async function () {
    const { accounts: { membershipOperator, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[0];

    await registry.connect(membershipOperator).addMember(user.address);
    const memberId = await registry.getMemberId(user.address);
    const countBefore = await registry.getMemberCount();

    await expect(registry.connect(user).removeMember(memberId))
      .to.emit(registry, 'MembershipChanged')
      .withArgs(memberId, user.address, ethers.ZeroAddress);

    expect(await registry.isMember(user.address)).to.equal(false);
    expect(await registry.getMemberId(user.address)).to.equal(0);
    expect(await registry.getMemberAddress(memberId)).to.equal(ethers.ZeroAddress);
    expect(await registry.getMemberCount()).to.equal(countBefore - 1n);
  });

  it('allows operator to remove members', async function () {
    const { accounts: { membershipOperator, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[1];

    await registry.connect(membershipOperator).addMember(user.address);
    const memberId = await registry.getMemberId(user.address);
    await registry.connect(membershipOperator).removeMember(memberId);

    expect(await registry.isMember(user.address)).to.equal(false);
  });

  it('removeMember reverts for non-members and unauthorized senders', async function () {
    const { accounts: { membershipOperator, governor, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[2];
    const outsider = nonMembers[3];

    await expect(registry.connect(governor).removeMember(999)).to.be.revertedWithCustomError(registry, 'NotMember');

    await registry.connect(membershipOperator).addMember(user.address);
    const memberId = await registry.getMemberId(user.address);
    await expect(registry.connect(outsider).removeMember(memberId)).to.be.revertedWithCustomError(registry, 'OnlyMemberOrOperator');
  });

  it('allows changing member address while keeping member id', async function () {
    const { accounts: { membershipOperator, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const from = nonMembers[0];
    const to = nonMembers[1];

    await registry.connect(membershipOperator).addMember(from.address);
    const memberId = await registry.getMemberId(from.address);
    const memberCountBefore = await registry.getMemberCount();

    await expect(registry.connect(from).changeMemberAddress(to.address))
      .to.emit(registry, 'MembershipChanged')
      .withArgs(memberId, from.address, to.address);

    expect(await registry.isMember(from.address)).to.equal(false);
    expect(await registry.isMember(to.address)).to.equal(true);
    expect(await registry.getMemberId(from.address)).to.equal(0);
    expect(await registry.getMemberId(to.address)).to.equal(memberId);
    expect(await registry.getMemberAddress(memberId)).to.equal(to.address);
    expect(await registry.getMemberCount()).to.equal(memberCountBefore);
  });

  it('changeMemberAddress reverts when caller is not a member', async function () {
    const { accounts: { nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.connect(nonMembers[0]).changeMemberAddress(nonMembers[1].address))
      .to.be.revertedWithCustomError(registry, 'NotMember');
  });

  it('changeMemberAddress reverts when target address is already a member', async function () {
    const { accounts: { membershipOperator, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const alice = nonMembers[2];
    const bob = nonMembers[3];

    await registry.connect(membershipOperator).addMember(alice.address);
    await registry.connect(membershipOperator).addMember(bob.address);

    await expect(registry.connect(alice).changeMemberAddress(bob.address))
      .to.be.revertedWithCustomError(registry, 'AlreadyMember');
  });
});
