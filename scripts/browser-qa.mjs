import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import ganache from "ganache";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { createPublicClient, createWalletClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevum, testToken } from "../src/chain.mjs";
import { confirm } from "../src/invoice.mjs";
import { compile, invoiceContract } from "./compile.mjs";

const provider = ganache.provider({
  logging: { quiet: true },
  chain: { chainId: aevum.id },
  wallet: { deterministic: true },
});
const accounts = Object.values(provider.getInitialAccounts()).slice(0, 3).map(
  ({ secretKey }) => privateKeyToAccount(secretKey),
);
const publicClient = createPublicClient({ chain: aevum, transport: custom(provider), pollingInterval: 30 });
const merchant = createWalletClient({ account: accounts[0], chain: aevum, transport: custom(provider) });
const fixture = await compile(new URL("../test/FixtureToken.sol", import.meta.url), "FixtureToken");
const invoice = await compile(invoiceContract, "AevumInvoices");
const token = (await confirm(publicClient, await merchant.deployContract(fixture))).contractAddress;
const address = (await confirm(publicClient, await merchant.deployContract({
  ...invoice, args: [token],
}))).contractAddress;
for (const { address: payer } of accounts.slice(1)) {
  const hash = await merchant.writeContract({
    address: token, abi: fixture.abi, functionName: "mint", args: [payer, 1_000_000n],
  });
  await confirm(publicClient, hash);
}

async function fixtureRpc(method, args = []) {
  const [first, ...rest] = args;
  const normalized = first?.to?.toLowerCase() === testToken.toLowerCase()
    ? [{ ...first, to: token }, ...rest]
    : args;
  if (method === "eth_sendTransaction" && !normalized[0].gas) {
    const [transaction] = normalized;
    const estimate = await provider.request({ method: "eth_estimateGas", params: [transaction] });
    const gas = "0x" + (BigInt(estimate) * 12n / 10n).toString(16);
    return provider.request({ method, params: [{ ...transaction, gas }] });
  }
  return provider.request({ method, params: normalized });
}

const server = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const video = process.env.DEMO_CAPTURE === "1";
const holdFrame = () => video ? delay(2_000) : Promise.resolve();
if (video) await mkdir(".local/recording", { recursive: true });
const context = await browser.newContext({
  viewport: { width: 1200, height: 840 },
  ...(video ? { recordVideo: { dir: ".local/recording", size: { width: 1200, height: 840 } } } : {}),
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
let selected = 0;
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await context.route("https://rpc-test.qday.info/**", async (route) => {
  const request = route.request().postDataJSON();
  try {
    const result = await fixtureRpc(request.method, request.params);
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  } catch (error) {
    await route.fulfill({
      json: { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message, data: error.data } },
    });
  }
});
await context.route(/\/src\/deployment\.json\?import/, (route) => route.fulfill({
  contentType: "text/javascript",
  body: "export default " + JSON.stringify({ address, chainId: aevum.id }),
}));
await page.exposeFunction("checkoutFixtureWallet", ({ method, params }) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [accounts[selected].address];
  return fixtureRpc(method, params);
});
await page.addInitScript(() => {
  window.ethereum = { request: (request) => window.checkoutFixtureWallet(request), on() {} };
  const markFixture = () => {
    const mark = document.querySelector(".network");
    if (mark) mark.textContent = "Local EVM rehearsal · fixture token";
  };
  document.addEventListener("DOMContentLoaded", markFixture);
});

try {
  await page.goto(url);
  await holdFrame();
  await page.getByLabel("Invoice total in tUSD8").fill("1");
  await page.getByRole("button", { name: "Create checkout link" }).click();
  await page.getByText("Invoice created. Copy the checkout link to share it.").waitFor();
  const share = page.url();
  assert.match(share, /[?]invoice=1$/);
  await holdFrame();

  for (const [walletIndex, amount, expectedStatus] of [
    [1, "0.4", "Partially paid"],
    [2, "0.6", "Paid in full"],
  ]) {
    selected = walletIndex;
    await page.goto(share);
    await page.getByLabel("Installment in tUSD8").fill(amount);
    await page.getByLabel("I confirmed the merchant wallet above.").check();
    await page.getByRole("button", { name: "Pay installment" }).click();
    await page.getByText(expectedStatus, { exact: true }).waitFor();
    await page.getByText("Installment confirmed.").waitFor();
    await holdFrame();
  }
  await page.getByRole("button", { name: "Pay installment" }).waitFor({ state: "hidden" });
  assert.equal(await page.locator("#receipts li").count(), 2);
  assert.equal(await page.locator("#remaining").textContent(), "0 tUSD8");
  assert.deepEqual(pageErrors, []);
  if (video) {
    await page.screenshot({ path: ".local/recording/settled-invoice.png" });
    await page.getByText("Paid in full", { exact: true }).waitFor();
  }
  console.log("Browser verified a share link, two signed fixture payments, zero remaining and two receipt links.");

  const outage = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await outage.route(aevum.rpcUrls.default.http[0] + "/**", (route) => route.abort());
    await outage.route(aevum.blockExplorers.default.url + "/**", (route) => route.abort());
    const demoPage = await outage.newPage();
    await demoPage.goto(new URL("?invoice=1", url).href);
    await demoPage.getByText("Paid in full", { exact: true }).waitFor();
    await demoPage.getByText("Showing the recorded settlement receipt.", { exact: false }).waitFor();
    assert.equal(await demoPage.locator("#remaining").textContent(), "0 tUSD8");
    assert.equal(await demoPage.locator("#receipts li a").count(), 2);
    assert.equal(await demoPage.getByRole("button", { name: "Pay installment" }).isVisible(), false);
    assert.ok(await demoPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await demoPage.goto(new URL("?invoice=2", url).href);
    await demoPage.locator("#status[data-error]").waitFor();
    assert.equal(await demoPage.locator("#checkout").isVisible(), false);
    console.log("Browser verified the settled demo remains readable during an RPC outage, without exposing payment actions.");
  } finally {
    await outage.close();
  }
} catch (error) {
  console.error("Checkout status:", await page.locator("#status").textContent());
  throw error;
} finally {
  await context.close();
  if (video) await page.video().saveAs(".local/recording/local-checkout.webm");
  await browser.close();
  await server.close();
  await provider.disconnect().catch((error) => {
    if (error.code !== "EBUSY") throw error;
  });
}
