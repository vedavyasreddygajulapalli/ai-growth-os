import { SeoIssueWorkflow, SeoSchemaDraft, SeoProviderConnection } from "./seo/models";
import { CrmLead, CrmActivity, CrmCaptureForm } from "./crm/models";
import { AnalyticsProviderConnection, ConversionDefinition, AnalyticsReport } from "./analytics/models";
import { AgentPolicy, AgentProposal, InboxState } from "./agents/models";
import { Subscription, UsageRecord, BillingWebhookEvent } from "./billing/models";
import { contentModels } from "./content/models";
import { KnowledgeRecord } from "./knowledge/models";
import { crawlerModels } from "./crawler/models";
import { initializeIndexes, Session, User } from "./database";
export async function runMigrations() {
  // Idempotent; legacy users are never silently verified.
  await User.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  await User.updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
  await User.updateMany({ emailVerifiedAt: { $exists: false } }, { $set: { emailVerifiedAt: null } });
  await Session.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  await initializeIndexes();
  await KnowledgeRecord.createIndexes();
  await SeoIssueWorkflow.createIndexes();
  await SeoSchemaDraft.createIndexes();
  await SeoProviderConnection.createIndexes();
  await CrmLead.createIndexes();
  await CrmActivity.createIndexes();
  await CrmCaptureForm.createIndexes();
  await AnalyticsProviderConnection.createIndexes();
  await ConversionDefinition.createIndexes();
  await AnalyticsReport.createIndexes();
  await AgentPolicy.createIndexes();
  await AgentProposal.createIndexes();
  await InboxState.createIndexes();
  await Subscription.createIndexes();
  await UsageRecord.createIndexes();
  await BillingWebhookEvent.createIndexes();
  for (const model of contentModels) await model.createIndexes();
  for (const model of crawlerModels) await model.createIndexes();
}
