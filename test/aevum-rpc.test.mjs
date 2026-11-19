import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient } from "viem";
import { aevumTransport } from "../src/aevum-rpc.mjs";
import { aevum, testToken } from "../src/chain.mjs";

const endpoints = {
  primary: aevum.rpcUrls.default.http[0],
  explorer: aevum.blockExplorers.default.url + "/api/eth-rpc",
  config: aevum.blockExplorers.default.url + "/assets/envs.js",
};

function fakeRpc(handlers, calls) {
  return async (url, request) => {
    const payload = request.body && JSON.parse(request.body);
    calls.push({ url, payload });
    return handlers[url](payload);
  };
}

test("uses the checked primary RPC without touching the explorer", async () => {
  const calls = [];
  const client = createPublicClient({
    chain: aevum,
    transport: aevumTransport(fakeRpc({
      [endpoints.primary]: ({ method }) => Response.json({
        result: method === "eth_chainId" ? "0xabe5" : "0x10",
      }),
    }, calls)),
  });
  assert.equal(await client.getChainId(), 44005);
  assert.equal(await client.getBlockNumber(), 16n);
  assert.deepEqual(calls.map(({ url }) => url), [endpoints.primary, endpoints.primary]);
});

test("verifies the explorer chain and adapts its balance and gas methods", async () => {
  const calls = [];
  const client = createPublicClient({
    chain: aevum,
    transport: aevumTransport(fakeRpc({
      [endpoints.primary]: () => { throw new TypeError("TLS connection rejected"); },
      [endpoints.config]: () => new Response('  NEXT_PUBLIC_NETWORK_ID: "44005",\n'),
      [endpoints.explorer]: ({ method, params }) => {
        if (method === "eth_chainId") return Response.json({ result: null });
        if (method === "eth_getBalance") return Response.json({ error: "Balance not found" });
        assert.equal(method, "eth_estimateGas");
        assert.equal(params[1], "latest");
        return Response.json({ result: "0x5208" });
      },
    }, calls)),
  });
  assert.equal(await client.getChainId(), 44005);
  assert.equal(await client.getBalance({ address: testToken }), 0n);
  assert.equal(await client.estimateGas({ to: testToken }), 21_000n);
  assert.equal(calls.filter(({ url }) => url === endpoints.config).length, 1);
});

test("rejects a reachable RPC on the wrong chain before relaying another request", async () => {
  const calls = [];
  const client = createPublicClient({
    chain: aevum,
    transport: aevumTransport(fakeRpc({
      [endpoints.primary]: () => Response.json({ result: "0x1" }),
    }, calls)),
  });
  await assert.rejects(client.getBlockNumber(), /does not identify Aevum Testnet/);
  assert.deepEqual(calls.map(({ payload }) => payload.method), ["eth_chainId"]);
});
