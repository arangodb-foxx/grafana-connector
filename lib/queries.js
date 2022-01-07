'use strict';

const Mustache = require("mustache");
const {aql, db} = require("@arangodb");
const _ = require("lodash");

const {htmlDecode, unravel, cartesian} = require("./utils");
const {targets} = require("./aggregations");

const aqlQuery = function (def, vars, start, end, interval) {
    const agg = def.aggregation && def.aggregation !== 'NONE'
        ? aql.literal(def.aggregation)
        : null;
    const queryExpression = Mustache.render(def.query, vars);
    const querySnippet = aql.literal(queryExpression);

    if (agg) {
        return aql`
          ${querySnippet}
          FILTER doc.time >= ${start} AND doc.time < ${end}
          COLLECT date = FLOOR(doc.time / ${interval}) * ${interval}
          AGGREGATE value = ${agg}(doc.value)
          SORT date
          RETURN [value, date]
        `;
    } else {
        return aql`
          ${querySnippet}
          FILTER doc.time >= ${start} AND doc.time < ${end}
          SORT doc.time
          RETURN [doc.value, doc.time]
        `;
    }
};

const computeMultiValues = function (cfg, vars) {
    let multiKeys = [];
    let multiValues = [];

    if (cfg['multiValueTemplateVariables']) {
        let d = cfg['multiValueTemplateVariables'];
        multiKeys = _.map(_.split(d, ','), str => str.trim());
    }

    for (let key of multiKeys) {
        if (key in vars) {
            let value = vars[key].value;

            if (!Array.isArray(value)) {
                value = [value];
            }

            let l = [];

            for (let v of value) {
                let obj = {};
                obj[key] = htmlDecode(v);
                l.push(obj);
            }

            multiValues.push(l);
        }
    }

    if (multiValues.length > 0) {
        multiValues = unravel(...cartesian(multiValues));
    } else {
        multiValues = [[{}]];
    }

    if (cfg.logQuery) {
        console.log(`multiKeys: ${multiKeys}`);
        console.log(`multiValues: ${JSON.stringify(multiValues)}`);
    }

    return {multiKeys, multiValues};
};

const setupSingleValue = function (cfg, grafana, scopedVars, multiKeys) {
    const logQuery = cfg.logQuery;

    for (let key of Object.keys(scopedVars)) {
        if (key[0] !== '_' && !multiKeys.includes(key)) {
            const val = scopedVars[key];
            grafana[key] = htmlDecode(val.value);

            if (logQuery) {
                console.log('using grafana var \'' + key + '\': \'' + grafana[key] + '\'');
            }
        }
    }
};

// see https://grafana.com/grafana/plugins/simpod-json-datasource/
exports.search = function (cfg, target) {
    const tv = cfg['templateVariables'];
    const query = tv[target];

    if (query) {
        if (cfg.logQuery) {
            console.log(`target query ${target}: ${query}`);
        }

        return db._query(query).toArray();
    } else if (cfg.logQuery) {
        console.log(`target ${target} is not known`);
    }

    return [];
}

// see https://grafana.com/grafana/plugins/simpod-json-datasource/
exports.results = function (cfg, params) {
    const logQuery = cfg.logQuery;
    const hideEmpty = cfg.hideEmpty;

    const scopedVars = params.scopedVars || {};
    const {multiKeys, multiValues} = computeMultiValues(cfg, scopedVars);

    // first add single value variables to the map
    const grafana = {};
    setupSingleValue(cfg, grafana, scopedVars, multiKeys);

    // now build a list of targets x multi-values combinations
    const {TARGETS} = targets(cfg);
    const defs = [];

    for (let mv of multiValues) {
        for (let target in TARGETS) {
            const def = _.merge({}, TARGETS[target]);
            const data = def.data;
            const vars = _.assign({grafana}, def.view, data);

            for (let m of mv) {
                vars.grafana = _.assign(vars.grafana, m);
            }

            let name = target;

            // in case we defined an alias in the Grafana query definition
            if (data && data.alias) {
                name = Mustache.render(data.alias, vars);
            }

            // in case we defined an alias in the Foxx configuration
            else if (def.alias) {
                name = Mustache.render(def.alias, vars);
            }

            defs.push({target: name, definition: def, vars});
        }
    }

    // execute the queries
    const response = [];
    const {interval, start, end} = params;

    for (let def of defs) {
        if (logQuery) {
            console.log(`using definition '${JSON.stringify(def)}'`);
        }

        const query = aqlQuery(def.definition, def.vars, start, end, interval);

        if (logQuery) {
            console.log(`using query '${JSON.stringify(query)}'`);
        }

        const datapoints = db._query(query).toArray();

        if (logQuery) {
            console.log(`datapoints '${datapoints}'`);
        }

        if (hideEmpty && datapoints.length > 0) {
            const result = {target: def.target, datapoints};

            if (logQuery) {
                result.query = query;
                result.definition = {
                    alias: def.definition.alias,
                    view: def.definition.view,
                    vars: def.vars
                };
            }


            response.push(result);
        }
    }

    return response;
};
