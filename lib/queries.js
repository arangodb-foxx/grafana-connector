import Mustache from "mustache/mustache.mjs";
import {aql} from "@arangodb";

exports.query = function (definition, vars, start, end, interval) {
    const agg = definition.aggregation && definition.aggregation !== 'NONE'
        ? aql.literal(definition.aggregation)
        : null;
    const queryExpression = Mustache.render(definition.query, vars);
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

exports.results = function (cfg, params) {

};

exports.search = function (cfg, body) {
    // TODO handle arrays https://grafana.com/grafana/plugins/simpod-json-datasource/
    if (body) {
        const j = JSON.parse(body);

        if (j.target) {
            const target = j.target;
            const tv = cfg['templateVariables'];

            if (tv[target]) {
                const values = db._query(tv[target]).toArray();
                return values;
            }
        }
    }
    return TARGET_KEYS;
}

/*
const response = [];
const unravel = function () {
    return [].slice.call(arguments);
};

const grafana = {};
let multiKeys = [];
let multiValues = [];

if (cfg['multiValueTemplateVariables']) {
    let d = cfg['multiValueTemplateVariables'];
    multiKeys = _.map(_.split(d, ','), str => str.trim());
}

for (let key of multiKeys) {
    if (key in body.scopedVars) {
        let value = body.scopedVars[key].value;

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

for (let key of Object.keys(body.scopedVars)) {
    if (key[0] !== '_' && !multiValues.includes(key)) {
        const val = body.scopedVars[key];
        grafana[key] = htmlDecode(val.value);

        if (logQuery) {
            console.log('using grafana var \'' + key + '\': \'' + grafana[key] + '\'');
        }
    }
}

for (let mv of multiValues) {
    for (let {target, type, data} of body.targets) {
        let original = target;
        const targetDef = TARGETS[original];

        if (!targetDef) {
            throw Error(`unknown target ${original}`);
        }

        const definition = _.merge({}, targetDef);
        const vars = _.assign({grafana}, definition.view, data);

        for (let m of mv) {
            if (logQuery) {
                console.log('using multi-value vars \'' + JSON.stringify(m) + '\'');
            }

            vars.grafana = _.assign(vars.grafana, m);
        }

        if (targetDef.alias) {
            target = Mustache.render(targetDef.alias, vars);
        }

        if (data && data.alias) {
            target = Mustache.render(data.alias, vars);
        }

        const isTable = (type === 'table');
        const datapoints = definition ?
            seriesQuery(definition, vars, start, end, interval, isTable) :
            [];

        if (datapoints.length > 0 || !hideEmpty) {
            if (isTable) {
                response.push({
                    target: target,
                    type: 'table',
                    columns: [{text: definition.dateName}, {text: definition.valueName}],
                    rows: datapoints
                });
            } else {
                response.push({
                    target: target,
                    type: 'timeserie',
                    datapoints,
                    debug: {aql: "for x in doc"}
                });
            }
        }
    }
}

*/