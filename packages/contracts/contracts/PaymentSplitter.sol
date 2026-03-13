// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PaymentSplitter
 * @notice Distributes x402 payments to relay operators and protocol.
 * @dev When a search payment arrives, it is split between the 3 relay nodes
 *      that handled the routing and a protocol fee. Shares are in basis points (1/10000).
 */
contract PaymentSplitter is Ownable, ReentrancyGuard {
    /// @notice Default shares in basis points (total = 10000)
    uint256 public relay1Share = 2500; // 25%
    uint256 public relay2Share = 2500; // 25%
    uint256 public relay3Share = 2500; // 25%
    uint256 public protocolShare = 2500; // 25%

    /// @notice Protocol fee recipient
    address public protocolRecipient;

    /// @notice Accumulated balances for withdrawal
    mapping(address => uint256) public balances;

    event PaymentReceived(uint256 amount, address[3] relays);
    event PaymentWithdrawn(address indexed recipient, uint256 amount);
    event SharesUpdated(uint256 relay1, uint256 relay2, uint256 relay3, uint256 protocol);

    constructor(address _protocolRecipient) Ownable(msg.sender) {
        require(_protocolRecipient != address(0), "Zero address");
        protocolRecipient = _protocolRecipient;
    }

    /**
     * @notice Split an incoming payment among 3 relays + protocol
     * @param relays Array of 3 relay operator addresses
     */
    function splitPayment(address[3] calldata relays) external payable nonReentrant {
        require(msg.value > 0, "No payment");
        require(relays[0] != address(0) && relays[1] != address(0) && relays[2] != address(0), "Zero relay");

        uint256 share1 = (msg.value * relay1Share) / 10000;
        uint256 share2 = (msg.value * relay2Share) / 10000;
        uint256 share3 = (msg.value * relay3Share) / 10000;
        uint256 protocolAmount = msg.value - share1 - share2 - share3;

        balances[relays[0]] += share1;
        balances[relays[1]] += share2;
        balances[relays[2]] += share3;
        balances[protocolRecipient] += protocolAmount;

        emit PaymentReceived(msg.value, relays);
    }

    /**
     * @notice Withdraw accumulated balance
     */
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");
        balances[msg.sender] = 0;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");
        emit PaymentWithdrawn(msg.sender, amount);
    }

    /**
     * @notice Update payment shares (owner only)
     * @param _relay1 Relay 1 share in basis points
     * @param _relay2 Relay 2 share in basis points
     * @param _relay3 Relay 3 share in basis points
     * @param _protocol Protocol share in basis points
     */
    function updateShares(
        uint256 _relay1,
        uint256 _relay2,
        uint256 _relay3,
        uint256 _protocol
    ) external onlyOwner {
        require(_relay1 + _relay2 + _relay3 + _protocol == 10000, "Must total 10000");
        relay1Share = _relay1;
        relay2Share = _relay2;
        relay3Share = _relay3;
        protocolShare = _protocol;
        emit SharesUpdated(_relay1, _relay2, _relay3, _protocol);
    }

    /**
     * @notice Update protocol recipient
     * @param _recipient New protocol fee recipient
     */
    function setProtocolRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Zero address");
        protocolRecipient = _recipient;
    }

    /**
     * @notice Get balance available for withdrawal
     * @param account Address to check
     */
    function getBalance(address account) external view returns (uint256) {
        return balances[account];
    }
}
