// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NodeRegistry
 * @notice Manages relay node registration, ENS name linking, and reputation scores.
 * @dev Relay operators register with an ENS subdomain (e.g., relay1.meshsearch.eth),
 *      an HTTP endpoint, and their wallet address. Reputation is tracked onchain.
 */
contract NodeRegistry is Ownable {
    struct Node {
        string ensName;
        address operator;
        string endpoint;
        uint256 reputationScore;
        bool active;
        uint256 lastActiveAt;
    }

    /// @notice ENS name => Node
    mapping(string => Node) public nodes;

    /// @notice All registered ENS names
    string[] public ensNames;

    /// @notice Minimum reputation to be considered for routing
    uint256 public constant MIN_REPUTATION = 10;

    /// @notice Maximum reputation score
    uint256 public constant MAX_REPUTATION = 100;

    /// @notice Initial reputation for new nodes
    uint256 public constant INITIAL_REPUTATION = 50;

    event NodeRegistered(string ensName, address operator, string endpoint);
    event NodeDeactivated(string ensName);
    event NodeActivated(string ensName);
    event ReputationUpdated(string ensName, uint256 newScore);
    event EndpointUpdated(string ensName, string newEndpoint);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register a new relay node
     * @param ensName ENS subdomain (e.g., relay1.meshsearch.eth)
     * @param endpoint HTTP endpoint of the relay
     */
    function registerNode(string calldata ensName, string calldata endpoint) external {
        require(bytes(ensName).length > 0, "Empty ENS name");
        require(bytes(endpoint).length > 0, "Empty endpoint");
        require(nodes[ensName].operator == address(0), "Already registered");

        nodes[ensName] = Node({
            ensName: ensName,
            operator: msg.sender,
            endpoint: endpoint,
            reputationScore: INITIAL_REPUTATION,
            active: true,
            lastActiveAt: block.timestamp
        });

        ensNames.push(ensName);
        emit NodeRegistered(ensName, msg.sender, endpoint);
    }

    /**
     * @notice Update relay endpoint
     * @param ensName ENS name of the node
     * @param newEndpoint New HTTP endpoint
     */
    function updateEndpoint(string calldata ensName, string calldata newEndpoint) external {
        require(nodes[ensName].operator == msg.sender, "Not operator");
        require(bytes(newEndpoint).length > 0, "Empty endpoint");
        nodes[ensName].endpoint = newEndpoint;
        emit EndpointUpdated(ensName, newEndpoint);
    }

    /**
     * @notice Deactivate a node (operator or owner)
     * @param ensName ENS name of the node
     */
    function deactivateNode(string calldata ensName) external {
        require(
            nodes[ensName].operator == msg.sender || msg.sender == owner(),
            "Not authorized"
        );
        nodes[ensName].active = false;
        emit NodeDeactivated(ensName);
    }

    /**
     * @notice Reactivate a node (operator only)
     * @param ensName ENS name of the node
     */
    function activateNode(string calldata ensName) external {
        require(nodes[ensName].operator == msg.sender, "Not operator");
        nodes[ensName].active = true;
        emit NodeActivated(ensName);
    }

    /**
     * @notice Update reputation after a routing event
     * @param ensName ENS name of the node
     * @param success Whether the routing was successful
     */
    function updateReputation(string calldata ensName, bool success) external onlyOwner {
        Node storage node = nodes[ensName];
        require(node.operator != address(0), "Node not registered");

        if (success) {
            if (node.reputationScore < MAX_REPUTATION) {
                node.reputationScore += 1;
            }
            node.lastActiveAt = block.timestamp;
        } else {
            if (node.reputationScore > 0) {
                node.reputationScore -= 5 > node.reputationScore ? node.reputationScore : 5;
            }
        }

        emit ReputationUpdated(ensName, node.reputationScore);
    }

    /**
     * @notice Get the top N active relay nodes by reputation
     * @param count Number of nodes to return
     * @return topNodes Array of top node ENS names
     */
    function getTopNodes(uint256 count) external view returns (string[] memory topNodes) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < ensNames.length; i++) {
            if (nodes[ensNames[i]].active && nodes[ensNames[i]].reputationScore >= MIN_REPUTATION) {
                activeCount++;
            }
        }

        uint256 resultCount = count < activeCount ? count : activeCount;
        topNodes = new string[](resultCount);

        // Simple selection sort for top nodes (fine for small relay sets)
        bool[] memory used = new bool[](ensNames.length);
        for (uint256 j = 0; j < resultCount; j++) {
            uint256 bestScore = 0;
            uint256 bestIdx = 0;
            for (uint256 i = 0; i < ensNames.length; i++) {
                if (
                    !used[i] &&
                    nodes[ensNames[i]].active &&
                    nodes[ensNames[i]].reputationScore >= MIN_REPUTATION &&
                    nodes[ensNames[i]].reputationScore > bestScore
                ) {
                    bestScore = nodes[ensNames[i]].reputationScore;
                    bestIdx = i;
                }
            }
            used[bestIdx] = true;
            topNodes[j] = ensNames[bestIdx];
        }
    }

    /**
     * @notice Get a node's details
     * @param ensName ENS name to look up
     */
    function getNode(string calldata ensName) external view returns (
        address operator,
        string memory endpoint,
        uint256 reputationScore,
        bool active,
        uint256 lastActiveAt
    ) {
        Node storage node = nodes[ensName];
        return (node.operator, node.endpoint, node.reputationScore, node.active, node.lastActiveAt);
    }

    /**
     * @notice Get total number of registered nodes
     */
    function nodeCount() external view returns (uint256) {
        return ensNames.length;
    }
}
