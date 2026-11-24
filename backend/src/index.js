import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, dbKind, initDb, one } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startJobs, stopJobs } from './jobs.js';

async function main() {
  await initDb();
  await migrate();
  const hasData = await one(`SELECT 1 FROM users LIMIT 1`);
  if (!hasData && config.seedOnEmpty) await seed();

  const app = createApp();
  const server = app.listen(config.port, () => {
    const u = `http://localhost:${config.port}`;
    console.log(`
  EV Bus Live is running
  ----------------------------------------------
  Home              ${u}
  Developer console ${u}/dev/
  Operator admin    ${u}/admin/
  Conductor app     ${u}/conductor/
  Passenger signup  ${u}/join/?op=ev-services
  ----------------------------------------------
  Database: ${dbKind()}   Messaging: ${config.messagingChannel}   Timezone: ${config.timezone}
`);
  });
  startJobs();

  const shutdown = async () => {
    stopJobs();
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
