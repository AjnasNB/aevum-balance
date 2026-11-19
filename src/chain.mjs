import { defineChain, getAddress } from "viem";

export const aevum = defineChain({
  id: 44005,
  name: "QDay Aevum",
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-test.qday.info"] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" } },
  testnet: true,
});

export const testToken = getAddress("0x456569838f1d43009a91eba4263147aFD7233483");
export const decimals = 6;
