import { crawlerModels } from "./crawler/models";
import { initializeIndexes, Session, User } from "./database";
export async function runMigrations() {
  // Idempotent; legacy users are never silently verified.
  await User.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  await User.updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
  await User.updateMany({ emailVerifiedAt: { $exists: false } }, { $set: { emailVerifiedAt: null } });
  await Session.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  await initializeIndexes();
  for (const model of crawlerModels) await model.createIndexes();
}
