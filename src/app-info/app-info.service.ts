/**
 * @section imports:internals
 */

import config from "../config.ts";

/**
 * @section class
 */

export class AppInfoService {
  /**
   * @section factory
   */

  public static createDefault(): AppInfoService {
    const appInfoService = new AppInfoService();

    return appInfoService;
  }

  /**
   * @section public:methods
   */

  public getServiceName(): string {
    const serviceName = config.SERVICE_NAME;

    return serviceName;
  }
}
