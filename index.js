'use strict';

const joi = require("joi");
const createRouter = require('@arangodb/foxx/router');

const {context} = require("@arangodb/locals");
const {targets} = require("./lib/aggregations");
const queries = require("./lib/queries");

/** @type {{
 *   username: string,
 *   password: string,
 *   target: string,
 *   alias: string,
 *   aggregation: string,
 *   multiValueTemplateVariables: string,
 *   query: string,
 *   hideEmpty: boolean,
 *   logQuery: boolean,
 *   templateVariables: Object
 * }} */

const cfg = context.configuration;

const USERNAME = cfg['username'];
const {TARGET_KEYS} = targets(cfg);

const router = createRouter();
context.use(router);

if (USERNAME) {
    const PASSWORD = cfg['password'];

    router.use((req, res, next) => {
        const auth = req.auth;
	console.log(auth);
        if (!auth || !auth.basic) {
            res.throw(401, 'Authentication required');
        }
        const {username, password} = auth.basic;
        if (username !== USERNAME || (PASSWORD && password !== PASSWORD)) {
            res.throw(403, 'Bad username or password');
        }
        next();
    });
}

router
    .get('/', (_req, res) => {
        res.json({ok: true});
    })
    .summary('JSON self-test endpoint')
    .description(
        'This is a dummy endpoint used by the JSON data source to ' +
        'confirm that the data source is configured correctly.'
    );

router
    .post('/search', (req, res) => {
	const body = req.body;

	if (body && body.target) {
	    const target = body.target;
	    const results = queries.search(cfg, target);

            if (body.logQuery) {
		console.log(`target ${target}: ${JSON.stringify(results)}`);
	    }

	    res.json(target);
	} else {
            if (body.logQuery) {
		console.log(`target: ${JSON.stringify(TARGET_KEYS)}`);
	    }

	    res.json(TARGET_KEYS);
	}
    })
    .body(joi.object())
    .summary('List the available metrics')
    .description(
        'This endpoint is used to determine which metrics (collections) ' +
        'are available to the data source.'
    );


router
    .post('/query', (req, res) => {
        console.log(JSON.stringify(req));
        const body = req.body;

        const response = queries.results(cfg, {
            interval: body.intervalMs,
	    scopedVars: body.scopedVars,
            start: Number(new Date(body.range.from)),
            end: Number(new Date(body.range.to))
        });

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
                                target: joi.allow(...TARGET_KEYS).required()
                            })
                            .required()
                    )
                    .required()
            })
            .options({allowUnknown: true})
    )
    .summary('Perform a SimpleJSON query')
    .description(
        'This endpoint performs the actual query for one or more metrics in a given time range. ' +
        'Results are aggregated with the given interval.'
    );
