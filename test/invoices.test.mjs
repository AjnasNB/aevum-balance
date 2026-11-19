import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, decodeErrorResult, defineChain, encodeFunctionData, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevumTransport } from "../src/aevum-rpc.mjs";
import { aevum } from "../src/chain.mjs";
import { compile, invoiceContract } from "../scripts/compile.mjs";
import { confirm, invoiceAbi, openedInvoiceId, readInvoice, showAmount, toAmount, tokenAbi } from "../src/invoice.mjs";

const chain = defineChain({
  id: aevum.id, name: "Local EVM",
  nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
});
const provider = ganache.provider({
  logging: { quiet: true }, chain: { chainId: chain.id }, wallet: { deterministic: true },
});
const clients = Object.values(provider.getInitialAccounts()).slice(0, 3).map(({ secretKey }) => {
  const account = privateKeyToAccount(secretKey);
  return createWalletClient({ account, chain, transport: custom(provider) });
});
const [merchant, first, second] = clients;
const payee = merchant.account.address;
const publicClient = createPublicClient({ chain, transport: custom(provider), pollingInterval: 40 });
let token, invoices;

async function write(wallet, address, abi, functionName, args) {
  return confirm(publicClient, await wallet.writeContract({ address, abi, functionName, args }));
}

async function deploy(compiled, args = []) {
  const hash = await merchant.deployContract({ ...compiled, args });
  return getAddress((await confirm(publicClient, hash)).contractAddress);
}

async function open(amount = 10_000_000n) {
  const receipt = await write(merchant, invoices, invoiceAbi, "open", [amount]);
  return openedInvoiceId(receipt, invoices);
}

const rejectPay = (wallet, args, expectedError) => assert.rejects(
  provider.request({
    method: "eth_call",
    params: [{
      from: wallet.account.address,
      to: invoices,
      data: encodeFunctionData({ abi: invoiceAbi, functionName: "pay", args }),
    }, "latest"],
  }),
  (error) => decodeErrorResult({ abi: invoiceAbi, data: error.data }).errorName === expectedError,
);

const balance = (owner) => publicClient.readContract({
  address: token, abi: tokenAbi, functionName: "balanceOf", args: [owner],
});

const approve = (payer, amount) => write(payer, token, tokenAbi, "approve", [invoices, amount]);

before(async () => {
  const mock = await compile(new URL("FixtureToken.sol", import.meta.url), "FixtureToken");
  const contract = await compile(invoiceContract, "AevumInvoices");
  token = await deploy(mock);
  invoices = await deploy(contract, [token]);
  for (const payer of [first, second]) {
    await write(merchant, token, mock.abi, "mint", [payer.account.address, 20_000_000n]);
  }
});
after(async () => { await provider.disconnect(); });

test("two wallets settle one invoice and produce a linked receipt", async () => {
  assert.equal(await publicClient.readContract({ address: invoices, abi: invoiceAbi, functionName: "token" }), token);
  const id = await open();
  const initial = await readInvoice(publicClient, invoices, id);
  assert.equal(initial.payee, payee);
  assert.equal(initial.remaining, 10_000_000n);
  const beforePayment = await balance(payee);
  const firstAmount = 4_000_000n;
  const secondAmount = 6_000_000n;
  await approve(first, firstAmount);
  const firstTx = await write(first, invoices, invoiceAbi, "pay", [id, payee, firstAmount]);
  assert.equal((await readInvoice(publicClient, invoices, id)).remaining, secondAmount);
  assert.equal(await balance(payee) - beforePayment, firstAmount);

  await approve(second, secondAmount);
  const secondTx = await write(second, invoices, invoiceAbi, "pay", [id, payee, secondAmount]);
  assert.equal((await readInvoice(publicClient, invoices, id)).remaining, 0n);
  assert.equal(await balance(payee) - beforePayment, 10_000_000n);
  assert.equal(await balance(invoices), 0n);

  const logs = await publicClient.getContractEvents({
    address: invoices, abi: invoiceAbi, eventName: "PaymentApplied", args: { invoiceId: id },
    fromBlock: initial.openedAtBlock,
  });
  assert.deepEqual(logs.map((log) => [
    log.transactionHash, log.args.payer, log.args.amount, log.args.remaining,
  ]), [
    [firstTx.transactionHash, first.account.address, firstAmount, secondAmount],
    [secondTx.transactionHash, second.account.address, secondAmount, 0n],
  ]);
  await rejectPay(second, [id, payee, 1n], "ExceedsBalance");
});

test("rejects stale balances and wrong recipients without moving tokens", async () => {
  const id = await open(1_000_000n);
  const beforePayment = await balance(payee);
  await rejectPay(first, [id, second.account.address, 1n], "UnexpectedPayee");
  await rejectPay(merchant, [id, payee, 1n], "SelfPayment");
  await rejectPay(first, [id, payee, 0n], "InvalidAmount");
  await rejectPay(first, [id, payee, 1_000_001n], "ExceedsBalance");
  await rejectPay(first, [id, payee, 1n], "TransferFailed");
  await rejectPay(first, [0n, payee, 1n], "UnknownInvoice");
  assert.equal((await readInvoice(publicClient, invoices, id)).paid, 0n);
  assert.equal(await balance(payee), beforePayment);
});

test("round-trips six decimals without rounding or coercion", () => {
  assert.equal(toAmount("1.000001"), 1_000_001n);
  assert.equal(showAmount(1_000_001n), "1.000001");
  for (const bad of ["0", "1.0000001", "-1", "NaN", "1e2", ""]) {
    assert.throws(() => toAmount(bad));
  }
});

test("a local signer sends a single payment through the explorer fallback", async () => {
  const id = await open(1_000_000n);
  await approve(first, 1_000_000n);
  const calls = [];
  const primary = aevum.rpcUrls.default.http[0];
  const explorer = aevum.blockExplorers.default.url;
  const transport = aevumTransport(async (url, options) => {
    if (url === primary) throw new TypeError("Primary RPC is unreachable");
    if (url === explorer + "/assets/envs.js") {
      return new Response('NEXT_PUBLIC_NETWORK_ID: "44005",\n');
    }
    assert.equal(url, explorer + "/api/eth-rpc");
    const { method, params } = JSON.parse(options.body);
    calls.push(method);
    if (method === "eth_chainId") return Response.json({ result: null });
    if (method === "eth_estimateGas") assert.equal(params[1], "latest");
    try {
      const result = await provider.request({ method, params });
      return Response.json({ result });
    } catch (error) {
      return Response.json({ error: { code: error.code ?? -32000, message: error.message } });
    }
  });
  const wallet = createWalletClient({ account: first.account, chain: aevum, transport });
  const liveStyleClient = createPublicClient({ chain: aevum, transport, pollingInterval: 40 });

  const hash = await wallet.writeContract({
    address: invoices, abi: invoiceAbi, functionName: "pay", args: [id, payee, 1_000_000n],
  });
  const receipt = await confirm(liveStyleClient, hash);
  assert.equal(receipt.transactionHash, hash);
  assert.equal((await readInvoice(liveStyleClient, invoices, id)).remaining, 0n);
  assert.equal(calls.filter((method) => method === "eth_sendRawTransaction").length, 1);
});
