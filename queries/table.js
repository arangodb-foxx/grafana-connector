"use strict";
const { db, query } = require("@arangodb");
/** @type {(opts: {target: string, collectionName: string, start: number, end: number, interval: number}) => {target: string, type: "table", columns: {text: string}[], rows: any[]}} */
exports.doTableQuery = ({ target, collectionName, start, end, interval }) => {
  const collection = db._collection(collectionName);
  const cursor = query`
    FOR doc IN ${collection}
    FILTER doc.date >= ${start}
    FILTER doc.date < ${end}
    COLLECT date = FLOOR(doc.date / ${interval}) * ${interval}
    AGGREGATE value = AVG(doc.latencyMs)
    RETURN [date, value]
  `;
  return {
    target,
    type: "table",
    columns: [{ text: "date" }, { text: "mean" }],
    rows: cursor.toArray()
  };
};
