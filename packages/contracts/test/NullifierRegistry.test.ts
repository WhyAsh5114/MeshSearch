import { expect } from "chai";
import { ethers } from "hardhat";
import { NullifierRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("NullifierRegistry", function () {
  let registry: NullifierRegistry;
  let owner: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NullifierRegistry");
    registry = (await Factory.deploy()) as unknown as NullifierRegistry;
  });

  describe("Nullifier Usage", function () {
    it("should store a new nullifier", async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier-1"));
      const result = await registry.useNullifier.staticCall(nullifier);
      expect(result).to.be.true;

      await registry.useNullifier(nullifier);
      expect(await registry.isNullifierUsed(nullifier)).to.be.true;
    });

    it("should reject a reused nullifier", async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier-1"));
      await registry.useNullifier(nullifier);

      const result = await registry.useNullifier.staticCall(nullifier);
      expect(result).to.be.false;
    });

    it("should emit NullifierUsed event", async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier-1"));
      await expect(registry.useNullifier(nullifier))
        .to.emit(registry, "NullifierUsed")
        .withArgs(nullifier);
    });

    it("should track nullifier count", async function () {
      expect(await registry.nullifierCount()).to.equal(0);

      const n1 = ethers.keccak256(ethers.toUtf8Bytes("nullifier-1"));
      const n2 = ethers.keccak256(ethers.toUtf8Bytes("nullifier-2"));

      await registry.useNullifier(n1);
      expect(await registry.nullifierCount()).to.equal(1);

      await registry.useNullifier(n2);
      expect(await registry.nullifierCount()).to.equal(2);
    });

    it("should only allow owner to use nullifiers", async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test-nullifier-1"));
      await expect(registry.connect(other).useNullifier(nullifier)).to.be.reverted;
    });
  });

  describe("Result Hash Storage", function () {
    it("should store and verify result hash", async function () {
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("query-commitment"));
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("search-results"));

      await registry.storeResultHash(commitment, resultHash);

      expect(await registry.verifyResultHash(commitment, resultHash)).to.be.true;
      expect(await registry.verifyResultHash(commitment, ethers.ZeroHash)).to.be.false;
    });

    it("should emit ResultHashStored event", async function () {
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("query-commitment"));
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("search-results"));

      await expect(registry.storeResultHash(commitment, resultHash))
        .to.emit(registry, "ResultHashStored")
        .withArgs(commitment, resultHash);
    });

    it("should only allow owner to store result hashes", async function () {
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("query-commitment"));
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("search-results"));

      await expect(
        registry.connect(other).storeResultHash(commitment, resultHash)
      ).to.be.reverted;
    });
  });
});
