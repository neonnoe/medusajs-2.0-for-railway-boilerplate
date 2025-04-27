// src/workflows/shared/steps/send-notification.ts
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { CreateNotificationDTO } from "@medusajs/framework/types"

export const sendNotificationStep = createStep(
  "send-notification",
  async (notifications: CreateNotificationDTO[], { container }) => {
    const notificationService = container.resolve(Modules.NOTIFICATION)
    const result = await notificationService.createNotifications(notifications)
    return new StepResponse(result)
  }
)
