import { run } from "./cli/main.ts"

const code = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTty: Boolean(process.stdout.isTTY),
})

process.exitCode = code
