import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, isAddressEqual } from "viem";
import { aevumTransport } from "../src/aevum-rpc.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { aevum, testToken } from "../src/chain.mjs";
import { confirm, invoiceAbi, openedInvoiceId, readInvoice, toAmount, tokenAbi } from "../src/invoice.mjs";

const roles = ["AEVM_DEPLOYER_KEY", "AEVM_FIRST_PAYER_KEY", "AEVM_SECOND_PAYER_KEY"];
const accounts = roles.map((role) => {
  if (!process.env[role]) throw new Error("A testnet private key is required for each role.");
  return privateKeyToAccount(process.env[role]);
});
if (new Set(accounts.map(({ address }) => address)).size !== 3) {
  throw new Error("Use three distinct testnet wallets.");
}
const transport = aevumTransport();
const client = createPublicClient({ chain: aevum, transport });
if (await client.getChainId() !== aevum.id) throw new Error("Unexpected chain. Demo paused.");

const stablecoinBalance = (owner) => client.readContract({
  address: testToken, abi: tokenAbi, functionName: "balanceOf", args: [owner],
});
const amounts = [toAmount("0.4"), toAmount("0.6")];
const balances = await Promise.all(accounts.map(async ({ address }, index) => {
  const [gas, token] = await Promise.all([
    client.getBalance({ address }), stablecoinBalance(address),
  ]);
  return {
    wallet: address,
    gas: gas.toString(),
    token: token.toString(),
    hasFunds: gas > 0n && (index === 0 || token >= amounts[index - 1]),
  };
}));
console.log(JSON.stringify(balances, null, 2));
if (process.argv.includes("--balances-only")) process.exit(balances.every(({ hasFunds }) => hasFunds) ? 0 : 1);
if (balances.some(({ hasFunds }) => !hasFunds)) throw new Error("Fund the demo wallets with testnet tQDAY and tUSD8.");

const deployment = JSON.parse(await readFile(new URL("../src/deployment.json", import.meta.url), "utf8"));
const address = deployment.address;
if (deployment.chainId !== aevum.id || !address) throw new Error("Deploy on Aevum before running the live flow.");
const token = await client.readContract({ address, abi: invoiceAbi, functionName: "token" });
if (!isAddressEqual(token, testToken)) throw new Error("Unexpected settlement token.");

const [merchant, first, second] = accounts.map((account) => createWalletClient({ account, chain: aevum, transport }));
const payee = merchant.account.address;
const priorBalance = await stablecoinBalance(payee);
const total = amounts[0] + amounts[1];
const openTx = await merchant.writeContract({ address, abi: invoiceAbi, functionName: "open", args: [total] });
const id = openedInvoiceId(await confirm(client, openTx), address);

const evidence = {
  chainId: aevum.id, token: testToken, contract: address, merchant: payee,
  invoiceId: id.toString(), openTx, payments: [],
};
const output = new URL("../.local/aevum-evidence.json", import.meta.url);
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
await save();

for (const [index, wallet] of [first, second].entries()) {
  const amount = amounts[index];
  const approval = await wallet.writeContract({
    address: testToken, abi: tokenAbi, functionName: "approve", args: [address, amount],
  });
  await confirm(client, approval);
  const hash = await wallet.writeContract({ address, abi: invoiceAbi, functionName: "pay", args: [id, payee, amount] });
  await confirm(client, hash);
  const { remaining } = await readInvoice(client, address, id);
  evidence.payments.push({ payer: wallet.account.address, hash, amount: amount.toString(), remaining: remaining.toString() });
  await save();
  assert.equal(remaining, index === 0 ? amounts[1] : 0n);
}
assert.equal(await stablecoinBalance(payee) - priorBalance, total);
assert.equal(await stablecoinBalance(address), 0n);
console.log(JSON.stringify(evidence, null, 2));
