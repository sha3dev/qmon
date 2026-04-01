import { ServiceRuntime } from "./index.ts";

async function main() {
  const SERVICE_RUNTIME = await ServiceRuntime.createDefault();
  SERVICE_RUNTIME.startServer();
}

main();
