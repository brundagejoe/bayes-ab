import { build } from "esbuild"
import { execSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"

const pkg = JSON.parse(readFileSync("package.json", "utf8"))

rmSync("dist", { recursive: true, force: true })

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(pkg.version) },
}

await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
})

await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
})

execSync("tsc --project tsconfig.build.json", { stdio: "inherit" })
