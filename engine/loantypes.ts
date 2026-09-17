// Loan type and grade constants. A leaf module with no imports so credit
// and state can both read it at load time.

export const LOAN_TYPES = ['ci', 'cre_oo', 'cre_inv', 'construction', 'resi', 'consumer', 'ag', 'energy'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const GRADES = 9;

export function emptyByType(value: number): Record<LoanType, number> {
  const out = {} as Record<LoanType, number>;
  for (const t of LOAN_TYPES) out[t] = value;
  return out;
}
