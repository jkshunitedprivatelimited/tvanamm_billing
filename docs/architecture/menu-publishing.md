# Central Menu Publishing and Outlet Overrides

## Ownership

- Central Admin maintains the standard master menu for JKSH brands.
- Franchise Owners may create private menu items for their own outlets.
- Outlets may set different selling prices and availability.
- Franchise Owners may customize the name, image, category, add-ons, price, and
  availability of a Central item for an owned outlet.
- Franchise-created items belong only to the selected outlet; they are not
  automatically shared with the owner's other outlets.
- Store Employees cannot edit menu definitions or prices while billing.

## Draft and Publish Flow

1. Central edits a master item in draft state.
2. Saving the draft does not change any outlet menu.
3. Central selects `Publish to outlets`.
4. The system previews changed fields, target brand, affected outlets, and
   conflicts/overrides.
5. Central confirms the versioned publication.
6. A background job applies the update idempotently and reports progress,
   successes, skipped outlets, and failures.
7. Every publication and target result is audited.

There is no automatic mass update merely because Central saved an item.

Franchise Owner edits follow the same safe pattern within one selected outlet:

1. Save outlet menu or price changes as a draft.
2. Preview the affected fields and selected outlet.
3. Explicitly publish a new immutable outlet menu version.

Saving an owner draft never changes the live POS menu, and a publication never
changes prices in an already open cart.

## Safe Default Merge Rules

- Master item fields may be published to outlets using the item.
- Outlet field-level overrides—including name, image, category, add-ons, price,
  and availability—are preserved by default.
- Franchise-created private items are never changed by master publication.
- Overwriting outlet prices requires a separate explicit `Publish standard
  price` selection, a preview, and final confirmation.
- Overwriting any other customized outlet field requires an explicit field-level
  force selection in the publication preview.
- Central can target all outlets for a brand or a selected subset.
- An outlet receives a new menu version atomically; employees never see half of a
  publication.
- Offline terminals receive the new version on synchronization. Bills created
  with a previously valid cached version retain their original snapshots.

## Promote Outlet Item to Master

- Central can review a franchise-created item from any outlet.
- `Copy to master menu` creates a new master item; it does not transfer ownership
  or mutate the outlet's original item.
- Central reviews and may edit its name, category, image, add-ons, GST-inclusive
  standard price, and brand before saving the master draft.
- The new master item is not distributed until Central uses the normal `Publish
  to outlets` workflow.
- Provenance records the source outlet item and Central actor for audit/deduping.

## Out-of-Stock Display

- Unavailable products remain visible in Store POS with an `Out of stock` label.
- Add-to-cart is disabled while unavailable.
- Existing cart lines are revalidated before checkout.
- Product details and past bill snapshots remain available.
- The UI shows when availability was last synchronized while offline.

## Optimization

- Store immutable menu versions and field-level changes instead of copying a full
  menu for every draft.
- Publish through a background job in bounded batches.
- Invalidate only affected outlet/menu caches.
- POS downloads a compact version diff when possible and a full snapshot only
  when required.
- Reuse images by content-addressed URLs instead of copying files per outlet.

## Failure Handling

- Failed targets remain on their previous complete menu version.
- Retrying a publication cannot apply it twice.
- Central can retry only failed outlets.
- Rollback publishes a new version based on the previous version; it never edits
  completed bill snapshots.
