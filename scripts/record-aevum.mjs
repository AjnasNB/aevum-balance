import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { setTimeout as hold } from "node:timers/promises";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { createPublicClient, erc20Abi, isAddressEqual, isHash, parseEventLogs } from "viem";
import { aevumTransport } from "../src/aevum-rpc.mjs";
import { aevum, testToken } from "../src/chain.mjs";
import { invoiceAbi, openedInvoiceId, readInvoice, toAmount } from "../src/invoice.mjs";

async function verifyDemo() {
  const [deployment, evidence] = await Promise.all([
    readFile(new URL("../src/deployment.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.local/aevum-evidence.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(deployment.chainId, aevum.id);
  assert.equal(evidence.chainId, aevum.id);
  assert.ok(isAddressEqual(evidence.contract, deployment.address));
  assert.ok(isAddressEqual(evidence.token, testToken));
  assert.equal(evidence.payments.length, 2);
  assert.ok(!isAddressEqual(evidence.payments[0].payer, evidence.payments[1].payer));
  assert.equal(new Set([evidence.openTx, ...evidence.payments.map(({ hash }) => hash)]).size, 3);

  const client = createPublicClient({ chain: aevum, transport: aevumTransport() });
  assert.equal(await client.getChainId(), aevum.id);
  const receipt = (hash) => {
    assert.ok(isHash(hash));
    return client.getTransactionReceipt({ hash });
  };
  const [opened, first, second] = await Promise.all([
    receipt(evidence.openTx),
    ...evidence.payments.map(({ hash }) => receipt(hash)),
  ]);
  const contract = evidence.contract;
  const invoiceId = BigInt(evidence.invoiceId);
  assert.equal(opened.status, "success");
  assert.ok(isAddressEqual(opened.from, evidence.merchant));
  assert.equal(openedInvoiceId(opened, contract), invoiceId);

  const amounts = [toAmount("0.4"), toAmount("0.6")];
  [first, second].forEach((paid, index) => {
    assert.equal(paid.status, "success");
    assert.ok(isAddressEqual(paid.from, evidence.payments[index].payer));
    assert.ok(!isAddressEqual(paid.from, evidence.merchant));
    const [payment] = parseEventLogs({
      abi: invoiceAbi,
      eventName: "PaymentApplied",
      logs: paid.logs.filter((log) => isAddressEqual(log.address, contract)),
    });
    assert.ok(payment);
    assert.equal(payment.args.invoiceId, invoiceId);
    assert.ok(isAddressEqual(payment.args.payer, paid.from));
    assert.equal(payment.args.amount, amounts[index]);
    assert.equal(payment.args.remaining, index === 0 ? amounts[1] : 0n);
    const transfers = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: paid.logs.filter((log) => isAddressEqual(log.address, testToken)),
    });
    assert.ok(transfers.some(({ args }) => (
      isAddressEqual(args.from, paid.from)
      && isAddressEqual(args.to, evidence.merchant)
      && args.value === amounts[index]
    )), "The receipt must include the actual tUSD8 transfer.");
  });

  const invoice = await readInvoice(client, contract, invoiceId);
  assert.ok(isAddressEqual(invoice.payee, evidence.merchant));
  assert.equal(invoice.total, amounts[0] + amounts[1]);
  assert.equal(invoice.remaining, 0n);
  return evidence;
}

const evidence = await verifyDemo().catch((error) => {
  if (error.code === "ENOENT") {
    throw new Error("Run the live Aevum payment flow before recording its receipts.");
  }
  throw error;
});
const output = ".local/recording";
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();

let browser;
try {
  browser = await chromium.launch();
  const size = { width: 1366, height: 900 };
  const context = await browser.newContext({
    viewport: size,
    recordVideo: { dir: output, size },
  });
  const page = await context.newPage();
  await page.goto(new URL("?invoice=" + evidence.invoiceId, server.resolvedUrls.local[0]).href);
  await page.getByText("Paid in full", { exact: true }).waitFor();
  await page.locator("#receipts li").nth(1).waitFor();
  assert.equal(await page.locator("#receipts li").count(), 2);
  assert.equal(await page.locator("#remaining").textContent(), "0 tUSD8");
  await page.locator("#history").scrollIntoViewIfNeeded();
  await hold(5_000);

  const explorer = aevum.blockExplorers.default.url;
  for (const { hash } of evidence.payments) {
    const url = new URL("/tx/" + hash, explorer);
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
    assert.ok(response?.ok(), "The transaction explorer page failed to load.");
    await page.getByText(hash, { exact: true }).first().waitFor({ timeout: 30_000 });
    await hold(4_000);
  }

  await context.close();
  const file = output + "/aevum-live.webm";
  await page.video().saveAs(file);
  console.log("Recorded both verified Aevum payments in " + file);
} finally {
  await browser?.close();
  await server.close();
}
