"use strict";
const joi = require("joi");
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
const allowAggregations = [
  "AVERAGE",
  "AVG",
  "COUNT",
  "COUNT_DISTINCT",
  "COUNT_UNIQUE",
  "LENGTH",
  "MAX",
  "MIN",
  "SORTED_UNIQUE",
  "STDDEV",
  "STDDEV_POPULATION",
  "STDDEV_SAMPLE",
  "SUM",
  "UNIQUE",
  "VARIANCE",
  "VARIANCE_POPULATION",
  "VARIANCE_SAMPLE"
];

const AGG_NAME = cfg.aggregation.toUpperCase();

if (!allowAggregations.includes(AGG_NAME)) {
  const allowed = allowAggregations.join(", ");
  throw new Error(
    `Invalid service configuration. Unknown aggregation function: ${
      cfg.aggregation
    }, allow are ${allowed}`
  );
}

const AGG = aql.literal(AGG_NAME);
const TARGETS = cfg.collections.split(",").map(str => str.trim());

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
    res.json(TARGETS);
  })
  .summary("List the available metrics")
  .description(
    "This endpoint is used to determine which metrics (collections) are available to the data source."
  );

const seriesQuery = function(collection, start, end, interval) {
  const { dateField, valueField, dateExpression, valueExpression } = cfg;

  let dateSnippet;
  let valueSnippet;

  if (dateExpression) {
    dateSnippet = `LET d = ${dateExpression}`;
  } else {
    dateSnippet = `LET d = doc["${dateField}"]`;
  }

  dateSnippet = aql.literal(dateSnippet);

  if (valueExpression) {
    valueSnippet = `LET v = ${valueExpression}`;
  } else {
    valueSnippet = `LET v = doc["${valueField}"]`;
  }

  valueSnippet = aql.literal(valueSnippet);

  return query`
    FOR doc IN ${collection}
      ${dateSnippet}
      FILTER d >= ${start} AND d < ${end}
      ${valueSnippet}
      COLLECT date = FLOOR(d / ${interval}) * ${interval}
      AGGREGATE value = ${AGG}(v)
      RETURN [value, date]
  `.toArray();
};

router
  .post("/query", (req, res) => {
    const body = req.body;
    const interval = body.intervalMs;
    const start = Number(new Date(body.range.from));
    const end = Number(new Date(body.range.to));
    const response = [];
    for (const { target, type } of body.targets) {
      const collection = db._collection(target);
      const datapoints = seriesQuery(collection, start, end, interval);
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
