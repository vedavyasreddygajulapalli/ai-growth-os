import mongoose from "mongoose";
import { connectDatabase } from "./database";
import { runMigrations } from "./migrations";
async function migrate() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await connectDatabase(process.env.MONGODB_URI);
  await runMigrations();
  console.info("Foundation account migration and indexes completed.");
}
migrate().catch(() => { console.error("Migration failed. Check database access and index compatibility."); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
