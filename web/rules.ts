// What the Act says about raising the rent, in the three states whose bond data
// is loaded. Each rule carries the section it comes from, because a rule without a
// citation is just an opinion.
export type Rule = {
  act: string
  law: string
  guide: string
  everyMonths: number
  noticeDays: number
  noticeSaid: string
  since: string
  note: string
}

export const RULES: Record<string, Rule> = {
  NSW: {
    act: 'Residential Tenancies Act 2010 (NSW), s 41',
    law: 'https://legislation.nsw.gov.au/view/html/inforce/current/act-2010-042#sec.41',
    guide: 'https://www.nsw.gov.au/housing-and-construction/rules/when-and-how-rent-can-be-increased',
    everyMonths: 12,
    noticeDays: 60,
    noticeSaid: '60 days',
    since: '31 October 2024',
    note:
      'The rent cannot go up in the first 12 months of the tenancy, and not more than once in any 12 months after that. ' +
      'A fixed term agreement of under two years, signed before 13 December 2024 with the increase written into it, is excluded.',
  },
  QLD: {
    act: 'Residential Tenancies and Rooming Accommodation Act 2008 (Qld)',
    law: 'https://www.legislation.qld.gov.au/view/html/inforce/current/act-2008-073',
    guide: 'https://www.rta.qld.gov.au/rent',
    everyMonths: 12,
    noticeDays: 60,
    noticeSaid: 'two months',
    since: '6 June 2024',
    note:
      'The 12 months runs from the day the current rent became payable, and since 6 June 2024 it attaches to the property ' +
      'rather than the tenancy, so an increase to a previous tenant or by a previous owner still counts.',
  },
  VIC: {
    act: 'Residential Tenancies Act 1997 (Vic), s 44',
    law: 'https://www.legislation.vic.gov.au/in-force/acts/residential-tenancies-act-1997',
    guide: 'https://www.consumer.vic.gov.au/housing/renting/rent-bond-bills-and-condition-reports/rent/rent-increases',
    everyMonths: 12,
    noticeDays: 90,
    noticeSaid: '90 days',
    since: '25 November 2025',
    note:
      'The rent cannot go up at intervals of less than 12 months, and since 25 November 2025 the notice period is 90 days ' +
      'rather than 60. The notice has to be on the Consumer Affairs Victoria form; on the wrong form it is not a notice at all.',
  },
}

export type Check = { months: number; days: number; often: boolean; notice: boolean }

// Months between two days, counting a month as passed only once the day of the
// month comes round again.
export function monthsBetween(from: Date, to: Date): number {
  let n = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) n--
  return n
}

export function check(rule: Rule, since: Date, from: Date, told: Date): Check {
  const months = monthsBetween(since, from)
  const days = Math.floor((from.getTime() - told.getTime()) / 86400_000)
  return { months, days, often: months >= rule.everyMonths, notice: days >= rule.noticeDays }
}
