// Local-only: jsdom-load editor/_sample.html, run tagEditable, write tagged copy.
const fs = require("fs");
const { JSDOM } = require("jsdom");
const { tagEditable } = require("./tag-editable.cjs");
const html = fs.readFileSync("editor/_sample.html", "utf8");
const dom = new JSDOM(html);
const n = tagEditable(dom.window.document);
fs.writeFileSync("editor/_sample.html", "<!DOCTYPE html>" + dom.window.document.documentElement.outerHTML);
console.log("tagged", n, "editable elements");
