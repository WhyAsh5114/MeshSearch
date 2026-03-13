// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NullifierRegistry
 * @notice Stores used nullifiers to prevent search replay attacks.
 * @dev Each search generates a unique nullifier via Semaphore. Once used,
 *      the nullifier is stored here. A nullifier can never be reused.
 *      Nullifiers are NOT linked to wallet addresses.
 */
contract NullifierRegistry is Ownable {
    /// @notice Set of used nullifiers
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Mapping of result hashes for integrity verification
    mapping(bytes32 => bytes32) public resultHashes;

    /// @notice Total number of nullifiers used
    uint256 public nullifierCount;

    event NullifierUsed(bytes32 indexed nullifierHash);
    event ResultHashStored(bytes32 indexed commitment, bytes32 resultHash);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Check and store a nullifier (anti-replay)
     * @param nullifierHash The nullifier hash from the ZK proof
     * @return success Whether the nullifier was successfully stored (false if already used)
     */
    function useNullifier(bytes32 nullifierHash) external onlyOwner returns (bool success) {
        if (usedNullifiers[nullifierHash]) {
            return false;
        }
        usedNullifiers[nullifierHash] = true;
        nullifierCount++;
        emit NullifierUsed(nullifierHash);
        return true;
    }

    /**
     * @notice Store a result hash for integrity verification
     * @param commitment The query commitment
     * @param resultHash Hash of the search result set
     */
    function storeResultHash(bytes32 commitment, bytes32 resultHash) external onlyOwner {
        resultHashes[commitment] = resultHash;
        emit ResultHashStored(commitment, resultHash);
    }

    /**
     * @notice Check if a nullifier has been used
     * @param nullifierHash The nullifier hash to check
     */
    function isNullifierUsed(bytes32 nullifierHash) external view returns (bool) {
        return usedNullifiers[nullifierHash];
    }

    /**
     * @notice Verify a result hash matches what was stored
     * @param commitment The query commitment
     * @param resultHash The result hash to verify
     */
    function verifyResultHash(bytes32 commitment, bytes32 resultHash) external view returns (bool) {
        return resultHashes[commitment] == resultHash;
    }
}
