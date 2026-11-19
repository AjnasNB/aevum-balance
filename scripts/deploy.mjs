import { writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevum, testToken, decimals } from "../src/chain.mjs";
import { confirm, tokenAbi } from "../src/invoice.mjs";
import { compile, invoiceContract } from "./compile.mjs";

const { AEVM_DEPLOYER_KEY } = process.env;
if (!AEVM_DEPLOYER_KEY) throw new Error("Provide AEVM_DEPLOYER_KEY for a funded, testnet-only account.");

const account = privateKeyToAccount(AEVM_DEPLOYER_KEY);
const client = createPublicClient({ chain: aevum, transport: http() });
if (await client.getChainId() !== aevum.id) throw new Error("Unexpected chain. Deployment paused.");
if (await client.getBalance({ address: account.address }) === 0n) {
  throw new Error("This testnet address needs tQDAY gas from the official faucet.");
}

const [symbol, places] = await Promise.all([
  client.readContract({ address: testToken, abi: tokenAbi, functionName: "symbol" }),
  client.readContract({ address: testToken, abi: tokenAbi, functionName: "decimals" }),
]);
if (symbol !== "tUSD8" || places !== decimals) throw new Error("Unexpected test token.");

const { abi, bytecode } = await compile(invoiceContract, "AevumInvoices");
const wallet = createWalletClient({ account, chain: aevum, transport: http() });
const hash = await wallet.deployContract({ abi, bytecode, args: [testToken] });
const receipt = await confirm(client, hash);
if (!receipt.contractAddress) throw new Error("No deployed contract address in the transaction receipt.");

const deployment = { address: receipt.contractAddress, transaction: hash, chainId: aevum.id };
await writeFile(new URL("../src/deployment.json", import.meta.url), JSON.stringify(deployment, null, 2) + "\n");
console.log(JSON.stringify(deployment));
