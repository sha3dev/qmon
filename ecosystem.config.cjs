const { join } = require("node:path");
const dotenv = require("dotenv");

const PROJECT_ROOT = __dirname;

dotenv.config({
  path: join(PROJECT_ROOT, ".env"),
});

module.exports = {
  apps: [
    {
      name: "@sha3/polymarket-quant",
      cwd: PROJECT_ROOT,
      script: "node",
      args: "--import tsx src/main.ts",
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    },
  ],
};
