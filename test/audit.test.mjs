import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import * as net from "../pipeline/lib/net.mjs";

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const quiet = { log() {}, error() {} };
const evaluate = (code, values) => runInNewContext(`(async () => { ${code}\n })()`, values);

function requestStub(replies, calls) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(async () => {
      try {
        const addresses = await new Promise((resolve, reject) => options.lookup(url.hostname, { all: true }, (e, a) => e ? reject(e) : resolve(a)));
        calls.push({ url: url.href, addresses, headers: options.headers });
        const reply = replies.shift() || {};
        const res = Readable.from([Buffer.from(reply.body || "ok")]);
        res.statusCode = reply.status || 200;
        res.headers = reply.location ? { location: reply.location } : {};
        callback(res);
      } catch (e) { req.emit("error", e); }
    });
    return req;
  };
}

test("SSRF rejects trailing dots and nonpublic literals", () => {
  for (const u of ["http://localhost./", "http://nas.local./", "http://[::]/", "http://[fe90::1]/", "http://224.0.0.1/", "http://198.18.0.1/"]) {
    assert.equal(net.isPublicUrl(u), false, u);
  }
});

test("SSRF rejects private and mixed DNS answers before connection", async () => {
  assert.equal(typeof net.fetchPublic, "function");
  for (const addresses of [[{ address: "10.0.0.1", family: 4 }], [{ address: "fd00::1", family: 6 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]]) {
    const calls = [];
    await assert.rejects(net.fetchPublic("https://news.example/a", {}, {
      lookup: async () => addresses, request: requestStub([], calls),
    }), /\uacf5\uac1c/);
    assert.equal(calls.length, 0);
  }
});

test("SSRF pins the validated address without resolving twice", async () => {
  assert.equal(typeof net.fetchPublic, "function");
  let lookups = 0;
  const calls = [];
  const res = await net.fetchPublic("https://news.example/a", {}, {
    lookup: async () => (++lookups === 1 ? [{ address: "8.8.8.8", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]),
    request: requestStub([], calls),
  });
  assert.equal(await res.text(), "ok");
  assert.equal(lookups, 1);
  assert.equal(calls[0].url, "https://news.example/a");
  assert.equal(calls[0].addresses[0].address, "8.8.8.8");
});

test("SSRF validates DNS at every redirect", async () => {
  assert.equal(typeof net.fetchPublic, "function");
  const calls = [];
  const lookups = [];
  await assert.rejects(net.fetchPublic("https://news.example/a", {}, {
    lookup: async (h) => { lookups.push(h); return [{ address: h === "news.example" ? "8.8.8.8" : "192.168.0.1", family: 4 }]; },
    request: requestStub([{ status: 302, location: "https://redirect.example/b" }], calls),
  }), /\uacf5\uac1c/);
  assert.deepEqual(lookups, ["news.example", "redirect.example"]);
  assert.equal(calls.length, 1);
});

test("SSRF follows public relative redirects with a hop limit", async () => {
  assert.equal(typeof net.fetchPublic, "function");
  const calls = [];
  const dependencies = { lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request: requestStub([{ status: 302, location: "/b" }, { body: "article" }], calls) };
  assert.equal(await (await net.fetchPublic("https://news.example/a", {}, dependencies)).text(), "article");
  assert.equal(calls[1].url, "https://news.example/b");
  const looping = { ...dependencies, request: requestStub(Array.from({ length: 7 }, () => ({ status: 302, location: "/again" })), []) };
  await assert.rejects(net.fetchPublic("https://news.example/a", {}, looping), /\ub9ac\ub2e4\uc774\ub809\ud2b8/);
});

test("SSRF turns an unusual status code into a rejection instead of crashing", async () => {
  // 실제 http 처럼 응답 콜백을 try 밖(다음 틱)에서 부른다 — 콜백에서 던지면 잡히지 않는 예외가 된다.
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => setImmediate(() => {
      const res = Readable.from([Buffer.from("x")]);
      res.statusCode = 999; res.headers = {};
      callback(res);
    });
    return req;
  };
  await assert.rejects(net.fetchPublic("https://news.example/a", {}, { lookup: async () => [], request }), RangeError);
});

const collector = source("pipeline/collect_assembly_speeches.mjs");
const downloadCode = collector.slice(collector.indexOf("async function downloadBatch("), collector.indexOf("const KW ="));
const batchCode = collector.slice(collector.indexOf("  const BATCH = 1000;"), collector.indexOf("  const dj = readFileSync"));
function collectorMemory() {
  const disk = new Map();
  const downloads = [];
  const values = { Buffer, URLSearchParams, join, basename, createHash, randomUUID: () => "fake-id", RAW: "memory", BASE: "https://unused.example",
    existsSync: (p) => disk.has(p), readFileSync: (p) => disk.get(p), writeFileSync: (p, data) => disk.set(p, data), sleep: async () => {},
    get: async (_url, options) => { if (options) { downloads.push(options.body.get("dataInfo")); return { json: async () => ({ resultCode: "ERR-0000", fid: "fake" }) }; }
      return { arrayBuffer: async () => Buffer.from("PK-memory-xlsx") }; },
    console: quiet, process: { stdout: { write() {} } }, COMMITTEES: ["committee"], SINCE: "2024-05-30", ymd: (s) => s.replaceAll("-", "") };
  return { disk, downloads, values };
}

test("Batch cache includes the content IDs", async () => {
  const m = collectorMemory();
  const files = await evaluate(`${downloadCode}\nreturn [await downloadBatch(['101', '102'], 'batch'), await downloadBatch(['103', '102'], 'batch')];`, m.values);
  assert.notEqual(files[0], files[1]);
  assert.equal(m.downloads.length, 2);
});

test("Collection downloads only new IDs and reuses previous originals", async () => {
  const m = collectorMemory();
  const run = (ids) => evaluate(`${downloadCode}\n${batchCode}\nreturn files;`, { ...m.values, uniq: ids.map((contentId) => ({ contentId })) });
  const first = await run(["101", "102"]);
  const second = await run(["103", "101", "102"]);
  assert.deepEqual(m.downloads, ["101,102", "103"]);
  assert.equal(second.length, 2);
  assert.ok(second.includes(first[0]));
  await run(["102", "103", "101"]);
  assert.equal(m.downloads.length, 2);
  m.disk.delete(first[0]);
  await run(["101", "102", "103"]);
  assert.equal(m.downloads[2], "101,102");
});

const builder = source("pipeline/build_assembly_speeches.mjs");
const quoteCode = builder.slice(builder.indexOf("const byName ="), builder.indexOf("const byMember = {};"));
const unesc = (s) => s.replaceAll("&amp;", "&");
async function quotes(text, core) {
  return evaluate(`${quoteCode}\nreturn added;`, { app: { members: [{ name: "member", quotes: [] }] },
    items: [{ name: "member", text, committee: "committee", date: "2026-11-12" }],
    tagged: [{ id: 0, relevant: true, biz: "POWER", stance: "favor", core }], COMM: [], BIZ: ["POWER"], unesc });
}
const realCore = "The long term direction of energy policy and the burden on citizens require us to oppose this plan.";
test("Quotes reject fabricated tails after a matching prefix", async () => {
  const fabricated = realCore.replace("oppose", "support");
  assert.equal((await quotes(realCore, fabricated)).length, 0);
});
test("Quotes publish the verified original span and context", async () => {
  const before = "A preceding sentence. ";
  const after = " A following sentence.";
  const [q] = await quotes(before + realCore + after, realCore.replaceAll(" ", ""));
  assert.ok(q);
  assert.equal(q.core, realCore);
  assert.equal(q.pre, before.trim());
  assert.equal(q.post, after.trim());
});
test("Quotes abridged with an ellipsis pass only when every piece is in the original, in order", async () => {
  const text = "First we must look at the cost of the grid. Then many other things follow here. Finally the plan must be stopped now.";
  const [q] = await quotes(text, "First we must look at the cost of the grid ... Finally the plan must be stopped now.");
  assert.ok(q);
  assert.equal(q.core, "First we must look at the cost of the grid. ... Finally the plan must be stopped now.".replace(". ...", " ..."));
  assert.equal(q.post, "");
  assert.equal((await quotes(text, "First we must look at the cost of the grid … Finally the plan must be approved now.")).length, 0);
  assert.equal((await quotes(text, "Finally the plan must be stopped now … First we must look at the cost of the grid")).length, 0);
  assert.equal((await quotes(text, "First we must look at the cost of the grid ... now.")).length, 0);
});

const cabinet = source("pipeline/update-cabinet.mjs");
const attachmentsCode = cabinet.slice(cabinet.indexOf("let ok = 0, fail = 0;"), cabinet.indexOf("writeFileSync(INDEX_FILE,"));
const successCode = cabinet.slice(cabinet.indexOf("if (fail > 0 || dbFail)"));
async function cabinetRun(files, { indexed = false, failDownload = false } = {}) {
  const writes = [];
  let code = 0;
  const $ = (el) => typeof el === "string" ? { each: (fn) => files.forEach((f, i) => fn(i, f)) } : { attr: () => el.href, text: () => el.name };
  try {
    await evaluate(`${attachmentsCode}\n${successCode}`, {
      targets: indexed ? [] : [{ nttId: "1", title: "Cabinet meeting (261112)", meetingAt: "2026-11-12" }],
      BASE: "https://unused.example", BBS: "test", load: () => $, clean: (s) => s, join, Buffer,
      get: async (_url, opt) => { if (opt && failDownload) throw new Error("download failed"); return { data: opt ? Buffer.from("fixture") : "fixture" }; },
      writeFileSync: (p, value) => writes.push({ p, value }), MINUTES_DIR: "memory", DATA_DIR: "memory",
      index: {}, GOOGLE_CREDENTIALS: undefined, GOOGLE_FOLDER_ID: undefined, sleep: async () => {}, DELAY: 0, dbFail: false,
      console: quiet, process: { exit: (n) => { code = n; throw new Error("test exit"); } },
    });
  } catch (e) { if (e.message !== "test exit") throw e; }
  return { code, writes };
}
test("Cabinet missing attachments fail without updating success", async () => {
  const r = await cabinetRun([]);
  assert.equal(r.code, 1);
  assert.equal(r.writes.length, 0);
});
test("Cabinet downloads and no new posts record success", async () => {
  for (const indexed of [false, true]) {
    const r = await cabinetRun([{ name: "minutes.pdf", href: "/file.pdf" }], { indexed });
    assert.equal(r.code, 0);
    assert.ok(r.writes.some((w) => w.p.endsWith("cabinet_last_success.json")));
  }
});
test("Cabinet download failure preserves the previous success time", async () => {
  const r = await cabinetRun([{ name: "minutes.pdf", href: "/file.pdf" }], { failDownload: true });
  assert.equal(r.code, 1);
  assert.equal(r.writes.length, 0);
});

test("Next locks a patched Windows RCE version as a dev dependency", () => {
  const pkg = JSON.parse(source("package.json"));
  const lock = JSON.parse(source("package-lock.json"));
  const v = lock.packages["node_modules/next"].version;
  assert.equal(pkg.devDependencies.next, ">=16.3.3 <17");
  const [major, minor, patch] = v.split(".").map(Number);
  assert.ok(major === 16 && (minor > 3 || (minor === 3 && patch >= 3)), `vulnerable or unsupported next: ${v}`);
  assert.equal(lock.packages[""].devDependencies.next, pkg.devDependencies.next);
  assert.equal(lock.packages["node_modules/next"].version, v);
  assert.equal(lock.packages["node_modules/next"].dev, true);
});


// Exercise the excerpt request path without importing or running its main body.
const excerpts = source("pipeline/6_fetch_excerpts.mjs");
const readCappedCode = excerpts.slice(excerpts.indexOf("async function readCapped("), excerpts.indexOf("const decode ="));
const htmlCode = excerpts.slice(excerpts.indexOf("async function fetchHtml("), excerpts.indexOf("const metaOf ="));
test("Excerpt HTML uses the guarded request and keeps the byte limit", async () => {
  const calls = [];
  const values = { Buffer, AbortSignal, TextDecoder, UA: "test", TIMEOUT_MS: 1000, MAX_BYTES: 8,
    fetchPublic: (url, options) => net.fetchPublic(url, options, {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }], request: requestStub([{ body: "article" }], calls),
    }) };
  assert.equal(await evaluate(`${readCappedCode}\n${htmlCode}\nreturn fetchHtml('https://news.example/a');`, values), "article");
  assert.equal(calls.length, 1);
  await assert.rejects(evaluate(`${readCappedCode}\n${htmlCode}\nreturn fetchHtml('https://news.example/a');`, { ...values, MAX_BYTES: 3 }));
});

test("Collection never marks a failed batch as collected", async () => {
  const m = collectorMemory();
  const values = { ...m.values, uniq: [{ contentId: "101" }], get: async () => { throw new Error("download failed"); } };
  await assert.rejects(evaluate(`${downloadCode}\n${batchCode}`, values), /download failed/);
  assert.equal(m.disk.size, 0);
});
