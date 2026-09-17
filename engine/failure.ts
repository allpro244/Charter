// Failure sequence (D8, D28). The FDIC arrives on a Friday, equity goes to
// zero, and on Monday the player is a private citizen. Version 1: the
// receivership takes the whole balance sheet and pays insured depositors.
// Phase 5 adds the weekend purchase and assumption by a rival.

import { type Ctx, addPending, emit, milestone } from './ctx';
import { type Account, type Accounts, post, totalAssets, totalDeposits, totalEquity } from './ledger';
import { type Bank } from './state';
import { money } from './format';
import { formatDate } from './time';

export function failuresDaily(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'closing' && b.closureDay !== null && world.day >= b.closureDay) closeBank(ctx, b);
  }
}

export function closeBank(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const a = b.acct;
  const assets = totalAssets(a);
  const deposits = totalDeposits(a);
  const equity = totalEquity(a);
  const isPlayer = world.playerBankId === b.id;
  emit(ctx, 'regulator', `${b.name} closed by its regulator on ${formatDate(world.day)}. FDIC named receiver. ${money(assets)} in assets, ${money(deposits)} in deposits. Equity ${money(equity)} to zero.`, {
    severity: 'alert',
    bankId: b.id,
  });
  // The receivership takes everything. Posting the negation of every balance
  // is balanced because the identity held before it.
  const entry: Partial<Accounts> = {};
  for (const k of Object.keys(a) as Account[]) if (a[k] !== 0) entry[k] = -a[k];
  post(a, entry);
  b.status = 'failed';
  b.failedDay = world.day;
  b.closureDay = null;
  b.price = null;
  world.failures.push({ day: world.day, state: b.state, assets, name: b.name });
  if (isPlayer) {
    const p = world.player;
    p.shares = 0;
    p.bankId = null;
    world.playerBankId = null;
    const rec = p.record.find((x) => x.bankId === b.id);
    if (rec) {
      rec.to = world.day;
      rec.outcome = 'failed';
    }
    milestone(ctx, `${b.name} failed`);
    addPending(ctx, {
      kind: 'failure',
      bankId: b.id,
      title: `${b.name} has failed`,
      lines: [
        `The FDIC closed ${b.name} on Friday ${formatDate(world.day)}.`,
        `Your shares are worth nothing. You keep ${money(p.cash)} in cash.`,
        `The failure stays on your record. The world goes on.`,
        `Charter a new bank or buy into another one from the map.`,
      ],
      options: [{ key: 'k', label: 'Acknowledge' }],
      data: {},
    });
  }
}
