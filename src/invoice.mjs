import { formatUnits, parseAbi, parseEventLogs, parseUnits } from "viem";
import { decimals } from "./chain.mjs";

export const invoiceAbi = parseAbi([
  "function open(uint256 total) returns (uint256)",
  "function pay(uint256 id, address expectedPayee, uint256 amount)",
  "function invoices(uint256) view returns (address payee, uint256 total, uint256 paid, uint256 openedAtBlock)",
  "function token() view returns (address)",
  "error InvalidAmount()",
  "error UnknownInvoice()",
  "error UnexpectedPayee()",
  "error SelfPayment()",
  "error ExceedsBalance(uint256 remaining)",
  "error TransferFailed()",
  "event InvoiceOpened(uint256 indexed invoiceId, address indexed payee, uint256 total)",
  "event PaymentApplied(uint256 indexed invoiceId, address indexed payer, uint256 amount, uint256 remaining)",
]);

export const tokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export function toAmount(input) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(input)) {
    throw new Error("Enter a tUSD8 amount with up to six decimal places.");
  }
  const amount = parseUnits(input, decimals);
  if (amount === 0n) throw new Error("Enter an amount greater than zero.");
  return amount;
}

export const showAmount = (amount) => formatUnits(amount, decimals);

export async function readInvoice(client, address, id) {
  const [payee, total, paid, openedAtBlock] = await client.readContract({
    address, abi: invoiceAbi, functionName: "invoices", args: [id],
  });
  if (total === 0n) throw new Error("This invoice does not exist.");
  return { payee, total, paid, remaining: total - paid, openedAtBlock };
}

export function openedInvoiceId(receipt, address) {
  const logs = receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase());
  const [event] = parseEventLogs({ abi: invoiceAbi, eventName: "InvoiceOpened", logs });
  if (!event) throw new Error("The invoice could not be located in the transaction receipt.");
  return event.args.invoiceId;
}

export async function confirm(client, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
  return receipt;
}
