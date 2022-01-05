import {_} from "lodash";

exports.cartesian = function* (args) {
    let remainder = args.length > 1 ? exports.cartesian(args.slice(1)) : [[]];
    for (let r of remainder)
        for (let h of args[0])
            yield [h, ...r];
}

exports.htmlDecode = function (str) {
    const map = {
        '&amp;': '&',
        '&gt;': '>',
        '&lt;': '<',
        '&quot;': '"',
        '&#39;': '\''
    };

    const re = new RegExp('(' + Object.keys(map).join('|') + '|&#[0-9]{1,5};|&#x[0-9a-fA-F]{1,4};' + ')', 'g');

    return String(str).replace(re, function (match, capture) {
        return (capture in map) ? map[capture] :
            capture[2] === 'x' ?
                String.fromCharCode(parseInt(capture.substr(3), 16)) :
                String.fromCharCode(parseInt(capture.substr(2), 10));
    });
};

exports.parse_variable = function (d) {
    let values = _.map(_.split(d, ','), str => str.trim());

    if (values.length === 0) {
        values = [''];
    }

    return values;
};
