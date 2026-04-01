import Logger from "@sha3/logger";

const PACKAGE_NAME = "@sha3/polymarket-quant";
const LOGGER_NAME = PACKAGE_NAME.startsWith("@") ? PACKAGE_NAME.split("/")[1] || PACKAGE_NAME : PACKAGE_NAME;
const logger = new Logger({ loggerName: LOGGER_NAME });

export default logger;
