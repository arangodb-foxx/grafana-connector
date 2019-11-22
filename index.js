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

router
  .post("/tag-keys", (_req, res) => {
    res.json([
      {"type":"string","text":"host"},
      {"type":"string","text":"plugin"},
      {"type":"string","text":"plugin_instance"},
      {"type":"string","text":"type"},
      {"type":"string","text":"type_instance"},
      {"type":"string","text":"values_index"}
    ]);
  })
  .summary("collectd field names")
  .description(
    "The names within collectd that may be used in wildcard selection."
  );

router
  .post("/tag-values", (_req, res) => {
    res.json([
      {'text': 'Eins!'},
      {'text': 'Zwei'},
      {'text': 'Drei!'}
    ]);
  })
  .summary("List the available metrics")
  .description(
    "This endpoint is used to determine which metrics (collections) are available to the data source."
  );

router
  .post("/query", (req, res) => {
    let aggregate = {"MAX" : aql`MAX`};

    // grafana request has time as number of milliseconds

    const body = req.body;
    const interval = body.intervalMs /1000;
    const start = Number(new Date(body.range.from))/1000;
    const end = Number(new Date(body.range.to))/1000;
    const { dateField, valueField } = cfg;

    let host, plugin, plugin_instance, values_index, collectionName, typeName;
    let derive = Boolean(true);
    let factor = 1.0;
    let aggregation = "MAX";
    let dashboardProp = {"dummy": "seed"};
    let summaryField = undefined;
    // find values from dashboard "adhocFilter"
    for (const {key, value} of body.adhocFilters) {
      dashboardProp[`${key}`] = value;
    } // for

    const response = [];
    // loop over "targets"
    for (const { target, type } of body.targets) {

      // also find values from "target"
      const decode = JSON.parse(target);
      const combinedProps = Object.assign( {}, dashboardProp, decode);

      const collection = db._collection(combinedProps["collection"]);
      let queryStr = aql`FOR doc IN ${collection}`;

      queryStr = aql.join([queryStr, aql`FILTER doc.${dateField} >= ${start}`, aql`FILTER doc.${dateField} < ${end}`]);

      for (let propName in combinedProps) {
        switch (propName) {
        case "collection":
          //              collectionName = combinedProps[propName];
          break;

        case "host":
          queryStr = aql.join([queryStr, aql`FILTER doc.host == ${combinedProps[propName]}`])
          break;

        case "plugin":
          queryStr = aql.join([queryStr, aql`FILTER doc.plugin == ${combinedProps[propName]}`])
          break;

        case "plugin_instance":
          let tempStr = combinedProps[propName];
          queryStr = aql.join([queryStr, aql`FILTER doc.plugin_instance == ${combinedProps[propName]}`])
//slow          let tempStr = combinedProps[propName] + "%";
//slow          queryStr = aql.join([queryStr, aql`FILTER doc.plugin_instance LIKE ${tempStr}`])
          break;

        case "type":
          queryStr = aql.join([queryStr, aql`FILTER doc.type == ${combinedProps[propName]}`])
          break;

        case "type_instance":
          queryStr = aql.join([queryStr, aql`FILTER doc.type_instance == ${combinedProps[propName]}`])
          break;

        case "values_index":
          values_index = combinedProps[propName];
          break;

        case "derive":
          derive = (combinedProps[propName] == 'true');
          break;

        case "aggregation":
          aggregation = combinedProps[propName];
          break;

        case "summary_field":
          summaryField = combinedProps[propName];
          break;

        case "factor":
          factor = combinedProps[propName];
          break;

        default:
          // some error
          break;
        } // switch
      } // for

      queryStr = aql.join([queryStr, aql`COLLECT date = FLOOR(doc.${dateField} / ${interval}) * ${interval}`]);

      if (undefined !== summaryField) {
        queryStr = aql.join([queryStr, aql`, summary = doc.${summaryField}`]);
      }

      queryStr = aql.join([queryStr, aql` AGGREGATE value = `, aggregate[aggregation],aql`(doc.${valueField}[${values_index}])`], "")

      if (undefined === summaryField) {
        queryStr = aql.join([queryStr, aql`RETURN [value, date*1000]`]);
      } else {
        queryStr = aql.join([queryStr, aql`RETURN [value, date*1000, summary]`]);
      }
      // console.log(queryStr);

      let datapoints = db._query(queryStr).toArray();

      // report raw values or interval diffs?
      if (derive) {
        if (undefined === summaryField) {

          let curValue, prevValue, prevTime;
          for (let i = 0; i < datapoints.length; i++) {
            curValue = datapoints[i][0];
            if (i == 0) {
              datapoints[i][0] = 0;
            } else if (prevValue <= curValue) {
              datapoints[i][0] = curValue - prevValue;
            } else {
              datapoints[i][0] = 0;
            }
            // adjust intervals from milliseconds to seconds
            datapoints[i][0] = datapoints[i][0] * factor;
            datapoints[i][0] = datapoints[i][0] * 1000 / (datapoints[i][1] - prevTime);
            prevValue = curValue;
            prevTime = datapoints[i][1];
          } // for
        } else {
          let idx;
          let curValue = [];
          let prevValue = [];
          let prevTime = [];

          for (let i = 0; i < datapoints.length; i++) {
            idx = datapoints[i][2];
            curValue[idx] = datapoints[i][0];
            if (undefined === prevValue[idx]) {
              datapoints[i][0] = 0;
            } else if (prevValue[idx] <= curValue[idx]) {
              datapoints[i][0] = curValue[idx] - prevValue[idx];
            } else {
              datapoints[i][0] = 0;
            }
            // adjust intervals from milliseconds to seconds
            datapoints[i][0] = datapoints[i][0] * factor;
            datapoints[i][0] = datapoints[i][0] * 1000 / (datapoints[i][1] - prevTime[idx]);
            prevValue[idx] = curValue[idx];
            prevTime[idx] = datapoints[i][1];
          } // for

          let total = 0;
          let prevTime2 = 0;
          let newDatapoints = [];
          for (let i = 0; i < datapoints.length; i++) {
            if (prevTime2 != datapoints[i][1]) {
              if (0 != prevTime2) {
                newDatapoints.push([total, prevTime2]);
              }
              prevTime2 = datapoints[i][1];
              total = 0;
            }
            total = total + datapoints[i][0];
          } // for
          newDatapoints.push([total, prevTime2]);

          datapoints = newDatapoints;
        }
      }   // if
      if (type === "table") {
        response.push({
          target,
          type: "table",
          columns: [{ text: "date" }, { text: "value" }],
          rows: datapoints.map(([a, b]) => [b, a])
        });
      } else {
        //          console.log("before push")
        response.push({
          target,
          type: "timeserie",
          datapoints
        });
        //          console.log("after push")
      }
    }
    //      console.log(response)
    //      console.log("duh")
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
