import { readFile, writeFile } from "node:fs/promises";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error("Usage: node scripts/build-d1-import.mjs <export.json> <output.sql>");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
if (!Array.isArray(source.schedules)) throw new Error("The export does not contain schedules.");

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = ["PRAGMA foreign_keys = ON;"];
for (const schedule of source.schedules.slice(0, 10)) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(schedule.id)) throw new Error(`Invalid schedule id: ${schedule.id}`);
  statements.push(
    `INSERT INTO pickleball_shared_schedules (id, payload, checked_matches, updated_at, created_at) VALUES (`
      + `${sqlText(schedule.id)}, ${sqlText(JSON.stringify(schedule.payload))}, `
      + `${sqlText(JSON.stringify(schedule.checkedMatches ?? []))}, ${sqlText(schedule.updatedAt)}, `
      + `${sqlText(schedule.createdAt)}) ON CONFLICT(id) DO UPDATE SET `
      + "payload=excluded.payload, checked_matches=excluded.checked_matches, "
      + "updated_at=excluded.updated_at, created_at=excluded.created_at;"
  );
}
statements.push("");

await writeFile(outputPath, statements.join("\n"), "utf8");
console.log(`Prepared ${Math.min(source.schedules.length, 10)} schedules for D1 import.`);
