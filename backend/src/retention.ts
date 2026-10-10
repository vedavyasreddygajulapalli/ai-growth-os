import mongoose from "mongoose";
import { Audit, connectDatabase } from "./database";
import { positiveInteger } from "./environment";
// Dry run by default. Run only after backup and retention policy approval.
async function main() {
  if (!process.env.AUDIT_RETENTION_DAYS) throw Error("AUDIT_RETENTION_DAYS must be explicitly configured");
  const days = positiveInteger(process.env.AUDIT_RETENTION_DAYS, 365, 3650);
  if (!process.env.MONGODB_URI) throw Error("Database configuration required");
  await connectDatabase(process.env.MONGODB_URI);
  const cutoff = new Date(Date.now() - days * 86400000);
  const filter = { occurredAt: { $lt: cutoff } };
  const count = await Audit.countDocuments(filter);
  console.info(JSON.stringify({ operation: "audit.retention", dryRun: !process.argv.includes("--apply"), cutoff, count }));
  if (process.argv.includes("--apply")) {
    // Batch deletion avoids a single unbounded operation; append-only API stays unchanged.
    while (true) {
      const ids = await Audit.find(filter).select("_id").limit(500).lean();
      if (!ids.length) break;
      await Audit.deleteMany({ ...filter, _id: { $in: ids.map(x => x._id) } });
    }
  }
}
main().catch(() => { console.error("Retention failed; check policy and database access."); process.exitCode = 1; }).finally(() => mongoose.disconnect());
