# Aevum Balance

A single invoice can be paid in installments by multiple wallets. Aevum Balance gives the merchant one checkout link and an on-chain receipt, while tUSD8 moves directly from each payer to the merchant.

This is a fresh Solidity and browser implementation for PQA Labs’ Aevum Builder Challenge #1. It carries forward the installment idea from [BalanceDue](https://github.com/AjnasNB/balancedue), which used a separate NEAR workflow and off-chain invoice state. [Challenge rules](https://qday.io/builder-challenge)

The live Aevum run settled invoice #1 for 1 tUSD8. Two different wallets paid 0.4 and 0.6 tUSD8, leaving zero due. [Live checkout](https://ajnasnb.github.io/aevum-balance/?invoice=1) · [Demo recording](https://ajnasnb.github.io/aevum-balance/demo.mp4) · [Deployed contract](https://explorer-test.qday.info/address/0x20ac27d59439ec12b2ce7d957083470dd7b287e3) · [0.4 tUSD8 receipt](https://explorer-test.qday.info/tx/0x0d1c14cf61a2b524ae492a31c9600624a5b9c5ed981d17be040f4eee7c8394bd) · [0.6 tUSD8 receipt](https://explorer-test.qday.info/tx/0xc6413304c7e349622175fe9ad8b95e590a71ce08cd0255282862e2b36835ee37)

## Try it from source

Requires Node.js 22 or newer. The contract and browser QA run against local EVM fixtures.

```sh
npm ci
npm test
npm run build
npx playwright-core install chromium
npm run test:browser
```

The browser QA opens an invoice, reloads its link as two separate wallets, pays 0.4 and 0.6, and verifies the zero balance and two receipt entries. Set `DEMO_CAPTURE=1` to save a local rehearsal video and screenshot under `.local/recording/`.

## Deploy on Aevum

- Network is QDay Aevum Testnet, chain ID `44005`, with tQDAY for gas. [Network reference](https://wiki.qday.info/guide/start/add-network)
- Settlement token is tUSD8 at `0x456569838f1d43009A91ebA4263147Afd7233483`, with six decimals. [Challenge token](https://qday.io/builder-challenge)
- The merchant needs gas. Two separate payers each need gas and enough tUSD8 for their installment. The web faucet requires a qualifying recipient. The organizer also documents a `/faucet` command for verified Discord members. Use only testnet-specific wallets and store their keys locally. [Challenge faucet instructions](https://qday.io/builder-challenge#faq)

The client checks the chain ID over HTTPS. If the primary RPC is unreachable, it uses QDay’s official explorer RPC and verifies the chain against the explorer’s public configuration. [Explorer RPC methods](https://docs.blockscout.com/devs/apis/rpc/eth-rpc)

Copy `.env.example` to a git-ignored `.env` file and fill in the three testnet keys. The deploy script checks the chain and token metadata before submitting and records the address and deploy hash in `src/deployment.json`.

```sh
node --env-file=.env scripts/aevum-flow.mjs --balances-only
node --env-file=.env scripts/deploy.mjs
node --env-file=.env scripts/aevum-flow.mjs
npm run dev
```

For explorer source verification, submit the contract source and its constructor argument with Solidity 0.8.39, Paris target and optimizer enabled at 200 runs. Use the recorded deploy transaction to match the contract address. [Aevum Explorer](https://explorer-test.qday.info)

The live smoke test writes a receipt to `.local/aevum-evidence.json`. Run `node scripts/record-aevum.mjs` to verify both live payment receipts and record the checkout and explorer pages under `.local/recording/`. The same invoice ID opens in the browser via `?invoice=<id>`. For a portable demo after deployment, run the packaged web app.

```sh
docker build -t aevum-balance .
docker run --rm -p 8080:80 aevum-balance
```

The browser rehearsal uses fixtures for local development. The hosted checkout and demo above are from the public Aevum run. [Submission checklist](docs/submission.md)

## Architecture

```mermaid
flowchart LR
  M[Merchant wallet] -->|Opens invoice| C[Aevum invoice contract]
  L[Shareable checkout] -->|Reads balance and payee| C
  P[Payer wallets] -->|Confirm payee and amount| L
  C -->|Transfers tUSD8 directly| M
  C -->|Emits indexed installment events| R[Checkout receipt]
```

The contract records the payee from the merchant's own signing wallet and makes it immutable for the invoice. Each payment supplies the expected payee, rejects an amount above the current remainder, and updates the invoice only if the token transfer succeeds. The UI shows the full payee address and requests wallet approval for the installment amount. Payment attempts never count as installments until the receipt confirms them. The service holds no stablecoins, and the share link contains only an invoice number. Invoice metadata and payments are public on the test chain.

Solidity and solc compile the contract. Viem handles wallet actions and typed chain calls. Vite builds the browser app. Ganache and Playwright provide isolated tests and are excluded from the served application. Dependency licenses are MIT (Viem, Vite, Ganache and the solc-js wrapper), GPL-3.0 (the Solidity compiler), and Apache-2.0 (Playwright). Application code uses MIT. The prototype targets the challenge token and has no refunds, merchant identity attestation or mainnet mode.
