import type { HardhatUserConfig } from "hardhat/config";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import "@nomicfoundation/hardhat-typechain";
import "@nomicfoundation/hardhat-verify";
import { configVariable } from "hardhat/config";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthersPlugin],
  typechain: {
    outDir: "types/ethers-contracts",
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "l1",
      allowUnlimitedContractSize: true,
    },
    mainnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("MAINNET_RPC_URL"),
    },
    hardhatMainnetFork: {
      type: "edr-simulated",
      chainType: "l1",
      forking: {
        enabled: true,
        url: configVariable("MAINNET_RPC_URL"),
      }
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    tenderlyvnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("TENDERLYVNET_RPC_URL"),
      accounts: [configVariable("TENDERLYVNET_PRIVATE_KEY")],
    }
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  paths: {
    tests: {
      mocha: "./test"
    },
  },
  test: {
    solidity: {
      fuzz: {
        runs: process.env.COVERAGE ? 16 : 256,
      },
    },
  }
};

export default config;
