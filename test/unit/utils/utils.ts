import { network } from "hardhat";
const { ethers } = await network.connect();

export const parseUsdc = (amount:string) => ethers.parseUnits(amount, 8);