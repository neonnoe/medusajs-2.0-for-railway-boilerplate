// src/modules/postmark/index.ts

import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PostmarkNotificationProviderService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [PostmarkNotificationProviderService],
})
