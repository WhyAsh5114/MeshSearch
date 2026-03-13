import { expect } from "chai";
import { ethers } from "hardhat";
import { AccessControl } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AccessControl", function () {
  let access: AccessControl;
  let owner: HardhatEthersSigner;
  let verifier: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const SEARCH_PRICE = ethers.parseEther("0.001");

  beforeEach(async function () {
    [owner, verifier, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AccessControl");
    access = (await Factory.deploy(SEARCH_PRICE)) as unknown as AccessControl;
  });

  describe("Subscriptions", function () {
    it("should set and check subscription", async function () {
      await access.setSubscription("user.eth", 2); // Premium
      expect(await access.hasSubscription("user.eth")).to.be.true;
      expect(await access.getTier("user.eth")).to.equal(2);
    });

    it("should return false for no subscription", async function () {
      expect(await access.hasSubscription("unknown.eth")).to.be.false;
    });

    it("should emit SubscriptionUpdated event", async function () {
      await expect(access.setSubscription("user.eth", 1))
        .to.emit(access, "SubscriptionUpdated")
        .withArgs("user.eth", 1);
    });

    it("should only allow owner to set subscriptions", async function () {
      await expect(
        access.connect(other).setSubscription("user.eth", 1)
      ).to.be.reverted;
    });
  });

  describe("Verifiers", function () {
    it("should authorize and check verifier", async function () {
      await access.setVerifier(verifier.address, true);
      expect(await access.isVerifier(verifier.address)).to.be.true;
    });

    it("should revoke verifier", async function () {
      await access.setVerifier(verifier.address, true);
      await access.setVerifier(verifier.address, false);
      expect(await access.isVerifier(verifier.address)).to.be.false;
    });

    it("should emit VerifierUpdated event", async function () {
      await expect(access.setVerifier(verifier.address, true))
        .to.emit(access, "VerifierUpdated")
        .withArgs(verifier.address, true);
    });
  });

  describe("Search Price", function () {
    it("should return initial search price", async function () {
      expect(await access.searchPrice()).to.equal(SEARCH_PRICE);
    });

    it("should allow owner to update price", async function () {
      const newPrice = ethers.parseEther("0.002");
      await access.setSearchPrice(newPrice);
      expect(await access.searchPrice()).to.equal(newPrice);
    });

    it("should emit SearchPriceUpdated event", async function () {
      const newPrice = ethers.parseEther("0.005");
      await expect(access.setSearchPrice(newPrice))
        .to.emit(access, "SearchPriceUpdated")
        .withArgs(newPrice);
    });
  });
});
