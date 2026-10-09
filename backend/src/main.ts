import { connectDatabase, initializeIndexes } from "./database";
import { createApp } from "./app";
async function main() {
  if (!process.env.MONGODB_URI)
    throw Error(
      "MONGODB_URI is required. Use an Atlas cluster or local replica set.",
    );
  await connectDatabase(process.env.MONGODB_URI);
  if (process.env.INIT_INDEXES === "true") await initializeIndexes();
  const app = await createApp();
  await app.listen(Number(process.env.PORT || 4000), "0.0.0.0");
}
main().catch((error) => {
  console.error(
    error.message?.startsWith("MONGODB_URI")
      ? error.message
      : "API startup failed. Check database configuration and server logs.",
  );
  process.exit(1);
});
