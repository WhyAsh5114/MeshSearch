import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // Deploy NodeRegistry
  const NodeRegistry = await ethers.getContractFactory("NodeRegistry");
  const nodeRegistry = await NodeRegistry.deploy();
  await nodeRegistry.waitForDeployment();
  console.log("NodeRegistry deployed to:", await nodeRegistry.getAddress());

  // Deploy NullifierRegistry
  const NullifierRegistry = await ethers.getContractFactory("NullifierRegistry");
  const nullifierRegistry = await NullifierRegistry.deploy();
  await nullifierRegistry.waitForDeployment();
  console.log("NullifierRegistry deployed to:", await nullifierRegistry.getAddress());

  // Deploy PaymentSplitter (protocol recipient = deployer for now)
  const PaymentSplitter = await ethers.getContractFactory("PaymentSplitter");
  const paymentSplitter = await PaymentSplitter.deploy(deployer.address);
  await paymentSplitter.waitForDeployment();
  console.log("PaymentSplitter deployed to:", await paymentSplitter.getAddress());

  // Deploy AccessControl (search price = 0.001 ETH)
  const AccessControl = await ethers.getContractFactory("AccessControl");
  const searchPrice = ethers.parseEther("0.001");
  const accessControl = await AccessControl.deploy(searchPrice);
  await accessControl.waitForDeployment();
  console.log("AccessControl deployed to:", await accessControl.getAddress());

  // Output summary
  const addresses = {
    nodeRegistry: await nodeRegistry.getAddress(),
    nullifierRegistry: await nullifierRegistry.getAddress(),
    paymentSplitter: await paymentSplitter.getAddress(),
    accessControl: await accessControl.getAddress(),
  };

  console.log("\n--- Deployment Summary ---");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
