import { BaseError, createPublicClient, createWalletClient, custom, isAddressEqual } from "viem";
import { aevumTransport } from "./aevum-rpc.mjs";
import { aevum, testToken } from "./chain.mjs";
import { confirm, invoiceAbi, openedInvoiceId, readInvoice, showAmount, toAmount, tokenAbi } from "./invoice.mjs";
import deployment from "./deployment.json";
import settledDemo from "./settled-demo.json";
import "./style.css";

const element = (id) => document.getElementById(id);
const provider = window.ethereum;
const client = createPublicClient({ chain: aevum, transport: aevumTransport() });
const contract = deployment.address;
const checkout = element("checkout");
const history = element("history");
const status = element("status");
let invoiceId;
let invoice;
let account;
let busy = false;

function report(message, error = false) {
  status.hidden = !message;
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

function shorten(address) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function setAccount(address) {
  account = address;
  element("connect").textContent = address ? shorten(address) : "Connect wallet";
}

async function connect() {
  if (!provider) throw new Error("Open this checkout in a browser with an EVM wallet.");
  const [address] = await provider.request({ method: "eth_requestAccounts" });
  if (!address) throw new Error("Connect a wallet first.");

  const chainId = "0x" + aevum.id.toString(16);
  if (await provider.request({ method: "eth_chainId" }) !== chainId) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      const wallet = createWalletClient({ chain: aevum, transport: custom(provider) });
      await wallet.addChain({ chain: aevum });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }
  }
  setAccount(address);
  return createWalletClient({ account, chain: aevum, transport: custom(provider) });
}

function shareUrl() {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invoice", invoiceId);
  return url;
}

function renderReceipts(events, emptyMessage = "Confirmed installments will appear here.") {
  const empty = element("empty-receipt");
  empty.textContent = emptyMessage;
  empty.hidden = events.length > 0;
  element("receipts").replaceChildren(...events.toReversed().map(({ args, transactionHash }) => {
    const row = document.createElement("li");
    const amount = document.createElement("strong");
    const link = document.createElement("a");
    amount.textContent = showAmount(args.amount) + " tUSD8";
    link.textContent = "Paid by " + shorten(args.payer);
    link.href = new URL("/tx/" + transactionHash, aevum.blockExplorers.default.url);
    row.append(amount, link);
    return row;
  }));
}

function renderInvoice(details) {
  invoice = details;
  element("create").hidden = true;
  checkout.hidden = false;
  history.hidden = false;
  element("title").textContent = "Invoice " + invoiceId;
  element("intro").textContent = "Check the payee before sending a testnet payment.";
  element("invoice-state").textContent = invoice.remaining === 0n ? "Paid in full" : invoice.paid > 0n ? "Partially paid" : "Open";
  element("remaining").textContent = showAmount(invoice.remaining) + " tUSD8";
  element("total").textContent = showAmount(invoice.total) + " tUSD8";
  element("recipient").textContent = invoice.payee;
  element("payment").hidden = invoice.remaining === 0n;
}

function demoReceipt() {
  if (settledDemo.chainId !== aevum.id || !isAddressEqual(contract, settledDemo.contract)
      || invoiceId !== BigInt(settledDemo.invoiceId)) return;
  const events = settledDemo.payments.map(({ payer, amount, hash }) => ({
    args: { payer, amount: BigInt(amount) },
    transactionHash: hash,
  }));
  const total = events.reduce((sum, event) => sum + event.args.amount, 0n);
  return { details: { payee: settledDemo.merchant, total, paid: total, remaining: 0n }, events };
}

function renderRecordedReceipt(events) {
  renderReceipts(events);
  report("Live Aevum data is temporarily unavailable. Showing the recorded settlement receipt.");
}

async function loadInvoice() {
  const demo = demoReceipt();
  let live;
  try {
    live = await readInvoice(client, contract, invoiceId);
  } catch (error) {
    if (!demo || !(error instanceof BaseError)) throw error;
    renderInvoice(demo.details);
    renderRecordedReceipt(demo.events);
    return;
  }

  renderInvoice(live);
  try {
    const events = await client.getContractEvents({
      address: contract,
      abi: invoiceAbi,
      eventName: "PaymentApplied",
      args: { invoiceId },
      fromBlock: live.openedAtBlock,
    });
    renderReceipts(events);
  } catch {
    if (demo && live.remaining === 0n && live.total === demo.details.total
        && isAddressEqual(live.payee, demo.details.payee)) {
      renderRecordedReceipt(demo.events);
    } else {
      renderReceipts([], "The receipt is temporarily unavailable. Refresh to try again.");
    }
  }
}

async function action(work) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    report("");
    await work();
  } catch (error) {
    const cause = error.walk?.((entry) => entry.data?.errorName);
    report(cause?.data?.errorName ?? error.shortMessage ?? error.message ?? "The action failed.", true);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    busy = false;
  }
}

async function openInvoice(total) {
  const wallet = await connect();
  report("Confirm the invoice in your wallet.");
  const hash = await wallet.writeContract({ address: contract, abi: invoiceAbi, functionName: "open", args: [total] });
  invoiceId = openedInvoiceId(await confirm(client, hash), contract);
  globalThis.history.replaceState({}, "", shareUrl());
  await loadInvoice();
  report("Invoice created. Copy the checkout link to share it.");
}

async function pay(amount) {
  const displayedPayee = invoice.payee;
  const latest = await readInvoice(client, contract, invoiceId);
  if (displayedPayee !== latest.payee) throw new Error("The payee changed. Refresh and confirm the wallet again.");
  if (amount > latest.remaining) {
    await loadInvoice();
    throw new Error("The invoice balance changed. Enter an installment within the remaining balance.");
  }

  const wallet = await connect();
  if (account.toLowerCase() === latest.payee.toLowerCase()) {
    throw new Error("Use a different wallet from the merchant wallet.");
  }
  const allowance = await client.readContract({
    address: testToken, abi: tokenAbi, functionName: "allowance", args: [account, contract],
  });
  if (allowance < amount) {
    report("Approve this installment amount in your wallet.");
    const approval = await wallet.writeContract({
      address: testToken, abi: tokenAbi, functionName: "approve", args: [contract, amount],
    });
    await confirm(client, approval);
  }

  const args = [invoiceId, latest.payee, amount];
  await client.simulateContract({ account, address: contract, abi: invoiceAbi, functionName: "pay", args });
  report("Confirm the payment in your wallet.");
  const payment = await wallet.writeContract({ address: contract, abi: invoiceAbi, functionName: "pay", args });
  await confirm(client, payment);
  element("confirm-payee").checked = false;
  element("pay-amount").value = "";
  await loadInvoice();
  report("Installment confirmed.");
}

element("connect").addEventListener("click", () => action(async () => { await connect(); }));
provider?.on?.("accountsChanged", ([address]) => setAccount(address));
element("new-invoice").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(() => openInvoice(toAmount(element("invoice-total").value.trim())));
});
element("payment").addEventListener("submit", (event) => {
  event.preventDefault();
  void action(() => pay(toAmount(element("pay-amount").value.trim())));
});
element("share").addEventListener("click", () => action(async () => {
  await navigator.clipboard.writeText(shareUrl().href);
  report("Checkout link copied.");
}));
element("refresh").addEventListener("click", () => action(loadInvoice));
element("pay-balance").addEventListener("click", () => {
  element("pay-amount").value = showAmount(invoice.remaining);
});

const requested = new URLSearchParams(location.search).get("invoice");
if (!contract || deployment.chainId !== aevum.id) {
  report("Deploy the invoice contract on Aevum to enable checkout.");
} else if (requested) {
  void action(async () => {
    if (!/^[1-9][0-9]*$/.test(requested)) throw new Error("This invoice link is invalid.");
    invoiceId = BigInt(requested);
    await loadInvoice();
  });
} else {
  element("create").hidden = false;
}
