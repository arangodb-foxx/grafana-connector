"use strict";
const joi = require("joi");
const _ = require("lodash");
const Mustache = require("mustache");
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
 *   x1_variable: string,
 *   x2_variable: string,
 *   x3_variable: string,
 *   y1_variable: string,
 *   y2_variable: string,
 *   y3_variable: string,
 *   z1_variable: string,
 *   z2_variable: string,
 *   z3_variable: string,
 *   target: string,
 *   collection: string,
 *   aggregation: string,
 *   filterExpression: string,
 *   dateName: string,
 *   dateField: string,
 *   dateExpression: string,
 *   valueName: string,
 *   valueField: string,
 *   valueExpression: string
 * }} */
const cfg = context.configuration;
const TARGETS = {};

const parse_variable = function(d) {
  let values = _.map(_.split(d, ","), str => str.trim());

  if (values.length === 0) {
    values = [""];
  }

  return values;
};

const variables = [
  _.map(["x1", "x2", "x3"], x => parse_variable(cfg[x + "_variable"])),
  _.map(["y1", "y2", "y3"], x => parse_variable(cfg[x + "_variable"])),
  _.map(["z1", "z2", "z3"], x => parse_variable(cfg[x + "_variable"]))
];

let agg = cfg['aggregation'];

if (AGGREGATIONS_ALIASES[agg]) {
  agg = AGGREGATIONS_ALIASES[agg];
}

const aggregations = (agg && agg !== '*')
      ? parse_variable(agg)
      : AGGREGATIONS;

{
  const target = cfg['target'];
  const collection = cfg['collection'];

  const lengths = _.map(variables, x => _.max(_.map(x, y => y.length)));

  const view = {};

  for (let x = 0; x < lengths[0]; ++x) {
    view['x1'] = variables[0][0][x];
    view['x2'] = variables[0][1][x];
    view['x3'] = variables[0][2][x];

    for (let y = 0; y < lengths[1]; ++y) {
      view['y1'] = variables[1][0][y];
      view['y2'] = variables[1][1][y];
      view['y3'] = variables[1][2][y];

      for (let z = 0; z < lengths[2]; ++z) {
        view['z1'] = variables[2][0][z];
        view['z2'] = variables[2][1][z];
        view['z3'] = variables[2][2][z];

        for (let a = 0; a < aggregations.length; ++a) {
          view['aggregation'] = aggregations[a];

          const t = Mustache.render(target, view);

          let { filterExpression,
                dateName, dateField, dateExpression,
                valueName, valueField, valueExpression } = cfg;

          filterExpression = filterExpression ? Mustache.render(filterExpression, view) : undefined;

          dateField = dateField ? Mustache.render(dateField, view) : undefined;
          dateName = dateName ? Mustache.render(dateName, view) : dateField;
          dateExpression = dateExpression ? Mustache.render(dateExpression, view) : undefined;

          valueField = valueField ? Mustache.render(valueField, view) : undefined;
          valueName = valueName ? Mustache.render(valueName, view) : valueField;
          valueExpression = valueExpression ? Mustache.render(valueExpression, view) : undefined;

          let filterSnippet = aql.literal(filterExpression
            ? `FILTER ${filterExpression}`
            : "");

          let dateSnippet = aql.literal(dateExpression
            ? `LET d = ${dateExpression}`
            : `LET d = doc["${dateField}"]`);

          let valueSnippet = aql.literal(valueExpression
            ? `LET v = ${valueExpression}`
            : `LET v = doc["${valueField}"]`);

          const collectionName = Mustache.render(collection, view);
          const c = db._collection(collectionName);

          if (!c) {
            throw new Error(
              `Invalid service configuration. Unknown collection: ${collectionName}`
            );
          }

          TARGETS[t] = {
            target: t,
            collection: c,
            dateName: dateName,
            valueName: valueName,
            filterSnippet: filterSnippet.toAQL(),
            dateSnippet: dateSnippet.toAQL(),
            valueSnippet: valueSnippet.toAQL()
          };
        }
      }
    }
  }
}

const TARGET_KEYS = _.keys(TARGETS);

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
    res.json(TARGET_KEYS);
  })
  .summary("List the available metrics")
  .description(
    "This endpoint is used to determine which metrics (collections) are available to the data source."
  );

const seriesQuery = function(definition, start, end, interval, isTable) {
  const agg = aql.literal(definition.aggregation);
  const { collection, filterSnippet, dateSnippet, valueSnippet } = definition;

  if (isTable) {
    return query`
      FOR doc IN ${collection}
        ${dateSnippet}
        FILTER d >= ${start} AND d < ${end}
        ${filterSnippet}
        ${valueSnippet}
        RETURN [d, v]
    `.toArray();
  } else {
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
  }
};

router
  .post("/query", (req, res) => {
    const body = req.body;
    const interval = body.intervalMs;
    const start = Number(new Date(body.range.from));
    const end = Number(new Date(body.range.to));
    const response = [];

    for (const { target, type } of body.targets) {
      const definition = TARGETS[target];
      const isTable = (type === "table");
      const datapoints = definition ? seriesQuery(definition, start, end, interval, isTable) : [];

      if (isTable) {
        response.push({
          target,
          type: "table",
          columns: [{ text: definition.dateName }, { text: definition.valueName }],
          rows: datapoints
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
                target: joi.allow(...TARGET_KEYS).required(),
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
