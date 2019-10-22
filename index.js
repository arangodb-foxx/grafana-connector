"use strict";
const joi = require("joi");
const _ = require("lodash");
const { aql, db, query } = require("@arangodb");
const { context } = require("@arangodb/locals");
const createRouter = require("@arangodb/foxx/router");
const { getAuth } = require("./util");

const AGGREGATIONS = [
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

const AGGREGATIONS_ALIASES = {
  "AVG": "AVERAGE",
  "COUNT_UNIQUE": "COUNT_DISTINCT",
  "LENGTH": "COUNT",
  "STDDEV": "STDDEV_POPULATION",
  "VARIANCE": "VARIANCE_POPULATION"
};

/** @type {{
 *   username: string,
 *   password: string,
 *   targets: string,
 *   collections: string,
 *   aggregation: string,
 *   filterExpression: string,
 *   dateField: string,
 *   dateExpression: string,
 *   valueField: string,
 *   valueExpression: string
 * }} */
const cfg = context.configuration;
const TARGETS = {};

for (let suffix of ["", "_1", "_2", "_3", "_4", "_5", "_6", "_7", "_8", "_9"]) {
  let targets = cfg["targets" + suffix];
  const collections = cfg["collections" + suffix];
  const filterExpression = cfg["filterExpression" + suffix];
  const dateField = cfg["dateField" + suffix];
  const dateExpression = cfg["dateExpression" + suffix];
  const valueField = cfg["valueField" + suffix];
  const valueExpression = cfg["valueExpression" + suffix];

  let aggregation = cfg["aggregation" + suffix].toUpperCase();

  if (AGGREGATIONS_ALIASES[aggregation]) {
    aggregation = AGGREGATIONS_ALIASES[aggregation];
  }

  if (!targets) {
    targets = collections;
  }

  let filterSnippet = aql.literal(filterExpression
    ? `FILTER ${filterExpression}`
    : "");

  let dateSnippet = aql.literal(dateExpression
    ? `LET d = ${dateExpression}`
    : `LET d = doc["${dateField}"]`);

  let valueSnippet = aql.literal(valueExpression
    ? `LET v = ${valueExpression}`
    : `LET v = doc["${valueField}"]`);

  const targetList = _.map(targets, str => str.trim());
  const collectionList = _.map(collections, str => str.trim());

  if (0 === targetList.length) {
    throw new Error(
      `Invalid service configuration: need at least one target or collection`
    );
  }

  if (targetList.length !== collectionList.length) {
    throw new Error(
      `Invalid service configuration: got ${targetList.length} targets, but ${collectionList.length} collections`
    );
  }

  for (let i = 0; i < targetList.length; ++i) {
    let target = targetList[i];
    let collection = collectionList[i];
    let aggregations = aggregation === '*' ? AGGREGATIONS : [aggregation];

    if (!db._collection(collection)) {
      throw new Error(
        `Invalid service configuration. Unknown collection: ${collection}`
      );
    }

    for (let agg of aggregations) {
      let final = target + "." + agg;

      TARGETS[final] = {
        final,
        target,
        collection,
        filterSnippet,
        dateSnippet,
        valueSnippet
      };
    }
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
    res.json(_.keys(TARGETS));
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
