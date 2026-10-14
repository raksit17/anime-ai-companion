import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
for (const app of ["api", "web", "voice"]) {
  const path = `apps/${app}/.env`;
  if (!existsSync(path)) {
    copyFileSync(path + ".example", path);
    console.log("Created " + path);
  }
}
const path = "apps/api/.env";
let env = readFileSync(path, "utf8");
if (!/^LOCAL_API_TOKEN=.{32,}$/m.test(env)) {
  env = env.replace(/^LOCAL_API_TOKEN=.*\r?\n?/gm, "");
  writeFileSync(
    path,
    env.trimEnd() +
      "\nLOCAL_API_TOKEN=" +
      randomBytes(32).toString("hex") +
      "\n",
    { mode: 0o600 },
  );
  console.log(
    "Created local API token in apps/api/.env. Paste it into Connection settings.",
  );
}
