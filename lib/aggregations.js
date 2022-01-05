const {parse_variable} = require("./utils");
const Mustache = require("mustache/mustache");
const _ = require("lodash");

const AGGREGATIONS = [
    'AVERAGE',
    'COUNT',
    'COUNT_DISTINCT',
    'MAX',
    'MIN',
    'SORTED_UNIQUE',
    'STDDEV_POPULATION',
    'STDDEV_SAMPLE',
    'SUM',
    'UNIQUE',
    'VARIANCE_POPULATION',
    'VARIANCE_SAMPLE',
    'NONE'
];

const AGGREGATIONS_ALIASES = {
    'AVG': 'AVERAGE',
    'COUNT_UNIQUE': 'COUNT_DISTINCT',
    'LENGTH': 'COUNT',
    'STDDEV': 'STDDEV_POPULATION',
    'VARIANCE': 'VARIANCE_POPULATION'
};

exports.aggregations = function (cfg) {
    let agg = cfg['aggregation'];
    agg = agg ? agg.toUpperCase(agg) : null;

    if (AGGREGATIONS_ALIASES[agg]) {
        agg = AGGREGATIONS_ALIASES[agg];
    }

    const aggregations = (agg && agg !== '*')
        ? parse_variable(agg)
        : AGGREGATIONS;
};

exports.targets = function (cfg) {
    const TARGETS = {};
    const target = cfg['target'];

    for (let aggregation of aggregations()) {
        const t = Mustache.render(target, {aggregation});

        TARGETS[t] = {
            target: t,
            alias: cfg.alias,
            view: {aggregation},
            aggregation,
            query: cfg.query
        };
    }

    const TARGET_KEYS = _.keys(TARGETS);
    return {TARGETS, TARGET_KEYS};
};

