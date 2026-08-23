#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const candidates = ["dist/client", "dist", ".output/public", "build/client"];
const root = candidates.find((dir) => {
  return existsSync(join(dir, "index.html")) || existsSync(join(dir, "_shell.html"));
});
if (!root) {
  console.error("pages-postbuild: no index.html or _shell.html in", candidates);
  process.exit(1);
}

const dest = "dist/client";
if (root !== dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(root, dest, { recursive: true });
}

if (!existsSync(join(dest, "index.html"))) {
  const shell = join(dest, "_shell.html");
  if (!existsSync(shell)) {
    console.error("pages-postbuild: missing SPA shell");
    process.exit(1);
  }
  copyFileSync(shell, join(dest, "index.html"));
}

writeFileSync(join(dest, ".nojekyll"), "");
copyFileSync(join(dest, "index.html"), join(dest, "404.html"));
for (const extra of ["__grok", "_shell.html"]) {
  rmSync(join(dest, extra), { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, from: root, dest, files: readdirSync(dest).slice(0, 24) }));
