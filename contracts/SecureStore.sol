// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


contract SecureStore is Ownable, ReentrancyGuard {

    enum WithdrawStatus {
        INITIATED,
        ATTESTING,
        COMPLETED
    }

    enum WithdrawMode {
        NONE,
        NORMAL,
        EMERGENCY
    }

    struct WithdrawCycle {
        uint cycleId;
        address initiator;
        address receiver;
        uint amount;
        uint init_block;
        WithdrawStatus status;
    }

    WithdrawCycle[] public withdrawCycles;

    WithdrawMode public withdrawMode;
    bool public isJailedOwner;

    address[] public attesters;

    uint public immutable EMERGENCY_PERIOD;

    mapping(address => bool) public isAttester;
    mapping(address => bool) public hasAttested;
    mapping(address => bool) public votedForJail;

    event WithdrawCycleInitiated(address indexed _initiator, uint indexed _cycleId);
    event WithdrawCycleCleared(address indexed _clearer, uint indexed _cycleId);
    event WithdrawCycleAttested(address indexed _attester, uint indexed _cycleId);
    event WithdrawCycleCompleted(address indexed _receiver, uint indexed _cycleId);
    event Deposit(uint indexed _amount, uint indexed _when);
    event JailedOwner();


    constructor(address[] memory _attesters, uint _block_count) Ownable(msg.sender) {
        attesters = _attesters;
        EMERGENCY_PERIOD = _block_count;
        withdrawMode = WithdrawMode.NONE;
        isJailedOwner = false;
        
        for (uint i = 0; i < _attesters.length; i++) {
            isAttester[_attesters[i]] = true;
        }
    }

    modifier onlyAttester() {
        require(isAttester[msg.sender], "Not an attester");
        _;
    }

    function getWithdrawCycles() external view returns (WithdrawCycle[] memory) {
        return withdrawCycles;
    }

    function getAttesters() external view returns (address[] memory) {
        return attesters;
    }

    function isRecognizedAttester(address _attester) external view returns (bool) {
        return isAttester[_attester];
    }

    function pruneOldCycles() external onlyOwner {
        require(withdrawMode == WithdrawMode.NONE, "Withdraw cycle ongoing!");
        require(!isJailedOwner, "Owner jailed!");

        delete withdrawCycles;
    }

    function initiateEmergencyWithdraw(address _receiver) external onlyOwner {
        require(address(this).balance > 0, "Insufficient contract balance");
        require(withdrawMode != WithdrawMode.EMERGENCY, "Emergency withdraw already active");
        require(!isJailedOwner, "Owner is jailed");
        require(_receiver != address(0), "Invalid receiver address");

        if(withdrawMode == WithdrawMode.NORMAL) {
            // If a withdraw cycle is active, clear it
            _clearCurrentWithdrawCycle();
        }
        withdrawMode = WithdrawMode.EMERGENCY;
        
        WithdrawCycle memory emergencyCycle = WithdrawCycle({
            cycleId: withdrawCycles.length,
            initiator: msg.sender,
            receiver: _receiver,
            amount: 0,
            init_block: block.number,
            status: WithdrawStatus.INITIATED
        });
        withdrawCycles.push(emergencyCycle);
        emit WithdrawCycleInitiated(msg.sender, emergencyCycle.cycleId);
        
    }

    function voteForJail() external onlyAttester {
        require(!isJailedOwner, "Owner is already jailed");
        require(!votedForJail[msg.sender], "You have already voted for jail");

        votedForJail[msg.sender] = true;
    }

    function jailForever() external onlyAttester {
        require(_hasAllVotedForJail(), "Not all attesters have voted for jail");

        isJailedOwner = true; // owner is jailed forever

        emit JailedOwner();
        
        if(withdrawMode == WithdrawMode.EMERGENCY)
        {
            _clearCurrentWithdrawCycle();
        }
        
    }
        
    function completeEmergencyWithdraw() external onlyOwner nonReentrant {
        require(!isJailedOwner, "Owner not jailed");
        require(withdrawMode == WithdrawMode.EMERGENCY, "No active emergency withdraw");
        
        WithdrawCycle storage emergencyCycle = withdrawCycles[withdrawCycles.length - 1];
        require(emergencyCycle.initiator == owner(), "Only owner can complete emergency withdraw");
        require(block.number - emergencyCycle.init_block >= EMERGENCY_PERIOD, "Emergency withdraw can only be completed after EMERGENCY_PERIOD reached!");
        
        withdrawMode = WithdrawMode.NONE;

        _clearAttestations();
        
        emergencyCycle.amount = address(this).balance;
        emergencyCycle.status = WithdrawStatus.COMPLETED;
        (bool _status,) = payable(emergencyCycle.receiver).call{value: emergencyCycle.amount}("");
        require(_status, "Emergency withdraw failed");

        emit WithdrawCycleCompleted(emergencyCycle.receiver, emergencyCycle.cycleId);
    }

    function initiateWithdrawCycle(address _receiver) external onlyAttester {
        require(withdrawMode == WithdrawMode.NONE, "Already existing withdraw cycle!");
        require(address(this).balance > 0, "Insufficient contract balance");
        require(_receiver != address(0), "Invalid receiver address!");

        _clearAttestations();
        withdrawMode = WithdrawMode.NORMAL;
        withdrawCycles.push(
            WithdrawCycle({
                cycleId: withdrawCycles.length,
                initiator: msg.sender,
                receiver: _receiver,
                amount: 0,
                init_block: block.number,
                status: WithdrawStatus.INITIATED
        }));

        emit WithdrawCycleInitiated(msg.sender, withdrawCycles.length - 1);
    }

    function clearCurrentWithdrawCycle() external onlyAttester nonReentrant {
        require(withdrawMode == WithdrawMode.NORMAL, "No active normal withdraw cycle!");
        
        _clearCurrentWithdrawCycle();
    }
    

    function attestOnWithdrawCycle(address _receiver) external onlyAttester nonReentrant {
        require(withdrawMode == WithdrawMode.NORMAL, "No active normal withdraw cycle!");
        
        WithdrawCycle storage currentCycle = withdrawCycles[withdrawCycles.length - 1];
        currentCycle.status = WithdrawStatus.ATTESTING;

        require(currentCycle.receiver == _receiver, "Receiver mismatch");
        require(!hasAttested[msg.sender], "Already attested");

        hasAttested[msg.sender] = true;
        
        emit WithdrawCycleAttested(msg.sender, currentCycle.cycleId);
    }

    function completeWithdrawCycle() external onlyAttester nonReentrant {
        require(withdrawMode == WithdrawMode.NORMAL, "No active normal withdraw cycle!");
        require(_hasAllAttested(), "Not all attesters have attested");
        require(address(this).balance > 0, "Insufficient contract balance");

        _clearAttestations();
        withdrawMode = WithdrawMode.NONE;

        WithdrawCycle storage currentCycle = withdrawCycles[withdrawCycles.length - 1];
        currentCycle.amount = address(this).balance;
        currentCycle.status = WithdrawStatus.COMPLETED;
        (bool _status,) = payable(currentCycle.receiver).call{value: currentCycle.amount}("");
        require(_status, "Withdraw failed");

        emit WithdrawCycleCompleted(currentCycle.receiver, currentCycle.cycleId);


    }

    function _clearCurrentWithdrawCycle() internal {
        withdrawMode = WithdrawMode.NONE;

        _clearAttestations();

        emit WithdrawCycleCleared(msg.sender, withdrawCycles[withdrawCycles.length - 1].cycleId);

        withdrawCycles.pop();   
    }

    function _hasAllAttested() internal view returns (bool) {
        for (uint i = 0; i < attesters.length; i++) {
            if (!hasAttested[attesters[i]]) {
                return false;
            }
        }
        return true;
    }

    function _hasAllVotedForJail() internal view returns (bool) {
        for (uint i = 0; i < attesters.length; i++) {
            if (!votedForJail[attesters[i]]) {
                return false;
            }
        }
        return true;
    }

    function _clearAttestations() internal {
        for (uint i = 0; i < attesters.length; i++) {
            hasAttested[attesters[i]] = false;
        }
    }

        

    function deposit() public payable {
        require(msg.value > 0, "Deposit amount must be greater than zero");

        emit Deposit(msg.value, block.number);
    }

    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }

    
}