// Startup file for the WhoGoHost (DirectAdmin) Node.js app. Its app server loads this file with
// require(), so it is CommonJS: it enables TypeScript through tsx, then loads the ES module API.
// The app server manages the process and routes api.theivypizza.com traffic to it.
const { register } = require("tsx/esm/api");

register();
import("./server/index.ts").catch((error) => {
  console.error("Ivy Pizza API failed to start", error);
  process.exit(1);
});
