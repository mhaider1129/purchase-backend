'use strict';
const conflict = () => Object.assign(new Error('The request priority queue changed. Reload the latest queue and review your order.'), { statusCode:409,code:'PRIORITY_VERSION_CONFLICT' });
const numberOrLast = value => value == null ? Infinity : Number(value);
const tierOrder = tier => /^P[0-4]$/.test(tier || '') ? Number(tier.slice(1)) : Infinity;
const versionMatches = (value,expected) => ['string','number'].includes(typeof value) && /^\d+$/.test(String(value)) && String(value)===expected;

// Item assessment remains item-specific. One request uses its most urgent
// active assessed item (tier, then score), never a sum that favors more items.
function requestQueue(cases, savedRanks = [], scope = 'institutional') {
  const ranks = new Map(savedRanks.map(row => [String(row.request_id),row]));
  const grouped = new Map();
  for (const row of cases) {
    const id = String(row.request_id);
    if (!grouped.has(id)) grouped.set(id,[]);
    const members = grouped.get(id);
    members.push(row);
  }
  const rows = [...grouped.entries()].map(([id,entries]) => {
    const members=entries.filter((row,index) => entries.findIndex(member => String(member.procurement_case_id)===String(row.procurement_case_id))===index);
    members.sort((a,b) => Number(a.procurement_case_id)-Number(b.procurement_case_id));
    const saved = ranks.get(id);
    const best = [...members].sort((a,b) => tierOrder(a.system_tier)-tierOrder(b.system_tier)
      || numberOrLast(a.system_score == null ? null : -Number(a.system_score))-numberOrLast(b.system_score == null ? null : -Number(b.system_score))
      || Number(a.procurement_case_id)-Number(b.procurement_case_id))[0];
    const first = members[0];
    const minimum = field => { const values=members.map(row => row[field]).filter(value => value != null); return values.length ? Math.min(...values.map(Number)) : null; };
    return { ...best, request_id:first.request_id, procurement_case_id:undefined,
      public_title:members.map(row => row.public_title).filter(Boolean).join(' · '),
      case_status:first.request_status || first.case_status,
      item_count:members.length, members,
      priority_group_names:[...new Set(entries.map(row => row.priority_group_name).filter(Boolean))],
      // SQL already projects departmental request ranks over the active set.
      // Mixing a raw saved rank with these normalized positions would reorder
      // requests incorrectly after higher-ranked requests are completed.
      department_rank:minimum('department_rank'),
      institutional_rank:saved?.institutional_rank ?? minimum('institutional_rank'),
      age:Math.max(...members.map(row => Number(row.age)||0)),
      snapshot:{ rank_version:String(saved?.row_version || 0), cases:Object.fromEntries(members.map(row => [row.procurement_case_id,String(row.row_version)])) },
    };
  });
  const suggested = [...rows].sort((a,b) => tierOrder(a.system_tier)-tierOrder(b.system_tier)
    || numberOrLast(a.system_score == null ? null : -Number(a.system_score))-numberOrLast(b.system_score == null ? null : -Number(b.system_score))
    || Number(a.request_id)-Number(b.request_id));
  const suggestion = new Map(suggested.map((row,index) => [String(row.request_id),row.system_score == null && row.system_tier == null ? null : index+1]));
  rows.sort((a,b) => numberOrLast(a[`${scope}_rank`])-numberOrLast(b[`${scope}_rank`]) || numberOrLast(suggestion.get(String(a.request_id)))-numberOrLast(suggestion.get(String(b.request_id))) || Number(a.request_id)-Number(b.request_id));
  rows.forEach((row,index) => { row[`${scope}_rank`] = row[`${scope}_rank`] == null ? null : index+1; row.system_suggested_rank=suggestion.get(String(row.request_id)); row.department_rank_total=rows.length; });
  return rows;
}

function assertRequestSnapshot(rows, ids, snapshots) {
  if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids.map(String)).size !== rows.length
    || !snapshots || Array.isArray(snapshots) || typeof snapshots !== 'object' || Object.keys(snapshots).length !== rows.length) throw conflict();
  for (const row of rows) {
    const id=String(row.request_id), snapshot=snapshots[id];
    if (!ids.map(String).includes(id) || !snapshot || !versionMatches(snapshot.rank_version,row.snapshot.rank_version)
      || !snapshot.cases || Array.isArray(snapshot.cases) || typeof snapshot.cases !== 'object'
      || Object.keys(snapshot.cases).length !== Object.keys(row.snapshot.cases).length
      || Object.entries(row.snapshot.cases).some(([caseId,version]) => !Object.hasOwn(snapshot.cases,caseId) || !versionMatches(snapshot.cases[caseId],version))) throw conflict();
  }
}
module.exports={ requestQueue,assertRequestSnapshot };
