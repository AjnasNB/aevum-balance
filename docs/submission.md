# Aevum Builder Challenge submission

- **Project** Aevum Balance
- **Track** Invoice Payments
- **Summary** One payable invoice across wallets, with direct tUSD8 settlement and one on-chain receipt.

Merchant creates a 1 tUSD8 invoice and shares the link. The first payer confirms the merchant and pays 0.4 tUSD8. The second opens the same link and sees 0.6 left. The final receipt proves each payment and shows a zero balance.

| Deliverable | Status |
| --- | --- |
| Public MIT-licensed source | [Aevum Balance on GitHub](https://github.com/AjnasNB/aevum-balance) |
| Working browser prototype and Dockerfile | Builds locally. Aevum mode activates after deployment. |
| Documentation | [README](../README.md) |
| Live Aevum integration | Public deployment, explorer source verification and two real installment hashes pending. |
| Demo video | Local rehearsal recorded. Final video must show actual Aevum settlement and explorer hashes. |
| DoraHacks receipt | Pending an eligible live demo and sign-in. |

## Demo sequence

1. Open an invoice and show the connected merchant address and total.
2. Reopen the same link in another wallet. Confirm the payee and send 0.4 tUSD8. Show the remaining balance.
3. Switch to the second wallet and pay 0.6 tUSD8. Show that the payment form disappears once the invoice is settled.
4. Open both explorer transactions. Show Aevum chain ID 44005, both senders, the same merchant and the two contract events.
5. Mention that the app accepts only tUSD8, caps every installment at the current remainder and transfers funds directly.

The organizer lists a closing time of 11 December 2026 at 08:00 UTC, or 13:30 IST. [DoraHacks submission page](https://dorahacks.io/hackathon/qday/detail)
