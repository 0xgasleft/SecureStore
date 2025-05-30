const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");


const EMERGENCY_PERIOD = 100;
const WithdrawMode = {
    NONE: 0,
    NORMAL: 1,
    EMERGENCY: 2
  };

  const WithdrawStatus = {
    INITIATED: 0,
    ATTESTING: 1,
    COMPLETED: 2
  };
  

describe("SecureStore", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.

  const deploy = async () => {
    const [deployer, attester1, attester2, receiver] = await ethers.getSigners();
    const SecureStore = await ethers.getContractFactory("SecureStore");
    const secureStore = await SecureStore.deploy([attester1.address, attester2.address], EMERGENCY_PERIOD);
    await secureStore.waitForDeployment();
    return { secureStore, deployer, attester1, attester2, receiver };
  }

  
  

  describe("Deployment", function () {
    it("Should deploy correctly", async function () {
      const { secureStore, deployer, attester1, attester2, receiver } = await deploy();

      expect(await secureStore.owner()).to.equal(deployer.address);
      expect(await secureStore.getAttesters()).to.deep.equal([attester1.address, attester2.address]);
      expect(await secureStore.isRecognizedAttester(attester1.address)).to.be.true;
      expect(await secureStore.isRecognizedAttester(attester2.address)).to.be.true;
      expect(await secureStore.isRecognizedAttester(receiver.address)).to.be.false;
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);
      expect(await secureStore.getWithdrawCycles()).to.deep.equal([]);
      expect(await secureStore.EMERGENCY_PERIOD()).to.equal(EMERGENCY_PERIOD);
      expect(await secureStore.isJailedOwner()).to.be.false;
    });

    
  });

  describe("Deposits", function () {
    it("Should receive and store funds", async function () {
      const { secureStore, attester1 } = await loadFixture(deploy);

      const initialBalance = await ethers.provider.getBalance(secureStore.target);
      expect(initialBalance).to.equal(0);

      let depositAmount = ethers.parseEther("1.0");
      expect(await secureStore.deposit({ value: depositAmount })).to.emit(secureStore, "Deposit").withArgs(depositAmount, await ethers.provider.getBlock("latest").number);

      const afterDepositBalance = await ethers.provider.getBalance(secureStore.target);
      expect(afterDepositBalance).to.equal(depositAmount);

      depositAmount = ethers.parseEther("0.5"); 
      const receiveDepositBalance = await attester1.sendTransaction({
        to: secureStore.target,
        value: depositAmount
      });
      await receiveDepositBalance.wait();
      const afterReceiveDepositBalance = await ethers.provider.getBalance(secureStore.target);
      expect(afterReceiveDepositBalance).to.equal(ethers.parseEther("1.5"));

      depositAmount = ethers.parseEther("0.25");
      const fallbackDepositBalance = await attester1.sendTransaction({
        to: secureStore.target,
        value: depositAmount,
        data: "0xabcd"
      });
      await fallbackDepositBalance.wait();
      const afterFallbackDepositBalance = await ethers.provider.getBalance(secureStore.target);
      expect(afterFallbackDepositBalance).to.equal(ethers.parseEther("1.75"));

      depositAmount = 0;
      await expect(secureStore.deposit({ value: depositAmount })).to.be.revertedWith(
        "Deposit amount must be greater than zero"
      );
      
    });
  });

  describe("Withdrawals", function () {
    it("Should initiate a withdraw cycle", async function () {
      
      let { secureStore, attester1, receiver } = await loadFixture(deploy);

      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);
      await expect(secureStore.initiateWithdrawCycle(receiver.address)).to.be.revertedWith(
        "Not an attester"
      );
      secureStore = secureStore.connect(attester1);
      await expect(secureStore.initiateWithdrawCycle(receiver.address)).to.be.revertedWith(
        "Insufficient contract balance"
      );
      await secureStore.deposit({ value: ethers.parseEther("1.0") });
      expect(await ethers.provider.getBalance(secureStore.target)).to.equal(ethers.parseEther("1.0"));

      await expect(secureStore.initiateWithdrawCycle(ethers.ZeroAddress)).to.be.revertedWith(
        "Invalid receiver address!"
      )
      const withdrawCycle = [
        0n,
        attester1.address,
        receiver.address,
        0n,
        (await ethers.provider.getBlock("latest")).number + 1,
        WithdrawStatus.INITIATED
      ];
      
      await expect(secureStore.initiateWithdrawCycle(receiver.address)).to.emit(secureStore, "WithdrawCycleInitiated").withArgs(attester1.address, 0n);
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NORMAL);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);
      expect((await secureStore.getWithdrawCycles())[0]).to.deep.equal(withdrawCycle);

      await expect(secureStore.initiateWithdrawCycle(receiver.address)).to.be.revertedWith(
        "Already existing withdraw cycle!"
      );

    });

    it("Should attest on a withdraw cycle", async function () {

      let { secureStore, attester1, receiver } = await loadFixture(deploy);

      await expect(secureStore.attestOnWithdrawCycle(receiver.address)).to.be.revertedWith(
        "Not an attester"
      );

      secureStore = secureStore.connect(attester1);
      await expect(secureStore.attestOnWithdrawCycle(receiver.address)).to.be.revertedWith(
        "No active normal withdraw cycle!"
      );

      await secureStore.deposit({ value: ethers.parseEther("1.0") });
      await secureStore.initiateWithdrawCycle(receiver.address);

      await expect(secureStore.attestOnWithdrawCycle(ethers.ZeroAddress)).to.be.revertedWith(
        "Receiver mismatch"
      );

      const withdrawCycle = [
        0n,
        attester1.address,
        receiver.address,
        0n,
        (await ethers.provider.getBlock("latest")).number - 1,
        WithdrawStatus.ATTESTING
      ];
      await expect(secureStore.attestOnWithdrawCycle(receiver.address)).to.emit(secureStore, "WithdrawCycleAttested").withArgs(withdrawCycle[1], withdrawCycle[0]);

      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);
      expect((await secureStore.getWithdrawCycles())[0]).to.deep.equal(withdrawCycle);

      await expect(secureStore.attestOnWithdrawCycle(receiver.address)).to.be.revertedWith(
        "Already attested"
      );

    });

    it("Should clear a withdraw cycle", async function () {

      let { secureStore, attester1, receiver } = await loadFixture(deploy);

      await expect(secureStore.clearCurrentWithdrawCycle()).to.be.revertedWith(
        "Not an attester"
      );

      secureStore = secureStore.connect(attester1);
      await expect(secureStore.clearCurrentWithdrawCycle()).to.be.revertedWith(
        "No active normal withdraw cycle!"
      );

      await secureStore.deposit({ value: ethers.parseEther("1.0") });
      await secureStore.initiateWithdrawCycle(receiver.address);
      const withdrawCycle = await secureStore.getWithdrawCycles();
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NORMAL);
      expect(withdrawCycle).to.have.lengthOf(1);

      await expect(secureStore.clearCurrentWithdrawCycle()).to.emit(secureStore, "WithdrawCycleCleared").withArgs(attester1.address, withdrawCycle[0][0]);
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(0);
      expect(await secureStore.getWithdrawCycles()).to.deep.equal([]);
      expect(await ethers.provider.getBalance(secureStore.target)).to.equal(ethers.parseEther("1.0"));
      
      await expect(secureStore.clearCurrentWithdrawCycle()).to.be.revertedWith(
        "No active normal withdraw cycle!"
      );
      
    });

    it("Should complete a normal withdraw cycle", async function () {

      let { secureStore, deployer, attester1, attester2, receiver } = await loadFixture(deploy);

      await expect(secureStore.completeWithdrawCycle()).to.be.revertedWith(
        "Not an attester"
      );

      secureStore = secureStore.connect(attester1);
      await expect(secureStore.completeWithdrawCycle()).to.be.revertedWith(
        "No active normal withdraw cycle!"
      );

      const depositedAmount = ethers.parseEther("1.0");
      await secureStore.deposit({ value: depositedAmount });
      await secureStore.initiateWithdrawCycle(receiver.address);
      const withdrawCycles = await secureStore.getWithdrawCycles();
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NORMAL);
      expect(withdrawCycles).to.have.lengthOf(1);

      await secureStore.attestOnWithdrawCycle(receiver.address);

      secureStore = secureStore.connect(deployer);
      await expect(secureStore.completeWithdrawCycle()).to.be.revertedWith(
        "Not an attester"
      );

      secureStore = secureStore.connect(attester2);
      await expect(secureStore.completeWithdrawCycle()).to.be.revertedWith(
        "Not all attesters have attested"
      );

      await secureStore.attestOnWithdrawCycle(receiver.address);

      const withdrawCycle = [
        0n,
        attester1.address,
        receiver.address,
        depositedAmount,
        (await ethers.provider.getBlock("latest")).number - 4,
        WithdrawStatus.COMPLETED
      ];
      const initialReceiverBalance = await ethers.provider.getBalance(receiver.address);
      await expect(secureStore.completeWithdrawCycle()).to.emit(secureStore, "WithdrawCycleCompleted").withArgs(withdrawCycle[2], withdrawCycle[0]);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(initialReceiverBalance + depositedAmount);
      expect(await ethers.provider.getBalance(secureStore.target)).to.equal(0);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);
      expect((await secureStore.getWithdrawCycles())[0]).to.deep.equal(withdrawCycle);
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);

    });

    it("Should prune old cycles", async function () {
      
      let { secureStore, deployer, attester1, attester2, receiver } = await loadFixture(deploy);

      const initialReceiverBalance = await ethers.provider.getBalance(receiver.address);
      const depositedAmount = ethers.parseEther("1.0");
      await secureStore.deposit({ value: depositedAmount });

      secureStore = secureStore.connect(attester1);
      await secureStore.initiateWithdrawCycle(receiver.address);

      await secureStore.attestOnWithdrawCycle(receiver.address);

      secureStore = secureStore.connect(attester2);
      await secureStore.attestOnWithdrawCycle(receiver.address);

      await secureStore.completeWithdrawCycle();

      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(initialReceiverBalance + depositedAmount);

      const depositedAmount2 = ethers.parseEther("2.0");
      await secureStore.deposit({ value: depositedAmount2 });
      await secureStore.initiateWithdrawCycle(receiver.address);
      
      secureStore = secureStore.connect(attester1);
      await secureStore.attestOnWithdrawCycle(receiver.address);

      secureStore = secureStore.connect(attester2);
      await secureStore.attestOnWithdrawCycle(receiver.address);

      await expect(secureStore.connect(deployer).pruneOldCycles()).to.be.revertedWith(
        "Withdraw cycle ongoing!"
      );

      await secureStore.completeWithdrawCycle();

      const expectedWithdrawCycles =  [
        [
          0n,
          attester1.address,
          receiver.address,
          depositedAmount,
          (await ethers.provider.getBlock("latest")).number - 9,
          WithdrawStatus.COMPLETED
        ],
        [
          1n,
          attester2.address,
          receiver.address,
          depositedAmount2,
          (await ethers.provider.getBlock("latest")).number - 4,
          WithdrawStatus.COMPLETED
        ]
      ]
      const withdrawCycles = await secureStore.getWithdrawCycles();
      expect(withdrawCycles).to.have.lengthOf(2);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(initialReceiverBalance + depositedAmount + depositedAmount2);
      expect(withdrawCycles).to.deep.equal(expectedWithdrawCycles);

      await expect(secureStore.pruneOldCycles()).to.be.reverted;

      // Check when owner is jailed

    });

  });

  describe("EmergencyWithdrawals", function () {

    it("Should jail forever", async function () {
      
      let { secureStore, deployer, attester1, attester2, receiver } = await loadFixture(deploy);

      await expect(secureStore.voteForJail()).to.be.revertedWith(
        "Not an attester"
      );

      expect(await secureStore.isJailedOwner()).to.be.false;

      secureStore = secureStore.connect(attester1);
      await secureStore.voteForJail();

      await expect(secureStore.voteForJail()).to.be.revertedWith(
        "You have already voted for jail"
      );

      await expect(secureStore.jailForever()).to.be.revertedWith(
        "Not all attesters have voted for jail"
      )

      secureStore = secureStore.connect(deployer);
      await secureStore.deposit({ value: ethers.parseEther("0.3") });
      await secureStore.initiateEmergencyWithdraw(receiver.address);

      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.EMERGENCY);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);

      secureStore = secureStore.connect(attester2);
      await secureStore.voteForJail();

      await expect(secureStore.jailForever()).to.emit(secureStore, "JailedOwner");
      expect(await secureStore.isJailedOwner()).to.be.true;
      
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(0);
      
    });

    it("Should initiate emergency withdraw", async function () {

      let { secureStore, deployer, attester1, receiver } = await loadFixture(deploy);

      secureStore = secureStore.connect(deployer);
      await secureStore.deposit({ value: ethers.parseEther("0.6") });

      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(0);
      
      secureStore = secureStore.connect(attester1);
      await expect(secureStore.initiateWithdrawCycle(receiver.address)).to.emit(secureStore, "WithdrawCycleInitiated").withArgs(attester1.address, 0);
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NORMAL);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);

      await expect(secureStore.initiateEmergencyWithdraw(receiver.address)).to.be.reverted;

      secureStore = secureStore.connect(deployer);
      await expect(secureStore.initiateEmergencyWithdraw(receiver.address)).to.emit(secureStore, "WithdrawCycleInitiated").withArgs(deployer.address, 0);
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.EMERGENCY);
      expect(await secureStore.getWithdrawCycles()).to.have.lengthOf(1);
      const expectedWithdrawCycle = [
        0,
        deployer.address,
        receiver.address,
        0,
        (await ethers.provider.getBlock("latest")).number,
        WithdrawStatus.INITIATED
      ]
      expect((await secureStore.getWithdrawCycles())[0]).to.deep.equal(expectedWithdrawCycle);

    });

    it("Should complete emergency withdraw", async function () {

      let { secureStore, deployer, attester1, attester2, receiver } = await loadFixture(deploy);

      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);

      const depositAmount = ethers.parseEther("0.6");
      secureStore = secureStore.connect(attester1);
      await secureStore.deposit({ value: depositAmount });

      await expect(secureStore.completeEmergencyWithdraw()).to.be.reverted;

      secureStore = secureStore.connect(deployer);

      await expect(secureStore.completeEmergencyWithdraw()).to.be.revertedWith(
        "No active emergency withdraw"
      );

      await secureStore.initiateEmergencyWithdraw(receiver.address);
      await expect(secureStore.completeEmergencyWithdraw()).to.be.revertedWith(
        "Emergency withdraw can only be completed after EMERGENCY_PERIOD reached!"
      );
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.EMERGENCY);

      const THRESHOLD = (await ethers.provider.getBlockNumber()) + EMERGENCY_PERIOD;
      while ((await ethers.provider.getBlockNumber()) < THRESHOLD) {
        await ethers.provider.send("evm_mine", []);
      }

      const initialReceiverBalance = await ethers.provider.getBalance(receiver.address);
      await expect(secureStore.completeEmergencyWithdraw()).to.emit(secureStore, "WithdrawCycleCompleted").withArgs(receiver.address, 0);
      expect(await secureStore.withdrawMode()).to.equal(WithdrawMode.NONE);
      expect(await ethers.provider.getBalance(receiver.address)).to.equal(initialReceiverBalance + depositAmount);
      expect(await ethers.provider.getBalance(secureStore.target)).to.equal(0);
      
      const expectedWithdrawCycle = [
        0,
        deployer.address,
        receiver.address,
        depositAmount,
        (await ethers.provider.getBlock("latest")).number - EMERGENCY_PERIOD - 2,
        WithdrawStatus.COMPLETED
      ];
      const withdrawCycles = await secureStore.getWithdrawCycles();
      expect(withdrawCycles).to.have.lengthOf(1);
      expect(withdrawCycles[0]).to.deep.equal(expectedWithdrawCycle);

    });


  });  

  
});
