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

if (
  ![
    "LENGTH",
    "MIN",
    "MAX",
    "SUM",
    "AVERAGE",
    "STDDEV_POPULATION",
    "STDDEV_SAMPLE",
    "VARIANCE_POPULATION",
    "VARIANCE_SAMPLE",
    "UNIQUE",
    "SORTED_UNIQUE",
    "COUNT_DISTINCT",
    "COUNT",
    "AVG",
    "STDDEV",
    "VARIANCE",
    "COUNT_UNIQUE"
  ].includes(cfg.aggregation.toUpperCase())
) {
  throw new Error(
    `Invalid service configuration. Unknown aggregation function: ${
      cfg.aggregation
    }`
  );
}

const AGG = aql.literal(cfg.aggregation.toUpperCase());
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

router.get("/", (_req, res) => {
  res.json({ ok: true });
});

router.post("/search", (_req, res) => {
  res.json(TARGETS);
});

router
  .post("/query", (req, res) => {
    const body = req.body;
    const interval = body.intervalMs;
    const start = Number(new Date(body.range.from));
    const end = Number(new Date(body.range.to));
    const { dateField, valueField } = cfg;
    const response = [];
    for (const { target, type } of body.targets) {
      const collection = db._collection(target);
      const datapoints = query`
        FOR doc IN ${collection}
        FILTER doc[${dateField}] >= ${start}
        FILTER doc[${dateField}] < ${end}
        COLLECT date = FLOOR(doc[${dateField}] / ${interval}) * ${interval}
        AGGREGATE value = ${AGG}(doc[${valueField}])
        RETURN [value, date]
      `.toArray();
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
  );
