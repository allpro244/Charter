// OFF: the officers. Skill, pay, tenure, loyalty; hire from this month's
// candidates, fire with severance.

import type { Ctx } from '../engine/ctx';
import { ROLES, ROLE_LABEL, fire, hire, officerSalary } from '../engine/officers';
import { totalAssets } from '../engine/ledger';
import { type Bank, type World } from '../engine/state';
import { formatDate } from '../engine/time';
import { num, pct } from './format';

export function OfficersScreen({ world, bank, act }: { world: World; bank: Bank; act: (fn: (ctx: Ctx) => void) => void }) {
  const assets = totalAssets(bank.acct);
  return (
    <div>
      <p className="hint">Your three officers. Skill drives the quality of loan memos, lending volume and funding costs; loyalty decides who stays when a rival calls.</p>
      <table>
        <thead>
          <tr>
            <th>Officers</th>
            <th>name</th>
            <th className="num">skill</th>
            <th className="num">salary</th>
            <th className="num">market</th>
            <th className="num">since</th>
            <th className="num">loyalty</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((role) => {
            const o = bank.officers.find((x) => x.role === role);
            return (
              <tr key={role} className={o ? '' : 'alert'}>
                <td>{ROLE_LABEL[role]}</td>
                <td>{o ? o.name : 'vacant'}</td>
                <td className="num">{o ? o.skill : ''}</td>
                <td className="num">{o ? num(o.salary) : ''}</td>
                <td className="num">{o ? num(officerSalary(o.skill, assets)) : ''}</td>
                <td className="num">{o ? formatDate(o.hiredDay) : ''}</td>
                <td className={'num' + (o && o.loyalty < 0.4 ? ' alert' : '')}>{o ? pct(o.loyalty, 0) : ''}</td>
                <td>{o && <button className="btn danger small" onClick={() => act((ctx) => fire(ctx, bank, o.id))}>Fire</button>}</td>
              </tr>
            );
          })}
          <tr className="memo-row">
            <td colSpan={8}>
              CCO: memo quality, red flags, auto-decision error. CLO: application volume and pricing. CFO: funding spreads, securities execution. Vacant roles run at a low default skill.
            </td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Candidates this month</th>
            <th>name</th>
            <th className="num">skill</th>
            <th className="num">salary</th>
            <th className="num">signing bonus</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bank.officerCandidates.map((c) => (
            <tr key={c.id}>
              <td>{ROLE_LABEL[c.role]}</td>
              <td>{c.name}</td>
              <td className="num">{c.skill}</td>
              <td className="num">{num(c.salary)}</td>
              <td className="num">{num(Math.round(c.salary * 0.25))}</td>
              <td>
                <button className="btn primary small" disabled={bank.acct.cash < c.salary * 0.25} onClick={() => act((ctx) => hire(ctx, bank, c.id))}>Hire</button>
              </td>
            </tr>
          ))}
          {bank.officerCandidates.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Candidates arrive at the next month end.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="dim">{world.pending.some((p) => p.kind === 'officer_event') ? 'an officer is waiting for your answer on the feed' : ''}</p>
    </div>
  );
}
