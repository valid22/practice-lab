import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = ["License notices for the dependencies bundled in editor.bundle.js."];
for (const [directory, info] of Object.entries(lockfile.packages)) {
  if (!directory || info.dev) continue;
  const license = (await readdir(directory)).find((file) => /^licen[cs]e(?:$|[._-])/i.test(file));
  if (!license) throw new Error("No license file found in " + directory);
  const heading = directory.replace("node_modules/", "") + " " + info.version;
  notices.push(heading + "\n\n" + (await readFile(join(directory, license), "utf8")).trim());
}
await writeFile("web/editor.LICENSE.txt", notices.join("\n\n" + "-".repeat(72) + "\n\n") + "\n");
