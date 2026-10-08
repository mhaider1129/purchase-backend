# Approval Engine shadow diagnostic hardening

## Confirmed Non-Stock no-match cause

The owner supplied policy/rule/condition/version exports on 2026-10-07. They show
policy ID 19, version ID 20, version number 1, status SHADOW, with four active
stop-processing rules 70–73. The selected version is not empty or an older
Non-Stock configuration in this export.

Every rule retains `REQUEST_TYPE_EQUALS = Non-Stock` and
`IS_NON_STOCK_REQUEST = true`. Amount operands are exactly `5000001`; high uses
AMOUNT_GTE and standard uses AMOUNT_LT. These operands are correct.

Conditions 233/237 store `medical`; 241/245 store `operational`. The reported
facts for requests 1044/1147 contain `Medical`/`Operational`. Repository hydration
aliases condition_type/value without altering their text, and the former engine
compared strings exactly. The classification predicate therefore failed even
when request type, Non-Stock flag and amount predicates passed. The policy editor
also offered lowercase classifications, making the representation mismatch an
application interoperability defect.

The fix equates case/trim variants of the two established controlled
classifications only. Unknown classifications retain exact equality. Request
types retain exact equality; there is no broad aliasing, removed scope condition,
threshold change, request-ID branch or organization data rewrite. The simulator's
independent NON_STOCK default was corrected to the canonical `Non-Stock`.

The test fixture contains only the relevant supplied rows and omits timestamps
and unrelated personal data. Hydration/composition tests cover all six amount
cases against this excerpt, including 6/5/5/4 configured steps for medical high,
medical standard, operational high and operational standard respectively.
Resolver dependencies are mocked; actual staffing is not inferred from this test.

## Diagnostic contract and UI

`composeShadowRoute` returns `policy` identity (policy ID/name/code, version
ID/number/status, total and active rule counts) and `ruleDiagnostics` for every
active rule in priority order. Conditions include stored configuredValue,
effective expected operand, raw actual value, sourceField/sourceActual,
PASS/FAIL/UNKNOWN and an explanatory reason. Exact strings display in quotes so
case and whitespace differences can be inspected. Decimal values are not rounded.

A rule with a definite failed condition is NO MATCH; its other UNKNOWN conditions
remain UNKNOWN individually. A rule with no failures and an unavailable operand
is UNKNOWN. Only all-PASS rules are selected. Diagnostics also distinguish
predicate MATCH from selection: rules after a matching stop-processing rule
record skippedBy and do not invoke resolvers or contribute route steps.

New shadow runs record diagnostics and evaluated policy identity in the existing
JSON summary, within the existing atomic shadow persistence transaction. Retrieval
uses that recorded summary rather than evaluating today's policy against old
facts. Older runs show that diagnostics were not recorded and invite a new shadow
run; they are never backfilled. Simulator diagnostics have no persistence or
business side effects. Existing institute scoping and shadow/simulator permission
checks remain enforced server-side.

Legacy semantic-purpose markers display as **Legacy approval — purpose
unavailable**, with neutral styling and explanatory tooltip. Normalization accepts
only explicit semantic metadata when present; it never derives purposes from
role, user, level, position or order. No historical approval rows are changed.

## Deployment and limitations

No database migration required. No frozen migration was edited. Deploy backend
and frontend together after reviewing and merging the Draft PR. Generate a new
shadow run for Non-Stock Version 1 (version ID 20 in the supplied export), then
inspect matched rule, condition results and authority resolution. Existing saved
runs retain their original results and have no retroactive diagnostic trace.

Live database contents and deployment state were not accessed. Export evidence
confirms the representation mismatch; a subsequent policy edit or deployment may
require a new run to verify current configuration. Classification equivalence
does not repair missing facts, unstaffed authorities or ambiguities.

Known semantic debt remains explicit: IS_NON_STOCK_REQUEST evaluates
`isStockRequest === false`; its stored value is not an operand. Boolean conditions
remain unary. REQUEST_TYPE_EQUALS is necessary to constrain this predicate to
actual Non-Stock requests. Condition groups retain the existing conjunctive
evaluation behavior. These changes do not enable live V2 routing.

LIVE_ROUTING_ENABLED remains FALSE.
The existing approval engine remains authoritative.
No SQL was executed against Development Supabase.
No SQL was executed against Production Supabase.
