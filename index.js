"use strict";
const joi = require("joi");
const _ = require("lodash");
const { aql, db, query } = require("@arangodb");
const { context } = require("@arangodb/locals");
const createRouter = require("@arangodb/foxx/router");
const { getAuth } = require("./util");

/** @type {{
 *   collections: string,
 *   aggregation: string,
 *   dateField: string,
 *   valueField: string,
 *   username: string,
 *   password: string
 * }} */
const cfg = context.configuration;
const STD_AGGREGATIONS = [
  "AVERAGE",
  "COUNT",
  "COUNT_DISTINCT",
  "MAX",
  "MIN",
  "SORTED_UNIQUE",
  "STDDEV_POPULATION",
  "STDDEV_SAMPLE",
  "SUM",
  "UNIQUE",
  "VARIANCE_POPULATION",
  "VARIANCE_SAMPLE"
];
const AGGREGATIONS = STD_AGGREGATIONS.concat([
  "AVG",
  "COUNT_UNIQUE",
  "LENGTH",
  "STDDEV",
  "VARIANCE"
]);

const AGG_NAME = cfg.aggregation.toUpperCase();
const TARGETS = _.map((cfg.names ? cfg.names : cfg.collections.split(",")), str => str.trim());
const ALL_TARGETS = _.flatten(_.map(TARGETS, t => _.map(STD_AGGREGATIONS, a => t + "." + a)));

for (const target of TARGETS) {
  if (!db._collection(target)) {
    throw new Error(
      `Invalid service configuration. Unknown collection: ${target}`
    );
  }
}

const router = createRouter();
context.use(router);

router.use((req, res, next) => {
  const auth = getAuth(req);
  if (!auth || !auth.basic) {
    res.throw(401, "Authentication required");
  }
  const { username, password } = auth.basic;
  if (
    username !== cfg.username ||
    (cfg.password && password !== cfg.password)
  ) {
    res.throw(403, "Bad username or password");
  }
  next();
});

router
  .get("/", (_req, res) => {
    res.json({ ok: true });
  })
  .summary("SimpleJSON self-test endpoint")
  .description(
    "This is a dummy endpoint used by the SimpleJSON data source to confirm that the data source is configured correctly."
  );

router
  .post("/search", (_req, res) => {
    res.json(AGG_NAME === '*' ? ALL_TARGETS : TARGETS);
  })
  .summary("List the available metrics")
  .description(
    "This endpoint is used to determine which metrics (collections) are available to the data source."
  );

const seriesQuery = function(collection, start, end, interval, aggName) {
  const agg = aql.literal(aggName);

  const { filterExpression, dateField, valueField, dateExpression,
          valueExpression } = cfg;

  let filterSnippet = aql.literal(filterExpression
    ? `FILTER ${filterExpression}`
    : "");

  let dateSnippet = aql.literal(dateExpression
    ? `LET d = ${dateExpression}`
    : `LET d = doc["${dateField}"]`);

  let valueSnippet = aql.literal(valueExpression
    ? `LET v = ${valueExpression}`
    : `LET v = doc["${valueField}"]`);

  return query`
    FOR doc IN ${collection}
      ${dateSnippet}
      FILTER d >= ${start} AND d < ${end}
      ${filterSnippet}
      ${valueSnippet}
      COLLECT date = FLOOR(d / ${interval}) * ${interval}
      AGGREGATE value = ${agg}(v)
      RETURN [value, date]
  `.toArray();
};

router
  .post("/query", (req, res) => {
    if (AGG_NAME !== '*') {
      if (!AGGREGATIONS.includes(AGG_NAME)) {
        const allowed = AGGREGATIONS.join(", ");
        throw new Error(
          `Invalid service configuration. Unknown aggregation function: ${
             cfg.aggregation
           }, allow are ${allowed}`
        );
      }
    }

    const body = req.body;
    const interval = body.intervalMs;
    const start = Number(new Date(body.range.from));
    const end = Number(new Date(body.range.to));
    const response = [];
    for (const { target, type } of body.targets) {
      let tgt = target;
      let agg = AGG_NAME;

      if (AGG_NAME === '*') {
        const s = target.split('.');
        tgt = s[0];
        agg = s[1];
      }

      const collection = db._collection(tgt);
      const datapoints = seriesQuery(collection, start, end, interval, agg);
      if (type === "table") {
        response.push({
          target,
          type: "table",
          columns: [{ text: "date" }, { text: "value" }],
          rows: datapoints.map(([a, b]) => [b, a])
        });
      } else {
        response.push({
          target,
          type: "timeserie",
          datapoints
        });
      }
    }
    res.json(response);
  })
  .body(
    joi
      .object({
        intervalMs: joi.number().required(),
        range: joi
          .object({
            from: joi.string().required(),
            to: joi.string().required(),
            raw: joi.any().optional()
          })
          .required(),
        targets: joi
          .array()
          .items(
            joi
              .object({
                target: joi.allow(...TARGETS).required(),
                type: joi.allow("timeserie", "table").required()
              })
              .required()
          )
          .required()
      })
      .options({ allowUnknown: true })
  )
  .summary("Perform a SimpleJSON query")
  .description(
    "This endpoint performs the actual query for one or more metrics in a given time range. Results are aggregated with the given interval."
  );
