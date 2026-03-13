import { expect } from "chai";
import { ethers } from "hardhat";
import { NodeRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("NodeRegistry", function () {
  let registry: NodeRegistry;
  let owner: HardhatEthersSigner;
  let operator1: HardhatEthersSigner;
  let operator2: HardhatEthersSigner;
  let operator3: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, operator1, operator2, operator3] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NodeRegistry");
    registry = (await Factory.deploy()) as unknown as NodeRegistry;
  });

  describe("Registration", function () {
    it("should register a new node", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.operator).to.equal(operator1.address);
      expect(node.endpoint).to.equal("https://relay1.example.com");
      expect(node.reputationScore).to.equal(50); // INITIAL_REPUTATION
      expect(node.active).to.be.true;
    });

    it("should emit NodeRegistered event", async function () {
      await expect(
        registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com")
      )
        .to.emit(registry, "NodeRegistered")
        .withArgs("relay1.meshsearch.eth", operator1.address, "https://relay1.example.com");
    });

    it("should reject duplicate ENS names", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await expect(
        registry.connect(operator2).registerNode("relay1.meshsearch.eth", "https://relay2.example.com")
      ).to.be.revertedWith("Already registered");
    });

    it("should reject empty ENS name", async function () {
      await expect(
        registry.connect(operator1).registerNode("", "https://relay1.example.com")
      ).to.be.revertedWith("Empty ENS name");
    });

    it("should reject empty endpoint", async function () {
      await expect(
        registry.connect(operator1).registerNode("relay1.meshsearch.eth", "")
      ).to.be.revertedWith("Empty endpoint");
    });
  });

  describe("Endpoint Update", function () {
    it("should allow operator to update endpoint", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://old.example.com");
      await registry.connect(operator1).updateEndpoint("relay1.meshsearch.eth", "https://new.example.com");

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.endpoint).to.equal("https://new.example.com");
    });

    it("should reject non-operator updating endpoint", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://old.example.com");
      await expect(
        registry.connect(operator2).updateEndpoint("relay1.meshsearch.eth", "https://attack.example.com")
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Activation/Deactivation", function () {
    it("should allow operator to deactivate", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await registry.connect(operator1).deactivateNode("relay1.meshsearch.eth");

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.active).to.be.false;
    });

    it("should allow owner to deactivate", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await registry.connect(owner).deactivateNode("relay1.meshsearch.eth");

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.active).to.be.false;
    });

    it("should allow operator to reactivate", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await registry.connect(operator1).deactivateNode("relay1.meshsearch.eth");
      await registry.connect(operator1).activateNode("relay1.meshsearch.eth");

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.active).to.be.true;
    });
  });

  describe("Reputation", function () {
    it("should increase reputation on success", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await registry.connect(owner).updateReputation("relay1.meshsearch.eth", true);

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.reputationScore).to.equal(51);
    });

    it("should decrease reputation on failure", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await registry.connect(owner).updateReputation("relay1.meshsearch.eth", false);

      const node = await registry.getNode("relay1.meshsearch.eth");
      expect(node.reputationScore).to.equal(45); // 50 - 5
    });

    it("should only allow owner to update reputation", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://relay1.example.com");
      await expect(
        registry.connect(operator1).updateReputation("relay1.meshsearch.eth", true)
      ).to.be.reverted;
    });
  });

  describe("Top Nodes", function () {
    it("should return top nodes by reputation", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://r1.example.com");
      await registry.connect(operator2).registerNode("relay2.meshsearch.eth", "https://r2.example.com");
      await registry.connect(operator3).registerNode("relay3.meshsearch.eth", "https://r3.example.com");

      // Boost relay2 reputation
      await registry.connect(owner).updateReputation("relay2.meshsearch.eth", true);
      await registry.connect(owner).updateReputation("relay2.meshsearch.eth", true);

      const topNodes = await registry.getTopNodes(3);
      expect(topNodes.length).to.equal(3);
      expect(topNodes[0]).to.equal("relay2.meshsearch.eth"); // highest rep
    });

    it("should handle requesting more than available", async function () {
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://r1.example.com");
      const topNodes = await registry.getTopNodes(5);
      expect(topNodes.length).to.equal(1);
    });
  });

  describe("Node Count", function () {
    it("should track node count", async function () {
      expect(await registry.nodeCount()).to.equal(0);
      await registry.connect(operator1).registerNode("relay1.meshsearch.eth", "https://r1.example.com");
      expect(await registry.nodeCount()).to.equal(1);
      await registry.connect(operator2).registerNode("relay2.meshsearch.eth", "https://r2.example.com");
      expect(await registry.nodeCount()).to.equal(2);
    });
  });
});
