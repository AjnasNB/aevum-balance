import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

export async function compile(path, name) {
  const filename = basename(fileURLToPath(path));
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { [filename]: { content: await readFile(path, "utf8") } },
    settings: {
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  })));
  const errors = (output.errors ?? []).filter((item) => item.severity === "error");
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  const result = output.contracts[filename][name];
  return { abi: result.abi, bytecode: "0x" + result.evm.bytecode.object };
}

export const invoiceContract = new URL("../contracts/AevumInvoices.sol", import.meta.url);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const artifact = await compile(invoiceContract, "AevumInvoices");
  const target = new URL("../build/AevumInvoices.json", import.meta.url);
  await mkdir(dirname(fileURLToPath(target)), { recursive: true });
  await writeFile(target, JSON.stringify(artifact, null, 2) + "\n");
  console.log("Compiled AevumInvoices for the Paris EVM");
}
