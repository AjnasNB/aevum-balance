import { custom } from "viem";
import { aevum } from "./chain.mjs";

const primary = aevum.rpcUrls.default.http[0];
const explorerOrigin = aevum.blockExplorers.default.url;
const explorer = new URL("/api/eth-rpc", explorerOrigin).href;
const chainConfig = new URL("/assets/envs.js", explorerOrigin).href;
const expectedChain = "0x" + aevum.id.toString(16);

async function fetchTrusted(fetcher, url, options) {
  const response = await fetcher(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("QDay RPC HTTP " + response.status);
  return response;
}

async function call(fetcher, url, method, params = []) {
  const response = await fetchTrusted(fetcher, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) {
    if (url === explorer && method === "eth_getBalance" && body.error === "Balance not found") {
      return "0x0";
    }
    if (typeof body.error === "string") {
      throw Object.assign(new Error(body.error), { code: -32000 });
    }
    const { message, code, data } = body.error;
    throw Object.assign(new Error(message), { code, data });
  }
  if (!Object.hasOwn(body, "result")) throw new Error("Malformed QDay RPC response.");
  return body.result;
}

function validateChain(id) {
  if (typeof id !== "string" || !/^0x[0-9a-f]+$/i.test(id) || BigInt(id) !== BigInt(aevum.id)) {
    throw new Error("QDay RPC chain ID does not identify Aevum Testnet.");
  }
}

async function chooseEndpoint(fetcher) {
  let primaryChain;
  try {
    primaryChain = await call(fetcher, primary, "eth_chainId");
  } catch {
    const explorerChain = await call(fetcher, explorer, "eth_chainId");
    if (explorerChain !== null) {
      validateChain(explorerChain);
    } else {
      // This Blockscout instance publishes its chain ID in the public frontend config.
      const response = await fetchTrusted(fetcher, chainConfig);
      const config = await response.text();
      const match = config.match(/^\s*NEXT_PUBLIC_NETWORK_ID:\s*"([0-9]+)"\s*,?\s*$/m);
      if (!match || Number(match[1]) !== aevum.id) {
        throw new Error("The official QDay explorer did not confirm Aevum chain 44005.");
      }
    }
    return explorer;
  }
  validateChain(primaryChain);
  return primary;
}

export function aevumTransport(fetcher = globalThis.fetch) {
  let endpoint;

  return custom({
    async request({ method, params = [] }) {
      endpoint ??= chooseEndpoint(fetcher).catch((error) => {
        endpoint = undefined;
        throw error;
      });
      const url = await endpoint;
      if (method === "eth_chainId") return expectedChain;
      // Blockscout requires an explicit block for gas estimation.
      const args = url === explorer && method === "eth_estimateGas" && params.length === 1
        ? [...params, "latest"]
        : params;
      return call(fetcher, url, method, args);
    },
  }, { retryCount: 0 });
}
