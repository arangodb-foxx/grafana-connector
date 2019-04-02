"use strict";
const joi = require("joi");
const createRouter = require("@arangodb/foxx/router");
const { context } = require("@arangodb/locals");
const { getTargets } = require("./utils/getTargets");
const { doTableQuery } = require("./queries/table");
const { doTimeserieQuery } = require("./queries/timeserie");
const router = createRouter();
const targets = getTargets(context.configuration.targets);

context.use(router);
router.use((req, res, next) => {
  if (req.arangoUser) next();
  else res.throw("unauthorized");
});

router.get("/", (_req, res) => {
  res.json({ ok: true });
});

router.post("/search", (_req, res) => {
  res.json([...targets.keys()]);
});

router
  .post("/query", (req, res) => {
    const body = req.body;
    const interval = body.intervalMs;
    const start = Number(new Date(body.range.from));
    const end = Number(new Date(body.range.to));
    const response = [];
    for (const { target, type } of body.targets) {
      console.log(JSON.stringify(target));
      const doQuery = type === "table" ? doTableQuery : doTimeserieQuery;
      response.push(
        doQuery({
          target,
          collectionName: targets.get(target),
          start,
          end,
          interval
        })
      );
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
                target: joi.allow(...targets.keys()).required(),
                type: joi.allow("timeserie", "table").required()
              })
              .required()
          )
          .required()
      })
      .options({ allowUnknown: true })
  );

// FAKE FAKE FAKE

router.post("/tag-keys", (req, res) => {
  console.log("/tag-keys", JSON.stringify(req.body));
  res.json([
    { type: "string", text: "statusCode" },
    { type: "string", text: "country" }
  ]);
});

router.post("/tag-values", (req, res) => {
  console.log("/tag-values", JSON.stringify(req.body));
  switch (req.body.key) {
    case "country":
      res.json([
        { text: "de" },
        { text: "es" },
        { text: "fr" },
        { text: "in" },
        { text: "nl" },
        { text: "ru" },
        { text: "us" }
      ]);
      return;
    case "statusCode":
      res.json([
        { text: 200 },
        { text: 404 },
        { text: 201 },
        { text: 400 },
        { text: 500 }
      ]);
      return;
    default:
      res.throw(400);
  }
});
