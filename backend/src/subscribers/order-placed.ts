// src/subscribers/order-placed.ts

import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { sendOrderConfirmationWorkflow } from "../workflows/send-order-confirmation"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  logger.info(`📩 Sending confirmation email for order ${data.id}`)

  await sendOrderConfirmationWorkflow(container)
    .run({
      input: {
        id: data.id,
      },
    })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}