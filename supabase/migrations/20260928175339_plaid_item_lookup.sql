-- plaid_item_changed finds a bank by item id alone (the webhook doesn't know
-- whose it is); the primary key leads with user_id, so without this every
-- webhook — and every anonymous call to the function — would scan the table.
-- Deliberately NOT unique: a unique index would let one person claim another's
-- item id first and block their link.
create index plaid_items_item_id_idx on public.plaid_items (item_id);
