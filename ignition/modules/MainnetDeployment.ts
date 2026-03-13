import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { ContractIndexes } from "../../test/unit/utils/constants.js";

const MAINNET_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ASSET_DECIMALS = 6;
const BASE_RATE = 1000000001847694958n; // 6% APY
const ASSET_CAP = 10_000_000n * 10n ** 6n;
const VAULT_NAME = "RWI VAULT";
const VAULT_SYMBOL = "RWIV";
const CREATE2_FACTORY_ADDRESS = "0xfac7011663910F75CbE1E25539ec2D7529f93C3F";

const EMERGENCY_ADMIN_1 = "0x87B2a7559d85f4653f13E6546A14189cd5455d45";
const EMERGENCY_ADMIN_2 = "0x8D38C81B7bE9Dbe7440D66B92d4EF529806baAE7";
const EMERGENCY_ADMIN_3 = "0x43f4cd7d153701794ce25a01eFD90DdC32FF8e8E";
const EMERGENCY_ADMIN_4 = "0x23E1B127Fd62A4dbe64cC30Bb30FFfBfd71BcFc6";
const EMERGENCY_ADMIN_5 = "0x9063a2C78aFd6C8A3510273d646111Df67D6CB4b";

const FINAL_GOVERNOR = "0x51ad1265C8702c9e96Ea61Fe4088C2e22eD4418e";
const VAULT_OPERATOR = "0x09F0fB4405e4445849519511A407E68f697d1822";
const MEMBERSHIP_OPERATOR = "0x09F0fB4405e4445849519511A407E68f697d1822";

export default buildModule("MainnetDeploymentModule", (m) => {
  const bootstrapGovernor = m.getParameter("bootstrapGovernor");
  const temporaryRegistryImplementationAddress = m.getParameter("temporaryRegistryImplementationAddress");
  const temporaryRegistryImplementationDeploymentData = m.getParameter("temporaryRegistryImplementationDeploymentData");
  const temporaryRegistryImplementationSalt = m.getParameter("temporaryRegistryImplementationSalt");
  const registryImplementationAddress = m.getParameter("registryImplementationAddress");
  const registryImplementationDeploymentData = m.getParameter("registryImplementationDeploymentData");
  const registryImplementationSalt = m.getParameter("registryImplementationSalt");
  const registryProxyAddress = m.getParameter("registryProxyAddress");
  const registryProxyDeploymentData = m.getParameter("registryProxyDeploymentData");
  const registrySalt = m.getParameter("registrySalt");
  const vaultImplementationAddress = m.getParameter("vaultImplementationAddress");
  const vaultProxyAddress = m.getParameter("vaultProxyAddress");
  const vaultImplementationDeploymentData = m.getParameter("vaultImplementationDeploymentData");
  const vaultImplementationSalt = m.getParameter("vaultImplementationSalt");
  const locksImplementationAddress = m.getParameter("locksImplementationAddress");
  const locksProxyAddress = m.getParameter("locksProxyAddress");
  const locksImplementationDeploymentData = m.getParameter("locksImplementationDeploymentData");
  const locksImplementationSalt = m.getParameter("locksImplementationSalt");
  const bootstrapVaultOperator = m.getParameter("bootstrapVaultOperator");
  const vaultProxySalt = m.getParameter("vaultProxySalt");
  const locksProxySalt = m.getParameter("locksProxySalt");

  const create2Factory = m.contractAt("IDeployer", CREATE2_FACTORY_ADDRESS);
  const deployTemporaryRegistryImplementation = m.call(
    create2Factory,
    "deployAt",
    [
      temporaryRegistryImplementationDeploymentData,
      temporaryRegistryImplementationSalt,
      temporaryRegistryImplementationAddress,
    ],
    { id: "deployTemporaryRegistryImplementation" },
  );

  const temporaryRegistryImplementation = m.contractAt("TemporaryRWIRegistry", temporaryRegistryImplementationAddress, {
    id: "temporaryRegistryImplementation",
    after: [deployTemporaryRegistryImplementation],
  });

  const deployRegistryProxy = m.call(
    create2Factory,
    "deployAt",
    [registryProxyDeploymentData, registrySalt, registryProxyAddress],
    { id: "deployRegistryProxy", after: [deployTemporaryRegistryImplementation] },
  );

  const registry = m.contractAt("TemporaryRWIRegistry", registryProxyAddress, {
    id: "registryProxy",
    after: [deployRegistryProxy],
  });

  const registryProxy = m.contractAt("UpgradeableProxy", registryProxyAddress, {
    id: "registryProxyAdmin",
    after: [deployRegistryProxy],
  });

  const initializeRegistry = m.call(
    registry,
    "initialize",
    [bootstrapGovernor],
    { id: "initializeRegistry", after: [deployRegistryProxy] },
  );

  const addVaultOperator = m.call(
    registry,
    "addContract",
    [ContractIndexes.A_VAULT_OPERATOR, bootstrapVaultOperator, false],
    { id: "addVaultOperator", after: [initializeRegistry] },
  );

  const addMembershipOperator = m.call(
    registry,
    "addContract",
    [ContractIndexes.A_MEMBERSHIP_OPERATOR, MEMBERSHIP_OPERATOR, false],
    { id: "addMembershipOperator", after: [addVaultOperator] },
  );

  const setEmergencyAdmin1 = m.call(
    registry,
    "setEmergencyAdmin",
    [EMERGENCY_ADMIN_1, true],
    { id: "setEmergencyAdmin1", after: [addMembershipOperator] },
  );

  const setEmergencyAdmin2 = m.call(
    registry,
    "setEmergencyAdmin",
    [EMERGENCY_ADMIN_2, true],
    { id: "setEmergencyAdmin2", after: [setEmergencyAdmin1] },
  );

  const setEmergencyAdmin3 = m.call(
    registry,
    "setEmergencyAdmin",
    [EMERGENCY_ADMIN_3, true],
    { id: "setEmergencyAdmin3", after: [setEmergencyAdmin2] },
  );

  const setEmergencyAdmin4 = m.call(
    registry,
    "setEmergencyAdmin",
    [EMERGENCY_ADMIN_4, true],
    { id: "setEmergencyAdmin4", after: [setEmergencyAdmin3] },
  );

  const setEmergencyAdmin5 = m.call(
    registry,
    "setEmergencyAdmin",
    [EMERGENCY_ADMIN_5, true],
    { id: "setEmergencyAdmin5", after: [setEmergencyAdmin4] },
  );

  const deployVaultImplementation = m.call(
    create2Factory,
    "deployAt",
    [vaultImplementationDeploymentData, vaultImplementationSalt, vaultImplementationAddress],
    { id: "deployVaultImplementation", after: [setEmergencyAdmin5] },
  );

  const vaultImplementation = m.contractAt("RWIVault", vaultImplementationAddress, {
    id: "vaultImplementation",
    after: [deployVaultImplementation],
  });

  const deployVaultProxy = m.call(
    registry,
    "deployContract",
    [ContractIndexes.C_VAULT, vaultProxySalt, vaultImplementationAddress],
    { id: "deployVaultProxy", after: [deployVaultImplementation] },
  );

  const vaultProxy = m.contractAt("RWIVault", vaultProxyAddress, {
    id: "vaultProxy",
    after: [deployVaultProxy],
  });

  const deployLocksImplementation = m.call(
    create2Factory,
    "deployAt",
    [locksImplementationDeploymentData, locksImplementationSalt, locksImplementationAddress],
    { id: "deployLocksImplementation", after: [deployVaultProxy] },
  );

  const locksImplementation = m.contractAt("Locks", locksImplementationAddress, {
    id: "locksImplementation",
    after: [deployLocksImplementation],
  });

  const deployLocksProxy = m.call(
    registry,
    "deployContract",
    [ContractIndexes.C_LOCKS, locksProxySalt, locksImplementationAddress],
    { id: "deployLocksProxy", after: [deployLocksImplementation] },
  );

  const locksProxy = m.contractAt("Locks", locksProxyAddress, {
    id: "locksProxy",
    after: [deployLocksProxy],
  });

  const initializeVault = m.call(
    vaultProxy,
    "initialize",
    [VAULT_NAME, VAULT_SYMBOL, BASE_RATE],
    { id: "initializeVault", after: [deployLocksProxy] },
  );

  const setAssetCap = m.call(
    vaultProxy,
    "setAssetCap",
    [ASSET_CAP],
    { id: "setAssetCap", after: [initializeVault] },
  );

  const removeVaultOperator = m.call(
    registry,
    "removeContract",
    [ContractIndexes.A_VAULT_OPERATOR],
    { id: "removeVaultOperator", after: [setAssetCap] },
  );

  const addFinalVaultOperator = m.call(
    registry,
    "addContract",
    [ContractIndexes.A_VAULT_OPERATOR, VAULT_OPERATOR, false],
    { id: "addFinalVaultOperator", after: [removeVaultOperator] },
  );

  const transferGovernor = m.call(
    registry,
    "transferGovernor",
    [FINAL_GOVERNOR],
    { id: "transferGovernor", after: [addFinalVaultOperator] },
  );

  const deployRegistryImplementation = m.call(
    create2Factory,
    "deployAt",
    [registryImplementationDeploymentData, registryImplementationSalt, registryImplementationAddress],
    { id: "deployRegistryImplementation", after: [transferGovernor] },
  );

  const registryImplementation = m.contractAt("RWIRegistry", registryImplementationAddress, {
    id: "registryImplementation",
    after: [deployRegistryImplementation],
  });

  const upgradeRegistryProxy = m.call(
    registryProxy,
    "upgradeTo",
    [registryImplementationAddress],
    { id: "upgradeRegistryProxy", after: [registryImplementation] },
  );

  const transferRegistryProxyOwnership = m.call(
    registryProxy,
    "transferProxyOwnership",
    [FINAL_GOVERNOR],
    { id: "transferRegistryProxyOwnership", after: [upgradeRegistryProxy] },
  );

  return {
    registry,
    registryImplementation,
    temporaryRegistryImplementation,
    vaultImplementation,
    vaultProxy,
    locksImplementation,
    locksProxy,
  };
});
