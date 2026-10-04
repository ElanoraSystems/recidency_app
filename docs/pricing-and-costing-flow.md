# Pricing, costing and accounting flow

How a price travels from the recipe to the purchase request, order, goods receipt and finally consumption, and which
document decides the actual cost at each step. Everything here describes what the application does today.

## The flow at a glance

| Stage | Price shown | Where it comes from | Can the user change it? | Financial effect |
|---|---|---|---|---|
| Recipe | Cost per portion | Each ingredient's **current average cost** (weighted average of the batches in stock, i.e. what GRNs actually paid) | No (derived). History is kept on the recipe page | None - it is a costing estimate |
| Purchase Request (PR) | Indicative price per line | Item Master **last purchase price** (what the last goods receipt actually paid); if the item was never bought, the stock's average cost | **No** - read only, set by the system | None |
| Purchase Order (PO) | Supplier price per line | Pre-filled with the most recent purchase price (the "last 3 purchases" panel shows supplier, date and price); falls back to the PR estimate | **Yes, while the PO is being created** (that is where the supplier price is agreed). After creation it is fixed; every PO then needs approval | None - a commitment, not an expense |
| Goods Receipt (GRN) | Actual price per line | Pre-filled with the PO price; set to the invoiced price | Yes, but a difference from the PO needs a written reason and an approver | **This is where cost is recorded**: stock is valued, the Item Master last price is updated, and an expense is logged |
| Consumption | Cost of stock used | The cost of the batches actually drawn (first-expiry first) | No | Consumption cost - what was used up |

## Answers

1. **Recipe cost** uses each ingredient's current average stock cost (company-wide weighted average of its batches). It moves
   as purchases change that average; the recipe page keeps a cost history. Meals already served keep the cost of the stock
   actually used, so history is not rewritten.
2. **PR** shows an indicative price only, taken from the item's last purchase price. The requester cannot type or change it.
3. **PO** price is entered when the PO is created (pre-filled from the last purchase, with the last 3 purchases shown for
   comparison). It cannot be edited afterwards, and every PO goes through approval, whatever the total.
4. **GRN** records the price finally used: the actual invoiced price per line. It defaults to the PO price.
5. **Financial impact** happens at the **GRN**. When a receipt is submitted the stock is valued at the actual price, an Expense
   is logged at that amount (with the receiving cost center and the GRN reference), and the item's last price is updated.
   There is **no Purchase Invoice document and no payables ledger** today, so nothing happens at an invoice stage, and a PO's
   payment status is not updated.
6. **Price differences**: the GRN actual price is the inventory and financial cost. The PO is never rewritten. If the actual
   differs from the PO, the GRN needs a reason and goes to an approver; the difference is shown on the GRN, on the PO detail
   ("invoiced so far" and "price variance") and in the Spend report.
7. **Monthly spend**: Purchasing > Spend > By month (goods receipts at invoiced price). The dashboard also shows the month's
   total expenses.
8. **Supplier-wise spend**: Purchasing > Spend > By supplier, for any date range; it can also be filtered to one supplier or
   cost center.
9. **Item consumption**: Inventory > Consumption Cost > Consumption by period > By item shows the quantity used per item for
   any date range and location.
10. **Consumption cost**: the same report shows the value by item, by location, by month or by type (meals, waste, count
    differences). The monthly consumption cost per cost center, from the stock count, is below it.

## End to end

```
Recipe cost (estimate, live average cost, history kept)
   |
Purchase Request  - item + quantity + description, indicative price = last purchase price (read only)
   |  approved, then converted (items grouped per supplier, one PO each)
Purchase Order    - supplier price set here, approved by an approver, cost center carried over from the PR
   |
GRN               - actual invoiced price; difference from PO needs a reason + approval
   |                 -> stock valued at actual price (batch cost), Expense logged, Item Master last price updated
   |
Stock (per cost center, first-expiry-first-out batches, each batch keeps its own cost)
   |
Consumption       - meals, waste and count shortfalls draw batches; cost = the batches' own cost
   |
Monthly stock count -> consumption cost per cost center for the month (opening + purchases + transfers in
                       - transfers out - closing); month can then be closed by the owner
```

## Which document controls the cost

* **Estimate**: recipe cost and PR price are estimates only and never change the books.
* **Commitment**: the PO fixes the agreed supplier price but creates no expense.
* **Actual cost**: the **GRN** line price. This is the batch cost, the stock value and the expense.
* **Consumption**: valued at the batch costs the GRNs created, so consumption cost always traces back to a goods receipt.

## Known limits

* No Purchase Invoice / supplier payables, by design for an operation of this size: the supplier's invoice number is
  recorded on the GRN for traceability, but invoices are not matched to POs and GRNs and payment is not tracked.
* Non-food items (cleaning, linen and so on) have no consumption document; their stock falls only through stock counts and
  transfers, valued at average cost.
* Recipe cost uses the company-wide average cost, while a meal is costed from the batches at its own location, so the two can
  differ slightly when locations hold batches bought at different prices.

## Who can move stock

* Raw Material Transfer, Log Meal and Waste Log need the **Kitchen** module; stock counts need the **Inventory** module.
  Both are role based (a role is granted modules). The owner always has access.
* Any user with the module can pick any From and To location. There is no per-location restriction yet.
* Submitting posts the stock movement. Approve and Close need an approver (owner, a manager role, or the creator's
  supervisor). A Closed document can only be reopened by the owner, with a reason.
* A stock count posts its adjustments when submitted and has no separate approval step.
