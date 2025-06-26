import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { triggerN8nWebhook } from "../utils/n8n"
import { N8N_ORDER_PLACED_WEBHOOK } from "../lib/constants"

interface OrderModuleService {
  retrieve?: (id: string) => Promise<any>
  retrieveOrder?: (id: string) => Promise<any>
}

export default async function orderPlacedN8nHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const orderModule: OrderModuleService = container.resolve(Modules.ORDER)

  let order: any
  try {
    if (typeof orderModule.retrieve === "function") {
      order = await orderModule.retrieve(data.id)
    } else if (typeof orderModule.retrieveOrder === "function") {
      order = await orderModule.retrieveOrder(data.id)
    }
  } catch (err) {
    logger.error(`Failed to load order ${data.id}`, err)
    return
  }

  if (!order) {
    logger.warn(`No order found for id ${data.id}`)
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
  if (!N8N_ORDER_PLACED_WEBHOOK) {
    logger.warn("N8N_ORDER_PLACED_WEBHOOK not configured")
    return
  }

  await triggerN8nWebhook(N8N_ORDER_PLACED_WEBHOOK, payload)
  logger.info(`🔗 Triggered n8n webhook for order ${order.id}`)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
