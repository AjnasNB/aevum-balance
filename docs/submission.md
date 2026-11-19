# Aevum Builder Challenge submission

- **Project** Aevum Balance
- **Track** Invoice Payments
- **Summary** One payable invoice across wallets, with direct tUSD8 settlement and one on-chain receipt.

Merchant creates a 1 tUSD8 invoice and shares the link. The first payer confirms the merchant and pays 0.4 tUSD8. The second opens the same link and sees 0.6 left. The final receipt proves each payment and shows a zero balance.

| Deliverable | Status |
| --- | --- |
| Public MIT-licensed source | [Aevum Balance on GitHub](https://github.com/AjnasNB/aevum-balance) |
| Working browser prototype and Dockerfile | [Hosted checkout](https://ajnasnb.github.io/aevum-balance/?invoice=1) and a buildable Dockerfile. |
| Documentation | [README](../README.md) |
| Live Aevum integration | Contract source verified on the Aevum explorer and both tUSD8 installments confirmed. |
| Demo video | [Live recording](https://ajnasnb.github.io/aevum-balance/demo.mp4) shows the settled invoice and both transactions. |
| DoraHacks receipt | Signed in and preparing the Build submission. |

The live Aevum run settled invoice #1 for 1 tUSD8. Two different wallets paid 0.4 and 0.6 tUSD8, leaving zero due. [Live checkout](https://ajnasnb.github.io/aevum-balance/?invoice=1) · [Demo recording](https://ajnasnb.github.io/aevum-balance/demo.mp4) · [Deployed contract](https://explorer-test.qday.info/address/0x20ac27d59439ec12b2ce7d957083470dd7b287e3) · [0.4 tUSD8 receipt](https://explorer-test.qday.info/tx/0x0d1c14cf61a2b524ae492a31c9600624a5b9c5ed981d17be040f4eee7c8394bd) · [0.6 tUSD8 receipt](https://explorer-test.qday.info/tx/0xc6413304c7e349622175fe9ad8b95e590a71ce08cd0255282862e2b36835ee37)

## Demo sequence

1. Open an invoice and show the connected merchant address and total.
2. Reopen the same link in another wallet. Confirm the payee and send 0.4 tUSD8. Show the remaining balance.
3. Switch to the second wallet and pay 0.6 tUSD8. Show that the payment form disappears once the invoice is settled.
4. Open both explorer transactions. Show Aevum chain ID 44005, both senders, the same merchant and the two contract events.
5. Mention that the app accepts only tUSD8, caps every installment at the current remainder and transfers funds directly.

The organizer lists a closing time of 11 December 2026 at 08:00 UTC, or 13:30 IST. [DoraHacks submission page](https://dorahacks.io/hackathon/qday/detail)
