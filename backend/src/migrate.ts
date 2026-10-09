import mongoose from "mongoose";
import { connectDatabase, initializeIndexes, Session, User } from "./database";
async function migrate() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await connectDatabase(process.env.MONGODB_URI);
  // Idempotent migration from the initial foundation. Never auto-verify legacy accounts.
  await User.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  await User.updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
  await User.updateMany({ emailVerifiedAt: { $exists: false } }, { $set: { emailVerifiedAt: null } });
  await Session.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  await initializeIndexes();
  console.info("Foundation account migration and indexes completed.");
}
migrate().catch(() => { console.error("Migration failed. Check database access and index compatibility."); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
