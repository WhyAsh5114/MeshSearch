// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AccessControl
 * @notice Manages ENS subscription tiers and access authorization.
 * @dev Users holding a registered ENS name get premium access without per-query payment.
 *      The contract tracks which ENS names have active subscriptions.
 */
contract AccessControl is Ownable {
    enum Tier {
        None,
        Basic,
        Premium
    }

    /// @notice ENS name => subscription tier
    mapping(string => Tier) public subscriptions;

    /// @notice Wallet address => authorized to use the MCP server (via ZK proof verification)
    mapping(address => bool) public authorizedVerifiers;

    /// @notice Price per search in wei (for non-subscribers)
    uint256 public searchPrice;

    event SubscriptionUpdated(string ensName, Tier tier);
    event VerifierUpdated(address verifier, bool authorized);
    event SearchPriceUpdated(uint256 newPrice);

    constructor(uint256 _searchPrice) Ownable(msg.sender) {
        searchPrice = _searchPrice;
    }

    /**
     * @notice Set subscription tier for an ENS name
     * @param ensName ENS name (e.g., user.eth)
     * @param tier Subscription tier
     */
    function setSubscription(string calldata ensName, Tier tier) external onlyOwner {
        subscriptions[ensName] = tier;
        emit SubscriptionUpdated(ensName, tier);
    }

    /**
     * @notice Check if an ENS name has an active subscription (Basic or Premium)
     * @param ensName ENS name to check
     */
    function hasSubscription(string calldata ensName) external view returns (bool) {
        return subscriptions[ensName] != Tier.None;
    }

    /**
     * @notice Get subscription tier for an ENS name
     * @param ensName ENS name to check
     */
    function getTier(string calldata ensName) external view returns (Tier) {
        return subscriptions[ensName];
    }

    /**
     * @notice Authorize or revoke a verifier address (MCP server)
     * @param verifier Address to update
     * @param authorized Whether the address is authorized
     */
    function setVerifier(address verifier, bool authorized) external onlyOwner {
        authorizedVerifiers[verifier] = authorized;
        emit VerifierUpdated(verifier, authorized);
    }

    /**
     * @notice Check if an address is an authorized verifier
     * @param verifier Address to check
     */
    function isVerifier(address verifier) external view returns (bool) {
        return authorizedVerifiers[verifier];
    }

    /**
     * @notice Update search price
     * @param _price New price in wei
     */
    function setSearchPrice(uint256 _price) external onlyOwner {
        searchPrice = _price;
        emit SearchPriceUpdated(_price);
    }
}
