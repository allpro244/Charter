// Hand typed geography, allowed by data/types.ts and CLAUDE.md rule 13:
// which two letter code and name go with each state FIPS code, and which
// states share a land border. DC is a state here. AK and HI have no
// neighbors. Nothing economic lives in this file.

export interface StateInfo {
  fips: string;
  abbr: string;
  name: string;
}

export const STATES: StateInfo[] = [
  { fips: '01', abbr: 'AL', name: 'Alabama' },
  { fips: '02', abbr: 'AK', name: 'Alaska' },
  { fips: '04', abbr: 'AZ', name: 'Arizona' },
  { fips: '05', abbr: 'AR', name: 'Arkansas' },
  { fips: '06', abbr: 'CA', name: 'California' },
  { fips: '08', abbr: 'CO', name: 'Colorado' },
  { fips: '09', abbr: 'CT', name: 'Connecticut' },
  { fips: '10', abbr: 'DE', name: 'Delaware' },
  { fips: '11', abbr: 'DC', name: 'District of Columbia' },
  { fips: '12', abbr: 'FL', name: 'Florida' },
  { fips: '13', abbr: 'GA', name: 'Georgia' },
  { fips: '15', abbr: 'HI', name: 'Hawaii' },
  { fips: '16', abbr: 'ID', name: 'Idaho' },
  { fips: '17', abbr: 'IL', name: 'Illinois' },
  { fips: '18', abbr: 'IN', name: 'Indiana' },
  { fips: '19', abbr: 'IA', name: 'Iowa' },
  { fips: '20', abbr: 'KS', name: 'Kansas' },
  { fips: '21', abbr: 'KY', name: 'Kentucky' },
  { fips: '22', abbr: 'LA', name: 'Louisiana' },
  { fips: '23', abbr: 'ME', name: 'Maine' },
  { fips: '24', abbr: 'MD', name: 'Maryland' },
  { fips: '25', abbr: 'MA', name: 'Massachusetts' },
  { fips: '26', abbr: 'MI', name: 'Michigan' },
  { fips: '27', abbr: 'MN', name: 'Minnesota' },
  { fips: '28', abbr: 'MS', name: 'Mississippi' },
  { fips: '29', abbr: 'MO', name: 'Missouri' },
  { fips: '30', abbr: 'MT', name: 'Montana' },
  { fips: '31', abbr: 'NE', name: 'Nebraska' },
  { fips: '32', abbr: 'NV', name: 'Nevada' },
  { fips: '33', abbr: 'NH', name: 'New Hampshire' },
  { fips: '34', abbr: 'NJ', name: 'New Jersey' },
  { fips: '35', abbr: 'NM', name: 'New Mexico' },
  { fips: '36', abbr: 'NY', name: 'New York' },
  { fips: '37', abbr: 'NC', name: 'North Carolina' },
  { fips: '38', abbr: 'ND', name: 'North Dakota' },
  { fips: '39', abbr: 'OH', name: 'Ohio' },
  { fips: '40', abbr: 'OK', name: 'Oklahoma' },
  { fips: '41', abbr: 'OR', name: 'Oregon' },
  { fips: '42', abbr: 'PA', name: 'Pennsylvania' },
  { fips: '44', abbr: 'RI', name: 'Rhode Island' },
  { fips: '45', abbr: 'SC', name: 'South Carolina' },
  { fips: '46', abbr: 'SD', name: 'South Dakota' },
  { fips: '47', abbr: 'TN', name: 'Tennessee' },
  { fips: '48', abbr: 'TX', name: 'Texas' },
  { fips: '49', abbr: 'UT', name: 'Utah' },
  { fips: '50', abbr: 'VT', name: 'Vermont' },
  { fips: '51', abbr: 'VA', name: 'Virginia' },
  { fips: '53', abbr: 'WA', name: 'Washington' },
  { fips: '54', abbr: 'WV', name: 'West Virginia' },
  { fips: '55', abbr: 'WI', name: 'Wisconsin' },
  { fips: '56', abbr: 'WY', name: 'Wyoming' },
];

export const STATE_BY_FIPS: Record<string, StateInfo> = Object.fromEntries(STATES.map((s) => [s.fips, s]));
export const STATE_BY_ABBR: Record<string, StateInfo> = Object.fromEntries(STATES.map((s) => [s.abbr, s]));

// Territories carry state FIPS 60 (AS), 66 (GU), 69 (MP), 72 (PR), 78 (VI).
// Everything above 56 is dropped.
export function isStateFips(fips: string): boolean {
  return fips in STATE_BY_FIPS;
}

// Land borders. Four Corners (AZ-CO, NM-UT) are included. Water-only
// borders (MI-MN across Lake Superior, MI-IL across Lake Michigan) are not.
export const STATE_NEIGHBORS: Record<string, string[]> = {
  AL: ['FL', 'GA', 'MS', 'TN'],
  AK: [],
  AZ: ['CA', 'CO', 'NV', 'NM', 'UT'],
  AR: ['LA', 'MO', 'MS', 'OK', 'TN', 'TX'],
  CA: ['AZ', 'NV', 'OR'],
  CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
  CT: ['MA', 'NY', 'RI'],
  DE: ['MD', 'NJ', 'PA'],
  DC: ['MD', 'VA'],
  FL: ['AL', 'GA'],
  GA: ['AL', 'FL', 'NC', 'SC', 'TN'],
  HI: [],
  ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  IL: ['IN', 'IA', 'KY', 'MO', 'WI'],
  IN: ['IL', 'KY', 'MI', 'OH'],
  IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'],
  KS: ['CO', 'MO', 'NE', 'OK'],
  KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'],
  LA: ['AR', 'MS', 'TX'],
  ME: ['NH'],
  MD: ['DE', 'DC', 'PA', 'VA', 'WV'],
  MA: ['CT', 'NH', 'NY', 'RI', 'VT'],
  MI: ['IN', 'OH', 'WI'],
  MN: ['IA', 'ND', 'SD', 'WI'],
  MS: ['AL', 'AR', 'LA', 'TN'],
  MO: ['AR', 'IL', 'IA', 'KS', 'KY', 'NE', 'OK', 'TN'],
  MT: ['ID', 'ND', 'SD', 'WY'],
  NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'],
  NV: ['AZ', 'CA', 'ID', 'OR', 'UT'],
  NH: ['ME', 'MA', 'VT'],
  NJ: ['DE', 'NY', 'PA'],
  NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
  NY: ['CT', 'MA', 'NJ', 'PA', 'VT'],
  NC: ['GA', 'SC', 'TN', 'VA'],
  ND: ['MN', 'MT', 'SD'],
  OH: ['IN', 'KY', 'MI', 'PA', 'WV'],
  OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'],
  OR: ['CA', 'ID', 'NV', 'WA'],
  PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'],
  RI: ['CT', 'MA'],
  SC: ['GA', 'NC'],
  SD: ['IA', 'MN', 'MT', 'NE', 'ND', 'WY'],
  TN: ['AL', 'AR', 'GA', 'KY', 'MS', 'MO', 'NC', 'VA'],
  TX: ['AR', 'LA', 'NM', 'OK'],
  UT: ['AZ', 'CO', 'ID', 'NV', 'NM', 'WY'],
  VT: ['MA', 'NH', 'NY'],
  VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'],
  WA: ['ID', 'OR'],
  WV: ['KY', 'MD', 'OH', 'PA', 'VA'],
  WI: ['IL', 'IA', 'MI', 'MN'],
  WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
};
