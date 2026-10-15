// One definition of "page" and "limit" for every list endpoint.
//
// Why it exists: several admin/list endpoints did `Number(query.limit) || 20` with no ceiling and no floor.
// `?limit=100000` loaded the whole table (and, for the approved-resources list, signed a download token per
// row), and in SQLite a NEGATIVE limit means "no limit at all". `?page=-3` produced a negative OFFSET.
// resourceController already clamped properly; this makes everything behave the same way.
export function pageParams(c, { defaultLimit = 20, maxLimit = 100, maxPage = 100000 } = {}) {
  let limit = parseInt(c.req.query("limit"), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);

  let page = parseInt(c.req.query("page"), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  page = Math.min(page, maxPage);

  return { page, limit, offset: (page - 1) * limit };
}
