// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

const ATTESTERS = [

];
const BLOCK_COUNT = 1_209_600;

module.exports = buildModule("SecureStoreModule", (m) => {

  const secureStore = m.contract("SecureStore", [ATTESTERS, BLOCK_COUNT]);

  return { secureStore };
});
