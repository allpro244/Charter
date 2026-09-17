// Per-tick context shared by every system: the world plus the events this
// tick produced. Plain object, no methods.

import { type FeedItem, type FeedSource, type Pending, type World, nextId } from './state';

export interface Ctx {
  world: World;
  events: FeedItem[];
}

export function emit(
  ctx: Ctx,
  source: FeedSource,
  text: string,
  opts: { severity?: FeedItem['severity']; bankId?: string | null; ref?: FeedItem['ref'] } = {},
): FeedItem {
  const item: FeedItem = {
    id: nextId(ctx.world, 'e'),
    day: ctx.world.day,
    source,
    text,
    severity: opts.severity ?? 'info',
    bankId: opts.bankId ?? null,
    ref: opts.ref ?? null,
  };
  ctx.events.push(item);
  return item;
}

export function addPending(ctx: Ctx, p: Omit<Pending, 'id' | 'day'>): Pending {
  const item: Pending = { ...p, id: nextId(ctx.world, 'p'), day: ctx.world.day };
  ctx.world.pending.push(item);
  return item;
}

export function milestone(ctx: Ctx, text: string): void {
  ctx.world.milestones.push({ day: ctx.world.day, text });
}
