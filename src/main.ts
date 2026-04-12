import { ServiceRuntime } from "./app/service-runtime.service.ts";

async function main() {
  const serviceRuntime = await ServiceRuntime.createDefault();
  serviceRuntime.startServer();
}

main();
