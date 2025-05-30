# SecureStore

## DESCRIPTION

`SecureStore` is a secure, multi-attester, owner-controlled smart contract for managing and safeguarding native asset deposits. It is designed for scenarios where withdrawals require multi-party attestation and includes robust emergency withdrawal mechanisms. The contract leverages OpenZeppelin's `Ownable` and `ReentrancyGuard` for access control and security.

---

## File Overview

### 1. `contracts/SecureStore.sol`
This is the main Solidity smart contract implementing the SecureStore logic.

**Key Features**
- **Multi-Attester Withdrawals:** Withdrawals require attestation from all registered attesters before funds can be released.
- **Emergency Withdrawals:** The owner can initiate an emergency withdrawal, which can only be completed after a configurable waiting period (`EMERGENCY_PERIOD`).
- **Jail Mechanism:** Attesters can vote to permanently jail the owner, disabling its emergency power.
- **Deposit Handling:** Accepts native asset deposits via direct calls, `receive()`, or `fallback()` functions.
- **Cycle Tracking:** All withdrawal and emergency cycles are tracked and can be queried.

**Main Components**
- **Enums:**
  - `WithdrawStatus`: { INITIATED, ATTESTING, COMPLETED }
  - `WithdrawMode`: { NONE, NORMAL, EMERGENCY }
- **Structs:**
  - `WithdrawCycle`: Tracks each withdrawal/emergency cycle (id, initiator, receiver, amount, block, status).
- **State Variables:**
  - `withdrawCycles`, `withdrawMode`, `isJailedOwner`, `attesters`, `EMERGENCY_PERIOD`, `isAttester`, `hasAttested`, `votedForJail`
- **Events:**
  - `WithdrawCycleInitiated`, `WithdrawCycleCleared`, `WithdrawCycleAttested`, `WithdrawCycleCompleted`, `Deposit`, `JailedOwner`
- **Key Functions:**
  - `initiateWithdrawCycle`, `attestOnWithdrawCycle`, `completeWithdrawCycle`, `clearCurrentWithdrawCycle`, `initiateEmergencyWithdraw`, `completeEmergencyWithdraw`, `voteForJail`, `jailForever`, `pruneOldCycles`, `deposit`, `getWithdrawCycles`, `getAttesters`, `isRecognizedAttester`

---

### 2. `ignition/modules/SecureStore.js`
This is a Hardhat Ignition deployment module for SecureStore.

**Purpose**
- Automates deployment of the SecureStore contract with configurable attesters and emergency period.
- Uses Hardhat Ignition's `buildModule` to define deployment logic.

**Usage**
- Set the `ATTESTERS` array and `BLOCK_COUNT` (emergency period in blocks) as needed.
- The module deploys the contract and returns the deployed instance for use in scripts or tests.

---

### 3. `test/SecureStore.js`
This file contains comprehensive unit tests for the SecureStore contract using Hardhat and Chai.

**Test Coverage**
- **Deployment:** Verifies correct initialization, attester setup, and contract state.
- **Deposits:** Tests native asset deposit functionality and event emission.
- **Withdrawals:**
  - Initiation, attestation, completion, and clearing of normal withdraw cycles.
  - Pruning of old cycles.
- **Emergency Withdrawals:**
  - Initiation and completion of emergency withdrawals.
  - Owner jailing mechanism (attester voting and permanent disablement of owner powers).
- **Edge Cases:**
  - Reverts on invalid actions (e.g., double attestation, unauthorized access, invalid receiver, etc.).

**How to Run**
- Use Hardhat's test runner: `npx hardhat test`
- Tests are designed to cover all major contract behaviors and edge cases.

---

## Usage Example

1. **Deploy the contract** using the Ignition module or Hardhat scripts.
2. **Deposit native asset** into the contract.
3. **Initiate a withdraw cycle** as an attester, then have all attesters attest.
4. **Complete the withdraw cycle** to transfer funds to the receiver.
5. **Emergency withdraw** can be initiated and completed by the owner after the emergency period, unless the owner is jailed by attesters.
6. **Run tests** to verify contract behavior and security.

---

## License
MIT