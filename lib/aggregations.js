'use strict';

const {parseVariable} = require("./utils");
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

const aggregations = function (cfg) {
    let agg = cfg['aggregation'];
    agg = agg ? agg.toUpperCase(agg) : null;

    if (AGGREGATIONS_ALIASES[agg]) {
        agg = AGGREGATIONS_ALIASES[agg];
    }

    return (agg && agg !== '*')
        ? parseVariable(agg)
        : AGGREGATIONS;
};

exports.targets = function (cfg) {
    const TARGETS = {};
    const targets = _.map(cfg['target'].split(','), str => str.trim());

    for (let target of targets) {
        for (let aggregation of aggregations(cfg)) {
            const t = Mustache.render(target, {aggregation});
            const alias = cfg.alias
                ? Mustache.render(cfg.alias, {target: t, aggregation})
                : null;

            TARGETS[t] = {
                target: t,
                alias,
                view: {aggregation, target: t, rawTarget: target},
                aggregation,
                query: cfg.query,
                data: targets[target]
            };
        }
    }

    const TARGET_KEYS = _.keys(TARGETS);
    return {TARGETS, TARGET_KEYS};
};
