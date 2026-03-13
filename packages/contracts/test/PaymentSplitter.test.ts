import { expect } from "chai";
import { ethers } from "hardhat";
import { PaymentSplitter } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("PaymentSplitter", function () {
  let splitter: PaymentSplitter;
  let owner: HardhatEthersSigner;
  let protocol: HardhatEthersSigner;
  let relay1: HardhatEthersSigner;
  let relay2: HardhatEthersSigner;
  let relay3: HardhatEthersSigner;
  let payer: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, protocol, relay1, relay2, relay3, payer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PaymentSplitter");
    splitter = (await Factory.deploy(protocol.address)) as unknown as PaymentSplitter;
  });

  describe("Payment Splitting", function () {
    it("should split payment among relays and protocol", async function () {
      const amount = ethers.parseEther("1.0");

      await splitter.connect(payer).splitPayment(
        [relay1.address, relay2.address, relay3.address],
        { value: amount }
      );

      // Each gets 25% of 1 ETH = 0.25 ETH
      expect(await splitter.getBalance(relay1.address)).to.equal(ethers.parseEther("0.25"));
      expect(await splitter.getBalance(relay2.address)).to.equal(ethers.parseEther("0.25"));
      expect(await splitter.getBalance(relay3.address)).to.equal(ethers.parseEther("0.25"));
      expect(await splitter.getBalance(protocol.address)).to.equal(ethers.parseEther("0.25"));
    });

    it("should emit PaymentReceived event", async function () {
      const amount = ethers.parseEther("0.01");
      await expect(
        splitter.connect(payer).splitPayment(
          [relay1.address, relay2.address, relay3.address],
          { value: amount }
        )
      ).to.emit(splitter, "PaymentReceived");
    });

    it("should reject zero payment", async function () {
      await expect(
        splitter.connect(payer).splitPayment(
          [relay1.address, relay2.address, relay3.address],
          { value: 0 }
        )
      ).to.be.revertedWith("No payment");
    });

    it("should reject zero address relay", async function () {
      await expect(
        splitter.connect(payer).splitPayment(
          [relay1.address, ethers.ZeroAddress, relay3.address],
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Zero relay");
    });
  });

  describe("Withdrawal", function () {
    it("should allow balance withdrawal", async function () {
      const amount = ethers.parseEther("1.0");
      await splitter.connect(payer).splitPayment(
        [relay1.address, relay2.address, relay3.address],
        { value: amount }
      );

      const balBefore = await ethers.provider.getBalance(relay1.address);
      const tx = await splitter.connect(relay1).withdraw();
      const receipt = await tx.wait();
      const gasUsed: bigint = BigInt(receipt!.gasUsed.toString());
      const gasPrice: bigint = BigInt((receipt!.gasPrice ?? 0).toString());
      const gasCost: bigint = gasUsed * gasPrice;
      const balAfter = await ethers.provider.getBalance(relay1.address);

      expect(balAfter - balBefore + gasCost).to.equal(ethers.parseEther("0.25"));
      expect(await splitter.getBalance(relay1.address)).to.equal(0);
    });

    it("should reject withdrawal with no balance", async function () {
      await expect(splitter.connect(relay1).withdraw()).to.be.revertedWith("No balance");
    });
  });

  describe("Share Configuration", function () {
    it("should allow owner to update shares", async function () {
      await splitter.connect(owner).updateShares(3000, 3000, 3000, 1000);
      expect(await splitter.relay1Share()).to.equal(3000);
      expect(await splitter.protocolShare()).to.equal(1000);
    });

    it("should reject shares that don't total 10000", async function () {
      await expect(
        splitter.connect(owner).updateShares(3000, 3000, 3000, 2000)
      ).to.be.revertedWith("Must total 10000");
    });

    it("should reject non-owner share updates", async function () {
      await expect(
        splitter.connect(relay1).updateShares(3000, 3000, 3000, 1000)
      ).to.be.reverted;
    });
  });
});
