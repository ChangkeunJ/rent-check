import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULES, check, monthsBetween } from '../web/rules.js'

const d = (s: string) => new Date(s + 'T00:00:00Z')

test('a month is not up until the day comes round again', () => {
  assert.equal(monthsBetween(d('2025-01-31'), d('2026-01-30')), 11)
  assert.equal(monthsBetween(d('2025-01-31'), d('2026-01-31')), 12)
  assert.equal(monthsBetween(d('2025-06-15'), d('2026-09-01')), 14)
})

test('an increase a year and a day later is often enough apart', () => {
  const c = check(RULES.NSW!, d('2025-03-01'), d('2026-03-02'), d('2025-12-01'))
  assert.equal(c.often, true)
  assert.equal(c.months, 12)
})

test('an increase eleven months on is too soon in both states', () => {
  for (const st of ['NSW', 'QLD']) {
    assert.equal(check(RULES[st]!, d('2025-03-01'), d('2026-02-01'), d('2025-10-01')).often, false)
  }
})

test('Queensland asks two months of notice where New South Wales asks sixty days', () => {
  const short = { since: d('2025-01-01'), from: d('2026-03-01'), told: d('2026-02-01') }
  assert.equal(check(RULES.NSW!, short.since, short.from, short.told).notice, false)
  assert.equal(check(RULES.QLD!, short.since, short.from, short.told).notice, false)
  const long = check(RULES.NSW!, d('2025-01-01'), d('2026-03-01'), d('2025-12-15'))
  assert.equal(long.notice, true)
  assert.equal(long.days, 76)
})

test('every rule carries the Act it came from', () => {
  for (const r of Object.values(RULES)) {
    assert.match(r.law, /^https:\/\/(www\.)?legislation\./)
    assert.ok(r.act.length > 20)
  }
})
