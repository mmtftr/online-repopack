import { api } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import { Bucket } from "encore.dev/storage/objects";
export const CLEAN_OLDER_THAN_DAYS = 30;

export const cleanupOldFiles = api({}, async function () {
  try {
    const cutoffDate = new Date();
    console.info(`Cleaning up old files older than ${CLEAN_OLDER_THAN_DAYS} days.`);
    cutoffDate.setDate(cutoffDate.getDate() - CLEAN_OLDER_THAN_DAYS);

    const objects = await RepopackOutputBucket.list({});

    let numDeleted = 0;
    for await (const obj of objects) {
      const dateOfObj = new Date(parseInt(obj.name.split("-")[0]));
      if (dateOfObj < cutoffDate) {
        try {
          await RepopackOutputBucket.remove(obj.name);
          numDeleted++;
        } catch (error) {
          console.error("Failed to delete old file:", obj.name, error);
        }
      }
    }

    console.info(`Deleted ${numDeleted} old files.`);
  } catch (error) {
    console.error("Failed to cleanup old files:", error);
  }
})

export const cleanupCronjob = new CronJob("repopack-output-cleanup", {
  title: "Repopack Output Cleanup",
  every: "24h",
  endpoint: cleanupOldFiles,
});

export const RepopackOutputBucket = new Bucket("repopack-output", {
  versioned: false,
  public: true
})
