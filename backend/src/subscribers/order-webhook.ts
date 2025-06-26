import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { N8N_ORDER_PLACED_WEBHOOK_URL } from "../lib/constants"

export default async function orderPlacedWebhook(
  { event: { data }, container }: SubscriberArgs<{ id: string }>
) {
  const logger = container.resolve("logger")
  if (!N8N_ORDER_PLACED_WEBHOOK_URL) {
    logger.warn("N8N webhook URL not configured; skipping")
    return
  }

  try {
    const orderModuleService: any = container.resolve(Modules.ORDER)
    let order
    if (typeof orderModuleService.retrieve === "function") {
      order = await orderModuleService.retrieve(data.id, {
        relations: ["shipping_address"],
        select: [
          "id",
          "created_at",
          "total",
          "payment_status",
          "fulfillment_status",
        ],
      })
    } else if (typeof orderModuleService.retrieveOrder === "function") {
      order = await orderModuleService.retrieveOrder(data.id, {
        relations: ["shipping_address"],
        select: [
          "id",
          "created_at",
          "total",
          "payment_status",
          "fulfillment_status",
        ],
      })
    }

    if (!order) {
      logger.warn(`Order ${data.id} not found`)
      return
    }

    const payload = {
      id: order.id,
      created_at: order.created_at,
      total: order.total,
      shipping_address: order.shipping_address,
      payment_status: order.payment_status,
      fulfillment_status: order.fulfillment_status,
    }

    await fetch(N8N_ORDER_PLACED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    logger.info(`Order ${order.id} sent to n8n webhook`)
  } catch (err: any) {
    logger.error(`Failed to call n8n webhook for order ${data.id}: ${err.message || err}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
