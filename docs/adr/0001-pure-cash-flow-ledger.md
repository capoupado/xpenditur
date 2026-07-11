# xPenditur is a pure cash-flow ledger, not an account tracker

A personal finance tracker usually models an account balance: a starting amount plus every transaction ever, answering "how much money do I have?". We deliberately rejected that. xPenditur has no accounts table, no starting balance, and no carryover between months; "balance" in the UI means monthly net (earnings − spendings for one calendar month), nothing more.

**Why:** a running balance is only honest if the ledger is complete — miss logging one coffee and the number silently diverges from the real bank account forever, turning the headline figure into a lie. Monthly net degrades gracefully under incomplete logging and matches the app's actual purpose (budgeting and month-over-month insight). Retrofitting accounts later would be a schema *and* semantics migration, which is why this is recorded.
